import Konva from 'konva';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Layer, Line, Rect, Stage } from 'react-konva';
import { isMac } from '../../../app/shell/undoShortcuts';
import { useProject } from '../../../app/projectStore';
import { aspectRatioValue, projectStoryboard, shotFields } from '../../../core/model/storyboard';
import { Button } from '../../../ui/Button';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { FrameImage } from '../FrameImage';
import { pictureView } from '../framePictures';
import { ProjectPictures } from '../ProjectPictures';
import {
  addStroke,
  eraseStrokes,
  pressureOutline,
  strokesAt,
  strokesOf,
  tidyPoints,
  WIDTHS,
  type SketchTool,
  type Stroke,
  type WidthName,
} from './strokes';

// The sketch editor (1.13): the frame large, over its picture, in a modal dialog. Pen, arrow and box draw; the eraser
// takes off whole strokes it touches. Each stroke, and each pass of the eraser, is one op group, so the app's undo
// takes back one at a time, and the board's cards show the result at once. Konva draws here only; cards draw the same
// strokes as SVG.

type Tool = SketchTool | 'eraser';

const TOOLS: readonly { value: Tool; label: string; key: string }[] = [
  { value: 'pen', label: 'Pen', key: 'p' },
  { value: 'arrow', label: 'Arrow', key: 'a' },
  { value: 'box', label: 'Box', key: 'b' },
  { value: 'eraser', label: 'Eraser', key: 'e' },
];

const WIDTH_OPTIONS: readonly { value: WidthName; label: string }[] = [
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'bold', label: 'Bold' },
];

/** How near the eraser has to come to a stroke: 1.5% of the frame's height. */
const ERASER_RADIUS = 0.015;

/**
 * The ink the strokes are drawn in, read from the theme so the editor matches the cards: `--text`, which a project
 * theme sets on <html>. (Tailwind's `--color-text` is inlined into the classes, not set on the page.)
 */
function inkColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || 'black';
}

/** The largest frame that fits the window with the toolbar above it. */
function fit(aspect: number): { width: number; height: number } {
  const maxWidth = Math.min(window.innerWidth - 96, 1200);
  const maxHeight = window.innerHeight - 220;
  const width = Math.max(240, Math.min(maxWidth, maxHeight * aspect));
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

function KonvaStroke({ stroke, width, height, ink, faded }: { stroke: Stroke; width: number; height: number; ink: string; faded: boolean }) {
  const p = stroke.points.map((n, i) => (i % 2 === 0 ? n * width : n * height));
  const line = stroke.width * height;
  const opacity = faded ? 0.25 : 1;
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    return (
      <Rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} stroke={ink} strokeWidth={line} opacity={opacity} />
    );
  }
  if (stroke.tool === 'arrow') {
    const length = Math.max(line * 4, 8);
    return (
      <Arrow points={p} stroke={ink} fill={ink} strokeWidth={line} pointerLength={length} pointerWidth={length * 0.9} lineCap="round" opacity={opacity} />
    );
  }
  if (stroke.pressures) {
    return <Line points={pressureOutline(stroke.points, stroke.pressures, width, height, stroke.width)} closed fill={ink} opacity={opacity} />;
  }
  return <Line points={p} stroke={ink} strokeWidth={line} lineCap="round" lineJoin="round" opacity={opacity} />;
}

interface SketchEditorProps {
  shotId: string;
  onClose: () => void;
}

/** A stroke in progress: its points so far, and for an arrow or a box drawn by two clicks, where the first fell. */
interface Drawing {
  points: number[];
  pressures: number[] | null;
}

export default function SketchEditor({ shotId, onClose }: SketchEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const applyWith = useProject((s) => s.applyWith);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  const [tool, setTool] = useState<Tool>('pen');
  const [widthName, setWidthName] = useState<WidthName>('medium');
  // The stroke being drawn and the strokes the eraser has touched live in refs, so no pointer event is lost between
  // renders; the state copies are only for drawing them.
  const drawing = useRef<Drawing | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  // An arrow or a box begun with a click rather than a drag (WCAG 2.5.7): the next click ends it.
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [faded, setFaded] = useState<ReadonlySet<string>>(() => new Set());
  const [said, setSaid] = useState('');
  const [ink, setInk] = useState(inkColour);
  const mac = isMac();

  const shot = records[shotId];
  const live = shot?.type === 'shot' && shot.trashedAt === null;
  const aspect = aspectRatioValue(projectStoryboard(project ? records[project.projectId]?.props : undefined).aspectRatio);
  const [size, setSize] = useState(() => fit(aspect));
  const strokes = useMemo(() => strokesOf(records, shotId), [records, shotId]);
  const picture = shot ? pictureView(records, shotFields(shot.props)) : null;
  const number = shot ? shotFields(shot.props).number : '';
  // Read by the listeners registered once, below.
  const latest = useRef({ tool, widthName });
  useLayoutEffect(() => {
    latest.current = { tool, widthName };
  }, [tool, widthName]);

  // Opened as a modal; on close, focus goes back to whatever opened it (the frame on the board, or Sketch).
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setSize(fit(aspect));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [aspect]);

  // The ink follows the theme: light and dark, or a project's own, switched while the editor is open.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setInk(inkColour());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      observer.disconnect();
    };
  }, []);

  // A frame that went to the Trash (or an undone add) closes the editor.
  useEffect(() => {
    if (!live) onClose();
  }, [live, onClose]);

  /** A point in the frame, 0 to 1 each way, from any pointer event: on the stage, or anywhere for a release. */
  const pointAt = (event: PointerEvent) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      // Only a pen reports real pressure; a mouse says 0.5 for any press, and that would only add noise.
      pressure: event.pointerType === 'pen' ? event.pressure : null,
    };
  };

  const onPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const at = pointAt(event.evt);
    if (!at) return;
    if (tool === 'eraser') {
      erasing.current = new Set(strokesAt(strokes, at.x, at.y, ERASER_RADIUS, aspect));
      setFaded(new Set(erasing.current));
      return;
    }
    const start = tool !== 'pen' && anchor.current ? anchor.current : at;
    drawing.current = {
      points: [start.x, start.y, at.x, at.y],
      pressures: tool === 'pen' && at.pressure !== null ? [at.pressure, at.pressure] : null,
    };
    setDraft({ ...drawing.current });
  };

  const onPointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    // A pen hovering over the frame isn't drawing.
    if (event.evt.buttons === 0) return;
    const at = pointAt(event.evt);
    if (!at) return;
    if (erasing.current) {
      const touched = strokesAt(strokes, at.x, at.y, ERASER_RADIUS, aspect);
      if (touched.some((id) => !erasing.current?.has(id))) {
        for (const id of touched) erasing.current.add(id);
        setFaded(new Set(erasing.current));
      }
      return;
    }
    const current = drawing.current;
    if (!current) return;
    if (tool === 'pen') {
      current.points.push(at.x, at.y);
      current.pressures?.push(at.pressure ?? 0.5);
    } else {
      // An arrow or a box: from where it began to where the pointer is now.
      current.points.splice(2, 2, at.x, at.y);
    }
    setDraft({ points: [...current.points], pressures: current.pressures ? [...current.pressures] : null });
  };

  // Registered once; they read the latest tool and strokes through `latest`. A release outside the frame still ends
  // the stroke, at the release's own point; a cancelled pointer drops what it was doing.
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const { tool: now, widthName: width } = latest.current;
      if (erasing.current) {
        const ids = [...erasing.current];
        erasing.current = null;
        setFaded(new Set());
        if (ids.length === 0) return;
        // Only those still there when it lands: an undo mid-erase takes some away.
        void applyWith((records) => ({ changes: eraseStrokes(ids.filter((id) => records[id]?.trashedAt === null)) }));
        setSaid(`${String(ids.length)} ${ids.length === 1 ? 'stroke' : 'strokes'} erased.`);
        return;
      }
      const stroke = drawing.current;
      if (!stroke || now === 'eraser') return;
      drawing.current = null;
      setDraft(null);
      const end = pointAt(event);
      if (end && now !== 'pen') stroke.points.splice(2, 2, end.x, end.y);
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = stroke.points;
      if (now !== 'pen' && Math.hypot(x2 - x1, y2 - y1) < 0.01) {
        // A click, not a drag: the first end of an arrow or a box, and the next click places the other.
        anchor.current = { x: x1, y: y1 };
        setSaid('Click again where it ends.');
        return;
      }
      anchor.current = null;
      const tidy = tidyPoints(stroke.points, stroke.pressures);
      // A tap with a pen has nowhere to show pressure; it's a dot at one width.
      const pressures = tidy.points.length > 4 ? tidy.pressures : null;
      const made = { tool: now, points: tidy.points, pressures, width: WIDTHS[width] };
      // Ordered after whatever strokes landed before it, even ones drawn faster than they're saved.
      void applyWith((records) => ({ changes: [addStroke(records, shotId, made)] }));
      setSaid(`${TOOLS.find((t) => t.value === now)?.label ?? 'Stroke'} drawn.`);
    };
    const cancel = () => {
      drawing.current = null;
      erasing.current = null;
      setDraft(null);
      setFaded(new Set());
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [applyWith, shotId]);

  // P, A, B and E pick a tool anywhere in the dialog.
  useEffect(() => {
    const element = dialog.current;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement) return;
      const picked = TOOLS.find((t) => t.key === event.key.toLowerCase());
      if (!picked) return;
      event.preventDefault();
      anchor.current = null;
      setTool(picked.value);
    };
    element?.addEventListener('keydown', onKeyDown);
    return () => {
      element?.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const draftStroke: Stroke | null =
    draft && tool !== 'eraser' ? { id: 'draft', tool, points: draft.points, pressures: draft.pressures, width: WIDTHS[widthName] } : null;
  const undoKey = mac ? '⌘Z' : 'Ctrl+Z';

  return (
    // The native dialog: modal, with Escape (its cancel) closing it and focus kept inside.
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-none max-w-none border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-text/40"
    >
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id={titleId} className="font-mono text-[16px] font-bold">
            Sketch {number}
          </h2>
          <SegmentedControl label="Tool" size="sm" options={TOOLS} value={tool} onChange={setTool} />
          <SegmentedControl label="Line" size="sm" options={WIDTH_OPTIONS} value={widthName} onChange={setWidthName} />
          <span className="ml-auto flex items-center gap-2">
            {/* The app's own undo, as the shortcut is: the last edit anywhere in the project. */}
            <Button disabled={!canUndo} onClick={() => void undo()}>
              Undo
            </Button>
            <Button disabled={!canRedo} onClick={() => void redo()}>
              Redo
            </Button>
            <Button
              disabled={strokes.length === 0}
              onClick={() => {
                // Undoable like any edit, so it needs no confirm; worked out when it lands, so a stroke still being
                // saved goes too.
                void applyWith((records) => ({ changes: eraseStrokes(strokesOf(records, shotId).map((s) => s.id)) }));
                setSaid(`Sketch cleared. ${undoKey} brings it back.`);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </span>
        </div>
        <p id={hintId} className="text-[12px] text-text-muted">
          Draw on the frame. P pen, A arrow, B box, E eraser. An arrow or a box can be two clicks, one at each end. {undoKey}{' '}
          undoes the last edit, as it does anywhere in the app. Escape or Done closes.
        </p>
        <ProjectPictures>
          <div
            ref={frame}
            data-sketch-frame=""
            className="relative touch-none overflow-hidden border border-text bg-surface-raised"
            style={{ width: size.width, height: size.height }}
          >
            {picture && <FrameImage picture={picture} frameAspect={aspect} size="original" eager />}
            <Stage
              width={size.width}
              height={size.height}
              className="absolute inset-0"
              style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
            >
              {/* The saved strokes in a layer of their own that doesn't listen for the pointer: drawing a new one
                  redraws only the layer above. */}
              <SavedStrokes strokes={strokes} width={size.width} height={size.height} ink={ink} faded={faded} />
              <Layer listening={false}>
                {draftStroke && <KonvaStroke stroke={draftStroke} width={size.width} height={size.height} ink={ink} faded={false} />}
              </Layer>
            </Stage>
          </div>
        </ProjectPictures>
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </div>
    </dialog>
  );
}

interface SavedStrokesProps {
  strokes: readonly Stroke[];
  width: number;
  height: number;
  ink: string;
  faded: ReadonlySet<string>;
}

const SavedStrokes = memo(function SavedStrokes({ strokes, width, height, ink, faded }: SavedStrokesProps) {
  return (
    <Layer listening={false}>
      {strokes.map((stroke) => (
        <KonvaStroke key={stroke.id} stroke={stroke} width={width} height={height} ink={ink} faded={faded.has(stroke.id)} />
      ))}
    </Layer>
  );
});

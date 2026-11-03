import Konva from 'konva';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Arrow, Layer, Line, Rect, Stage } from 'react-konva';
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
// takes off whole strokes it touches. Each stroke, and each pass of the eraser, is one op group, so ⌘Z (in the app's
// own shortcut) takes back one at a time, and the board's cards show the result at once. Konva draws here only; cards
// draw the same strokes as SVG.

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

/** The ink the strokes are drawn in, read from the theme so the editor matches the cards. */
function inkColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || 'black';
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

export default function SketchEditor({ shotId, onClose }: SketchEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintId = useId();
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  const [tool, setTool] = useState<Tool>('pen');
  const [widthName, setWidthName] = useState<WidthName>('medium');
  // The stroke being drawn, and the strokes the eraser has touched so far, before either is saved.
  const [draft, setDraft] = useState<{ points: number[]; pressures: number[] | null } | null>(null);
  const [erasing, setErasing] = useState<Set<string> | null>(null);
  const [said, setSaid] = useState('');
  const ink = useMemo(() => inkColour(), []);

  const shot = records[shotId];
  const live = shot?.type === 'shot' && shot.trashedAt === null;
  const aspect = aspectRatioValue(projectStoryboard(project ? records[project.projectId]?.props : undefined).aspectRatio);
  const [size, setSize] = useState(() => fit(aspect));
  const strokes = useMemo(() => strokesOf(records, shotId), [records, shotId]);
  const picture = shot ? pictureView(records, shotFields(shot.props)) : null;
  const number = shot ? shotFields(shot.props).number : '';

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const onResize = () => {
      setSize(fit(aspect));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [aspect]);

  // A frame that went to the Trash (or an undone add) closes the editor.
  useEffect(() => {
    if (!live) onClose();
  }, [live, onClose]);

  const pointAt = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const position = event.target.getStage()?.getPointerPosition();
    if (!position) return null;
    const pen = event.evt.pointerType === 'pen';
    return {
      x: Math.min(1, Math.max(0, position.x / size.width)),
      y: Math.min(1, Math.max(0, position.y / size.height)),
      // Only a pen reports real pressure; a mouse says 0.5 for any press, and that would only add noise.
      pressure: pen ? event.evt.pressure : null,
    };
  };

  const onPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const at = pointAt(event);
    if (!at) return;
    if (tool === 'eraser') {
      setErasing(new Set(strokesAt(strokes, at.x, at.y, ERASER_RADIUS, aspect)));
      return;
    }
    setDraft({ points: [at.x, at.y, at.x, at.y], pressures: tool === 'pen' && at.pressure !== null ? [at.pressure, at.pressure] : null });
  };

  const onPointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const at = pointAt(event);
    if (!at) return;
    if (erasing) {
      const touched = strokesAt(strokes, at.x, at.y, ERASER_RADIUS, aspect);
      if (touched.some((id) => !erasing.has(id))) setErasing(new Set([...erasing, ...touched]));
      return;
    }
    if (!draft) return;
    if (tool === 'pen') {
      setDraft({
        points: [...draft.points, at.x, at.y],
        pressures: draft.pressures ? [...draft.pressures, at.pressure ?? 0.5] : null,
      });
    } else {
      // An arrow or a box: from where the press began to where the pointer is now.
      setDraft({ points: [draft.points[0] ?? 0, draft.points[1] ?? 0, at.x, at.y], pressures: null });
    }
  };

  const finish = () => {
    if (erasing) {
      const ids = [...erasing];
      setErasing(null);
      if (ids.length > 0) {
        void apply(eraseStrokes(ids));
        setSaid(`${String(ids.length)} ${ids.length === 1 ? 'stroke' : 'strokes'} erased.`);
      }
      return;
    }
    if (!draft || tool === 'eraser') return;
    setDraft(null);
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = draft.points;
    // A press without a drag draws a dot with the pen, and nothing with the arrow or the box.
    if (tool !== 'pen' && Math.hypot(x2 - x1, y2 - y1) < 0.01) return;
    const tidy = tidyPoints(draft.points, draft.pressures);
    void apply([addStroke(records, shotId, { tool, points: tidy.points, pressures: tidy.pressures, width: WIDTHS[widthName] })]);
    setSaid(`${TOOLS.find((t) => t.value === tool)?.label ?? 'Stroke'} drawn.`);
  };

  // A release outside the frame still ends the stroke.
  useEffect(() => {
    window.addEventListener('pointerup', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
    };
  });

  // P, A, B and E pick a tool anywhere in the dialog.
  useEffect(() => {
    const element = dialog.current;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement) return;
      const picked = TOOLS.find((t) => t.key === event.key.toLowerCase());
      if (!picked) return;
      event.preventDefault();
      setTool(picked.value);
    };
    element?.addEventListener('keydown', onKeyDown);
    return () => {
      element?.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const draftStroke: Stroke | null =
    draft && tool !== 'eraser' ? { id: 'draft', tool, points: draft.points, pressures: draft.pressures, width: WIDTHS[widthName] } : null;

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
            <Button disabled={!canUndo} onClick={() => void undo()}>
              Undo
            </Button>
            <Button disabled={!canRedo} onClick={() => void redo()}>
              Redo
            </Button>
            <Button
              disabled={strokes.length === 0}
              onClick={() => {
                // Undoable like any edit, so it needs no confirm.
                void apply(eraseStrokes(strokes.map((s) => s.id)));
                setSaid('Sketch cleared. ⌘Z brings it back.');
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
          Draw on the frame. P pen, A arrow, B box, E eraser; ⌘Z takes back the last stroke. Escape or Done closes.
        </p>
        <ProjectPictures>
          <div
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
              <Layer>
                {strokes.map((stroke) => (
                  <KonvaStroke
                    key={stroke.id}
                    stroke={stroke}
                    width={size.width}
                    height={size.height}
                    ink={ink}
                    faded={erasing?.has(stroke.id) === true}
                  />
                ))}
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

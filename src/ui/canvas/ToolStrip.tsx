import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type Ref } from 'react';
import { t } from '../../core/i18n';
import { cx } from '../cx';
import { keepBrowserMenuOut } from '../menuKey';
import { useForwardToCanvas } from './forwardToCanvas';
import type { StripTool } from './stripTools';
import { TOOL_ICONS } from './toolIcons/toolIcons';

// The tools as one vertical strip of icons at the canvas's top-left corner (6.5.2, Kevin Nov 16: as in Photoshop), on
// plans and boards alike. Each host gives its own tools (stripTools.ts), in the order the old row of labelled buttons
// had; actions (zoom, export, layers, the Paper/Dark view) stay where they were. The strip is app chrome, so it follows
// the app's theme over a Paper or a Dark canvas alike: its own boxed surface, never the canvas's colours.
//
// Every button is a tab stop of its own, as every toolbar of the app is (the keyboard walks Select to Shapes, then the
// canvas). Its name is its aria-label and its keys its aria-keyshortcuts; a tooltip "Name (Key)" shows on hover and on
// keyboard focus (a title shows on neither for the keyboard), passes the pointer through, and Escape hides it.
//
// The host renders the strip just before the canvas, inside a positioned box the canvas fills, so its tab stops come
// before the canvas's and its keys never reach the canvas's own.

/** Each button's side, px: at least the 28 the brief asks; the icon is drawn at 20 inside it. */
const SIZE = 28;
/** The strip's offset from the canvas's corner (top-2, left-2). */
const INSET = 8;
/**
 * Room kept free at the canvas's foot, px: the zoom's box (30 px high, 8 px off the foot) and the Paper/Dark box above it
 * (bottom 42 px, 35 high with its rules and padding) sit in the same left column, so the strip stops above them, plus a
 * gap of 8.
 */
const FOOT = 85;

/** How many buttons fit one above another in a canvas this tall; the rest wrap into a second column (and on). */
export function stripRows(height: number, count: number): number {
  // The strip's two 1.5 px rules take 3 px, its 2 px padding 4.
  return Math.max(1, Math.min(count, Math.floor((height - INSET - FOOT - 7) / SIZE)));
}

// In forced colours (Windows High Contrast) the ink fill is dropped, so the pressed tool also gets an outline there.
const ON = 'bg-text text-text-inverse forced-colors:outline-2 forced-colors:outline-solid forced-colors:-outline-offset-3';
const OFF = 'text-text hover:bg-surface-raised';

function ToolIcon({ name }: { name: string }) {
  // The markup is the app's own SVG, bundled at build time (toolIcons.ts), never anything a person typed or opened.
  return <span aria-hidden="true" className="pointer-events-none block size-5 [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: TOOL_ICONS[name] ?? '' }} />;
}

/** What the tooltip says: "Name (Key)", or the name alone for a tool no key picks. */
export const tipText = (tool: Pick<StripTool, 'name' | 'keys'>): string => (tool.keys === '' ? tool.name : t('canvas.toolTip', { name: tool.name, keys: tool.keys }));

interface ToolButtonProps {
  tool: StripTool;
  /** Whether its tooltip shows. */
  tip: boolean;
  onTip: (show: boolean) => void;
  /** A button with options toggles their panel instead of picking. */
  onToggle?: () => void;
  expanded?: boolean;
  controls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * One square button of the strip. No hooks, so a unit test can press it. The icon and the tooltip sit beside the button,
 * not in it: a kit drawing's letters (the measure's "2.4M") or the tooltip's words inside would be read as the button's
 * visible label, which its name must contain (WCAG 2.5.3). The button lies over the icon, so its focus ring shows.
 */
export function ToolButton({ tool, tip, onTip, onToggle, expanded, controls, buttonRef }: ToolButtonProps) {
  const keys = tool.aria ?? tool.keys;
  return (
    // Selection is an ink fill, as everywhere (DESIGN.md); the icon turns the inverse colour on it.
    <div className={cx('relative size-7', tool.active ? ON : OFF)}>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <ToolIcon name={tool.icon} />
      </span>
      <button
        ref={buttonRef}
        type="button"
        data-tool-button={tool.id}
        aria-label={tool.name}
        aria-pressed={tool.active}
        {...(keys !== '' ? { 'aria-keyshortcuts': keys } : {})}
        {...(tool.options ? { 'aria-expanded': expanded === true, ...(controls ? { 'aria-controls': controls } : {}) } : {})}
        onClick={() => {
          if (tool.options) onToggle?.();
          else tool.onSelect?.();
        }}
        onPointerEnter={() => {
          onTip(true);
        }}
        onPointerLeave={() => {
          onTip(false);
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          // Keyboard focus only: a click's focus already has the pointer over it.
          if (event.currentTarget.matches(':focus-visible')) onTip(true);
        }}
        onBlur={() => {
          onTip(false);
        }}
        className={cx('absolute inset-0 focus-visible:-outline-offset-4', tool.active && 'focus-visible:outline-text-inverse')}
      />
      {tip && (
        <span
          aria-hidden="true"
          data-tool-tip=""
          className="pointer-events-none absolute top-1/2 left-full z-30 ml-2 -translate-y-1/2 border-[1.5px] border-text bg-surface px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-text"
        >
          {tipText(tool)}
        </span>
      )}
    </div>
  );
}

/** A button of several tools (a board's Shapes): opens them to its right, closed by Escape or a press outside (focus goes back to it). */
function OptionsButton({ tool, tip, onTip }: { tool: StripTool; tip: boolean; onTip: (show: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>(`#${CSS.escape(panel)} button`)?.focus();
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, panel]);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel; the buttons inside are the controls
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <ToolButton
        tool={tool}
        tip={tip && !open}
        onTip={onTip}
        expanded={open}
        controls={panel}
        buttonRef={trigger}
        onToggle={() => {
          setOpen((value) => !value);
        }}
      />
      {open && (
        // The menu key on a shape opens no browser menu over the panel.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only keeps the browser's menu out; the buttons inside are the controls
        <div id={panel} role="group" aria-label={tool.name} onContextMenu={keepBrowserMenuOut} className="absolute top-0 left-full z-30 ml-1 flex w-40 flex-col border-[1.5px] border-text bg-surface">
          {(tool.options ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setOpen(false);
                option.onSelect();
              }}
              className="sb-label flex h-8 items-center gap-2 px-2 text-left text-text hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              <ToolIcon name={option.icon} />
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The canvas the strip sits on: the host renders it next to the strip, in the same positioned box. */
const canvasBeside = (strip: HTMLElement | null): HTMLElement | null => strip?.parentElement?.querySelector<HTMLElement>('[data-canvas]') ?? null;

interface ToolStripProps {
  tools: readonly StripTool[];
  /**
   * How far inside the canvas's corner the strip's own 8 px start, px: a canvas with rulers (a plan) passes their depth,
   * so the strip sits inside them and hides no ruler's number. Left out, none (a board).
   */
  offset?: number;
}

export function ToolStrip({ tools, offset = 0 }: ToolStripProps) {
  const root = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(tools.length);
  const [tip, setTip] = useState<string | null>(null);
  const count = tools.length;
  // A canvas too short for the strip: the buttons wrap into a second column rather than run under the zoom's boxes.
  // Measured before the first paint, against the canvas's own height (the box holding it can be shorter: the canvas
  // keeps a least height), so the strip never shows one column and then jumps.
  useLayoutEffect(() => {
    const canvas = canvasBeside(root.current);
    if (!canvas) return;
    const measure = () => {
      setRows(stripRows(canvas.clientHeight - offset, count));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [count, offset]);
  // A wheel over the strip zooms or scrolls the canvas, as if the strip weren't there; a middle-button press on it starts
  // the canvas's pan (forwardToCanvas.ts, shared with the plan's compass).
  useForwardToCanvas(root);
  // Escape hides a tooltip wherever the focus is (hover opens one with the focus on the canvas). The key keeps its own
  // meaning there too: on the canvas it still ends what it ends (a selection, a run), as it always has.
  useEffect(() => {
    if (tip === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [tip]);
  const tipFor = (id: string) => (show: boolean) => {
    setTip((now) => (show ? id : now === id ? null : now));
  };
  const at = INSET + offset;
  return (
    <div
      ref={root}
      role="group"
      aria-label={t('canvas.tools')}
      data-tool-strip=""
      // The 2 px of surface round the buttons keep the pressed one's ink fill framed, even where the canvas under the
      // strip is the same colour as that fill (a Paper canvas in the dark theme, whose ink is paper).
      //
      // Layering, one order for both hosts, back to front: the canvas; its own overlays (the quick-connect "+" handles
      // and the run's length label, z-10; the in-place text editor, no z); the strip (z-[15]); the strip's Shapes panel
      // and tooltips (z-30, inside the strip's layer); the canvas's menus (CanvasMenu, z-20, later in the page, so above
      // the strip and all it holds). A "+" handle never draws over a tool. A text box edited under the strip keeps its
      // editor over the canvas, with the strip over that corner of it: the strip stays reachable.
      className="absolute z-[15] grid grid-flow-col auto-cols-[28px] border-[1.5px] border-text bg-surface p-0.5"
      style={{ top: at, left: at, gridTemplateRows: `repeat(${String(rows)}, ${String(SIZE)}px)` }}
    >
      {tools.map((tool) =>
        tool.options ? (
          <OptionsButton key={tool.id} tool={tool} tip={tip === tool.id} onTip={tipFor(tool.id)} />
        ) : (
          <ToolButton key={tool.id} tool={tool} tip={tip === tool.id} onTip={tipFor(tool.id)} />
        ),
      )}
    </div>
  );
}

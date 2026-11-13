import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../../core/i18n';
import { cx } from '../cx';
import type { Tool } from './types';

// The tools in a strip at the top of the tile (decision 11): Select (V), Hand (H), Rectangle (R), Text (T), Sticky (S), Link (L), Connector (C)
// and Shapes (O draws an ellipse; the button opens the four shapes), as labelled buttons in mono uppercase. The pressed one is an ink fill, as selection is everywhere (DESIGN.md). Anything the host adds
// (a way back to the picker, a board's name) goes in `children`, at the left.

const TOOLS: readonly { tool: Tool; key: string; label: () => string }[] = [
  { tool: 'select', key: 'V', label: () => t('canvas.tool.select') },
  { tool: 'hand', key: 'H', label: () => t('canvas.tool.hand') },
  { tool: 'rect', key: 'R', label: () => t('canvas.tool.rect') },
  { tool: 'text', key: 'T', label: () => t('canvas.tool.text') },
  { tool: 'sticky', key: 'S', label: () => t('canvas.tool.sticky') },
  { tool: 'link', key: 'L', label: () => t('canvas.tool.link') },
  { tool: 'connector', key: 'C', label: () => t('canvas.tool.connector') },
];

const SHAPES: readonly { tool: Tool; label: () => string }[] = [
  { tool: 'rect', label: () => t('canvas.tool.rect') },
  { tool: 'ellipse', label: () => t('canvas.tool.ellipse') },
  { tool: 'triangle', label: () => t('canvas.tool.triangle') },
  { tool: 'diamond', label: () => t('canvas.tool.diamond') },
];
const SHAPE_TOOLS: readonly Tool[] = ['ellipse', 'triangle', 'diamond'];
const BUTTON = 'sb-label flex h-7 items-center gap-1.5 border border-text px-2.5 focus-visible:-outline-offset-4';
const ON = 'bg-text font-bold text-text-inverse focus-visible:outline-text-inverse';
const OFF = 'text-text hover:bg-surface-raised';

/** The Shapes button: a disclosure of the four shapes, closed by Escape or a press outside (focus goes back to it). */
function ShapesButton({ tool, onTool }: { tool: Tool; onTool: (tool: Tool) => void }) {
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
  const on = SHAPE_TOOLS.includes(tool);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel; the buttons inside are the controls
    <div
      ref={root}
      className="relative -ml-px"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-pressed={on}
        aria-keyshortcuts="O"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={cx(BUTTON, on ? ON : OFF)}
      >
        {t('canvas.tool.shapes')}
        <kbd aria-hidden="true" className="font-mono text-[10px] normal-case">
          O
        </kbd>
      </button>
      {open && (
        <div id={panel} role="group" aria-label={t('canvas.tool.shapes')} className="absolute top-full right-0 z-20 mt-1 flex w-36 flex-col border border-text bg-surface">
          {SHAPES.map(({ tool: id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setOpen(false);
                onTool(id);
              }}
              className="sb-label flex h-8 items-center px-2.5 text-left text-text hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              {label()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToolStripProps {
  tool: Tool;
  onTool: (tool: Tool) => void;
  children?: ReactNode;
}

export function ToolStrip({ tool, onTool, children }: ToolStripProps) {
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
      {children}
      <div role="group" aria-label={t('canvas.tools')} className="ml-auto flex">
        {TOOLS.map(({ tool: id, key, label }, i) => {
          const on = id === tool;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              aria-keyshortcuts={key}
              onClick={() => {
                onTool(id);
              }}
              className={cx(
                BUTTON,
                i > 0 && '-ml-px',
                // Selection is an ink fill; bold is the second cue.
                on ? ON : OFF,
              )}
            >
              {label()}
              <kbd aria-hidden="true" className="font-mono text-[10px] normal-case">
                {key}
              </kbd>
            </button>
          );
        })}
        <ShapesButton tool={tool} onTool={onTool} />
      </div>
    </div>
  );
}

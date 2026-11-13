import type { ReactNode } from 'react';
import { t } from '../../core/i18n';
import { cx } from '../cx';
import type { Tool } from './types';

// The tools in a strip at the top of the tile (decision 11): Select (V), Hand (H), Rectangle (R), as labelled buttons
// in mono uppercase. The pressed one is an ink fill, as selection is everywhere (DESIGN.md). Anything the host adds
// (a way back to the picker, a board's name) goes in `children`, at the left.

const TOOLS: readonly { tool: Tool; key: string; label: () => string }[] = [
  { tool: 'select', key: 'V', label: () => t('canvas.tool.select') },
  { tool: 'hand', key: 'H', label: () => t('canvas.tool.hand') },
  { tool: 'rect', key: 'R', label: () => t('canvas.tool.rect') },
];

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
                'sb-label flex h-7 items-center gap-1.5 border border-text px-2.5 focus-visible:-outline-offset-4',
                i > 0 && '-ml-px',
                // Selection is an ink fill; bold is the second cue.
                on ? 'bg-text font-bold text-text-inverse focus-visible:outline-text-inverse' : 'text-text hover:bg-surface-raised',
              )}
            >
              {label()}
              <kbd aria-hidden="true" className="font-mono text-[10px] normal-case">
                {key}
              </kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

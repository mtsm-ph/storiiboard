import { useId, type CSSProperties, type ReactNode } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import { CloseGlyph, GripGlyph, MaximizeGlyph, RestoreGlyph } from './glyphs';
import { roveFocus } from './roving';

export interface TileTab {
  id: string;
  label: string;
}

interface TileProps {
  /** Position in the workspace layout; shown as 01, 02… */
  index: number;
  title: string;
  /** Muted extra after the title, such as a count. */
  meta?: string;
  /** Stacked tiles share one frame; the open tab sits on oatmeal. */
  tabs?: readonly TileTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode;
}

export function Tile({
  index,
  title,
  meta,
  tabs,
  activeTab,
  onTabChange,
  maximized = false,
  onToggleMaximize,
  onClose,
  className,
  style,
  children,
}: TileProps) {
  const baseId = useId();
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const hasTabs = tabs !== undefined && tabs.length > 0;

  return (
    <section
      aria-label={title}
      className={cx('flex min-h-0 min-w-0 flex-col overflow-hidden border border-rule bg-panel', className)}
      style={style}
    >
      <div className="flex h-titlebar shrink-0 items-center gap-2 border-b border-rule pr-1 pl-2">
        {/* Docking (D2) makes the title bar the drag handle; until then the grip only marks it. */}
        <GripGlyph />
        <span className="sb-label shrink-0 font-bold">
          {String(index).padStart(2, '0')} / {title}
        </span>
        {meta !== undefined && <span className="sb-label shrink-0 text-muted">{meta}</span>}

        {hasTabs && (
          // Stretched to the title bar's content box, so the open tab stops at the rule instead of covering it.
          <div role="tablist" aria-label={`${title} tabs`} className="ml-1.5 flex min-w-0 self-stretch">
            {tabs.map((tab, i) => {
              const open = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  id={tabId(tab.id)}
                  type="button"
                  role="tab"
                  aria-selected={open}
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    onTabChange?.(tab.id);
                  }}
                  onKeyDown={(event) => {
                    const next = roveFocus(event, i, tabs.length, '[role="tab"]');
                    const nextTab = next === null ? undefined : tabs[next];
                    if (nextTab) onTabChange?.(nextTab.id);
                  }}
                  className={cx(
                    'sb-label flex items-center border-r border-rule px-2.5 focus-visible:-outline-offset-4',
                    i === 0 && 'border-l',
                    // Muted text never sits on oatmeal (3.8:1), so the open tab switches to ink. Bold is the second
                    // cue: the oatmeal fill alone sits too close to the panel to mark which tab is open.
                    open ? 'bg-oatmeal font-bold text-ink' : 'text-muted',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex shrink-0">
          {onToggleMaximize && (
            <IconButton size="sm" label={`${maximized ? 'Restore' : 'Maximize'} ${title}`} onClick={onToggleMaximize}>
              {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
            </IconButton>
          )}
          {onClose && (
            <IconButton size="sm" label={`Close ${title}`} onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        {...(hasTabs && activeTab !== undefined
          ? { role: 'tabpanel', 'aria-labelledby': tabId(activeTab) }
          : {})}
      >
        {children}
      </div>
    </section>
  );
}

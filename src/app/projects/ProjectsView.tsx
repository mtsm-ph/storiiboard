import type { ReactNode } from 'react';
import type { RecentProject } from '../../core/storage/recent';
import { Button, IconButton } from '../../ui/Button';
import { CloseGlyph } from '../../ui/glyphs';
import { Tile } from '../../ui/Tile';

// The Projects screen (0.7): New, Open and Recent, in one tile. It shows when no project is open and from the
// switcher's All projects…. This part only draws; ProjectsScreen feeds it.

export interface ProjectsViewProps {
  recent: readonly RecentProject[];
  /** The path of the project open now, marked in the list. */
  openPath: string | null;
  /** False in the browser build, which has no files to open. */
  canOpen: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onForget: (path: string) => void;
  /** Open backup… and the archived filter join in 0.7b. */
  extraActions?: ReactNode;
}

/** "2026-11-02 14:05" in local time, as the backups name their files. */
export function openedAtLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

export function ProjectsView({ recent, openPath, canOpen, onNew, onOpen, onOpenRecent, onForget, extraActions }: ProjectsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-gap">
      <Tile index={1} title="Projects" meta={`${String(recent.length)} recent`} className="min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule p-3">
            <Button variant="primary" disabled={!canOpen} onClick={onNew}>
              New project…
            </Button>
            <Button disabled={!canOpen} onClick={onOpen}>
              Open…
            </Button>
            {extraActions}
            {!canOpen && <p className="sb-label ml-2 text-muted">Projects open in the desktop app.</p>}
          </div>
          <h2 className="sb-label px-3 pt-3 pb-2">Recent</h2>
          {recent.length === 0 ? (
            <p className="px-3 text-[13px] text-muted">
              No recent projects yet. New project makes one; Open… finds one on disk.
            </p>
          ) : (
            <ul aria-label="Recent projects" className="min-h-0 overflow-y-auto border-t border-rule">
              {recent.map((entry) => {
                const open = entry.path === openPath;
                return (
                  <li key={entry.path} className="group flex items-stretch border-b border-rule">
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => {
                        onOpenRecent(entry.path);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left enabled:hover:bg-oatmeal focus-visible:-outline-offset-4"
                    >
                      {/* The project's accent dot; the name beside it is the second cue. */}
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold">{entry.name}</span>
                        {/* Muted until hovered: muted text never sits on oatmeal. */}
                        <span className="truncate font-mono text-[11px] text-muted group-hover:text-ink">{entry.path}</span>
                      </span>
                      {open && <span className="sb-label shrink-0 border border-ink px-1.5 py-0.5">Open</span>}
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted group-hover:text-ink">
                        {openedAtLabel(entry.openedAt)}
                      </span>
                    </button>
                    <IconButton
                      label={`Remove ${entry.name} from Recent`}
                      size="sm"
                      className="mx-2 self-center"
                      onClick={() => {
                        onForget(entry.path);
                      }}
                    >
                      <CloseGlyph />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Tile>
    </div>
  );
}

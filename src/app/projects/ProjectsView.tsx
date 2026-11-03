import { useState } from 'react';
import { PROJECT_STATE_LABEL } from '../../core/model/project';
import type { RecentProject } from '../../core/storage/recent';
import { Button, IconButton } from '../../ui/Button';
import { CloseGlyph } from '../../ui/glyphs';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Tile } from '../../ui/Tile';
import { localDateTime } from '../format';

// The Projects screen (0.7): New, Open, Open backup, and Recent with an Archived list, in one tile. It shows when no
// project is open and from the switcher's All projects…. This part only draws; ProjectsScreen feeds it.

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
  onOpenBackup: () => void;
}

type Shown = 'recent' | 'archived';

/** When a Recent entry was last opened, in local time. */
export function openedAtLabel(iso: string): string {
  return localDateTime(new Date(iso));
}

export function ProjectsView({ recent, openPath, canOpen, onNew, onOpen, onOpenRecent, onForget, onOpenBackup }: ProjectsViewProps) {
  const [shown, setShown] = useState<Shown>('recent');
  // An archived project leaves Recent for the Archived list (CLAUDE.md, Data model).
  const listed = recent.filter((entry) => (entry.state === 'archived') === (shown === 'archived'));
  return (
    <div className="flex min-h-0 flex-1 flex-col p-gap">
      <Tile index={1} title="Projects" className="min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <Button variant="primary" disabled={!canOpen} onClick={onNew}>
              New project…
            </Button>
            <Button disabled={!canOpen} onClick={onOpen}>
              Open…
            </Button>
            <Button disabled={!canOpen} onClick={onOpenBackup}>
              Open backup…
            </Button>
            {!canOpen && <p className="sb-label ml-2 text-text-muted">Projects open in the desktop app.</p>}
          </div>
          <div className="px-3 pt-3 pb-3">
            <SegmentedControl<Shown>
              label="Show"
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'archived', label: 'Archived' },
              ]}
              value={shown}
              onChange={setShown}
            />
          </div>
          {listed.length === 0 ? (
            <p className="px-3 text-[13px] text-text-muted">
              {shown === 'archived'
                ? 'No archived projects. Archive Project, in the project menu, moves one here.'
                : 'No recent projects yet. New project makes one; Open… finds one on disk.'}
            </p>
          ) : (
            <ul aria-label={shown === 'archived' ? 'Archived projects' : 'Recent projects'} className="min-h-0 overflow-y-auto border-t border-border">
              {listed.map((entry) => {
                const open = entry.path === openPath;
                return (
                  <li key={entry.path} className="group flex items-stretch border-b border-border">
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => {
                        onOpenRecent(entry.path);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left enabled:hover:bg-surface-raised focus-visible:-outline-offset-4"
                    >
                      {/* The project's accent dot; the name beside it is the second cue. */}
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold">{entry.name}</span>
                        {/* Muted until hovered: muted text never sits on oatmeal. */}
                        <span className="truncate font-mono text-[11px] text-text-muted group-hover:text-text">{entry.path}</span>
                      </span>
                      {open && <span className="sb-label shrink-0 border border-text px-1.5 py-0.5">Open</span>}
                      <span className="sb-label shrink-0">{PROJECT_STATE_LABEL[entry.state ?? 'active']}</span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-text-muted group-hover:text-text">
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

import { cx } from '../../../ui/cx';
import { useEffect } from 'react';
import { ComingItem, Menu, menuItemClass } from '../../../ui/Menu';
import { isDesktop, newProject, openRecent, recentStore } from '../../projects/actions';
import { useRecent } from '../../projects/recentStore';
import { useProject } from '../../projectStore';
import { isUnsaved, useLayouts } from '../docking/layoutStore';
import { sectionId, type Workspace, type WorkspaceId } from '../workspaces';
import { onNavKeyDown } from './navKeys';
import { SceneList } from './SceneList';
import { addSceneChange, sceneEntries } from './scenes';

// The left sidebar (DESIGN.md, Navigation): the project switcher, then one section per workspace. Storyboard lists
// its scenes inline. Arrow keys move through every entry and Enter opens one; Tab enters at the active section and
// leaves the sidebar, so it's one stop on the way to the tiles.

interface SidebarProps {
  workspaces: readonly Workspace[];
  activeId: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
  activeSceneId: string | null;
  onSelectScene: (id: string) => void;
  /** All projects…: the Projects screen. */
  onShowProjects: () => void;
}

/** How many recent projects the switcher lists; All projects… has the rest. */
const SWITCHER_RECENT = 8;

export function Sidebar({ workspaces, activeId, onSelect, activeSceneId, onSelectScene, onShowProjects }: SidebarProps) {
  const layouts = useLayouts((s) => s.layouts);
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const projectName = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' && title !== '' ? title : (s.project?.name ?? null);
  });
  const scenes = project ? sceneEntries(records, project.projectId) : [];
  // Archived projects leave the switcher; the Projects screen's Archived list still has them.
  const recent = useRecent(recentStore, (s) => s.entries)
    .filter((entry) => entry.state !== 'archived')
    .slice(0, SWITCHER_RECENT);
  const openPath = project?.file.path ?? null;

  // Re-read Recent whenever the open project changes, however it was opened.
  useEffect(() => {
    void recentStore.getState().refresh();
  }, [openPath]);

  const addScene = () => {
    if (!project) return;
    const change = addSceneChange(records, project.projectId);
    void apply([change]).then(() => {
      onSelectScene(change.record.id);
    });
  };

  return (
    // The sidebar keeps paper outlines in dark, like the top bar: together they're the guiding board.
    <nav aria-label="Sections" className="flex w-sidebar shrink-0 flex-col border-r border-rule-top">
      <div className="h-11 shrink-0 border-b border-rule-top">
        <Menu
          label={
            <>
              {/* The project's accent; the name beside it is the second cue. */}
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
              <span className="sr-only">Project: </span>
              <span className={cx('truncate', projectName === null && 'text-muted')}>{projectName ?? 'No project open'}</span>
            </>
          }
          buttonClassName="sb-label flex h-full w-full items-center gap-2 px-4 text-left focus-visible:-outline-offset-4"
          panelClassName="w-full"
        >
          {(close) =>
            isDesktop ? (
              <>
                {recent.length > 0 && (
                  <ul aria-label="Recent projects">
                    {recent.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          aria-current={entry.path === openPath ? 'true' : undefined}
                          onClick={() => {
                            close();
                            // Switching opens the other .sbd in place, without reloading the window.
                            void openRecent(entry.path);
                          }}
                          className={cx(menuItemClass, entry.path === openPath && 'font-bold')}
                        >
                          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    close();
                    onShowProjects();
                  }}
                >
                  All projects…
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    close();
                    void newProject();
                  }}
                >
                  New project…
                </button>
              </>
            ) : (
              // The browser build has no files to open.
              <>
                <ComingItem label="All projects…" phase="Desktop app" />
                <ComingItem label="New project…" phase="Desktop app" />
              </>
            )
          }
        </Menu>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {workspaces.map((workspace, i) => {
          const active = workspace.id === activeId;
          return (
            <li key={workspace.id} className="border-b border-rule-top">
              <button
                id={sectionId(workspace.id)}
                type="button"
                data-nav-item=""
                onKeyDown={onNavKeyDown}
                aria-current={active ? 'page' : undefined}
                aria-keyshortcuts={`Alt+${String(i + 1)}`}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  onSelect(workspace.id);
                }}
                className={cx(
                  'group sb-label flex h-9 w-full items-center gap-1.5 px-4 text-left focus-visible:-outline-offset-4',
                  // The active section is one of the few places orange appears; text and focus ring on it are ink,
                  // since the dark theme's paper ink is only 2.9:1 on orange. Sections still to come are muted
                  // until hovered: muted text never sits on oatmeal.
                  active
                    ? 'bg-accent font-bold text-on-accent focus-visible:outline-on-accent'
                    : workspace.phase === null
                      ? 'text-ink hover:bg-oatmeal'
                      : 'text-muted hover:bg-oatmeal hover:text-ink',
                )}
              >
                {workspace.label}
                {isUnsaved(layouts[workspace.id]) && (
                  // The dot marks a layout changed since it was last saved (DESIGN.md, Workspaces).
                  <span aria-label="unsaved layout" role="img" className="inline-block size-1.5 rounded-full bg-current" />
                )}
                {workspace.phase !== null && <span className="ml-auto font-normal">{workspace.phase}</span>}
              </button>
              {workspace.id === 'storyboard' && (
                <SceneList
                  scenes={scenes}
                  activeSceneId={activeSceneId}
                  canAdd={project !== null}
                  onSelect={(id) => {
                    onSelectScene(id);
                    onSelect('storyboard');
                  }}
                  onAdd={addScene}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

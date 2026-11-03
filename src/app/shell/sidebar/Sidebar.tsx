import { cx } from '../../../ui/cx';
import { ComingItem, Menu } from '../../../ui/Menu';
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
}

export function Sidebar({ workspaces, activeId, onSelect, activeSceneId, onSelectScene }: SidebarProps) {
  const layouts = useLayouts((s) => s.layouts);
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const projectName = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' && title !== '' ? title : (s.project?.name ?? null);
  });
  const scenes = project ? sceneEntries(records, project.projectId) : [];

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
          {() => (
            // Recent projects and switching in place arrive with the Projects screen (0.7).
            <>
              <ComingItem label="All projects…" phase="0.7" />
              <ComingItem label="New project…" phase="0.7" />
            </>
          )}
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
                    : 'text-muted hover:bg-oatmeal hover:text-ink',
                )}
              >
                {workspace.label}
                {isUnsaved(layouts[workspace.id]) && (
                  // The dot marks a layout changed since it was last saved (DESIGN.md, Workspaces).
                  <span aria-label="unsaved layout" role="img" className="inline-block size-1.5 rounded-full bg-current" />
                )}
                <span className="ml-auto font-normal">{workspace.phase}</span>
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

import { cx } from '../../../ui/cx';
import { useEffect, useId } from 'react';
import { ComingItem, Menu, menuItemClass } from '../../../ui/Menu';
import { canOpenFiles } from '../../fileAccess';
import { newProject, openRecent, recentStore } from '../../projects/actions';
import { useRecent } from '../../projects/recentStore';
import { useProject } from '../../projectStore';
import { isUnsaved, layoutsOf, useLayouts } from '../docking/layoutStore';
import { departmentWorkspaceId, sectionId, workspaceById, type Workspace, type WorkspaceId } from '../workspaces';
import { closeDepartmentWorkspace, useWorkspaceState } from '../workspaceStore';
import type { Department } from '../../../core/model/department';
import { onNavKeyDown } from './navKeys';
import { BoardList } from './BoardList';
import { SceneList } from './SceneList';
import { addSceneChange, sceneEntries } from './scenes';
import { deleteScene, focusSceneAfterDelete } from '../../../features/storyboard/deleteScene';
import { boardsOf, boardTitle } from '../../../features/moodboards/boards';
import { deleteBoard } from '../../../features/moodboards/boardActions';
import { moodboardStore, useMoodboard } from '../../../features/moodboards/moodboardStore';
import { HIDE_SIDEBAR_ID, sidebarShortcut } from './sidebarToggle';
import { IconButton } from '../../../ui/Button';
import { SidebarGlyph } from '../../../ui/glyphs';
import { isMac } from '../undoShortcuts';
import { GearButton, ProfileButton, WebVersionItem } from './SidebarFoot';
import { t } from '../../../core/i18n';

// The left sidebar (DESIGN.md, Navigation): the project switcher, then one section per workspace. Storyboard lists
// its scenes inline. Arrow keys move through every entry (the foot's Web version too) and Enter opens one; Tab enters
// at the active section, then goes to the foot's Hide sidebar, the gear and the profile, and on to the tiles. Under the
// sections, the department workspaces the person has opened from a frame (3.6a); Delete takes one off the list.

interface SidebarProps {
  workspaces: readonly Workspace[];
  activeId: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
  activeSceneId: string | null;
  onSelectScene: (id: string) => void;
  /** All projects…: the Projects screen. */
  onShowProjects: () => void;
  /** Hide sidebar (polish 2): fold it to the thin strip. */
  onHide: () => void;
}

/** How many recent projects the switcher lists; All projects… has the rest. */
const SWITCHER_RECENT = 8;

export function Sidebar({ workspaces, activeId, onSelect, activeSceneId, onSelectScene, onShowProjects, onHide }: SidebarProps) {
  const shortcut = sidebarShortcut(isMac());
  const layouts = useLayouts((s) => s.layouts);
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const projectName = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' && title !== '' ? title : (s.project?.name ?? null);
  });
  const scenes = project ? sceneEntries(records, project.projectId) : [];
  const boards = project ? boardsOf(records, project.projectId).map((b) => ({ id: b.id, title: boardTitle(b) })) : [];
  const openBoardId = useMoodboard((s) => s.openBoardId);
  // Archived projects leave the switcher; the Projects screen's Archived list still has them.
  const recent = useRecent(recentStore, (s) => s.entries)
    .filter((entry) => entry.state !== 'archived')
    .slice(0, SWITCHER_RECENT);
  const openPath = project?.file.path ?? null;
  const departments = useWorkspaceState((s) => s.departments);
  const departmentsHeading = useId();
  const customs = useWorkspaceState((s) => s.customs);
  const customsHeading = useId();

  // Re-read Recent whenever the open project changes, however it was opened.
  useEffect(() => {
    void recentStore.getState().refresh();
  }, [openPath]);

  /**
   * Off the sidebar, focus staying in it. The one on screen gives way to the Storyboard, and focus goes with it, so the
   * entry focused is the workspace shown (and a second Delete can't take off one the person isn't looking at). Another
   * one leaves focus on the department that took its place, else on the Storyboard.
   */
  const closeDepartment = (department: Department) => {
    const at = departments.indexOf(department);
    const next = activeId === departmentWorkspaceId(department) ? undefined : (departments[at + 1] ?? departments[at - 1]);
    closeDepartmentWorkspace(department);
    requestAnimationFrame(() => {
      document.getElementById(sectionId(next ? departmentWorkspaceId(next) : 'storyboard'))?.focus();
    });
  };

  const addScene = () => {
    if (!project) return;
    const change = addSceneChange(records, project.projectId);
    void apply([change]).then(() => {
      onSelectScene(change.record.id);
    });
  };

  return (
    // The sidebar keeps paper outlines in dark, like the top bar: together they're the guiding board.
    <nav data-sidebar="" aria-label={t('sidebar.sections')} className="flex w-sidebar shrink-0 flex-col border-r border-border-top">
      <div className="h-11 shrink-0 border-b border-border-top">
        <Menu
          label={
            <>
              {/* The project's accent; the name beside it is the second cue. */}
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
              <span className="sr-only">{t('sidebar.project')}{' '}</span>
              <span className={cx('truncate', projectName === null && 'text-text-muted')}>{projectName ?? t('project.noneOpen')}</span>
            </>
          }
          buttonClassName="sb-label flex h-full w-full items-center gap-2 px-4 text-left focus-visible:-outline-offset-4"
          panelClassName="w-full"
        >
          {(close) =>
            canOpenFiles ? (
              <>
                {recent.length > 0 && (
                  <ul aria-label={t('sidebar.recentProjects')}>
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
                  {t('sidebar.allProjects')}
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    close();
                    void newProject();
                  }}
                >
                  {t('sidebar.newProject')}
                </button>
              </>
            ) : (
              // The browser build has no files to open.
              <>
                <ComingItem label={t('sidebar.allProjects')} phase={t('sidebar.desktopApp')} />
                <ComingItem label={t('sidebar.newProject')} phase={t('sidebar.desktopApp')} />
              </>
            )
          }
        </Menu>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {workspaces.map((workspace, i) => {
          const active = workspace.id === activeId;
          return (
            <li key={workspace.id} className="border-b border-border-top">
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
                    ? 'bg-accent font-bold text-accent-contrast focus-visible:outline-accent-contrast'
                    : workspace.phase === null
                      ? 'text-text hover:bg-surface-raised'
                      : 'text-text-muted hover:bg-surface-raised hover:text-text',
                )}
              >
                {workspace.label}
                {isUnsaved(layoutsOf(layouts, workspace.id)) && (
                  // The dot marks a layout changed since it was last saved (DESIGN.md, Workspaces).
                  <span aria-label={t('sidebar.unsavedLayout')} role="img" className="inline-block size-1.5 rounded-full bg-current" />
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
                  onDelete={(id) => {
                    void deleteScene(id).then(({ written, next }) => {
                      // Focus stays in the sidebar: on the scene that took its place, or its section.
                      if (written) focusSceneAfterDelete(next, 'data-sidebar-scene', () => document.getElementById(sectionId('storyboard')));
                    });
                  }}
                />
              )}
              {workspace.id === 'moodboard' && (
                <BoardList
                  boards={boards}
                  openBoardId={openBoardId}
                  canAdd={project !== null}
                  onSelect={(id) => {
                    moodboardStore.getState().openBoard(id);
                    onSelect('moodboard');
                  }}
                  onAdd={() => {
                    moodboardStore.getState().openBoard(null);
                    onSelect('moodboard');
                  }}
                  onDelete={(id) => {
                    void deleteBoard(id).then(({ written, next }) => {
                      // Focus stays in the sidebar: on the board that took its place, or its section.
                      if (written) focusSceneAfterDelete(next, 'data-sidebar-board', () => document.getElementById(sectionId('moodboard')));
                    });
                  }}
                />
              )}
            </li>
          );
        })}
        {departments.length > 0 && (
          <li className="border-b border-border-top pb-1">
            <h2 id={departmentsHeading} className="sb-label px-4 pt-3 pb-1 text-text-muted">
              {t('sidebar.departments')}
            </h2>
            <ul aria-labelledby={departmentsHeading}>
              {departments.map((department) => {
                const workspace = workspaceById(departmentWorkspaceId(department));
                const active = workspace.id === activeId;
                return (
                  <li key={department}>
                    <button
                      id={sectionId(workspace.id)}
                      type="button"
                      data-nav-item=""
                      data-department-workspace={department}
                      aria-current={active ? 'page' : undefined}
                      aria-keyshortcuts="Delete Backspace"
                      aria-describedby={`${departmentsHeading}-close`}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={(event) => {
                        if (event.key === 'Delete' || event.key === 'Backspace') {
                          event.preventDefault();
                          if (!event.repeat) closeDepartment(department);
                          return;
                        }
                        onNavKeyDown(event);
                      }}
                      onClick={() => {
                        onSelect(workspace.id);
                      }}
                      className={cx(
                        'sb-label flex h-9 w-full items-center gap-1.5 px-4 text-left focus-visible:-outline-offset-4',
                        active ? 'bg-accent font-bold text-accent-contrast focus-visible:outline-accent-contrast' : 'text-text hover:bg-surface-raised',
                      )}
                    >
                      {workspace.label}
                      {isUnsaved(layoutsOf(layouts, workspace.id)) && (
                        <span aria-label={t('sidebar.unsavedLayout')} role="img" className="inline-block size-1.5 rounded-full bg-current" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* How to take one off, said once for the whole list rather than in every name. */}
            <p id={`${departmentsHeading}-close`} hidden>
              {t('sidebar.departmentClose')}
            </p>
          </li>
        )}
        {customs.length > 0 && (
          // The person's own workspaces (3.6d), in the order made. Renamed and deleted in Manage workspaces….
          <li className="border-b border-border-top pb-1">
            <h2 id={customsHeading} className="sb-label px-4 pt-3 pb-1 text-text-muted">
              {t('sidebar.customWorkspaces')}
            </h2>
            <ul aria-labelledby={customsHeading}>
              {customs.map((custom) => {
                const active = custom.id === activeId;
                return (
                  <li key={custom.id}>
                    <button
                      id={sectionId(custom.id)}
                      type="button"
                      data-nav-item=""
                      data-custom-workspace={custom.id}
                      aria-current={active ? 'page' : undefined}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={onNavKeyDown}
                      onClick={() => {
                        onSelect(custom.id);
                      }}
                      className={cx(
                        'sb-label flex h-9 w-full items-center gap-1.5 px-4 text-left focus-visible:-outline-offset-4',
                        active ? 'bg-accent font-bold text-accent-contrast focus-visible:outline-accent-contrast' : 'text-text hover:bg-surface-raised',
                      )}
                    >
                      <span className="truncate">{custom.name}</span>
                      {isUnsaved(layoutsOf(layouts, custom.id)) && (
                        <span aria-label={t('sidebar.unsavedLayout')} role="img" className="inline-block size-1.5 shrink-0 rounded-full bg-current" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        )}
      </ul>
      {/* The foot (polish C): the web version, still to come, then Hide sidebar at the bottom left, where the strip's
          Show sidebar sits once it's hidden, and the Settings gear and the profile at the right. */}
      <div className="shrink-0 border-t border-border-top">
        <WebVersionItem />
        <div className="flex h-9 items-center gap-1 border-t border-border-top px-2">
          <IconButton
            id={HIDE_SIDEBAR_ID}
            size="sm"
            label={t('sidebar.hide', { keys: shortcut.label })}
            aria-keyshortcuts={shortcut.aria}
            onClick={onHide}
          >
            <SidebarGlyph shown />
          </IconButton>
          <span className="flex-1" />
          <GearButton />
          <ProfileButton />
        </div>
      </div>
    </nav>
  );
}

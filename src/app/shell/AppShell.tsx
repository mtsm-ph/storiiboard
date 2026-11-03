import { useEffect, useState } from 'react';
import { clearNotice, useNotice } from '../notice';
import { projectStateOf } from '../../core/model/project';
import { Button } from '../../ui/Button';
import { isDesktop, setProjectState, syncRecentState } from '../projects/actions';
import { ProjectsScreen } from '../projects/ProjectsScreen';
import { projectStore, useProject } from '../projectStore';
import { StatusBar } from './StatusBar';
import { Dock } from './docking/Dock';
import { Sidebar } from './sidebar/Sidebar';
import { useOpenedFiles } from './useOpenedFiles';
import { TopBar } from './TopBar';
import { isMac, undoCommandFor } from './undoShortcuts';
import { sectionId, WORKSPACE_PANEL_ID, WORKSPACES, workspaceForShortcut, type WorkspaceId } from './workspaces';

export function AppShell() {
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>('storyboard');
  // The scene the storyboard is on: its sidebar entry carries the orange marker. Phase 1's board follows it.
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  // All projects… asks for the Projects screen while a project is open; opening one, or a section, leaves it.
  const [projectsAsked, setProjectsAsked] = useState(false);
  const notice = useNotice();
  useOpenedFiles();
  const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0];
  const projectTitle = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' ? title : (s.project?.name ?? null);
  });
  const projectPath = useProject((s) => s.project?.file.path ?? null);
  const projectState = useProject((s) => (s.project ? projectStateOf(s.records[s.project.projectId]?.props) : null));

  // Recent shows each project's state without opening it, so a change here (or its undo) is copied there.
  useEffect(() => {
    if (projectPath !== null && projectState !== null) void syncRecentState(projectPath, projectState);
  }, [projectPath, projectState]);
  // The desktop app with nothing open shows the Projects screen. The browser build can't open files, so it shows
  // the workspaces' placeholder tiles instead, as a preview of the shell (and for its end-to-end tests).
  const showProjects = isDesktop && (projectPath === null || projectsAsked);

  // A project opening or switching leaves the Projects screen for its workspace.
  const [shownPath, setShownPath] = useState(projectPath);
  if (shownPath !== projectPath) {
    setShownPath(projectPath);
    setProjectsAsked(false);
  }
  const selectWorkspace = (id: WorkspaceId) => {
    setWorkspaceId(id);
    setProjectsAsked(false);
  };

  useEffect(() => {
    const mac = isMac();
    const onKeyDown = (event: KeyboardEvent) => {
      const command = undoCommandFor(event, mac);
      if (!command) return;
      event.preventDefault();
      // ⌘Z is the project's alone; layout changes undo from the Layout menu.
      void (command === 'undo' ? projectStore.getState().undo() : projectStore.getState().redo());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = workspaceForShortcut(event);
      if (!target) return;
      event.preventDefault();
      if (target.id === workspaceId) return;
      // The old workspace's tiles unmount on a switch: focus inside them would drop to <body>, and focus on the
      // old section would be left behind. Either way it moves to the new section, where a click would have put it.
      const focused = document.activeElement;
      const follow =
        focused !== null &&
        (document.getElementById(WORKSPACE_PANEL_ID)?.contains(focused) === true ||
          WORKSPACES.some((w) => sectionId(w.id) === focused.id));
      setWorkspaceId(target.id);
      setProjectsAsked(false);
      if (follow) requestAnimationFrame(() => document.getElementById(sectionId(target.id))?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspaceId]);

  return (
    <div className="sb-grain flex h-full flex-col text-ink">
      <TopBar projectName={projectTitle} workspace={workspace} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          workspaces={WORKSPACES}
          activeId={workspace.id}
          onSelect={selectWorkspace}
          activeSceneId={activeSceneId}
          onSelectScene={setActiveSceneId}
          onShowProjects={() => {
            setProjectsAsked(true);
          }}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {notice && (
            <div role="alert" className="mx-gap mt-gap flex items-center gap-3 bg-warning px-3 py-2 text-paper-fixed">
              <p className="text-[13px]">{notice}</p>
              <button
                type="button"
                onClick={clearNotice}
                className="sb-label ml-auto border border-paper-fixed px-2 py-1 focus-visible:outline-paper-fixed"
              >
                Dismiss
              </button>
            </div>
          )}
          {!showProjects && projectState === 'archived' && (
            <div role="status" className="mx-gap mt-gap flex items-center gap-3 border border-ink px-3 py-1.5">
              <p className="text-[13px]">
                This project is archived: it’s off the switcher and under Archived on the Projects screen. It stays
                editable.
              </p>
              <Button className="ml-auto" onClick={() => void setProjectState('active')}>
                Unarchive
              </Button>
            </div>
          )}
          {showProjects ? (
            <div id={WORKSPACE_PANEL_ID} className="flex min-h-0 flex-1 flex-col">
              <ProjectsScreen />
            </div>
          ) : (
            // Keyed by workspace so drag and keyboard-move state never carries from one workspace to the next.
            <Dock key={workspace.id} workspace={workspace} />
          )}
        </main>
      </div>
      <StatusBar workspace={workspace} />
    </div>
  );
}

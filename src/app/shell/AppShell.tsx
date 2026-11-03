import { useEffect, useState } from 'react';
import { ProjectHome } from '../project/ProjectHome';
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
  // Why the last file the person asked for didn't open; shown until dismissed or another one opens.
  const [openError, setOpenError] = useState<string | null>(null);
  useOpenedFiles(setOpenError);
  const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0];
  const projectTitle = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' ? title : (s.project?.name ?? null);
  });
  const projectOpen = useProject((s) => s.project !== null);

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
          onSelect={setWorkspaceId}
          activeSceneId={activeSceneId}
          onSelectScene={setActiveSceneId}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {openError && (
            <div role="alert" className="mx-gap mt-gap flex items-center gap-3 bg-warning px-3 py-2 text-paper-fixed">
              <p className="text-[13px]">{openError}</p>
              <button
                type="button"
                onClick={() => {
                  setOpenError(null);
                }}
                className="sb-label ml-auto border border-paper-fixed px-2 py-1 focus-visible:outline-paper-fixed"
              >
                Dismiss
              </button>
            </div>
          )}
          {projectOpen ? (
            // Phase 0's edit surface; the workspaces fill with real tools from Phase 1.
            <div id={WORKSPACE_PANEL_ID} className="flex min-h-0 flex-1 flex-col">
              <ProjectHome />
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

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { clearNotice, useNotice } from '../notice';
import { projectStateOf } from '../../core/model/project';
import { Button } from '../../ui/Button';
import { canOpenFiles, isTauriApp } from '../fileAccess';
import { reopenChangedProject, setProjectState, syncRecentState } from '../projects/actions';
import { ProjectsScreen } from '../projects/ProjectsScreen';
import { noteIfSynced } from '../projects/synced';
import { projectStore, useProject } from '../projectStore';
import { OnboardingHost } from '../theme/OnboardingDialog';
import { StatusBar } from './StatusBar';
import { Dock } from './docking/Dock';
import { openTile } from './docking/layout';
import { layoutStore } from './docking/layoutStore';
import { isDragging } from './docking/textSelection';
import { useSelection } from '../../features/storyboard/selection';
import { Sidebar } from './sidebar/Sidebar';
import { SidebarStrip } from './sidebar/SidebarStrip';
import { HIDE_SIDEBAR_ID, isSidebarToggle, SHOW_SIDEBAR_ID } from './sidebar/sidebarToggle';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { useOpenedFiles } from './useOpenedFiles';
import { TopBar } from './TopBar';
import { isMac, undoCommandFor } from './undoShortcuts';
import { inModalDialog, sectionId, TILES, WORKSPACE_PANEL_ID, WORKSPACES, workspaceForShortcut, type WorkspaceId } from './workspaces';
import { SketchHost } from '../../features/storyboard/sketch/SketchHost';
import { ImportScriptHost } from '../../features/script/ImportScriptDialog';
import { ExportHost } from '../../features/export/ExportDialog';
import { isSettingsShortcut, openSettings, SettingsHost } from '../settings/SettingsWindow';
import { AskHost } from '../ask';
import { t } from '../../core/i18n';

export function AppShell() {
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>('storyboard');
  // The scene the storyboard is on, shared with the Scenes tile and the board (src/features/storyboard/selection.ts).
  const activeSceneId = useSelection((s) => s.sceneId);
  const setActiveSceneId = useSelection((s) => s.selectScene);
  // All projects… asks for the Projects screen while a project is open; opening one, or a section, leaves it.
  const [projectsAsked, setProjectsAsked] = useState(false);
  const notice = useNotice();
  // Hidden or shown as the person last left it (polish 2); the workspace takes the room, its tiles keeping their shares.
  const [sidebarHidden, setSidebarHidden] = useState(() => loadSettings().sidebarHidden);
  useOpenedFiles();
  const workspace = WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0];
  const projectTitle = useProject((s) => {
    const title = s.project ? s.records[s.project.projectId]?.props.title : undefined;
    return typeof title === 'string' ? title : (s.project?.name ?? null);
  });
  const projectPath = useProject((s) => s.project?.file.path ?? null);
  const projectState = useProject((s) => (s.project ? projectStateOf(s.records[s.project.projectId]?.props) : null));

  // A write refused because a sync replaced the file: open the newer version (src/app/projects/actions.ts).
  const changedOnDisk = useProject((s) => s.changedOnDisk);
  useEffect(() => {
    if (changedOnDisk) void reopenChangedProject();
  }, [changedOnDisk]);

  // Once per project: say that a project in a synced folder should be open on one computer at a time.
  useEffect(() => {
    if (isTauriApp && projectPath !== null) void noteIfSynced(projectPath);
  }, [projectPath]);

  // Recent shows each project's state without opening it, so a change here (or its undo) is copied there.
  useEffect(() => {
    if (projectPath !== null && projectState !== null) void syncRecentState(projectPath, projectState);
  }, [projectPath, projectState]);
  // The desktop app with nothing open shows the Projects screen. The browser build can't open files, so it shows
  // the workspaces' placeholder tiles instead, as a preview of the shell (and for its end-to-end tests).
  const showProjects = canOpenFiles && (projectPath === null || projectsAsked);

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

  /** Hides or shows the sidebar. `focusFollows`: focus moves to the button that brings it back, never to <body>. */
  const hiddenRef = useRef(sidebarHidden);
  const toggleSidebar = (focusFollows: boolean) => {
    const next = !hiddenRef.current;
    hiddenRef.current = next;
    setSidebarHidden(next);
    saveSettings({ sidebarHidden: next });
    // Whichever of the two buttons is drawn now: Show sidebar in the strip, or Hide sidebar at the sidebar's foot.
    if (focusFollows) requestAnimationFrame(() => (document.getElementById(SHOW_SIDEBAR_ID) ?? document.getElementById(HIDE_SIDEBAR_ID))?.focus());
  };
  const onToggleKey = useEffectEvent((event: KeyboardEvent) => {
    // Not while a tile or a splitter is being dragged: the workspace would move from under the pointer.
    if (!isSidebarToggle(event, isMac()) || isDragging()) return;
    event.preventDefault();
    // From the keyboard, focus moves only if it was in what's folding away.
    const focused = document.activeElement;
    toggleSidebar(focused !== null && focused.closest('[data-sidebar]') !== null);
  });

  useEffect(() => {
    const mac = isMac();
    // ⌘, (Ctrl+,): Settings, from anywhere but another window of the app's.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSettingsShortcut(event, mac) || inModalDialog(event.target)) return;
      event.preventDefault();
      openSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onToggleKey);
    return () => {
      window.removeEventListener('keydown', onToggleKey);
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
      // With the sidebar hidden there's no section to land on: the new workspace itself takes focus.
      if (follow) requestAnimationFrame(() => (document.getElementById(sectionId(target.id)) ?? document.getElementById(WORKSPACE_PANEL_ID))?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspaceId]);

  return (
    <div className="sb-grain flex h-full flex-col text-text">
      <TopBar
        projectName={projectTitle}
        workspace={workspace}
        onOpenHistory={() => {
          // From the Projects screen too: back to the workspace, with History in front.
          const { layouts, change } = layoutStore.getState();
          change(workspace.id, openTile(layouts[workspace.id].current, 'history'));
          setProjectsAsked(false);
          // Focus goes into the tile, on its first control, so the keyboard needn't cross the workspace to reach it.
          requestAnimationFrame(() => {
            const tile = document.querySelector(`section[aria-label="${CSS.escape(TILES.history?.title ?? '')}"]`);
            tile?.querySelector<HTMLElement>('[data-scroll-root] :is(button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])')?.focus();
          });
        }}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarHidden ? (
          <SidebarStrip
            onShow={() => {
              toggleSidebar(true);
            }}
          />
        ) : (
          <Sidebar
            workspaces={WORKSPACES}
            activeId={workspace.id}
            onSelect={selectWorkspace}
            activeSceneId={activeSceneId}
            onSelectScene={setActiveSceneId}
            onShowProjects={() => {
              setProjectsAsked(true);
            }}
            onHide={() => {
              toggleSidebar(true);
            }}
          />
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {notice.message !== null &&
            (notice.kind === 'warning' ? (
              <div role="alert" className="mx-gap mt-gap flex items-center gap-3 bg-warning px-3 py-2 text-paper-fixed">
                <p className="text-[13px]">{notice.message}</p>
                <button
                  type="button"
                  onClick={clearNotice}
                  className="sb-label ml-auto border border-paper-fixed px-2 py-1 focus-visible:outline-paper-fixed"
                >
                  {t('appShell.dismiss')}
                </button>
              </div>
            ) : (
              <div role="status" className="mx-gap mt-gap flex items-center gap-3 border border-text px-3 py-1.5">
                <p className="text-[13px]">{notice.message}</p>
                <button type="button" onClick={clearNotice} className="sb-label ml-auto border border-text px-2 py-1">
                  {t('appShell.gotIt')}
                </button>
              </div>
            ))}
          {!showProjects && projectState === 'archived' && (
            <div role="status" className="mx-gap mt-gap flex items-center gap-3 border border-text px-3 py-1.5">
              <p className="text-[13px]">
                {t('appShell.thisProjectIsArchivedIts')}
              </p>
              <Button className="ml-auto" onClick={() => void setProjectState('active')}>
                {t('appShell.unarchive')}
              </Button>
            </div>
          )}
          {showProjects ? (
            <div id={WORKSPACE_PANEL_ID} tabIndex={-1} className="flex min-h-0 flex-1 flex-col focus-visible:outline-offset-[-2px]">
              <ProjectsScreen />
            </div>
          ) : (
            // Keyed by workspace so drag and keyboard-move state never carries from one workspace to the next.
            <Dock key={workspace.id} workspace={workspace} />
          )}
        </main>
        <SketchHost />
      </div>
      <StatusBar workspace={workspace} />
      <OnboardingHost />
      <ImportScriptHost />
      <ExportHost />
      <SettingsHost />
      <AskHost />
    </div>
  );
}

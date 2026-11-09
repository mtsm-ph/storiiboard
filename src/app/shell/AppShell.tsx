import { useEffect, useEffectEvent, useState } from 'react';
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
import { layoutsOf, layoutStore } from './docking/layoutStore';
import { isDragging } from './docking/textSelection';
import { useSelection } from '../../features/storyboard/selection';
import { Sidebar } from './sidebar/Sidebar';
import { SidebarStrip } from './sidebar/SidebarStrip';
import { isSidebarToggle } from './sidebar/sidebarToggle';
import { toggleSidebar, useSidebarHidden } from './sidebar/sidebarStore';
import { useOpenedFiles } from './useOpenedFiles';
import { TopBar } from './TopBar';
import { isMac, undoCommandFor } from './undoShortcuts';
import { inModalDialog, sectionId, TILES, WORKSPACE_PANEL_ID, WORKSPACES, workspaceById, workspaceForShortcut, type WorkspaceId } from './workspaces';
import { showWorkspace, useWorkspaceState } from './workspaceStore';
import { SketchHost } from '../../features/storyboard/sketch/SketchHost';
import { ImportScriptHost } from '../../features/script/ImportScriptDialog';
import { ExportHost } from '../../features/export/ExportDialog';
import { openExportDialog } from '../../features/export/exportStore';
import { MarkSeen } from '../../features/storyboard/useMarkSeen';
import { EyedropperHost } from '../../features/storyboard/palette/Eyedropper';
import { isSettingsShortcut, openSettings, SettingsHost } from '../settings/SettingsWindow';
import { AskHost } from '../ask';
import { ManageWorkspacesHost } from './ManageWorkspaces';
import { useNotificationSync } from '../../features/notifications/notificationsStore';
import { NoticeBar } from '../NoticeBar';
import { t } from '../../core/i18n';

export function AppShell() {
  // A section, or a department's workspace (3.6a), which a frame's department row can open from inside a tile.
  const workspaceId = useWorkspaceState((s) => s.active);
  // The scene the storyboard is on, shared with the Scenes tile and the board (src/features/storyboard/selection.ts).
  const activeSceneId = useSelection((s) => s.sceneId);
  const setActiveSceneId = useSelection((s) => s.selectScene);
  // All projects… asks for the Projects screen while a project is open; opening one, or a section, leaves it.
  const [projectsAsked, setProjectsAsked] = useState(false);
  // Hidden or shown as the person last left it (polish 2); the workspace takes the room, its tiles keeping their shares.
  const sidebarHidden = useSidebarHidden();
  useOpenedFiles();
  // Notifications' read state kept in step with the project and whoever is reading (3.10), for the count and the tile.
  useNotificationSync();
  // Read through the store, so a rename of one of the person's own workspaces (3.6d) names it anew everywhere.
  const workspace = useWorkspaceState((s) => workspaceById(s.active));
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
    showWorkspace(id);
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
        (document.getElementById(WORKSPACE_PANEL_ID)?.contains(focused) === true || focused.closest('[data-sidebar] [data-nav-item]') !== null);
      showWorkspace(target.id);
      setProjectsAsked(false);
      // With the sidebar hidden there's no section to land on: the new workspace itself takes focus.
      if (follow) requestAnimationFrame(() => (document.getElementById(sectionId(target.id)) ?? document.getElementById(WORKSPACE_PANEL_ID))?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspaceId]);

  /** History, from the top bar's button, the project menu or ⌘⇧H: the tile in front, focus inside it. */
  const openHistoryHere = () => {
    // From the Projects screen too: back to the workspace, with History in front.
    const { layouts, change } = layoutStore.getState();
    change(workspace.id, openTile(layoutsOf(layouts, workspace.id).current, 'history'));
    setProjectsAsked(false);
    // Focus goes into the tile, on its first control, so the keyboard needn't cross the workspace to reach it.
    requestAnimationFrame(() => {
      const tile = document.querySelector(`section[aria-label="${CSS.escape(TILES.history?.title ?? '')}"]`);
      tile?.querySelector<HTMLElement>('[data-scroll-root] :is(button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])')?.focus();
    });
  };

  // The project menu's shortcuts (polish A): ⌘⇧H History, ⌘E Export, with a project open and no window of the app's up.
  const onMenuKey = useEffectEvent((event: KeyboardEvent) => {
    // Not mid-drag, nor while an input method composes; the key read where it sits too, for layouts without Latin letters.
    if (projectPath === null || inModalDialog(event.target) || event.repeat || event.isComposing || isDragging()) return;
    const mac = isMac();
    const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!command || event.altKey) return;
    // The letter typed, on any Latin layout (Dvorak, Colemak); the key's place only where the layout has no Latin letters.
    const typed = event.key.toLowerCase();
    const key = /^[a-z]$/.test(typed) ? typed : event.code === 'KeyH' ? 'h' : event.code === 'KeyE' ? 'e' : typed;
    if (key === 'h' && event.shiftKey) {
      event.preventDefault();
      openHistoryHere();
    } else if (key === 'e' && !event.shiftKey) {
      event.preventDefault();
      openExportDialog('export');
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onMenuKey);
    return () => {
      window.removeEventListener('keydown', onMenuKey);
    };
  }, []);

  return (
    <div className="sb-grain flex h-full flex-col text-text">
      {/* A frame opened marks it Seen by this person's department (polish 6b), whichever tile opened it. Its own
          component, so a new selection re-renders it alone, never the shell. */}
      <MarkSeen />
      {/* The palette's eyedropper (polish PP): on while a scene's palette is picking from a frame. */}
      <EyedropperHost />
      <TopBar projectName={projectTitle} workspace={workspace} onOpenHistory={openHistoryHere} />
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
          <NoticeBar />
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
      <ManageWorkspacesHost />
      <AskHost />
    </div>
  );
}

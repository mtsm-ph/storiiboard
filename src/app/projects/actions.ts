import type { ProjectState } from '../../core/model/project';
import { CHANGED_ON_DISK } from '../../core/storage/driver';
import { appDataDir } from '@tauri-apps/api/path';
import { copyBackup, folderOfPath } from '../../core/storage/openBackup';
import { setRecentState } from '../../core/storage/recent';
import { loadSettings } from '../../core/storage/settings';
import { appData, appDriver, isTauriApp } from '../fileAccess';
import { fileStem } from '../../core/storage/paths';
import { clearNotice, showInfo, showNotice } from '../notice';
import { createProjectFile, openProjectFile, reopenProjectFile, type OpenFileOptions } from '../openFiles';
import { projectStore } from '../projectStore';
import { openOnboarding } from '../theme/onboarding';
import { askWhenLocked, pickBackupToOpen, pickNewProjectPath, pickProjectToOpen } from './dialogs';
import { createRecentStore } from './recentStore';
import { projectsFolderForNew } from './synced';

// What the Projects screen and the switcher do: in the desktop app, or in the end-to-end tests' memory build
// (src/app/fileAccess.ts). The plain browser build has no files to open, and says so instead of failing.

/** The app's Recent list. Empty in the plain browser build. */
export const recentStore = createRecentStore(appData);

/** How the desktop app opens files: through Rust, remembered in Recent, backed up as Settings says. */
export const files: OpenFileOptions = {
  store: projectStore,
  driver: appDriver,
  ...(appData ? { recent: appData } : {}),
  ...(isTauriApp ? { askWhenLocked } : {}),
  backupsNextToProject: () => loadSettings().backupsNextToProject,
  backups: {
    keep: () => loadSettings().backups,
    onError: (error) => {
      // A backup refused because a sync replaced the file is handled like a refused edit: reopen the new version.
      if (error instanceof Error && error.message === CHANGED_ON_DISK) projectStore.setState({ changedOnDisk: true });
      else showNotice(`The last backup didn’t complete. ${error instanceof Error ? error.message : String(error)}`);
    },
  },
};

let reopening = false;

/**
 * After a write was refused because a sync put a newer version of the file in place (most likely edited on another
 * computer): open that version, and say what happened. The refused change was never written.
 */
export async function reopenChangedProject(): Promise<void> {
  const path = projectStore.getState().project?.file.path;
  if (!path || reopening) return;
  reopening = true;
  try {
    if (!(await reopenProjectFile(path, files))) {
      // Not opened (Cancel at "open on another computer"): the one open is on a replaced file and can't be saved to,
      // so it closes rather than refuse every edit without a word.
      await projectStore.getState().close();
      showNotice(
        'This project changed on disk, most likely from another computer, and wasn’t opened again. Storiiboard ' +
          'closed the old version, which can’t be saved to. Your last change wasn’t saved.',
      );
      return;
    }
    showNotice(
      'This project changed on disk, most likely from another computer, so Storiiboard opened the newest version. ' +
        'Your last change wasn’t saved; please make it again.',
    );
  } catch (error) {
    // The open project is on a file that's been replaced, so it can't be saved to: it closes, and the notice says why.
    await projectStore.getState().close();
    showNotice(error);
  } finally {
    reopening = false;
    await recentStore.getState().refresh();
  }
}

/**
 * Runs an action; on failure the reason shows as a notice, on success any old notice goes. Recent is re-read. Returns
 * whether it worked.
 */
async function attempt(action: () => Promise<void>): Promise<boolean> {
  let worked = false;
  try {
    await action();
    clearNotice();
    worked = true;
  } catch (error) {
    showNotice(error);
  }
  await recentStore.getState().refresh();
  return worked;
}

export async function newProject(): Promise<void> {
  await attempt(async () => {
    const path = await pickNewProjectPath();
    if (path === null) return;
    await createProjectFile(path, files);
    // The new project's first step: its look, which can be skipped (docs/PLAN.md B).
    const created = projectStore.getState().project;
    if (created?.file.path === path) openOnboarding({ projectId: created.projectId, path });
  });
}

export async function openWithDialog(): Promise<void> {
  await attempt(async () => {
    const path = await pickProjectToOpen();
    if (path !== null) await openProjectFile(path, files);
  });
}

export async function openRecent(path: string): Promise<void> {
  await attempt(() => openProjectFile(path, files));
}

/**
 * Opens a copy of a backup as its own project; the backup itself is never edited. From the Backups tile the copy goes
 * beside the open project, wherever its backups are kept.
 */
export async function openBackup(path: string, projectPath: string): Promise<void> {
  let copy = '';
  const worked = await attempt(async () => {
    copy = await copyBackup(path, appDriver, folderOfPath(projectPath));
    await openProjectFile(copy, files);
  });
  if (worked) announceBackupCopy(copy);
}

/** A backup's copy keeps the project's title, so the notice says which file is open and that the original is safe. */
function announceBackupCopy(copy: string): void {
  showInfo(`Opened a backup as a separate project, “${fileStem(copy)}”. The original is unchanged.`);
}

/**
 * Open backup… on the Projects screen. A backup picked from a Backups folder beside its project is copied beside the
 * project; one from the app's own folder (a synced project's) is copied where New project would start.
 */
export async function openBackupWithDialog(): Promise<void> {
  // An object, so the check after the closure sees what the closure set.
  const opened: { copy: string | null } = { copy: null };
  const worked = await attempt(async () => {
    const path = await pickBackupToOpen();
    if (path === null) return;
    const local = isTauriApp && path.startsWith(await appDataDir());
    const beside = local ? await projectsFolderForNew() : undefined;
    opened.copy = await copyBackup(path, appDriver, beside);
    await openProjectFile(opened.copy, files);
  });
  if (worked && opened.copy !== null) announceBackupCopy(opened.copy);
}

/** Draft, active or archived: an op on the project record, so undo takes it back. */
export async function setProjectState(state: ProjectState): Promise<void> {
  const project = projectStore.getState().project;
  if (!project) return;
  await projectStore.getState().apply([{ kind: 'update', id: project.projectId, set: { state } }]);
}

/** Keeps Recent's copy of a project's state in step, whether it changed by a command or by undo. */
export async function syncRecentState(path: string, state: ProjectState): Promise<void> {
  if (!appData) return;
  await setRecentState(appData, path, state).catch(() => undefined);
  await recentStore.getState().refresh();
}

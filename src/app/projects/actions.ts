import { isTauri } from '@tauri-apps/api/core';
import type { ProjectState } from '../../core/model/project';
import { tauriAppData } from '../../core/storage/appData';
import { CHANGED_ON_DISK } from '../../core/storage/driver';
import { appDataDir } from '@tauri-apps/api/path';
import { copyBackup, folderOfPath } from '../../core/storage/openBackup';
import { setRecentState } from '../../core/storage/recent';
import { loadSettings } from '../../core/storage/settings';
import { tauriDriver } from '../../core/storage/tauriDriver';
import { clearNotice, showNotice } from '../notice';
import { createProjectFile, openProjectFile, reopenProjectFile, type OpenFileOptions } from '../openFiles';
import { projectStore } from '../projectStore';
import { askWhenLocked, pickBackupToOpen, pickNewProjectPath, pickProjectToOpen } from './dialogs';
import { createRecentStore } from './recentStore';
import { projectsFolderForNew } from './synced';

// What the Projects screen and the switcher do. Projects live on disk, so this is the desktop app's alone: the
// browser build (tests, the shell preview) has no files to open, and says so instead of failing.

export const isDesktop = isTauri();

/** The app's Recent list. Empty in the browser build. */
export const recentStore = createRecentStore(isDesktop ? tauriAppData : null);

/** How the desktop app opens files: through Rust, remembered in Recent, backed up as Settings says. */
export const files: OpenFileOptions = {
  store: projectStore,
  driver: tauriDriver,
  recent: tauriAppData,
  askWhenLocked,
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
    await reopenProjectFile(path, files);
    showNotice(
      'This project changed on disk, most likely from another computer, so Storiiboard opened the newest version. ' +
        'Your last change wasn’t saved; please make it again.',
    );
  } catch (error) {
    showNotice(error);
  } finally {
    reopening = false;
    await recentStore.getState().refresh();
  }
}

/** Runs an action; on failure the reason shows as a notice, on success any old notice goes. Recent is re-read. */
async function attempt(action: () => Promise<void>): Promise<void> {
  try {
    await action();
    clearNotice();
  } catch (error) {
    showNotice(error);
  }
  await recentStore.getState().refresh();
}

export function newProject(): Promise<void> {
  return attempt(async () => {
    const path = await pickNewProjectPath();
    if (path !== null) await createProjectFile(path, files);
  });
}

export function openWithDialog(): Promise<void> {
  return attempt(async () => {
    const path = await pickProjectToOpen();
    if (path !== null) await openProjectFile(path, files);
  });
}

export function openRecent(path: string): Promise<void> {
  return attempt(() => openProjectFile(path, files));
}

/**
 * Opens a copy of a backup as its own project; the backup itself is never edited. From the Backups tile the copy goes
 * beside the open project, wherever its backups are kept.
 */
export function openBackup(path: string, projectPath: string): Promise<void> {
  return attempt(async () => {
    await openProjectFile(await copyBackup(path, tauriDriver, folderOfPath(projectPath)), files);
  });
}

/**
 * Open backup… on the Projects screen. A backup picked from a Backups folder beside its project is copied beside the
 * project; one from the app's own folder (a synced project's) is copied where New project would start.
 */
export function openBackupWithDialog(): Promise<void> {
  return attempt(async () => {
    const path = await pickBackupToOpen();
    if (path === null) return;
    const local = path.startsWith(await appDataDir());
    const beside = local ? await projectsFolderForNew() : undefined;
    await openProjectFile(await copyBackup(path, tauriDriver, beside), files);
  });
}

/** Draft, active or archived: an op on the project record, so undo takes it back. */
export async function setProjectState(state: ProjectState): Promise<void> {
  const project = projectStore.getState().project;
  if (!project) return;
  await projectStore.getState().apply([{ kind: 'update', id: project.projectId, set: { state } }]);
}

/** Keeps Recent's copy of a project's state in step, whether it changed by a command or by undo. */
export async function syncRecentState(path: string, state: ProjectState): Promise<void> {
  if (!isDesktop) return;
  await setRecentState(tauriAppData, path, state).catch(() => undefined);
  await recentStore.getState().refresh();
}

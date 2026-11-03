import { isTauri } from '@tauri-apps/api/core';
import type { ProjectState } from '../../core/model/project';
import { tauriAppData } from '../../core/storage/appData';
import { copyBackup } from '../../core/storage/openBackup';
import { setRecentState } from '../../core/storage/recent';
import { loadSettings } from '../../core/storage/settings';
import { tauriDriver } from '../../core/storage/tauriDriver';
import { clearNotice, showNotice } from '../notice';
import { createProjectFile, openProjectFile, type OpenFileOptions } from '../openFiles';
import { projectStore } from '../projectStore';
import { pickBackupToOpen, pickNewProjectPath, pickProjectToOpen } from './dialogs';
import { createRecentStore } from './recentStore';

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
  backups: {
    keep: () => loadSettings().backups,
    onError: (error) => {
      showNotice(`The last backup didn’t complete. ${error instanceof Error ? error.message : String(error)}`);
    },
  },
};

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

/** Opens a copy of a backup as its own project, beside the original; the backup itself is never edited. */
export function openBackup(path: string): Promise<void> {
  return attempt(async () => {
    await openProjectFile(await copyBackup(path, tauriDriver), files);
  });
}

export function openBackupWithDialog(): Promise<void> {
  return attempt(async () => {
    const path = await pickBackupToOpen();
    if (path !== null) await openProjectFile(await copyBackup(path, tauriDriver), files);
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

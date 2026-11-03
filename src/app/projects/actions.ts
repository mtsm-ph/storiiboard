import { isTauri } from '@tauri-apps/api/core';
import { tauriAppData } from '../../core/storage/appData';
import { tauriDriver } from '../../core/storage/tauriDriver';
import { clearNotice, showNotice } from '../notice';
import { createProjectFile, openProjectFile, type OpenFileOptions } from '../openFiles';
import { projectStore } from '../projectStore';
import { pickNewProjectPath, pickProjectToOpen } from './dialogs';
import { createRecentStore } from './recentStore';

// What the Projects screen and the switcher do. Projects live on disk, so this is the desktop app's alone: the
// browser build (tests, the shell preview) has no files to open, and says so instead of failing.

export const isDesktop = isTauri();

/** The app's Recent list. Empty in the browser build. */
export const recentStore = createRecentStore(isDesktop ? tauriAppData : null);

const files: OpenFileOptions = { store: projectStore, driver: tauriDriver, recent: tauriAppData };

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

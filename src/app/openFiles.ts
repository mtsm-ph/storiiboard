import type { StoreApi } from 'zustand/vanilla';
import type { AppDataStore } from '../core/storage/appData';
import type { BackupOptions } from '../core/storage/backups';
import type { LockHolder, SqlDriver } from '../core/storage/driver';
import { copyBeside } from '../core/storage/openBackup';
import { fileName } from '../core/storage/paths';
import { createProject, openProject, type Project } from '../core/storage/project';
import type { ProjectState } from './projectStore';
import { localizeError, t } from '../core/i18n';

// Opening or making a .sbd the person asked for: a double-click (0.6), the Projects screen or the switcher (0.7).
// One window holds one project, so the new one replaces the open one. Every edit is already on disk, so closing
// loses nothing.

export interface OpenFileOptions {
  store: StoreApi<ProjectState>;
  driver: SqlDriver;
  recent?: AppDataStore;
  backups?: BackupOptions;
  /** Read at each open: the person's setting to keep synced projects' backups next to them. */
  backupsNextToProject?: () => boolean;
  /**
   * Asked when another computer has the project open (its lock file is fresh). Left out, the project opens anyway,
   * as it would for someone who chose Open anyway.
   */
  askWhenLocked?: (holder: LockHolder, path: string) => Promise<LockedChoice>;
}

/** Open a copy (safe: a separate project), open anyway (edits may end up in two conflicting copies), or cancel. */
export type LockedChoice = 'copy' | 'anyway' | 'cancel';

/** A failure to open, worded for the person: which file, and why. */
export class OpenFileError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(t('open.failed', { name: fileName(path), reason: localizeError(cause instanceof Error ? cause.message : String(cause)) }));
    this.name = 'OpenFileError';
  }
}

/**
 * Opens the project at `path` in place of the one open now. The new file is opened before the old one closes, so if
 * it can't be opened (missing, not a project, from a newer Storiiboard) the current project stays as it was. Resolves
 * to whether it's open: Cancel at "open on another computer" opens nothing.
 */
export async function openProjectFile(path: string, options: OpenFileOptions): Promise<boolean> {
  if (options.store.getState().project?.file.path === path) return true;
  return openChecked(path, options);
}

/**
 * Opens the project at `path` again, even though it's the one open: after a sync replaced the file, this loads the
 * newer version. The old connection, still on the replaced file, closes once the new one is open.
 */
export async function reopenProjectFile(path: string, options: OpenFileOptions): Promise<boolean> {
  return openChecked(path, options);
}

/** Whether it opened: Cancel at the "open on another computer" question opens nothing. */
async function openChecked(path: string, options: OpenFileOptions): Promise<boolean> {
  const holder = options.askWhenLocked ? await options.driver.lockHolder(path) : null;
  const choice = holder && options.askWhenLocked ? await options.askWhenLocked(holder, path) : 'anyway';
  if (choice === 'cancel') return false;
  let target = path;
  if (choice === 'copy') {
    try {
      target = await copyBeside(path, 'copy', options.driver);
    } catch (error) {
      throw new OpenFileError(path, error);
    }
  }
  await replaceWith(target, options, openProject);
  return true;
}

/** Makes a new project at `path` and opens it in place of the open one. It never overwrites an existing file. */
export async function createProjectFile(path: string, options: OpenFileOptions): Promise<void> {
  await replaceWith(path, options, createProject);
}

async function replaceWith(
  path: string,
  { store, driver, recent, backups, backupsNextToProject }: OpenFileOptions,
  start: typeof openProject,
): Promise<void> {
  let project: Project;
  try {
    project = await start(path, {
      driver,
      ...(recent ? { recent } : {}),
      ...(backups ? { backups } : {}),
      backupsNextToProject: backupsNextToProject?.() ?? false,
    });
  } catch (error) {
    throw new OpenFileError(path, error);
  }
  // Open replaces the project in place: the one open now closes once the new one's records are in, so the window
  // never shows "no project" (the Projects screen and the kit's colours) in between.
  try {
    await store.getState().open(project);
  } catch (error) {
    throw new OpenFileError(path, error);
  }
}

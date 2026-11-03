import type { StoreApi } from 'zustand/vanilla';
import type { AppDataStore } from '../core/storage/appData';
import type { SqlDriver } from '../core/storage/driver';
import { fileName } from '../core/storage/paths';
import { createProject, openProject, type Project } from '../core/storage/project';
import type { ProjectState } from './projectStore';

// Opening or making a .sbd the person asked for: a double-click (0.6), the Projects screen or the switcher (0.7).
// One window holds one project, so the new one replaces the open one. Every edit is already on disk, so closing
// loses nothing.

export interface OpenFileOptions {
  store: StoreApi<ProjectState>;
  driver: SqlDriver;
  recent?: AppDataStore;
}

/** A failure to open, worded for the person: which file, and why. */
export class OpenFileError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Couldn’t open “${fileName(path)}”. ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'OpenFileError';
  }
}

/**
 * Opens the project at `path` in place of the one open now. The new file is opened before the old one closes, so if
 * it can't be opened (missing, not a project, from a newer Storiiboard) the current project stays as it was.
 */
export async function openProjectFile(path: string, options: OpenFileOptions): Promise<void> {
  if (options.store.getState().project?.file.path === path) return;
  await replaceWith(path, options, openProject);
}

/** Makes a new project at `path` and opens it in place of the open one. It never overwrites an existing file. */
export async function createProjectFile(path: string, options: OpenFileOptions): Promise<void> {
  await replaceWith(path, options, createProject);
}

async function replaceWith(
  path: string,
  { store, driver, recent }: OpenFileOptions,
  start: typeof openProject,
): Promise<void> {
  let project: Project;
  try {
    project = await start(path, { driver, ...(recent ? { recent } : {}) });
  } catch (error) {
    throw new OpenFileError(path, error);
  }
  await store.getState().close();
  await store.getState().open(project);
}

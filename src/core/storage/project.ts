import { version as appVersion } from '../../../package.json';
import type { AppDataStore } from './appData';
import { startBackups, type BackupOptions, type BackupSchedule } from './backups';
import type { ProjectFile, SqlDriver } from './driver';
import { migrate, setMeta, type MigrationResult } from './migrate';
import { fileStem } from './paths';
import { rememberRecent } from './recent';

export interface Project {
  readonly file: ProjectFile;
  /** The .sbd's name without the extension, as Finder and Explorer show it. */
  readonly name: string;
  readonly migration: MigrationResult;
  /** Null when backups were turned off for this open. */
  readonly backups: BackupSchedule | null;
  close(): Promise<void>;
}

export interface ProjectOptions {
  driver: SqlDriver;
  /** Where the Recent list lives. Left out, the list isn't touched (tests, and Open backup in 0.7). */
  recent?: AppDataStore;
  /** `false` turns the 5-minute backups off for this open. */
  backups?: BackupOptions | false;
  now?: () => Date;
}

/** Makes a new .sbd at `path` with the current schema and opens it. */
export function createProject(path: string, options: ProjectOptions): Promise<Project> {
  return start(path, options, true);
}

/** Opens an existing .sbd, upgrading it first if it's from an older schema (with a backup made before). */
export function openProject(path: string, options: ProjectOptions): Promise<Project> {
  return start(path, options, false);
}

async function start(path: string, options: ProjectOptions, isNew: boolean): Promise<Project> {
  const { driver, recent, backups = {}, now = () => new Date() } = options;
  const file = isNew ? await driver.create(path) : await driver.open(path);

  let migration: MigrationResult;
  try {
    migration = await migrate(file, { isNew, now });
    // Which app last wrote the file, for anyone reading a support report or a file sent from another machine.
    await file.tx([setMeta('app_version', appVersion, now())]);
  } catch (error) {
    await file.close();
    throw error;
  }

  const name = fileStem(path);
  if (recent) {
    // The Recent list is a convenience: failing to update it must never stop a project from opening.
    await rememberRecent(recent, { path, name, openedAt: now().toISOString() }).catch(() => undefined);
  }
  const schedule = backups === false ? null : await startBackups(file, { now, ...backups });

  return {
    file,
    name,
    migration,
    backups: schedule,
    close: async () => {
      schedule?.stop();
      await file.close();
    },
  };
}

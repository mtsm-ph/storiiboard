import { version as appVersion } from '../../../package.json';
import { projectStateOf, type ProjectState } from '../model/project';
import type { Props } from '../model/record';
import { keyBetween } from '../ops/order';
import type { AppDataStore } from './appData';
import { startBackups, type BackupOptions, type BackupSchedule } from './backups';
import type { ProjectFile, SqlDriver } from './driver';
import { migrate, setMeta, type MigrationResult } from './migrate';
import { fileStem } from './paths';
import { rememberRecent } from './recent';

export interface Project {
  readonly file: ProjectFile;
  /** The id of the file's one project record. */
  readonly projectId: string;
  /** The .sbd's name without the extension, as Finder and Explorer show it. */
  readonly name: string;
  readonly migration: MigrationResult;
  /** Null when backups were turned off for this open. */
  readonly backups: BackupSchedule | null;
  close(): Promise<void>;
}

export const LOCK_REFRESH_MS = 60 * 1000;

export interface ProjectOptions {
  driver: SqlDriver;
  /** Where the Recent list lives. Left out, the list isn't touched (tests, and Open backup in 0.7). */
  recent?: AppDataStore;
  /** `false` turns the 5-minute backups off for this open. */
  backups?: BackupOptions | false;
  /** How often the lock file is rewritten while open; another computer counts it stale after 5 minutes. */
  lockRefreshMs?: number;
  /**
   * The person's setting: keep a synced project's backups next to it rather than in a folder on this computer
   * (docs/PLAN.md, F). Unsynced projects keep them next to the file either way.
   */
  backupsNextToProject?: boolean;
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
  const {
    driver,
    recent,
    backups = {},
    lockRefreshMs = LOCK_REFRESH_MS,
    backupsNextToProject = false,
    now = () => new Date(),
  } = options;
  const file = isNew ? await driver.create(path) : await driver.open(path);

  const name = fileStem(path);
  let migration: MigrationResult;
  let projectId: string;
  try {
    migration = await migrate(file, { isNew, now });
    projectId = await ensureProjectRecord(file, name, now);
  } catch (error) {
    await file.close();
    throw error;
  }

  if (recent) {
    // The Recent list is a convenience: failing to update it must never stop a project from opening.
    const state = await readState(file, projectId);
    await rememberRecent(recent, { path, name, openedAt: now().toISOString(), state }).catch(() => undefined);
  }
  // Where backups go is settled before the first one: a synced project keeps them on this computer.
  await file.placeBackups(backupsNextToProject);
  const schedule = backups === false ? null : await startBackups(file, { now, ...backups });
  // A missed refresh only risks a later warning on another computer, never the project, so failures are ignored.
  const lockTimer = setInterval(() => {
    file.refreshLock().catch(() => undefined);
  }, lockRefreshMs);

  return {
    file,
    projectId,
    name,
    migration,
    backups: schedule,
    close: async () => {
      schedule?.stop();
      clearInterval(lockTimer);
      await file.close();
    },
  };
}

/**
 * Every file holds exactly one project record, the root every other record hangs from. It's written with the file,
 * not as an op, so undo can never remove it. Also records which app last opened the file, for anyone reading a
 * support report or a file sent from another machine.
 */
async function ensureProjectRecord(file: ProjectFile, name: string, now: () => Date): Promise<string> {
  const [existing] = await file.query("SELECT id FROM records WHERE type = 'project' AND parent_id IS NULL LIMIT 1");
  const at = now().toISOString();
  const id = existing ? String(existing.id) : crypto.randomUUID();
  await file.tx([
    ...(existing
      ? []
      : [
          {
            sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at)
              VALUES (?, 'project', NULL, ?, ?, ?, ?)`,
            // New projects start as drafts, as in the prototype.
            params: [id, keyBetween(null, null), JSON.stringify({ title: name, notes: '', state: 'draft' }), at, at],
          },
        ]),
    setMeta('app_version', appVersion, now()),
    // An id for the file itself, so a synced project's local backup folder belongs to this file and no copy of it.
    ...(await hasMeta(file, 'file_id') ? [] : [setMeta('file_id', crypto.randomUUID(), now())]),
  ]);
  return id;
}

async function hasMeta(file: ProjectFile, key: string): Promise<boolean> {
  return (await file.query('SELECT 1 FROM meta WHERE key = ?', [key])).length > 0;
}

/** The project's state, for the Recent list, which shows it without opening every file. */
async function readState(file: ProjectFile, projectId: string): Promise<ProjectState> {
  const [row] = await file.query('SELECT props FROM records WHERE id = ?', [projectId]);
  return projectStateOf(row ? (JSON.parse(String(row.props)) as Props) : undefined);
}

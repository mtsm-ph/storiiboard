import { version as appVersion } from '../../../package.json';
import { projectStateOf, type ProjectState } from '../model/project';
import type { Props } from '../model/record';
import { keyBetween } from '../ops/order';
import type { AppDataStore } from './appData';
import { startBackups, type BackupOptions, type BackupSchedule } from './backups';
import type { ProjectFile, SqlDriver } from './driver';
import { migrate, setMeta, type MigrationResult } from './migrate';
import { fileStem, pathKey } from './paths';
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
  /**
   * Closes the file and its lock. A hand backup still queued is made first, and one under way finished (`flush`, on
   * unless set false): not for a file a sync replaced, which is no longer the project (#244 round 3).
   */
  close(options?: { flush?: boolean }): Promise<void>;
}

/**
 * Files still closing, by `pathKey` (one key for two spellings of a path): a close that makes a queued backup first
 * can run on after a switch (projectStore's `open`), and the same file opened again meanwhile waits for it, up to
 * CLOSE_WAIT_MS.
 */
const closing = new Map<string, Promise<void>>();

/**
 * How long opening a file waits for its last close (Kevin, Nov 20: nothing waits without an end). Past it the open
 * goes on and `onStillClosing` says so. That's safe: from the moment its close began, the old connection only reads
 * the project file, for its copy (what it writes and prunes is in the backups folder; its 5-minute timer and its lock
 * refresh stopped then, so it never rewrites the lock); the new connection opens beside it as a second one to the same
 * file; and the old one's close removes the lock file only when it's still its own session's (lock.rs, nodeDriver.ts),
 * so it never takes the new one's. In the desktop app every open file shares one lock in Rust (`OpenFiles`, sbd.rs),
 * so the new connection's calls still wait out any single copy step that stalls; a lock per file is a later item.
 */
export const CLOSE_WAIT_MS = 10 * 1000;

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
  /** CLOSE_WAIT_MS unless a test sets it. */
  closeWaitMs?: number;
  /** Told when this file's last close is still running after `closeWaitMs` and the open goes on without it. */
  onStillClosing?: () => void;
  /**
   * Told when the backup a close made first (a queued or unfinished hand backup) failed: the project is closing, so
   * its sign can't show it; the app keeps it for the next time the file opens (#244 round 4).
   */
  onCloseBackupFailed?: (error: unknown) => void;
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
    closeWaitMs = CLOSE_WAIT_MS,
  } = options;
  const key = pathKey(path);
  await closed(key, closeWaitMs, options.onStillClosing);
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

  let schedule: Awaited<ReturnType<typeof startBackups>> | null = null;
  try {
    if (recent) {
      // The Recent list is a convenience: failing to update it must never stop a project from opening.
      const state = await readState(file, projectId);
      await rememberRecent(recent, { path, name, openedAt: now().toISOString(), state }).catch(() => undefined);
    }
    // Where backups go is settled before the first one: a synced project keeps them on this computer.
    await file.placeBackups(backupsNextToProject);
    schedule = backups === false ? null : await startBackups(file, { now, ...backups });
  } catch (error) {
    // Not opened after all: the file closes again, its lock with it.
    await file.close().catch(() => undefined);
    throw error;
  }
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
    close: (closeOptions) => {
      const done = (async () => {
        // First, so a close that hangs never keeps the lock fresh, nor rewrites it over a newer open's.
        clearInterval(lockTimer);
        // A hand backup waiting for its minute is made now (if anything changed), and one under way finished: the sign
        // said one would be.
        if (closeOptions?.flush !== false) {
          const failed = await schedule?.flushQueued();
          if (failed) {
            try {
              options.onCloseBackupFailed?.(failed.error);
            } catch {
              // Keeping the note is a courtesy: it never stops the file closing.
            }
          }
        }
        schedule?.stop();
        await file.close();
      })();
      const settled = done.then(
        () => undefined,
        () => undefined,
      );
      closing.set(key, settled);
      void settled.then(() => {
        if (closing.get(key) === settled) closing.delete(key);
      });
      return done;
    },
  };
}

/** Waits for the file's last close, if one is running, for at most `limitMs`; past it, says so and goes on. */
async function closed(key: string, limitMs: number, onStillClosing: (() => void) | undefined): Promise<void> {
  const last = closing.get(key);
  if (!last) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    last.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(true);
      }, limitMs);
    }),
  ]);
  clearTimeout(timer);
  if (!timedOut) return;
  try {
    onStillClosing?.();
  } catch {
    // Saying so never stops the open.
  }
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

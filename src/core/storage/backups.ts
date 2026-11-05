import type { BackupFile, ProjectFile } from './driver';
import { fileStem } from './paths';

// Every 5 minutes, if the project changed, a backup goes to Backups/ next to it (CLAUDE.md, docs/SBD_FORMAT.md): an
// APFS clone on a Mac, a full copy elsewhere. Names and pruning are decided here, in local time, because that's how
// people read them in Finder or Explorer; the Rust side checks every name again before it writes or deletes anything.

export const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

export interface BackupKeep {
  /** The newest backups kept whatever their age. */
  recent: number;
  /** The newest backup of each of this many calendar days, today included, is kept too. */
  days: number;
}

/** The defaults for both numbers, which people change in Settings (src/core/storage/settings.ts). */
export const DEFAULT_KEEP: BackupKeep = { recent: 12, days: 14 };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A project's backups share this much disk (Kevin, Nov 3), each counted as the space it alone takes. In practice it
 * limits full copies, since a clone shares nearly all it holds. Gigabytes as Finder and Explorer show them, 10^9 bytes.
 */
export const BACKUP_CAP_BYTES = 5e9;

/** The newest backups the cap never deletes, however large they are. */
export const ALWAYS_KEPT = 3;

/** `YYYY-MM-DD HH-mm`, local time. Colons aren't allowed in Windows file names, hence the dash in the time. */
export function stamp(at: Date): string {
  const date = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
}

/**
 * `Bey County 2026-11-02 14-05.sbd`; a second backup in the same minute is `Bey County 2026-11-02 14-05 (2).sbd`, so
 * a name never carries a time that hasn't come yet (Kevin, Nov 4).
 */
export function backupFileName(projectStem: string, at: Date, copy = 1): string {
  return `${projectStem} ${stamp(at)}${copy > 1 ? ` (${String(copy)})` : ''}.sbd`;
}

/** `Bey County.sbd.bak-v1-2026-11-02 14-05`, the copy made before upgrading a file from schema `from`. */
export function migrationBackupName(projectFileName: string, from: number, at: Date): string {
  return `${projectFileName}.bak-v${String(from)}-${stamp(at)}`;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})$/;
/** The most backups one minute can hold: its copy numbers run to ` (99)`, the room openBackup.ts leaves for them. */
export const MAX_COPIES = 99;
/** A scheduled backup's stamp, with the copy number a second one in the same minute takes: ` (2)` to ` (99)`. */
const BACKUP_STAMP = /^((\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2}))(?: \(([2-9]|[1-9]\d)\))?$/;

/** The shape check src-tauri/src/sbd.rs makes before it writes or deletes a backup; nodeDriver.ts makes it too. */
export function isBackupName(projectStem: string, name: string): boolean {
  const prefix = `${projectStem} `;
  return name.startsWith(prefix) && name.endsWith('.sbd') && BACKUP_STAMP.test(name.slice(prefix.length, -'.sbd'.length));
}

export function isMigrationBackupName(projectFileName: string, name: string): boolean {
  const prefix = `${projectFileName}.bak-v`;
  if (!name.startsWith(prefix)) return false;
  const match = /^(\d+)-(.*)$/.exec(name.slice(prefix.length));
  return match !== null && STAMP.test(match[2] ?? '');
}

/** When a backup of this project was made and which copy of that minute it is, or null if it isn't one of its backups. */
export function parseBackup(projectStem: string, name: string): { at: Date; copy: number } | null {
  const prefix = `${projectStem} `;
  if (!name.startsWith(prefix) || !name.endsWith('.sbd')) return null;
  const match = BACKUP_STAMP.exec(name.slice(prefix.length, -'.sbd'.length));
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(2, 7).map(Number) as [number, number, number, number, number];
  const at = new Date(year, month - 1, day, hours, minutes);
  // Date rolls 2026-02-30 over to March; a name like that wasn't made by us.
  return stamp(at) === match[1] ? { at, copy: Number(match[7] ?? 1) } : null;
}

/** When a backup of this project was made, or null if the name isn't one of its backups. */
export function parseBackupFileName(projectStem: string, name: string): Date | null {
  return parseBackup(projectStem, name)?.at ?? null;
}

/** Newest first: by time, then a minute's later copies before its earlier ones. */
function newestFirst(a: { at: Date; copy: number }, b: { at: Date; copy: number }): number {
  return b.at.getTime() - a.at.getTime() || b.copy - a.copy;
}

/** Backup names in the order they were made, newest first; names that aren't this project's backups go last. */
export function byNewest(projectStem: string, names: readonly string[]): string[] {
  const parsed = names.map((name) => ({ name, backup: parseBackup(projectStem, name) }));
  return parsed
    .sort((a, b) => (a.backup && b.backup ? newestFirst(a.backup, b.backup) : a.backup ? -1 : b.backup ? 1 : 0))
    .map((entry) => entry.name);
}

/** Which of this project's backups pruning deletes. Names that aren't its backups are never in the result. */
export function backupsToDelete(names: readonly string[], projectStem: string, now: Date, keep: BackupKeep): string[] {
  const dated = names
    .map((name) => ({ name, parsed: parseBackup(projectStem, name) }))
    .flatMap(({ name, parsed }) => (parsed ? [{ name, ...parsed }] : []))
    .sort(newestFirst);

  const kept = new Set(dated.slice(0, keep.recent).map((backup) => backup.name));
  // Local midnight at the start of the oldest day kept. Built from the calendar date, so a daylight-saving change
  // can't shift it by an hour.
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (keep.days - 1));
  const daysSeen = new Set<string>();
  for (const backup of dated) {
    if (backup.at < firstDay) continue;
    const day = stamp(backup.at).slice(0, 10);
    if (daysSeen.has(day)) continue;
    // Newest first, so the first backup seen for a day is that day's newest.
    daysSeen.add(day);
    kept.add(backup.name);
  }
  return dated.filter((backup) => !kept.has(backup.name)).map((backup) => backup.name);
}

/**
 * Which backups go to bring this project's under the cap, oldest first, never one of the newest three. Runs after the
 * keep rule, on what it left.
 */
export function backupsOverCap(backups: readonly BackupFile[], projectStem: string, cap = BACKUP_CAP_BYTES): string[] {
  const oldestFirst = backups
    .flatMap((backup) => {
      const parsed = parseBackup(projectStem, backup.name);
      return parsed ? [{ ...backup, ...parsed }] : [];
    })
    .sort((a, b) => newestFirst(b, a));
  let total = oldestFirst.reduce((sum, backup) => sum + backup.bytes, 0);
  const deleted: string[] = [];
  for (const backup of oldestFirst.slice(0, Math.max(0, oldestFirst.length - ALWAYS_KEPT))) {
    if (total <= cap) break;
    deleted.push(backup.name);
    total -= backup.bytes;
  }
  return deleted;
}

/** SQLite's count of rows changed through this connection since it opened. */
async function changeCount(file: ProjectFile): Promise<number> {
  const [row] = await file.query('SELECT total_changes() AS changes');
  return Number(row?.changes ?? 0);
}

export interface BackupRun {
  /** The backup written, or null when nothing had changed. */
  created: string | null;
  deleted: string[];
}

export interface BackupOptions {
  intervalMs?: number;
  /** A function is read at every run, so a change in Settings applies without reopening the project. */
  keep?: BackupKeep | (() => BackupKeep);
  /** BACKUP_CAP_BYTES unless a test sets it. */
  capBytes?: number;
  now?: () => Date;
  /** A failed backup never stops the project; it's reported here so the app can show it. */
  onError?: (error: unknown) => void;
}

export interface BackupSchedule {
  /** Backs up now if anything changed since the last backup, then prunes. */
  runNow(): Promise<BackupRun>;
  /**
   * A backup of the file as it is, then `then`, with no backup of this schedule's between or during them (Compact
   * project, 1.27). When nothing has changed since this schedule's last backup, that one stands for it. Resolves to
   * the backup's name and what `then` returned.
   */
  backUpThen<T>(then: () => Promise<T>): Promise<{ backup: string; result: T }>;
  stop(): void;
}

/**
 * A backup name for the file as it is now: this minute's, or this minute's next copy, ` (2)` on, when a backup made
 * earlier this minute already has it. That one holds an older state, and backups are never overwritten.
 */
export async function freshBackupName(file: ProjectFile, at: Date): Promise<string> {
  const stem = fileStem(file.path);
  const taken = new Set((await file.listBackups()).map((backup) => backup.name));
  for (let copy = 1; copy <= MAX_COPIES; copy += 1) {
    const name = backupFileName(stem, at, copy);
    if (!taken.has(name)) return name;
  }
  throw new Error(`This project already has ${String(MAX_COPIES)} backups from this minute. Try again in a minute.`);
}

/**
 * Starts the 5-minute backups for an open project. Call it once the open is complete: whatever was written while
 * opening (a migration, the app version) doesn't count as a change, so opening a project alone never makes one.
 */
export async function startBackups(file: ProjectFile, options: BackupOptions = {}): Promise<BackupSchedule> {
  const { intervalMs = BACKUP_INTERVAL_MS, keep = DEFAULT_KEEP, capBytes = BACKUP_CAP_BYTES, now = () => new Date() } =
    options;
  const stem = fileStem(file.path);
  let backedUpAt = await changeCount(file);
  /** The newest backup this schedule made, which stands for the file while nothing has changed since. */
  let latest: string | null = null;
  let running: Promise<BackupRun> | null = null;
  let stopped = false;
  // Everything that copies the file takes its turn: the desktop makes one copy of a project at a time.
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  const backUp = async (): Promise<BackupRun> => {
    const changes = await changeCount(file);
    if (changes <= backedUpAt) return { created: null, deleted: [] };
    const at = now();
    // A second run in the same minute (a manual one right after a scheduled one) is that minute's next copy.
    const name = await freshBackupName(file, at);
    await file.backup('scheduled', name);
    backedUpAt = changes;
    latest = name;
    // Listed again for the new backup's size.
    const backups = await file.listBackups();
    const byAge = backupsToDelete(
      backups.map((backup) => backup.name),
      stem,
      at,
      typeof keep === 'function' ? keep() : keep,
    );
    const left = backups.filter((backup) => !byAge.includes(backup.name));
    // Never the copy just made: after the clock goes back (a time zone, a fix), it can sort as the oldest.
    const deleted = [...byAge, ...backupsOverCap(left, stem, capBytes)].filter((old) => old !== name);
    for (const old of deleted) await file.deleteBackup(old);
    return { created: name, deleted };
  };

  // One run at a time: a slow disk must not start a second copy over the first.
  const runNow = () => {
    running ??= inTurn(backUp).finally(() => {
      running = null;
    });
    return running;
  };

  const backUpThen = <T>(then: () => Promise<T>) =>
    inTurn(async () => {
      const changes = await changeCount(file);
      // The newest stands only while it's still there: someone short of space may have deleted it by hand.
      const listed = latest !== null && (await file.listBackups()).some((b) => b.name === latest);
      let backup = listed ? latest : null;
      if (backup === null || changes > backedUpAt) {
        backup = await freshBackupName(file, now());
        await file.backup('scheduled', backup);
        backedUpAt = changes;
        latest = backup;
      }
      return { backup, result: await then() };
    });

  const timer = setInterval(() => {
    runNow().catch((error: unknown) => {
      // A copy cut off by closing the project isn't a failure to tell anyone about.
      if (!stopped) options.onError?.(error);
    });
  }, intervalMs);

  return {
    runNow,
    backUpThen,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

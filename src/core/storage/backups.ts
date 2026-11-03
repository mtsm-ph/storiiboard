import type { ProjectFile } from './driver';
import { fileStem } from './paths';

// Every 5 minutes, if the project changed, a full copy goes to Backups/ next to it (CLAUDE.md, docs/SBD_FORMAT.md).
// Names and pruning are decided here, in local time, because that's how people read them in Finder or Explorer; the
// Rust side checks every name again before it writes or deletes anything.

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

/** `YYYY-MM-DD HH-mm`, local time. Colons aren't allowed in Windows file names, hence the dash in the time. */
export function stamp(at: Date): string {
  const date = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}-${pad(at.getMinutes())}`;
}

/** `Bey County 2026-11-02 14-05.sbd` */
export function backupFileName(projectStem: string, at: Date): string {
  return `${projectStem} ${stamp(at)}.sbd`;
}

/** `Bey County.sbd.bak-v1-2026-11-02 14-05`, the copy made before upgrading a file from schema `from`. */
export function migrationBackupName(projectFileName: string, from: number, at: Date): string {
  return `${projectFileName}.bak-v${String(from)}-${stamp(at)}`;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})$/;

/** The shape check src-tauri/src/sbd.rs makes before it writes or deletes a backup; nodeDriver.ts makes it too. */
export function isBackupName(projectStem: string, name: string): boolean {
  const prefix = `${projectStem} `;
  return name.startsWith(prefix) && name.endsWith('.sbd') && STAMP.test(name.slice(prefix.length, -'.sbd'.length));
}

export function isMigrationBackupName(projectFileName: string, name: string): boolean {
  const prefix = `${projectFileName}.bak-v`;
  if (!name.startsWith(prefix)) return false;
  const match = /^(\d+)-(.*)$/.exec(name.slice(prefix.length));
  return match !== null && STAMP.test(match[2] ?? '');
}

/** When a backup of this project was made, or null if the name isn't one of its backups. */
export function parseBackupFileName(projectStem: string, name: string): Date | null {
  const prefix = `${projectStem} `;
  if (!name.startsWith(prefix) || !name.endsWith('.sbd')) return null;
  const match = STAMP.exec(name.slice(prefix.length, -'.sbd'.length));
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number) as [number, number, number, number, number];
  const at = new Date(year, month - 1, day, hours, minutes);
  // Date rolls 2026-02-30 over to March; a name like that wasn't made by us.
  return stamp(at) === match[0] ? at : null;
}

/** Which of this project's backups pruning deletes. Names that aren't its backups are never in the result. */
export function backupsToDelete(names: readonly string[], projectStem: string, now: Date, keep: BackupKeep): string[] {
  const dated = names
    .map((name) => ({ name, at: parseBackupFileName(projectStem, name) }))
    .filter((backup): backup is { name: string; at: Date } => backup.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());

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
  now?: () => Date;
  /** A failed backup never stops the project; it's reported here so the app can show it. */
  onError?: (error: unknown) => void;
}

export interface BackupSchedule {
  /** Backs up now if anything changed since the last backup, then prunes. */
  runNow(): Promise<BackupRun>;
  stop(): void;
}

/**
 * Starts the 5-minute backups for an open project. Call it once the open is complete: whatever was written while
 * opening (a migration, the app version) doesn't count as a change, so opening a project alone never makes one.
 */
export async function startBackups(file: ProjectFile, options: BackupOptions = {}): Promise<BackupSchedule> {
  const { intervalMs = BACKUP_INTERVAL_MS, keep = DEFAULT_KEEP, now = () => new Date(), onError } = options;
  const stem = fileStem(file.path);
  let backedUpAt = await changeCount(file);
  let running: Promise<BackupRun> | null = null;

  const backUp = async (): Promise<BackupRun> => {
    const changes = await changeCount(file);
    if (changes <= backedUpAt) return { created: null, deleted: [] };
    const at = now();
    const name = backupFileName(stem, at);
    const existing = await file.listBackups();
    // Two runs in the same minute (a manual one right after a scheduled one) share a name; the first copy stands.
    if (!existing.includes(name)) await file.backup('scheduled', name);
    backedUpAt = changes;
    const deleted = backupsToDelete([...new Set([...existing, name])], stem, at, typeof keep === 'function' ? keep() : keep);
    for (const old of deleted) await file.deleteBackup(old);
    return { created: name, deleted };
  };

  // One run at a time: a slow disk must not start a second copy over the first.
  const runNow = () => {
    running ??= backUp().finally(() => {
      running = null;
    });
    return running;
  };

  const timer = setInterval(() => {
    runNow().catch((error: unknown) => onError?.(error));
  }, intervalMs);

  return {
    runNow,
    stop: () => {
      clearInterval(timer);
    },
  };
}

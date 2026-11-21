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

/**
 * When this project's newest backup was made, from its name, or null when it has none: one listing, read when a project
 * opens (the status bar's sign, 6.5.4); after that the schedule's `onBackup` says when a new one is written.
 */
export async function newestBackupAt(file: ProjectFile): Promise<Date | null> {
  const stem = fileStem(file.path);
  const [newest] = byNewest(stem, (await file.listBackups()).map((backup) => backup.name));
  return newest === undefined ? null : parseBackupFileName(stem, newest);
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

/**
 * What a backup asked for by hand did (Ctrl+S, ⌘S, or Settings → Backups → Back up now; Kevin, Nov 18): nothing, as
 * nothing changed since the newest backup; queued for `at`, when the newest is a minute old; a new copy in place of a
 * hand one made since the last tick (Kevin, Nov 20); or a new copy. `deleted` is what pruning took, as in BackupRun.
 */
export type HandBackup =
  | { kind: 'nothing'; newestAt: Date | null; deleted: string[] }
  | { kind: 'queued'; at: Date; deleted: string[] }
  | { kind: 'replaced'; created: string; replaced: string; deleted: string[] }
  | { kind: 'created'; created: string; deleted: string[] };

/** A hand backup under this old waits: one is queued for when the minute is up. */
export const HAND_WAIT_MS = 60 * 1000;
/** A hand backup made since the last tick, under this long ago, is replaced by the next hand backup, not added to. */
export const HAND_REPLACE_MS = 5 * 60 * 1000;

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
  /**
   * A backup asked for by hand, one rule for Ctrl+S and Back up now, so pressing after every edit never pushes the timed
   * backups out of the last 12: nothing when nothing changed; under a minute after the newest, one is queued for when
   * the minute is up (at most one); under 5 minutes after a hand backup made since the last tick, the new copy
   * replaces it, written first and the old one deleted after; otherwise a new copy. A tick's own copy is never
   * replaced, so there's a copy for every 5 minutes whoever presses (Kevin, Nov 20). Prunes as every run does.
   */
  backUpByHand(): Promise<HandBackup>;
  /**
   * For a close: makes the queued hand backup now, if one is waiting and anything changed, so closing or switching the
   * project never drops the copy the sign said would be made; a hand copy already being made (a press, or the queued
   * one whose minute came) is waited for. The 5-minute timer stops as it begins, so a close that hangs queues no more
   * runs. Resolves once it's on disk or failed: to the failure of the last copy it waited for or made, or null. A
   * failure never goes to `onError`, nor does any later one: the project is closing, and another may be open by the
   * time it ends (#244 round 3), so a failure can't be told on its sign; the caller keeps it for the next open (round 4).
   */
  flushQueued(): Promise<{ error: unknown } | null>;
  /** Whether a hand backup is queued or being made: a close then has a copy to make or finish first. */
  pending(): boolean;
  /**
   * Calls `listener` with the time in a backup's name each time this schedule writes one (the 5-minute run, Back up
   * now, Compact's), so the status bar's sign (6.5.4) learns of it without reading the disk. Returns the unsubscribe.
   */
  onBackup(listener: (at: Date) => void): () => void;
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
  /** When this schedule wrote `latest`, to the millisecond: a hand backup's minute and 5 minutes count from it. */
  let latestAt: Date | null = null;
  /**
   * Whether a hand backup may replace `latest`: only a hand copy made since the last tick (Kevin, Nov 20). A tick's
   * own copy, or one a tick adopted, stands for its 5 minutes and is never replaced; nor is one Compact made or
   * adopted, its safety copy. Kept in memory only, so a copy from before this session is never replaceable.
   */
  let latestReplaceable = false;
  /** The one hand backup waiting for its minute, if any. */
  let queued: { at: Date; timer: ReturnType<typeof setTimeout> } | null = null;
  /**
   * The latest hand backup asked for (a press, or the queued one once its minute came) while it's in its turn: a close
   * waits for it before the file goes. Hand runs take their turns in order, so the latest settles after the others.
   */
  let handRun: Promise<HandBackup> | null = null;
  let running: Promise<BackupRun> | null = null;
  let stopped = false;
  /** Set when a close begins (`flushQueued`): from then on no failure is told, as after `stop()`. */
  let closing = false;
  const report = (error: unknown) => {
    if (!stopped && !closing) options.onError?.(error);
  };
  const listeners = new Set<(at: Date) => void>();
  const tell = (at: Date) => {
    // A listener that throws never fails the backup it hears of: the copy is on disk either way.
    for (const listener of listeners) {
      try {
        listener(at);
      } catch {
        // Ignored on purpose, as above.
      }
    }
  };
  // Everything that copies the file takes its turn: the desktop makes one copy of a project at a time.
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  /** Pruning after a copy, by the keep rule then the cap. */
  const prune = async (name: string, at: Date): Promise<string[]> => {
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
    return deleted;
  };

  const backUp = async (): Promise<BackupRun> => {
    const changes = await changeCount(file);
    if (changes <= backedUpAt) {
      // A hand copy took in this run's changes, so it stands for this run: from now on it's the run's, never replaced.
      // Otherwise a press every few minutes would replace its last copy forever, leaving one backup for a session.
      latestReplaceable = false;
      return { created: null, deleted: [] };
    }
    const at = now();
    // A second run in the same minute (a timed one right after a hand one) is that minute's next copy.
    const name = await freshBackupName(file, at);
    await file.backup('scheduled', name);
    backedUpAt = changes;
    latest = name;
    latestAt = at;
    // A tick's own copy: never replaced by a press, so every 5 minutes keeps one (Kevin, Nov 20).
    latestReplaceable = false;
    try {
      return { created: name, deleted: await prune(name, at) };
    } finally {
      // Told once pruning is done, so a list read on hearing it never shows a copy about to go.
      tell(at);
    }
  };

  /** A copy the person can't see go: deleted by hand meanwhile counts as gone already. */
  const deleteReplaced = async (old: string): Promise<void> => {
    try {
      await file.deleteBackup(old);
    } catch (error) {
      if ((await file.listBackups()).some((b) => b.name === old)) throw error;
    }
  };

  /** The hand rule; `wait` false makes the copy now, for the queued one a close can't leave waiting. */
  const byHand = async (wait = true): Promise<HandBackup> => {
    if (wait && queued) return { kind: 'queued', at: queued.at, deleted: [] };
    const changes = await changeCount(file);
    // With no copy written this session, the newest on disk counts, by the time in its name.
    const newestAt = latestAt ?? (await newestBackupAt(file));
    if (changes <= backedUpAt) return { kind: 'nothing', newestAt, deleted: [] };
    const at = now();
    // A clock that went back makes the age negative: that copy is no guide, and a new one is made.
    const age = newestAt === null ? null : at.getTime() - newestAt.getTime();
    if (wait && newestAt !== null && age !== null && age >= 0 && age < HAND_WAIT_MS) {
      const due = new Date(newestAt.getTime() + HAND_WAIT_MS);
      const timer = setTimeout(() => {
        queued = null;
        if (stopped) return;
        backUpByHand().catch((error: unknown) => {
          report(error);
        });
      }, HAND_WAIT_MS - age);
      queued = { at: due, timer };
      return { kind: 'queued', at: due, deleted: [] };
    }
    // Only a hand copy this schedule wrote since the last tick, under 5 minutes old and still on disk (someone short of
    // space may have deleted it by hand).
    const old =
      latest !== null && latestReplaceable && age !== null && age >= 0 && age < HAND_REPLACE_MS
        ? (await file.listBackups()).some((b) => b.name === latest)
          ? latest
          : null
        : null;
    const name = await freshBackupName(file, at);
    // The new copy is complete before the old one goes: a failed write leaves the old one as it was.
    await file.backup('scheduled', name);
    backedUpAt = changes;
    latest = name;
    latestAt = at;
    latestReplaceable = true;
    try {
      if (old !== null) await deleteReplaced(old);
      const deleted = (await prune(name, at)).filter((gone) => gone !== old);
      return old !== null
        ? { kind: 'replaced', created: name, replaced: old, deleted }
        : { kind: 'created', created: name, deleted };
    } finally {
      // After the old copy and pruning are done, so a list read on hearing it never shows a replaced file.
      tell(at);
    }
  };

  const backUpByHand = (): Promise<HandBackup> => {
    // A press while one is queued answers at once, without waiting for a copy in progress.
    if (queued) return Promise.resolve({ kind: 'queued', at: queued.at, deleted: [] });
    // Counted while in its turn (pending), so a switch lets it finish rather than close the file under it.
    const run = inTurn(() => byHand());
    handRun = run;
    const clear = () => {
      if (handRun === run) handRun = null;
    };
    void run.then(clear, clear);
    return run;
  };

  const flushQueued = async (): Promise<{ error: unknown } | null> => {
    if (stopped) return null;
    closing = true;
    // A close that hangs (a share that stalls) queues no more 5-minute runs behind it.
    clearInterval(timer);
    let failed: { error: unknown } | null = null;
    // A hand copy already under way (a press, or the queued one whose minute came): the file closes only once it's
    // done, in its turn. Its own caller hears of a failure too, but by then may be showing another project.
    if (handRun) {
      try {
        await handRun;
      } catch (error) {
        failed = { error };
      }
    }
    if (!queued) return failed;
    clearTimeout(queued.timer);
    queued = null;
    try {
      await inTurn(() => byHand(false));
      // This copy holds every change the failed one would have: nothing is missing.
      return null;
    } catch (error) {
      // Not told here (see flushQueued's note): the project is closing, and another may be open by now. The copies
      // made before it are on disk as they were.
      return { error };
    }
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
        const at = now();
        backup = await freshBackupName(file, at);
        await file.backup('scheduled', backup);
        backedUpAt = changes;
        latest = backup;
        latestAt = at;
        tell(at);
      }
      // Made or adopted, it's Compact's safety copy from now on: a hand backup never replaces it.
      latestReplaceable = false;
      return { backup, result: await then() };
    });

  const timer = setInterval(() => {
    // A copy cut off by closing the project isn't a failure to tell anyone about.
    runNow().catch(report);
  }, intervalMs);

  return {
    runNow,
    backUpThen,
    backUpByHand,
    flushQueued,
    pending: () => queued !== null || handRun !== null,
    onBackup: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
      if (queued) clearTimeout(queued.timer);
      queued = null;
    },
  };
}

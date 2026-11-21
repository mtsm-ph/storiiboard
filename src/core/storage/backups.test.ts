import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_INTERVAL_MS,
  backupFileName,
  backupsOverCap,
  backupsToDelete,
  byNewest,
  DEFAULT_KEEP,
  isBackupName,
  isMigrationBackupName,
  migrationBackupName,
  newestBackupAt,
  parseBackupFileName,
  startBackups,
  type HandBackup,
} from './backups';
import type { ProjectFile } from './driver';
import { nodeDriver } from './nodeDriver';
import { createProject } from './project';
import { makeTestFolder, type TestFolder } from './testFolder';

describe('backup names', () => {
  it('stamps local time, with a dash in the time because Windows file names allow no colon', () => {
    const at = new Date(2026, 10, 2, 14, 5);
    expect(backupFileName('Bey County', at)).toBe('Bey County 2026-11-02 14-05.sbd');
    expect(migrationBackupName('Bey County.sbd', 1, at)).toBe('Bey County.sbd.bak-v1-2026-11-02 14-05');
    expect(parseBackupFileName('Bey County', 'Bey County 2026-11-02 14-05.sbd')).toEqual(at);
  });

  // The same cases as checks_backup_names in src-tauri/src/sbd.rs, so the two guards agree.
  it("recognises this project's backups and nothing else", () => {
    expect(isBackupName('Bey County', 'Bey County 2026-11-02 14-05.sbd')).toBe(true);
    expect(isBackupName('Bey', 'Bey County 2026-11-02 14-05.sbd')).toBe(false);
    expect(isBackupName('Bey County', 'Bey County 2026-11-02 14-05.sbd.tmp')).toBe(false);
    expect(isBackupName('Bey County', 'Bey County 2026-11-02 14:05.sbd')).toBe(false);
    expect(isMigrationBackupName('Bey.sbd', 'Bey.sbd.bak-v12-2026-11-02 14-05')).toBe(true);
    expect(isMigrationBackupName('Bey.sbd', 'Bey.sbd.bak-v-2026-11-02 14-05')).toBe(false);
  });

  it("doesn't read a date that doesn't exist", () => {
    expect(parseBackupFileName('Bey', 'Bey 2026-02-30 10-00.sbd')).toBeNull();
  });

  it('names a second backup in the same minute (2), never a time still to come, with one spelling each', () => {
    const at = new Date(2026, 10, 4, 18, 30);
    expect(backupFileName('Bey', at, 2)).toBe('Bey 2026-11-04 18-30 (2).sbd');
    expect(backupFileName('Bey', at, 1)).toBe('Bey 2026-11-04 18-30.sbd');
    for (const copy of ['(2)', '(9)', '(10)', '(99)']) expect(isBackupName('Bey', `Bey 2026-11-04 18-30 ${copy}.sbd`)).toBe(true);
    for (const copy of ['(1)', '(0)', '(02)', '()', '(2a)', '(-2)', '(2', '2)', '(100)']) {
      expect(isBackupName('Bey', `Bey 2026-11-04 18-30 ${copy}.sbd`)).toBe(false);
    }
    expect(parseBackupFileName('Bey', 'Bey 2026-11-04 18-30 (2).sbd')).toEqual(at);
  });

  it('lists and prunes a minute’s copies in the order they were made', () => {
    const at = new Date(2026, 10, 4, 18, 30);
    const minute = [backupFileName('Bey', at), backupFileName('Bey', at, 2), backupFileName('Bey', at, 10)];
    const earlier = backupFileName('Bey', new Date(2026, 10, 4, 18, 29));
    expect(byNewest('Bey', [minute[1] ?? '', earlier, minute[0] ?? '', minute[2] ?? ''])).toEqual([...minute].reverse().concat(earlier));
    // Keeping the newest one keeps the minute's last copy.
    expect(backupsToDelete([earlier, ...minute], 'Bey', at, { recent: 1, days: 1 }).sort()).toEqual([earlier, minute[0], minute[1]].sort());
    // The cap deletes a minute's earliest copies first, whatever order they're listed in.
    const shuffled = [10, 3, 1, 2, 4].map((copy) => backupFileName('Bey', at, copy));
    const capped = backupsOverCap(shuffled.map((name) => ({ name, bytes: 10 })), 'Bey', 25);
    expect(capped).toEqual([backupFileName('Bey', at), backupFileName('Bey', at, 2)]);
  });
});

describe('pruning', () => {
  const now = new Date(2026, 10, 20, 18, 0);
  // Four backups a day (9:00, 12:00, 15:00, 18:00) from Nov 1 to Nov 20.
  const names = Array.from({ length: 20 }, (_, i) =>
    [9, 12, 15, 18].map((hour) => backupFileName('Bey', new Date(2026, 10, i + 1, hour, 0))),
  ).flat();

  it('keeps the newest 12, plus the newest of each of the last 14 days', () => {
    const deleted = new Set(backupsToDelete(names, 'Bey', now, DEFAULT_KEEP));
    const kept = names.filter((name) => !deleted.has(name));
    // The newest 12 are Nov 18 to 20; each day from Nov 7 to Nov 17 adds its 18:00 copy.
    const days = Array.from({ length: 11 }, (_, i) => backupFileName('Bey', new Date(2026, 10, 7 + i, 18, 0)));
    expect(kept).toEqual([...days, ...names.slice(-12)]);
  });

  it('keeps everything while there are only a few backups', () => {
    expect(backupsToDelete(names.slice(-5), 'Bey', now, DEFAULT_KEEP)).toEqual([]);
  });

  it("never returns a file that isn't one of this project's backups", () => {
    const others = ['Bey County 2026-01-01 09-00.sbd', 'notes.txt', 'Bey.sbd'];
    expect(backupsToDelete(others, 'Bey', now, { recent: 0, days: 0 })).toEqual([]);
  });
});

describe('the 5 GB cap', () => {
  const GB = 1e9;
  const backup = (hour: number, bytes: number) => ({ name: backupFileName('Bey', new Date(2026, 10, 3, hour, 0)), bytes });

  it('deletes the oldest full copies until the rest fit', () => {
    const backups = [backup(9, 2 * GB), backup(10, 2 * GB), backup(11, 2 * GB), backup(12, GB), backup(13, GB)];
    expect(backupsOverCap(backups, 'Bey')).toEqual([backups[0]?.name, backups[1]?.name]);
  });

  it('always keeps the newest three, however large', () => {
    const backups = [backup(9, 3 * GB), backup(10, 3 * GB), backup(11, 3 * GB), backup(12, 3 * GB)];
    expect(backupsOverCap(backups, 'Bey')).toEqual([backups[0]?.name]);
  });

  it('barely counts clones, which take next to no space of their own', () => {
    const clones = Array.from({ length: 26 }, (_, i) => backup(i % 24, 2_000_000));
    expect(backupsOverCap(clones, 'Bey')).toEqual([]);
  });

  it("never returns a file that isn't one of this project's backups", () => {
    expect(backupsOverCap([{ name: 'notes.txt', bytes: 9 * GB }, backup(9, 1)], 'Bey', 0)).toEqual([]);
  });
});

describe('the 5-minute schedule', () => {
  let folder: TestFolder;
  let file: ProjectFile;
  let clock: Date;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    folder = makeTestFolder();
    file = await nodeDriver.create(folder.path('Bey.sbd'));
    await file.tx([{ sql: 'CREATE TABLE shots (id TEXT)' }]);
    clock = new Date(2026, 10, 2, 9, 0);
  });

  afterEach(async () => {
    await file.close();
    folder.remove();
    vi.useRealTimers();
  });

  const edit = (id: string) => file.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: [id] }]);
  const names = async (of: ProjectFile) => (await of.listBackups()).map((backup) => backup.name);

  /** Lets five minutes pass, then waits for the run they started. */
  async function fiveMinutes(schedule: { runNow: () => Promise<unknown> }, minutes: number) {
    clock = new Date(2026, 10, 2, 9, minutes);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    // A run still in progress is returned as is; otherwise this one finds nothing new and writes nothing.
    await schedule.runNow();
  }

  it('backs up only when the project changed since the last backup', async () => {
    const schedule = await startBackups(file, { now: () => clock });
    await fiveMinutes(schedule, 5);
    expect(await names(file)).toEqual([]);

    await edit('1A');
    await fiveMinutes(schedule, 10);
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd']);

    await fiveMinutes(schedule, 15);
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd']);
    schedule.stop();
  });

  it('prunes after each backup', async () => {
    const schedule = await startBackups(file, { now: () => clock, keep: { recent: 2, days: 0 } });
    for (const minutes of [5, 10, 15]) {
      await edit(`1${String(minutes)}`);
      await fiveMinutes(schedule, minutes);
    }
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd', 'Bey 2026-11-02 09-15.sbd']);
    schedule.stop();
  });

  it('keeps full copies under the cap after the keep rule', async () => {
    const schedule = await startBackups(file, { now: () => clock, capBytes: 1 });
    for (const minutes of [5, 10, 15, 20]) {
      await edit(`1${String(minutes)}`);
      await fiveMinutes(schedule, minutes);
    }
    // Every copy is over a 1-byte cap, so only the newest three stay.
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd', 'Bey 2026-11-02 09-15.sbd', 'Bey 2026-11-02 09-20.sbd']);
    schedule.stop();
  });

  it('reads the keep numbers at every run, so a change in Settings applies at once', async () => {
    let keep = { recent: 3, days: 0 };
    const schedule = await startBackups(file, { now: () => clock, keep: () => keep });
    for (const minutes of [5, 10, 15]) {
      await edit(`1${String(minutes)}`);
      await fiveMinutes(schedule, minutes);
    }
    expect(await names(file)).toHaveLength(3);
    keep = { recent: 1, days: 0 };
    await edit('1X');
    await fiveMinutes(schedule, 20);
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-20.sbd']);
    schedule.stop();
  });

  it('reports a failed backup and tries again next time', async () => {
    const errors: unknown[] = [];
    let failNext = true;
    const flaky: ProjectFile = {
      ...file,
      backup: (kind, name) => {
        if (!failNext) return file.backup(kind, name);
        failNext = false;
        return Promise.reject(new Error('The disk is full.'));
      },
    };
    const schedule = await startBackups(flaky, { now: () => clock, onError: (error) => errors.push(error) });
    await edit('1A');
    clock = new Date(2026, 10, 2, 9, 5);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });

    await fiveMinutes(schedule, 10);
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd']);
    schedule.stop();
  });

  it("doesn't report a backup that fails after the project closed", async () => {
    const errors: unknown[] = [];
    let release: () => void = () => undefined;
    const closing: ProjectFile = {
      ...file,
      // Held until the project has closed, as a copy cut off by closing is.
      backup: () =>
        new Promise((_, reject) => {
          release = () => {
            reject(new Error("That project isn't open."));
          };
        }),
    };
    const schedule = await startBackups(closing, { now: () => clock, onError: (error) => errors.push(error) });
    await edit('1A');
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    schedule.stop();
    release();
    await expect(schedule.runNow()).rejects.toThrow("isn't open");
    expect(errors).toEqual([]);
  });

  it('tells its listeners the time of each backup it writes, Compact’s too, and of no run that wrote none (6.5.4)', async () => {
    const schedule = await startBackups(file, { now: () => clock });
    expect(await newestBackupAt(file)).toBeNull();
    const heard: Date[] = [];
    const stop = schedule.onBackup((at) => heard.push(at));
    await fiveMinutes(schedule, 5);
    expect(heard).toEqual([]);

    await edit('1A');
    await fiveMinutes(schedule, 10);
    expect(heard).toEqual([new Date(2026, 10, 2, 9, 10)]);
    expect(await newestBackupAt(file)).toEqual(new Date(2026, 10, 2, 9, 10));

    await edit('1B');
    clock = new Date(2026, 10, 2, 9, 12);
    await schedule.backUpThen(() => Promise.resolve(null));
    expect(heard).toEqual([new Date(2026, 10, 2, 9, 10), new Date(2026, 10, 2, 9, 12)]);
    expect(await newestBackupAt(file)).toEqual(new Date(2026, 10, 2, 9, 12));

    stop();
    await edit('1C');
    await fiveMinutes(schedule, 20);
    expect(heard).toHaveLength(2);
    schedule.stop();
  });

  it('writes its backup even when a listener throws, and still tells the others (6.5.4)', async () => {
    const schedule = await startBackups(file, { now: () => clock });
    const heard: Date[] = [];
    schedule.onBackup(() => {
      throw new Error('a listener that fails');
    });
    schedule.onBackup((at) => heard.push(at));
    await edit('1A');
    clock = new Date(2026, 10, 2, 9, 10);
    await expect(schedule.runNow()).resolves.toEqual({ created: 'Bey 2026-11-02 09-10.sbd', deleted: [] });
    expect(await names(file)).toEqual(['Bey 2026-11-02 09-10.sbd']);
    expect(heard).toEqual([new Date(2026, 10, 2, 9, 10)]);
    schedule.stop();
  });
});

describe('a backup asked for by hand (Ctrl+S, Back up now; Kevin, Nov 18)', () => {
  let folder: TestFolder;
  let file: ProjectFile;
  let clock: Date;
  /** What the file was asked to do, in order: a copy's start and end, and each delete. */
  let calls: string[];
  let failNext: boolean;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    folder = makeTestFolder();
    file = await nodeDriver.create(folder.path('Bey.sbd'));
    await file.tx([{ sql: 'CREATE TABLE shots (id TEXT)' }]);
    clock = new Date(2026, 10, 2, 9, 0);
    calls = [];
    failNext = false;
  });

  afterEach(async () => {
    await file.close();
    folder.remove();
    vi.useRealTimers();
  });

  const edit = (id: string) => file.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: [id] }]);
  const names = async () => (await file.listBackups()).map((backup) => backup.name).sort();
  const at = (minutes: number, seconds = 0) => new Date(2026, 10, 2, 9, minutes, seconds);
  const name = (minutes: number) => backupFileName('Bey', at(minutes));
  /** The file, with every copy and delete recorded, and the next copy refused when `failNext` is set. */
  const watched = (): ProjectFile => ({
    ...file,
    backup: async (kind, backup) => {
      if (failNext) {
        failNext = false;
        throw new Error('The disk is full.');
      }
      calls.push(`copy ${backup}`);
      await file.backup(kind, backup);
      calls.push(`copied ${backup}`);
    },
    deleteBackup: async (backup) => {
      calls.push(`delete ${backup}`);
      await file.deleteBackup(backup);
    },
  });
  const start = (options: Parameters<typeof startBackups>[1] = {}) =>
    startBackups(watched(), { intervalMs: 3_600_000, now: () => clock, ...options });

  it('makes none when nothing changed, and says when the newest was made', async () => {
    const schedule = await start();
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'nothing', newestAt: null, deleted: [] });
    await edit('1A');
    clock = at(0, 20);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(0), deleted: [] });
    clock = at(3);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'nothing', newestAt: at(0, 20), deleted: [] });
    expect(await names()).toEqual([name(0)]);
    schedule.stop();
  });

  it('under a minute after the newest, queues one for the minute (one at most), which then replaces it', async () => {
    const schedule = await start();
    const heard: Date[] = [];
    schedule.onBackup((when) => heard.push(when));
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 30);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'queued', at: at(1), deleted: [] });
    const timers = vi.getTimerCount();
    // A second press answers with the same time and queues nothing more.
    await edit('1C');
    clock = at(0, 45);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'queued', at: at(1), deleted: [] });
    expect(vi.getTimerCount()).toBe(timers);
    expect(await names()).toEqual([name(0)]);

    clock = at(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(async () => {
      expect(await names()).toEqual([name(1)]);
    });
    expect(heard).toEqual([at(0), at(1)]);
    expect(vi.getTimerCount()).toBe(timers - 1);
    schedule.stop();
  });

  // Kevin, Nov 20 (#244 round 4): a press after a tick's own copy makes a new one; it replaces only a hand copy.
  it('never replaces a tick’s own copy; replacing a hand copy, the new copy is complete before the old is deleted', async () => {
    const schedule = await start();
    await edit('1A');
    clock = at(5);
    await schedule.runNow();
    await edit('1B');
    clock = at(7);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(7), deleted: [] });
    await edit('1C');
    clock = at(9);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'replaced', created: name(9), replaced: name(7), deleted: [] });
    expect(calls).toEqual([
      `copy ${name(5)}`,
      `copied ${name(5)}`,
      `copy ${name(7)}`,
      `copied ${name(7)}`,
      `copy ${name(9)}`,
      `copied ${name(9)}`,
      `delete ${name(7)}`,
    ]);
    expect(await names()).toEqual([name(5), name(9)]);
    schedule.stop();
  });

  it('replaces a hand backup under 5 minutes old, and the timed run after it still adds its own', async () => {
    const schedule = await start();
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(4, 59);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'replaced', created: name(4), replaced: name(0) });
    await edit('1C');
    clock = at(5, 30);
    await expect(schedule.runNow()).resolves.toEqual({ created: name(5), deleted: [] });
    expect(await names()).toEqual([name(4), name(5)]);
    schedule.stop();
  });

  it('never replaces the copy Compact made or adopted', async () => {
    const schedule = await start();
    await edit('1A');
    const made = await schedule.backUpThen(() => Promise.resolve(null));
    expect(made.backup).toBe(name(0));
    await edit('1B');
    clock = at(2);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(2), deleted: [] });
    expect(await names()).toEqual([name(0), name(2)]);

    // Nothing changed since the hand copy: Compact adopts it, and from then on it's Compact's.
    clock = at(3);
    const adopted = await schedule.backUpThen(() => Promise.resolve(null));
    expect(adopted.backup).toBe(name(2));
    await edit('1C');
    clock = at(4);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(4), deleted: [] });
    expect(await names()).toEqual([name(0), name(2), name(4)]);
    expect(calls.filter((call) => call.startsWith('delete'))).toEqual([]);
    schedule.stop();
  });

  it('never replaces a copy from before this session; the time in its name counts for the minute', async () => {
    await file.backup('scheduled', name(0));
    const schedule = await start();
    await edit('1A');
    clock = at(0, 40);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'queued', at: at(1), deleted: [] });
    clock = at(1);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(async () => {
      expect(await names()).toEqual([name(0), name(1)]);
    });
    expect(calls).toEqual([`copy ${name(1)}`, `copied ${name(1)}`]);
    schedule.stop();
  });

  it('makes a new copy once the newest is 5 minutes old', async () => {
    const schedule = await start();
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(5);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(5), deleted: [] });
    expect(await names()).toEqual([name(0), name(5)]);
    schedule.stop();
  });

  it('keeps the old copy when the new one fails, and replaces it on the next press', async () => {
    const schedule = await start();
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(2);
    failNext = true;
    await expect(schedule.backUpByHand()).rejects.toThrow('The disk is full.');
    expect(await names()).toEqual([name(0)]);
    clock = at(3);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'replaced', created: name(3), replaced: name(0) });
    expect(await names()).toEqual([name(3)]);
    schedule.stop();
  });

  it('prunes by the keep numbers and the cap as every run does, never the copy just made', async () => {
    const schedule = await start({ keep: { recent: 2, days: 0 } });
    for (const minutes of [0, 6, 12]) {
      await edit(`1${String(minutes)}`);
      clock = at(minutes);
      await schedule.backUpByHand();
    }
    expect(await names()).toEqual([name(6), name(12)]);
    schedule.stop();

    const capped = await start({ capBytes: 1 });
    for (const minutes of [18, 24, 30, 36]) {
      await edit(`2${String(minutes)}`);
      clock = at(minutes);
      await capped.backUpByHand();
    }
    // Every copy is over a 1-byte cap, so only the newest three stay.
    expect(await names()).toEqual([name(24), name(30), name(36)]);
    capped.stop();
  });

  it('drops the queued one when it stops', async () => {
    const schedule = await start();
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 10);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    schedule.stop();
    expect(vi.getTimerCount()).toBe(0);
    clock = at(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await names()).toEqual([name(0)]);
  });

  /**
   * The review's chain (#244, round 2): the 5-minute ticks, and an edit then a press at each of these times, as minutes
   * and seconds. Without presses, the same edits with the ticks alone. Returns the copies left and what each press did.
   * `times` replaces the review's; `editAfter` makes one more edit after each press, for the tick that follows.
   */
  async function chain(
    where: TestFolder,
    presses: boolean,
    times: readonly (readonly [number, number])[] = [[4, 10], [6, 10], [8, 10], [10, 30], [12, 30], [16, 10]],
    editAfter = false,
  ) {
    const of = await nodeDriver.create(where.path('Bey.sbd'));
    await of.tx([{ sql: 'CREATE TABLE shots (id TEXT)' }]);
    const schedule = await startBackups(of, { now: () => clock });
    const startAt = at(0).getTime();
    let elapsed = 0;
    // Step by step through every tick on the way, each with its own time on the clock.
    const until = async (ms: number) => {
      for (let tick = (Math.floor(elapsed / BACKUP_INTERVAL_MS) + 1) * BACKUP_INTERVAL_MS; tick <= ms; tick += BACKUP_INTERVAL_MS) {
        clock = new Date(startAt + tick);
        await vi.advanceTimersByTimeAsync(tick - elapsed);
        elapsed = tick;
      }
      clock = new Date(startAt + ms);
      await vi.advanceTimersByTimeAsync(ms - elapsed);
      elapsed = ms;
    };
    const results: HandBackup['kind'][] = [];
    for (const [minutes, seconds] of times) {
      const pressAt = (minutes * 60 + seconds) * 1000;
      await until(pressAt - 10_000);
      await of.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: [String(pressAt)] }]);
      await until(pressAt);
      if (presses) results.push((await schedule.backUpByHand()).kind);
      if (editAfter) {
        await until(pressAt + 5_000);
        await of.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: [`${String(pressAt)} after`] }]);
      }
    }
    // And the tick at 20 minutes.
    await until(20 * 60 * 1000);
    schedule.stop();
    const left = byNewest('Bey', (await of.listBackups()).map((backup) => backup.name)).reverse();
    await of.close();
    return { left, results };
  }

  it('keeps a copy for every 5 minutes when each interval’s presses come after its tick, never fewer than the ticks alone', async () => {
    const other = makeTestFolder();
    const pressed = await chain(other, true);
    other.remove();
    const alone = makeTestFolder();
    const timed = await chain(alone, false);
    alone.remove();
    expect(timed.left).toEqual([name(5), name(10), name(15), name(20)]);
    // A press in the same 5 minutes replaces; the tick after a press finds nothing new, and the press's copy is its.
    expect(pressed.results).toEqual(['created', 'created', 'replaced', 'created', 'replaced', 'created']);
    expect(pressed.left).toEqual([backupFileName('Bey', at(4)), name(8), name(12), name(16)]);
    expect(pressed.left.length).toBeGreaterThanOrEqual(timed.left.length);
  });

  // The reviewer's chain (#244 round 4): an edit and a press just before each tick, and an edit after the press for the
  // tick to back up. Under round 3's rule each press replaced the tick before's copy.
  it('keeps one copy per tick at least when the presses come just before each tick', async () => {
    const times = [[4, 50], [9, 50], [14, 50], [19, 50]] as const;
    const other = makeTestFolder();
    const pressed = await chain(other, true, times, true);
    other.remove();
    const alone = makeTestFolder();
    const timed = await chain(alone, false, times, true);
    alone.remove();
    const ticks = [name(5), name(10), name(15), name(20)];
    expect(timed.left).toEqual(ticks);
    expect(pressed.results).toEqual(['created', 'created', 'created', 'created']);
    // Every tick's own copy stays, beside the presses'.
    expect(pressed.left).toEqual(expect.arrayContaining(ticks));
    expect(pressed.left).toEqual([name(4), name(5), name(9), name(10), name(14), name(15), name(19), name(20)]);
  });

  // Kevin, Nov 20 (#244 round 4): "a press replaces only a hand copy made since the last tick. A tick's own copy is
  // never replaced by a press, so there's a copy for every 5 minutes whoever presses." Round 3 pinned the rule before.
  it('never lets a press replace a tick’s own copy: each tick’s copy stays', async () => {
    const schedule = await start({ intervalMs: BACKUP_INTERVAL_MS });
    const results: HandBackup[] = [];
    for (const interval of [0, 10]) {
      await edit(`tick ${String(interval)}`);
      clock = at(interval + 5);
      await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
      await edit(`press ${String(interval)}`);
      clock = at(interval + 9, 50);
      results.push(await schedule.backUpByHand());
      // The tick at 10 (and 20) finds nothing new: the press's copy is its.
      clock = at(interval + 10);
      await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    }
    expect(results).toEqual([
      { kind: 'created', created: name(9), deleted: [] },
      { kind: 'created', created: name(19), deleted: [] },
    ]);
    expect(await names()).toEqual([name(5), name(9), name(15), name(19)]);
    schedule.stop();
  });

  it('still replaces a press’s copy with the next press in the same 5 minutes, after a tick that wrote nothing', async () => {
    const schedule = await start({ intervalMs: BACKUP_INTERVAL_MS });
    await edit('1A');
    clock = at(4);
    await schedule.backUpByHand();
    // The tick at 5 minutes finds nothing new: the 4-minute copy is its own now.
    clock = at(5);
    await vi.advanceTimersByTimeAsync(BACKUP_INTERVAL_MS);
    await edit('1B');
    clock = at(6);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(6), deleted: [] });
    await edit('1C');
    clock = at(8);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'replaced', created: name(8), replaced: name(6), deleted: [] });
    expect(await names()).toEqual([name(4), name(8)]);
    schedule.stop();
  });

  it('counts a replaced copy deleted by hand meanwhile as gone: no error, and pruning still runs', async () => {
    // A copy from before this session, for pruning to take once the numbers allow only one.
    const older = backupFileName('Bey', new Date(2026, 10, 2, 8, 50));
    await file.backup('scheduled', older);
    let keep = { recent: 2, days: 0 };
    const schedule = await startBackups(
      {
        ...watched(),
        backup: async (kind, backup) => {
          await file.backup(kind, backup);
          // Someone short of space deletes the old copy while the new one is being written.
          if (backup === name(2)) await file.deleteBackup(name(0));
        },
      },
      { intervalMs: 3_600_000, now: () => clock, keep: () => keep },
    );
    await edit('1A');
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'created', created: name(0), deleted: [] });
    keep = { recent: 1, days: 0 };
    await edit('1B');
    clock = at(2);
    // The old copy is gone already: the press still answers as a replacement, and pruning takes the older copy.
    await expect(schedule.backUpByHand()).resolves.toEqual({
      kind: 'replaced',
      created: name(2),
      replaced: name(0),
      deleted: [older],
    });
    expect(await names()).toEqual([name(2)]);
    schedule.stop();
  });

  it('tells its listeners of a press’s copy only once the replaced one is gone', async () => {
    const schedule = await start();
    const heardAfter: string[][] = [];
    schedule.onBackup(() => heardAfter.push([...calls]));
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(2);
    await schedule.backUpByHand();
    expect(heardAfter).toHaveLength(2);
    expect(heardAfter[1]?.at(-1)).toBe(`delete ${name(0)}`);
    schedule.stop();
  });

  it('makes the queued one at once when the project closes, and none when nothing is queued', async () => {
    const schedule = await start();
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 20);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    await schedule.flushQueued();
    // Under 5 minutes after a hand copy, so it replaces it, as it would have at the minute.
    expect(await names()).toEqual([backupFileName('Bey', at(0), 2)]);
    schedule.stop();
    expect(vi.getTimerCount()).toBe(0);
    await schedule.flushQueued();
    expect(await names()).toEqual([backupFileName('Bey', at(0), 2)]);
  });

  it('at a close, waits for the queued copy already under way before resolving', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = false;
    const schedule = await startBackups(
      {
        ...watched(),
        backup: async (kind, backup) => {
          calls.push(`copy ${backup}`);
          if (hold) await held;
          await file.backup(kind, backup);
          calls.push(`copied ${backup}`);
        },
      },
      { intervalMs: 3_600_000, now: () => clock },
    );
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 30);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    // Its minute comes, and its copy starts and is held.
    hold = true;
    clock = at(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => {
      expect(calls).toContain(`copy ${name(1)}`);
    });
    expect(schedule.pending()).toBe(true);
    let flushed = false;
    const flushing = schedule.flushQueued().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(calls.at(-2)).toBe(`copied ${name(1)}`);
    expect(calls.at(-1)).toBe(`delete ${name(0)}`);
    expect(schedule.pending()).toBe(false);
    schedule.stop();
  });

  it('at a close, tells onError of no failure: neither the copy it makes nor one under way', async () => {
    const onError = vi.fn();
    const schedule = await start({ onError });
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 30);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    failNext = true;
    await schedule.flushQueued();
    expect(failNext).toBe(false);
    expect(await names()).toEqual([name(0)]);
    schedule.stop();

    // One whose minute came and whose copy is under way when the close begins, and then fails.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = false;
    const other = await startBackups(
      {
        ...watched(),
        backup: async (kind, backup) => {
          if (hold) {
            calls.push(`held ${backup}`);
            await held;
            throw new Error('The disk is full.');
          }
          await file.backup(kind, backup);
        },
      },
      { intervalMs: 3_600_000, now: () => clock, onError },
    );
    await edit('2A');
    clock = at(3);
    await other.backUpByHand();
    await edit('2B');
    clock = at(3, 30);
    await expect(other.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    hold = true;
    clock = at(4);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => {
      expect(calls).toContain(`held ${name(4)}`);
    });
    const flushing = other.flushQueued();
    release();
    await flushing;
    other.stop();
    expect(onError).not.toHaveBeenCalled();
  });

  it('counts a press’s copy under way as pending, and at a close waits for it and hands back its failure', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onError = vi.fn();
    const schedule = await startBackups(
      {
        ...watched(),
        backup: async (kind, backup) => {
          calls.push(`copy ${backup}`);
          await held;
          if (failNext) throw new Error('The disk is full.');
          await file.backup(kind, backup);
        },
      },
      { intervalMs: 3_600_000, now: () => clock, onError },
    );
    await edit('1A');
    failNext = true;
    // A press made at once (nothing queued), its copy held.
    const press = schedule.backUpByHand();
    await vi.waitFor(() => {
      expect(calls).toContain(`copy ${name(0)}`);
    });
    expect(schedule.pending()).toBe(true);
    let flushed = false;
    const flushing = schedule.flushQueued().then((failed) => {
      flushed = true;
      return failed;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    release();
    await expect(press).rejects.toThrow('The disk is full.');
    const failed = await flushing;
    expect(failed?.error).toBeInstanceOf(Error);
    expect((failed?.error as Error).message).toBe('The disk is full.');
    expect(schedule.pending()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    schedule.stop();
  });

  it('hands back null from a close whose copy is made, and stops the 5-minute timer as the close begins', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = false;
    const schedule = await startBackups(
      {
        ...watched(),
        backup: async (kind, backup) => {
          calls.push(`copy ${backup}`);
          if (hold) await held;
          await file.backup(kind, backup);
        },
      },
      { intervalMs: BACKUP_INTERVAL_MS, now: () => clock },
    );
    await edit('1A');
    await schedule.backUpByHand();
    await edit('1B');
    clock = at(0, 30);
    await expect(schedule.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    // The 5-minute timer and the queued one's.
    expect(vi.getTimerCount()).toBe(2);
    hold = true;
    const flushing = schedule.flushQueued();
    await vi.waitFor(() => {
      expect(calls).toContain(`copy ${backupFileName('Bey', at(0), 2)}`);
    });
    // The copy hangs, and no timer is left to queue another run behind it.
    expect(vi.getTimerCount()).toBe(0);
    release();
    await expect(flushing).resolves.toBeNull();
    schedule.stop();
  });
});

describe('closing a project with a hand backup queued', () => {
  let folder: TestFolder;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    folder = makeTestFolder();
  });

  afterEach(() => {
    folder.remove();
    vi.useRealTimers();
  });

  it('makes it before the project closes', async () => {
    let clock = new Date(2026, 10, 2, 9, 0);
    const project = await createProject(folder.path('Bey.sbd'), { driver: nodeDriver, now: () => clock });
    const schedule = project.backups;
    expect(schedule).not.toBeNull();
    await project.file.tx([{ sql: 'CREATE TABLE shots (id TEXT)' }]);
    await project.file.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: ['1A'] }]);
    await expect(schedule?.backUpByHand()).resolves.toMatchObject({ kind: 'created' });
    await project.file.tx([{ sql: 'INSERT INTO shots VALUES (?)', params: ['1B'] }]);
    clock = new Date(2026, 10, 2, 9, 0, 30);
    await expect(schedule?.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    const listed = async (of: ProjectFile) => (await of.listBackups()).map((backup) => backup.name);
    expect(await listed(project.file)).toEqual(['Bey 2026-11-02 09-00.sbd']);
    await project.close();
    // Made at the close, in place of the hand copy before it (under 5 minutes old), as it would have been at the minute.
    const reopened = await nodeDriver.open(folder.path('Bey.sbd'));
    expect(await listed(reopened)).toEqual(['Bey 2026-11-02 09-00 (2).sbd']);
    await reopened.close();
  });
});

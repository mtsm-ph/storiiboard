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
} from './backups';
import type { ProjectFile } from './driver';
import { nodeDriver } from './nodeDriver';
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

  it('replaces a timed backup under 5 minutes old, the new copy complete before the old is deleted', async () => {
    const schedule = await start();
    await edit('1A');
    clock = at(5);
    await schedule.runNow();
    await edit('1B');
    clock = at(7);
    await expect(schedule.backUpByHand()).resolves.toEqual({ kind: 'replaced', created: name(7), replaced: name(5), deleted: [] });
    expect(calls).toEqual([`copy ${name(5)}`, `copied ${name(5)}`, `copy ${name(7)}`, `copied ${name(7)}`, `delete ${name(5)}`]);
    expect(await names()).toEqual([name(7)]);
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
});

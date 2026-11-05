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
    for (const copy of ['(1)', '(0)', '(02)', '()', '(2a)', '(-2)']) expect(isBackupName('Bey', `Bey 2026-11-04 18-30 ${copy}.sbd`)).toBe(false);
    expect(parseBackupFileName('Bey', 'Bey 2026-11-04 18-30 (2).sbd')).toEqual(at);
  });

  it('lists and prunes a minute’s copies in the order they were made', () => {
    const at = new Date(2026, 10, 4, 18, 30);
    const minute = [backupFileName('Bey', at), backupFileName('Bey', at, 2), backupFileName('Bey', at, 10)];
    const earlier = backupFileName('Bey', new Date(2026, 10, 4, 18, 29));
    expect(byNewest('Bey', [minute[1] ?? '', earlier, minute[0] ?? '', minute[2] ?? ''])).toEqual([...minute].reverse().concat(earlier));
    // Keeping the newest one keeps the minute's last copy.
    expect(backupsToDelete([earlier, ...minute], 'Bey', at, { recent: 1, days: 1 }).sort()).toEqual([earlier, minute[0], minute[1]].sort());
    const cap = backupsOverCap([earlier, ...minute].map((name) => ({ name, bytes: 10 })), 'Bey', 25);
    expect(cap).toEqual([earlier]);
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
});

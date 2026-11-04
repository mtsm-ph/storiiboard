import { existsSync, readdirSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addShot, board, setNumbersLocked } from '../../features/storyboard/board';
import { log } from '../ops/ops';
import { backupFileName, startBackups } from './backups';
import { compactProject, fileSpace } from './compact';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { arriveFromSync, makeTestFolder, type TestFolder } from './testFolder';

// Compact project (1.27): a backup of the file as it is, then the file rewritten without its free space, and nothing
// else changed. The kill-mid-compact safety test is in src-tauri/src/sbd.rs (survives_a_kill_mid_compact).

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await project.file.placeBackups(true);
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
  for (let i = 0; i < 3; i += 1) await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const AT = new Date(2026, 10, 4, 18, 30);
const numbers = () => (board(store.getState().records, project.projectId)[0]?.shots ?? []).map((s) => s.fields.number);
const backups = () => (existsSync(folder.path('Backups')) ? readdirSync(folder.path('Backups')).sort() : []);

/** Notes with a lot of text, then deleted for good: free space inside the file. */
const freeUpSpace = async () => {
  const notes = Array.from({ length: 60 }, (_, i) => ({
    kind: 'create' as const,
    record: { id: `n${String(i)}`, type: 'note' as const, parentId: 'sc4', sortKey: `z${String(i).padStart(3, '0')}`, props: { text: 'Rain. '.repeat(4000) } },
  }));
  await store.getState().apply(notes);
  await store.getState().apply(notes.map((n) => ({ kind: 'trash' as const, id: n.record.id })));
  expect(await store.getState().emptyTrash()).not.toBeNull();
};

describe('Compact project', () => {
  it('backs up the file as it is, then shrinks it and changes nothing else', async () => {
    await freeUpSpace();
    const before = await fileSpace(project.file);
    expect(before.free).toBeGreaterThan(before.bytes / 2);
    const steps = (await log(project.file)).length;

    const done = await compactProject(project.file, { now: AT });
    expect(done.backup).toBe(backupFileName('Bey County', AT));
    expect(done.before).toBe(before.bytes);
    expect(done.after).toBeLessThan(before.bytes / 2);
    expect((await fileSpace(project.file)).free).toBe(0);

    // The backup is the project as it was, every step included. (Its size depends on the driver: the desktop app
    // copies page by page, free pages too; the test driver's copy is compacted.)
    const copy = await nodeDriver.open(folder.path('Backups', done.backup));
    try {
      expect((await copy.query('SELECT count(*) AS n FROM op_groups'))[0]?.n).toBe(steps);
      expect((await copy.query("SELECT count(*) AS n FROM records WHERE type = 'shot'"))[0]?.n).toBe(3);
    } finally {
      await copy.close();
    }

    // Nothing else changed: the board and History, and edits, undo and redo carry on.
    expect((await log(project.file)).length).toBe(steps);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    expect(numbers()).toEqual(['4A', '4B', '4C', '4D']);
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await store.getState().redo();
    expect(numbers()).toEqual(['4A', '4B', '4C', '4D']);
  });

  it('keeps everything after a restart, with the backup listed among the project’s backups', async () => {
    await freeUpSpace();
    const done = await compactProject(project.file, { now: AT });
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await project.file.listBackups()).map((b) => b.name)).toEqual([done.backup]);
    const check = await project.file.query('PRAGMA integrity_check');
    expect(check[0]?.integrity_check).toBe('ok');
  });

  it('never overwrites a backup made earlier the same minute: it takes the next free minute', async () => {
    await project.file.backup('scheduled', backupFileName('Bey County', AT));
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    const done = await compactProject(project.file, { now: AT });
    expect(done.backup).toBe(backupFileName('Bey County', new Date(AT.getTime() + 60_000)));
    expect(backups()).toEqual([backupFileName('Bey County', AT), done.backup]);
  });

  it('compacts nothing when the backup fails', async () => {
    await freeUpSpace();
    const before = await fileSpace(project.file);
    const file = project.file;
    let compacted = false;
    const failing = {
      ...file,
      backup: () => Promise.reject(new Error('The disk is full.')),
      compact: () => {
        compacted = true;
        return file.compact();
      },
    };
    await expect(compactProject(failing, { now: AT })).rejects.toThrow('The disk is full.');
    expect(compacted).toBe(false);
    expect(await fileSpace(file)).toEqual(before);
  });

  it('writes nothing, not even a backup, to a file a sync has replaced', async () => {
    const incoming = await createProject(folder.path('incoming.sbd'), { driver: nodeDriver, backups: false });
    await incoming.close();
    arriveFromSync(folder.path('incoming.sbd'), folder.path('Bey County.sbd'));
    await expect(compactProject(project.file, { now: AT })).rejects.toThrow('The project file changed on disk since Storiiboard last saved it.');
    expect(backups()).toEqual([]);
  });

  it('never lets a backup that’s gone stand for one, and never prunes the copy it just made', async () => {
    let at = AT;
    const schedule = await startBackups(project.file, { intervalMs: 3_600_000, now: () => at, keep: { recent: 1, days: 1 } });
    try {
      await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
      const first = (await schedule.runNow()).created ?? '';
      // Deleted by hand from the Backups folder: Compact makes a new one rather than name a file that isn't there.
      rmSync(folder.path('Backups', first));
      const done = await compactProject(project.file, { schedule });
      expect(backups()).toEqual([done.backup]);
      // The clock goes back an hour: the next copy sorts as the oldest, and is kept anyway.
      at = new Date(AT.getTime() - 3_600_000);
      await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
      const run = await schedule.runNow();
      expect(run.deleted).not.toContain(run.created);
      expect(backups()).toContain(run.created);
    } finally {
      schedule.stop();
    }
  });

  it('takes its turn with the scheduled backups, and lets the newest stand when nothing has changed', async () => {
    let minute = 0;
    const clock = () => new Date(AT.getTime() + minute * 60_000);
    const schedule = await startBackups(project.file, { intervalMs: 3_600_000, now: clock });
    try {
      await freeUpSpace();
      // A scheduled run and Compact at once: the copy finishes before the file is rewritten, and each is its own.
      const [run, done] = await Promise.all([schedule.runNow(), compactProject(project.file, { schedule })]);
      expect(run.created).toBe(backupFileName('Bey County', AT));
      // Nothing changed between them, so the scheduled copy stands for Compact's.
      expect(done.backup).toBe(run.created);
      expect(done.after).toBeLessThan(done.before);
      // After an edit, Compact makes a new one; in the same minute, under the next minute's name.
      await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
      const again = await compactProject(project.file, { schedule });
      expect(again.backup).toBe(backupFileName('Bey County', new Date(AT.getTime() + 60_000)));
      minute = 1;
      // And a scheduled run in that minute after another edit never stands on the older copy.
      await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
      expect((await schedule.runNow()).created).toBe(backupFileName('Bey County', new Date(AT.getTime() + 120_000)));
    } finally {
      schedule.stop();
    }
  });

  it('runs in the edit queue: an edit made meanwhile lands after it, numbered from the slate numbers', async () => {
    await store.getState().applyWith((now, slate) => ({ changes: setNumbersLocked(now, project.projectId, 'sc4', true, slate) }));
    const slate = store.getState().slateNumbers.map((row) => `${row.number} ${row.shotId}`).sort();
    expect(slate).toHaveLength(3);
    const [done] = await Promise.all([
      store.getState().compact(),
      // Queued behind it, so it lands on the compacted file.
      store.getState().applyWith((now, numbered) => addShot(now, project.projectId, 'sc4', null, {}, numbered)),
    ]);
    expect(done?.after).toBeGreaterThan(0);
    expect(numbers()).toEqual(['4A', '4B', '4C', '4D']);
    expect(store.getState().slateNumbers.map((row) => `${row.number} ${row.shotId}`).sort()).toEqual(
      [...slate, `4D ${board(store.getState().records, project.projectId)[0]?.shots[3]?.record.id ?? ''}`].sort(),
    );
  });
});

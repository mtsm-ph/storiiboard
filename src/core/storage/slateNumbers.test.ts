import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVersionCopy } from '../../app/openVersion';
import { createProjectStore } from '../../app/projectStore';
import { addScene, addShot, board, setNumbersLocked, setSceneNumber, trashShot } from '../../features/storyboard/board';
import { emptyTrashMessage, restoreChanges } from '../../features/trash/trash';
import { log } from '../ops/ops';
import { backupFileName } from './backups';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { loadSlateNumbers, slateNumbersUnknown } from './slateNumbers';
import { makeTestFolder, type TestFolder } from './testFolder';
import { listVersions, nameVersion } from './versions';

// 1.26 (Kevin, Nov 4): a locked scene remembers every number it has given out, in a table undo, History restores and
// Empty Trash never take a row from, so a letter that has been on a slate is never given out again.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await scene('sc4', '4', 'V');
  for (let i = 0; i < 3; i += 1) await frame('sc4');
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const scene = (id: string, number: string, sortKey: string) =>
  store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number } } }]);
const frame = (sceneId: string) =>
  store.getState().applyWith((now, slate) => addShot(now, project.projectId, sceneId, null, {}, slate));
const lock = (sceneId: string, locked = true) =>
  store.getState().applyWith((now, slate) => ({ changes: setNumbersLocked(now, project.projectId, sceneId, locked, slate) }));
const renumberScene = (sceneId: string, number: string) =>
  store.getState().applyWith((now) => ({ changes: setSceneNumber(now, project.projectId, sceneId, number) }));
const trashScene = (sceneId: string) =>
  store.getState().apply([{ kind: 'trash', id: sceneId }, ...shotsIn(sceneId).map((s) => ({ kind: 'trash' as const, id: s.record.id }))]);
const shotsIn = (sceneId: string) => board(records(), project.projectId).find((s) => s.record.id === sceneId)?.shots ?? [];
const numbers = (sceneId = 'sc4') => shotsIn(sceneId).map((s) => s.fields.number);
const trashLast = (sceneId = 'sc4') => {
  const id = shotsIn(sceneId).at(-1)?.record.id ?? '';
  return store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));
};
const stored = async (sceneId = 'sc4') =>
  (await loadSlateNumbers(project.file)).filter((row) => row.sceneId === sceneId).map((row) => row.number).sort();
const idOf = (sceneId: string, number: string) => shotsIn(sceneId).find((s) => s.fields.number === number)?.record.id ?? '';
const newest = async () => (await log(project.file)).at(-1)?.id ?? '';

describe('slate numbers', () => {
  it('records nothing while a scene is unlocked, so boarding closes up letters as it always has', async () => {
    await trashLast();
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(await stored()).toEqual([]);
  });

  it('takes in every frame’s number as the scene is locked, and each number it gives out after', async () => {
    await trashLast();
    await lock('sc4');
    // The frame in the Trash still holds 4C there.
    expect(await stored()).toEqual(['4A', '4B', '4C']);
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4D']);
    expect(await stored()).toEqual(['4A', '4B', '4C', '4D']);
    expect(store.getState().slateNumbers.some((row) => row.sceneId === 'sc4' && row.number === '4D' && row.shotId === idOf('sc4', '4D'))).toBe(true);
  });

  it('never gives out a letter again after Empty Trash deletes the frame that had it', async () => {
    await lock('sc4');
    await trashLast();
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await stored()).toEqual(['4A', '4B', '4C']);
    await frame('sc4');
    // Before 1.26 this was 4C again: a slate number already on footage.
    expect(numbers()).toEqual(['4A', '4B', '4D']);
  });

  it('keeps a number when undo takes away the frame that had it, and after redo and History restores', async () => {
    await lock('sc4');
    const locked = await newest();
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4C', '4D']);
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(await stored()).toEqual(['4A', '4B', '4C', '4D']);
    await store.getState().redo();
    await store.getState().undo();
    // Back to before the lock, and to the project as created: History never takes a number out.
    expect(await store.getState().restoreTo(locked)).toBe(false);
    expect(await store.getState().restoreTo(null)).toBe(true);
    expect(await stored()).toEqual(['4A', '4B', '4C', '4D']);
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4C', '4E']);
  });

  it('keeps the numbers of a locked scene Empty Trash deletes, so a new scene 4 never reuses them', async () => {
    await lock('sc4');
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }, ...shotsIn('sc4').map((s) => ({ kind: 'trash' as const, id: s.record.id }))]);
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(records().sc4).toBeUndefined();
    expect(await stored()).toEqual(['4A', '4B', '4C']);
    await scene('sc4b', '4', 'W');
    await lock('sc4b');
    await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4D']);
  });

  it('skips a number another scene gave out under this scene number before it was renumbered', async () => {
    await lock('sc4');
    await store.getState().applyWith((now) => ({ changes: setSceneNumber(now, project.projectId, 'sc4', '9') }));
    // Locked, its frames keep the numbers on their slates.
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await trashLast();
    await store.getState().emptyTrash();
    await store.getState().applyWith((now) => ({ changes: [addScene(now, project.projectId)] }));
    const added = board(records(), project.projectId).at(-1)?.record.id ?? '';
    await store.getState().applyWith((now) => ({ changes: setSceneNumber(now, project.projectId, added, '4') }));
    await lock(added);
    await frame(added);
    // 4A and 4B are on the board in scene 9, and 4C is only a slate number now; the new scene 4 starts at 4D.
    expect(numbers(added)).toEqual(['4D']);
  });

  it('renumbers, as it locks, a frame boarded unlocked onto a number a deleted scene already put on a slate', async () => {
    await lock('sc4');
    await trashScene('sc4');
    await store.getState().emptyTrash();
    // Scene 4 again, as a script revision brings it back; boarded unlocked, its letters follow the board.
    await scene('sc4b', '4', 'W');
    await frame('sc4b');
    await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B']);
    expect(await stored('sc4b')).toEqual([]);
    // Locked, they go onto slates: 4A and 4B are on footage from the old scene 4, so they take the next free letters.
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4D', '4E']);
    expect(await stored('sc4b')).toEqual(['4D', '4E']);
    await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4D', '4E', '4F']);
  });

  it('renumbers, as it locks, a frame holding the number of a live frame in a scene renumbered while locked', async () => {
    await lock('sc4');
    await renumberScene('sc4', '9');
    await scene('sc4b', '4', 'W');
    await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4A']);
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4D']);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('numbers a locked scene restored under a new number past every slate number', async () => {
    // A locked scene A4 shot A4A, then was deleted for good.
    await scene('sc0', 'A4', 'U');
    await frame('sc0');
    await lock('sc0');
    await trashScene('sc0');
    await store.getState().emptyTrash();
    // Scene 4, locked, goes to the Trash, and a new scene 4 takes its number.
    await lock('sc4');
    await trashScene('sc4');
    await scene('sc4b', '4', 'W');
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, 'sc4', slate) }));
    expect(records().sc4?.props.number).toBe('A4');
    expect(records().sc4?.props.numbers_locked).toBe(true);
    expect(numbers()).toEqual(['A4B', 'A4C', 'A4D']);
  });

  it('gives each frame back its own slated number when a scene is unlocked, edited and locked again', async () => {
    await lock('sc4');
    const [a, b, c] = shotsIn('sc4').map((s) => s.record.id);
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, b ?? '') }));
    await store.getState().emptyTrash(); // 4B was on a slate; its frame is gone for good
    await lock('sc4', false);
    expect(numbers()).toEqual(['4A', '4B']); // unlocked, letters close up: the old 4C frame reads 4B
    await lock('sc4');
    expect(numbers()).toEqual(['4A', '4C']);
    expect(records()[c ?? '']?.props.number).toBe('4C');
    expect(records()[a ?? '']?.props.number).toBe('4A');
  });

  it('letters a scene afresh in board order when locking must move one of its frames', async () => {
    await lock('sc4');
    const [first, second] = shotsIn('sc4').map((s) => s.record.id);
    await store.getState().apply([
      { kind: 'trash', id: first ?? '' },
      { kind: 'trash', id: second ?? '' },
    ]);
    await store.getState().emptyTrash(); // 4A and 4B were on slates
    await trashScene('sc4');
    await store.getState().emptyTrash();
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B', '4C']);
    await lock('sc4b');
    // 4C was on a slate too (the old scene's third frame), and keeping a free one would put the board out of order.
    expect(numbers('sc4b')).toEqual(['4D', '4E', '4F']);
  });

  it('keeps the board in order when locking moves only some frames', async () => {
    await lock('sc4');
    const [first] = shotsIn('sc4').map((s) => s.record.id);
    await store.getState().apply([{ kind: 'trash', id: first ?? '' }]);
    await store.getState().emptyTrash(); // only 4A was on a slate and is gone
    await lock('sc4', false);
    await renumberScene('sc4', '7'); // unlocked: its frames follow, 7A, 7B
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    await lock('sc4b');
    // 4A is sc4's slate number (and 4B, 4C too); none can stay, so all three are lettered afresh in order.
    expect(numbers('sc4b')).toEqual(['4D', '4E', '4F']);
  });

  it('never restores a frame onto a number another frame in the scene was slated with since', async () => {
    const t1 = shotsIn('sc4')[2]?.record.id ?? '';
    await trashLast(); // T1 (4C) in the Trash
    await frame('sc4'); // unlocked: the new frame reads 4C too
    await lock('sc4');
    expect(records()[t1]?.props.number).toBe('');
    const f2 = idOf('sc4', '4C');
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, f2) }));
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, t1, slate) }));
    expect(numbers()).toEqual(['4A', '4B', '4D']);
  });

  it('never restores a frame onto a number another scene was slated with', async () => {
    await lock('sc4');
    await renumberScene('sc4', '9');
    await trashLast(); // sc4's 4C, in the Trash and on a slate
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    await trashLast('sc4b'); // its own 4C, trashed before the lock
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4D', '4E']);
    const trashed = Object.values(records()).find((r) => r.parentId === 'sc4b' && r.trashedAt !== null)?.id ?? '';
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, trashed, slate) }));
    expect(numbers('sc4b')).toEqual(['4D', '4E', '4F']);
  });

  it('never restores a frame onto a slated number, even one a file already holds twice', async () => {
    await lock('sc4');
    const b = idOf('sc4', '4B');
    const c = idOf('sc4', '4C');
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, b) }));
    await store.getState().emptyTrash(); // 4B's frame is gone for good; the number stays on its slate
    await trashLast();
    // As an older file can hold it: the trashed frame carries 4B, which went onto a slate with another frame.
    await store.getState().apply([{ kind: 'update', id: c, set: { number: '4B' } }]);
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, c, slate) }));
    expect(numbers()).toEqual(['4A', '4D']);
  });

  it('undoes a lock that renumbered frames, numbers and all', async () => {
    await lock('sc4');
    await trashScene('sc4');
    await store.getState().emptyTrash();
    await scene('sc4b', '4', 'W');
    await frame('sc4b');
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4D']);
    await store.getState().undo();
    expect(numbers('sc4b')).toEqual(['4A']);
    expect(records().sc4b?.props.numbers_locked).toBeUndefined();
  });

  it('goes into named version copies and backups, which are copies of the whole file', async () => {
    await lock('sc4');
    await frame('sc4');
    await nameVersion(project.file, { name: 'Board sent', opGroupId: await newest() });
    const [version] = await listVersions(project.file);
    if (!version) throw new Error('no version');

    await project.file.placeBackups(true);
    const backupName = backupFileName('Bey County', new Date(2026, 10, 4, 15, 0));
    await project.file.backup('scheduled', backupName);
    const backupPath = folder.path('Backups', backupName);
    expect(existsSync(backupPath)).toBe(true);
    const backup = await nodeDriver.open(backupPath);
    expect((await backup.query('SELECT number FROM slate_numbers ORDER BY number')).map((r) => r.number)).toEqual(['4A', '4B', '4C', '4D']);
    await backup.close();

    const copy = await openVersionCopy(version, { store, driver: nodeDriver });
    expect(copy.opened).toBe(true);
    const file = store.getState().project?.file;
    if (!file) throw new Error('no copy open');
    expect((await loadSlateNumbers(file)).map((row) => row.number).sort()).toEqual(['4A', '4B', '4C', '4D']);
  });
});

describe('the schema 5 migration', () => {
  /** Turns the open project back into the v4 file an older build would have left, then reopens it here. */
  const asV4ThenReopen = async () => {
    await project.file.tx([
      { sql: 'DROP TABLE slate_numbers' },
      { sql: "UPDATE meta SET value = '4' WHERE key = 'schema_version'" },
    ]);
    const path = project.file.path;
    await store.getState().close();
    project = await openProject(path, { driver: nodeDriver, backups: false, now: () => new Date(2026, 10, 4, 16, 0) });
    await store.getState().open(project);
    return project.migration;
  };

  it('backs up, then finds every number a locked scene gave out: live, in the Trash, or only in History', async () => {
    await lock('sc4');
    await frame('sc4');
    await store.getState().undo(); // 4D only in History now
    await trashLast(); // 4C in the Trash
    await scene('sc6', '6', 'X');
    await frame('sc6'); // unlocked: nothing to keep
    const migration = await asV4ThenReopen();
    expect(migration).toEqual({ from: 4, to: 5, backup: 'Bey County.sbd.bak-v4-2026-11-04 16-00' });
    expect(existsSync(folder.path('Bey County.sbd.bak-v4-2026-11-04 16-00'))).toBe(true);
    expect(await stored()).toEqual(['4A', '4B', '4C', '4D']);
    expect(await stored('sc6')).toEqual([]);
    expect(store.getState().slateUnknown).toBe(false);
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4E']);
  });

  it('finds a number a frame had when its scene was locked, though the frame is now only in History', async () => {
    await lock('sc4');
    const firstLock = await newest();
    await lock('sc4', false);
    await frame('sc4'); // 4D, boarded unlocked
    await lock('sc4'); // now on a slate
    expect(await store.getState().restoreTo(firstLock)).toBe(true);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await asV4ThenReopen();
    expect(await stored()).toEqual(['4A', '4B', '4C', '4D']);
  });

  it('counts a scene as unknown when it was unlocked as Empty Trash ran but had been locked before', async () => {
    await lock('sc4');
    await trashLast(); // 4C, trashed while locked, keeps its number
    await lock('sc4', false);
    await store.getState().emptyTrash();
    await lock('sc4');
    await asV4ThenReopen();
    expect(await stored()).toEqual(['4A', '4B']);
    expect(store.getState().slateUnknown).toBe(true);
  });

  it('marks numbers unknown when an Empty Trash ran after a scene was locked, and the confirm says so', async () => {
    await scene('sc5', '5', 'W');
    await frame('sc5');
    await frame('sc5');
    await lock('sc5');
    await trashLast('sc5');
    await store.getState().emptyTrash(); // 5B gone, with every step that showed it
    await lock('sc4'); // locked after that Empty Trash: nothing of it was lost
    const migration = await asV4ThenReopen();
    expect(migration.from).toBe(4);
    expect(await stored('sc5')).toEqual(['5A']);
    expect(await slateNumbersUnknown(project.file)).toBe(true);
    expect(store.getState().slateUnknown).toBe(true);
    await trashLast('sc4');
    expect(emptyTrashMessage(records(), 1, 0, store.getState().slateUnknown)).toContain(
      'Frames an Empty Trash deleted before this version of Storiiboard may have had letters it no longer knows',
    );
  });

  it('marks nothing unknown when every earlier Empty Trash ran before any scene was locked', async () => {
    await trashLast();
    await store.getState().emptyTrash();
    await lock('sc4');
    await asV4ThenReopen();
    expect(await slateNumbersUnknown(project.file)).toBe(false);
    expect(await stored()).toEqual(['4A', '4B']);
  });

  it('keeps the shot each number went to first', async () => {
    await lock('sc4');
    const owners = (await loadSlateNumbers(project.file)).map((row) => `${row.number} ${row.shotId}`).sort();
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).map((row) => `${row.number} ${row.shotId}`).sort()).toEqual(owners);
  });
});

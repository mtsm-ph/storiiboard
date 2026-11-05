import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVersionCopy } from '../../app/openVersion';
import { createProjectStore } from '../../app/projectStore';
import { addScene, addShot, board, lockNotice, moveItem, relettered, setNumbersLocked, setSceneNumber, trashShot } from '../../features/storyboard/board';
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
    const trashed = shotsIn('sc4')[2]?.record.id ?? '';
    await trashLast();
    await lock('sc4');
    // The frame trashed while unlocked never had 4C on a slate: it gives it up, so boarding leaves no gap.
    expect(await stored()).toEqual(['4A', '4B']);
    expect(records()[trashed]?.props.number).toBe('');
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(await stored()).toEqual(['4A', '4B', '4C']);
    expect(store.getState().slateNumbers.some((row) => row.sceneId === 'sc4' && row.number === '4C' && row.shotId === idOf('sc4', '4C'))).toBe(true);
    // Restored to its place on the board, it takes the next free letter.
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, trashed, slate) }));
    expect(numbers()).toEqual(['4A', '4B', '4D', '4C']);
  });

  it('keeps, as it locks, the number of a frame trashed while the scene was locked before', async () => {
    await lock('sc4');
    const c = idOf('sc4', '4C');
    await trashLast(); // trashed while locked: 4C stays its own
    await lock('sc4', false);
    await lock('sc4');
    expect(records()[c]?.props.number).toBe('4C');
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4D']);
  });

  it('records no number from a frame trashed in another scene before it was renumbered and locked', async () => {
    await trashLast(); // 4C in the Trash, unlocked
    await renumberScene('sc4', '7'); // live frames follow: 7A, 7B
    await lock('sc4');
    expect(await stored()).toEqual(['7A', '7B']);
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B', '4C']);
  });

  it('ignores never-slated frames in other scenes’ Trash, so a first lock changes nothing and a relock gives numbers back', async () => {
    await trashLast(); // a stale 4C in the Trash of what becomes scene 8
    await renumberScene('sc4', '8');
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    const steps = (await log(project.file)).length;
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B', '4C']);
    // The lock is one step that changes only the lock.
    const groups = await log(project.file);
    expect(groups.length).toBe(steps + 1);
    expect(groups.at(-1)?.opCount).toBe(1);
    await lock('sc4b', false);
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B', '4C']);
  });

  it('letters every unslated frame afresh, in board order, when locking must move only one of them', async () => {
    await scene('sc5', '5', 'X');
    await frame('sc5');
    await lock('sc5'); // 5A on a slate
    await renumberScene('sc5', '6'); // locked: its frame keeps 5A
    await scene('sc5b', '5', 'Y');
    for (let i = 0; i < 3; i += 1) await frame('sc5b');
    expect(numbers('sc5b')).toEqual(['5A', '5B', '5C']);
    await lock('sc5b');
    // 5A must move; keeping 5B and 5C would read 5D, 5B, 5C.
    expect(numbers('sc5b')).toEqual(['5B', '5C', '5D']);
  });

  it('gives a frame moved back into a locked scene the number it was slated with there', async () => {
    await lock('sc4');
    const c = idOf('sc4', '4C');
    await scene('sc5', '5', 'X');
    await lock('sc4', false);
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, project.projectId, c, 'sc5', null, slate) }));
    expect(numbers('sc5')).toEqual(['5A']);
    await lock('sc4');
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, project.projectId, c, 'sc4', null, slate) }));
    expect(numbers()).toEqual(['4A', '4B', '4C']);
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
    // Locked, they go onto slates: 4A and 4B are on footage from the old scene 4, so they take the next free letters,
    // and the person is told each change.
    const changes = setNumbersLocked(records(), project.projectId, 'sc4b', true, store.getState().slateNumbers);
    expect(relettered(records(), project.projectId, changes)).toEqual([
      { from: '4A', to: '4D' },
      { from: '4B', to: '4E' },
    ]);
    expect(lockNotice('4', relettered(records(), project.projectId, changes))).toBe(
      'Locked SC 04. To keep slate numbers unique, 4A is now 4D and 4B is now 4E.',
    );
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4D', '4E']);
    expect(await stored('sc4b')).toEqual(['4D', '4E']);
    await frame('sc4b');
    expect(numbers('sc4b')).toEqual(['4D', '4E', '4F']);
  });

  it('says nothing when a lock changes no number, and lists one, two or more changes in plain words', () => {
    const changes = setNumbersLocked(records(), project.projectId, 'sc4', true, store.getState().slateNumbers);
    expect(relettered(records(), project.projectId, changes)).toEqual([]);
    expect(lockNotice('4', [])).toBeNull();
    expect(lockNotice('12', [{ from: '12C', to: '12E' }])).toBe('Locked SC 12. To keep slate numbers unique, 12C is now 12E.');
    expect(lockNotice('4A', [
      { from: '4AA', to: '4AD' },
      { from: '4AB', to: '4AE' },
      { from: '4AC', to: '4AF' },
    ])).toBe('Locked SC 4A. To keep slate numbers unique, 4AA is now 4AD, 4AB is now 4AE and 4AC is now 4AF.');
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

  it('never lets a History restore that keeps a locked scene as it is now bring a frame back on a slated number', async () => {
    await scene('scX', '8', 'X');
    await frame('scX');
    const r = shotsIn('scX')[0]?.record.id ?? '';
    await frame('sc4'); // Z, unlocked: 4D
    const z = idOf('sc4', '4D');
    const point = await newest();
    await store.getState().undo();
    await lock('sc4');
    await frame('sc4'); // W, slated as 4D
    const w = idOf('sc4', '4D');
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, w) }));
    await renumberScene('sc4', '6');
    await scene('scU', '4', 'Y');
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, project.projectId, r, 'scU', null, slate) }));
    await store.getState().apply([{ kind: 'trash', id: 'scX' }]);
    await store.getState().emptyTrash(); // scene 8 and W go for good; W's 4D stays a slate number
    await store.getState().restoreTo(point);
    // R's scene is gone, so R stays in scene U, which keeps the number 4; scene 4 can't go back to 4, so it stays as it
    // is now, locked and numbered 6, and Z doesn't come back into it holding W's 4D.
    expect(records()[z]).toBeUndefined();
    expect(records().sc4?.props).toMatchObject({ number: '6', numbers_locked: true });
    expect(await stored()).toContain('4D');
  });

  it('never lets a History restore lock a scene again around frames numbered while it was unlocked', async () => {
    await scene('sc9', '9', 'U');
    await frame('sc9');
    await frame('sc9');
    await lock('sc9'); // 9A, 9B on slates
    await trashScene('sc9');
    await store.getState().emptyTrash();
    await lock('sc4');
    await renumberScene('sc4', '9'); // locked: 4A, 4B, 4C stay
    await scene('scN', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('scN'); // unlocked: 4A, 4B, 4C as well
    await scene('scX', '8', 'X');
    await frame('scX');
    const r = shotsIn('scX')[0]?.record.id ?? '';
    const point = await newest();
    await lock('sc4', false); // 9A, 9B, 9C
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, project.projectId, r, 'scN', null, slate) }));
    await store.getState().apply([{ kind: 'trash', id: 'scX' }]);
    await store.getState().emptyTrash();
    await store.getState().restoreTo(point);
    // Its frames clash with scene 4's on 4A to 4C, so they stay as they are now, and so does their scene: unlocked,
    // reading 9A to 9C. It never comes back locked around them.
    expect(records().sc4?.props.numbers_locked).not.toBe(true);
    expect(numbers()).toEqual(['9A', '9B', '9C']);
    expect((await loadSlateNumbers(project.file)).filter((row) => row.number === '9A').map((row) => row.sceneId)).toEqual(['sc9']);
  });

  it('leaves History restores without an Empty Trash landing exactly on their point', async () => {
    /** Every record as it is, apart from when it was last written. */
    const state = () =>
      JSON.stringify(
        Object.values(records())
          .map((r) => ({ ...r, updatedAt: '' }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    await scene('sc5', '5', 'X');
    await frame('sc5');
    await lock('sc4');
    const point = await newest();
    const at = state();
    await lock('sc4', false);
    await renumberScene('sc4', '7');
    const moving = shotsIn('sc4')[0]?.record.id ?? '';
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, project.projectId, moving, 'sc5', null, slate) }));
    await lock('sc4');
    await frame('sc4');
    await trashLast('sc5');
    expect(await store.getState().restoreTo(point)).toBe(true);
    const back = state();
    expect(back).toBe(at);
  });

  it('goes into named version copies and backups, which are copies of the whole file', async () => {
    await lock('sc4');
    // Named before 4D was made: its copy still knows 4D was given out.
    await nameVersion(project.file, { name: 'Board sent', opGroupId: await newest() });
    await frame('sc4');
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
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4C', '4E']);
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

  it('marks numbers unknown when a scene was unlocked as Empty Trash ran but had been locked before', async () => {
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

  it('marks numbers unknown after any earlier Empty Trash, since a locked scene deleted whole leaves no trace', async () => {
    await lock('sc4');
    await trashScene('sc4');
    await store.getState().emptyTrash();
    await scene('sc4b', '4', 'W');
    await asV4ThenReopen();
    expect(await slateNumbersUnknown(project.file)).toBe(true);
    expect(store.getState().slateUnknown).toBe(true);
  });

  /** Locks as a v4 build did: the lock alone, with nothing in the Trash blanked. */
  const lockAsV4 = (sceneId: string) => store.getState().apply([{ kind: 'update', id: sceneId, set: { numbers_locked: true } }]);

  it('gives a v4 number to the live frame slated with it, not a frame in the Trash still holding it', async () => {
    const c = idOf('sc4', '4C');
    await trashLast(); // C in the Trash, still reading 4C
    await frame('sc4'); // D, unlocked: 4C too
    const d = idOf('sc4', '4C');
    await lockAsV4('sc4'); // D goes onto the slate as 4C
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).find((row) => row.number === '4C')?.shotId).toBe(d);
    // Relocking keeps D on 4C, and C comes back on a new letter.
    await lock('sc4', false);
    await lock('sc4');
    expect(records()[d]?.props.number).toBe('4C');
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, c, slate) }));
    expect(records()[c]?.props.number).toBe('4D');
  });

  it('reserves no number a v4 lock left on a frame in the Trash from before a renumber', async () => {
    await trashLast(); // T keeps 4C in the Trash
    await renumberScene('sc4', '9'); // unlocked: live frames follow, 9A, 9B
    await lockAsV4('sc4');
    await asV4ThenReopen();
    expect(await stored()).toEqual(['9A', '9B']);
    await scene('sc4b', '4', 'W');
    for (let i = 0; i < 3; i += 1) await frame('sc4b');
    await lock('sc4b');
    expect(numbers('sc4b')).toEqual(['4A', '4B', '4C']);
  });

  it('gives a number a v4 locked scene gave twice to the shot that holds it now', async () => {
    await lockAsV4('sc4');
    const after = shotsIn('sc4').at(-1)?.record.sortKey ?? '';
    const make = (id: string, sortKey: string) =>
      store.getState().apply([{ kind: 'create', record: { id, type: 'shot', parentId: 'sc4', sortKey, props: { number: '4D' } } }]);
    // v4 counted only the records: the undone frame's 4D went to the next one too, and that one was shot.
    await make('e', `${after}m`);
    await store.getState().undo();
    await make('f', `${after}n`);
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).find((row) => row.number === '4D')?.shotId).toBe('f');
    await store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, 'f') }));
    await store.getState().applyWith((now, slate) => ({ changes: restoreChanges(now, project.projectId, 'f', slate) }));
    expect(records().f?.props.number).toBe('4D');
  });

  it('never gives a v4 number to a frame that took it only while the scene was unlocked', async () => {
    const c = idOf('sc4', '4C');
    await lockAsV4('sc4'); // c on the slate as 4C
    await lock('sc4', false);
    await trashLast(); // c in the Trash, still 4C
    await frame('sc4'); // d, unlocked: 4C as well
    const d = idOf('sc4', '4C');
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).find((row) => row.number === '4C')?.shotId).toBe(c);
    await lock('sc4');
    expect(records()[d]?.props.number).toBe('4D');
  });

  it('gives a v4 number given twice to the shot slated with it, in the Trash, over one numbered after an unlock', async () => {
    await lockAsV4('sc4');
    const after = shotsIn('sc4').at(-1)?.record.sortKey ?? '';
    const make = (id: string, sortKey: string) =>
      store.getState().apply([{ kind: 'create', record: { id, type: 'shot', parentId: 'sc4', sortKey, props: { number: '4D' } } }]);
    await make('e', `${after}m`);
    await store.getState().undo();
    await make('f', `${after}n`); // shot as 4D
    await store.getState().apply([{ kind: 'trash', id: 'f' }]);
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { numbers_locked: false } }]);
    await make('g', `${after}p`); // unlocked: 4D again
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).find((row) => row.number === '4D')?.shotId).toBe('f');
  });

  it('keeps the shot each number was slated with', async () => {
    await lock('sc4');
    const owners = (await loadSlateNumbers(project.file)).map((row) => `${row.number} ${row.shotId}`).sort();
    await asV4ThenReopen();
    expect((await loadSlateNumbers(project.file)).map((row) => `${row.number} ${row.shotId}`).sort()).toEqual(owners);
  });
});

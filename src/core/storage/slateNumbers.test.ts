import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVersionCopy } from '../../app/openVersion';
import { createProjectStore } from '../../app/projectStore';
import { addScene, addShot, board, setNumbersLocked, setSceneNumber, trashShot } from '../../features/storyboard/board';
import { emptyTrashMessage } from '../../features/trash/trash';
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
  store.getState().applyWith((now) => ({ changes: setNumbersLocked(now, project.projectId, sceneId, locked) }));
const shotsIn = (sceneId: string) => board(records(), project.projectId).find((s) => s.record.id === sceneId)?.shots ?? [];
const numbers = (sceneId = 'sc4') => shotsIn(sceneId).map((s) => s.fields.number);
const trashLast = (sceneId = 'sc4') => {
  const id = shotsIn(sceneId).at(-1)?.record.id ?? '';
  return store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));
};
const stored = async (sceneId = 'sc4') => [...((await loadSlateNumbers(project.file)).get(sceneId) ?? [])].sort();
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
    expect(store.getState().slateNumbers.get('sc4')?.has('4D')).toBe(true);
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
    expect([...((await loadSlateNumbers(file)).get('sc4') ?? [])].sort()).toEqual(['4A', '4B', '4C', '4D']);
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
    expect(store.getState().slateUnknown.size).toBe(0);
    await frame('sc4');
    expect(numbers()).toEqual(['4A', '4B', '4E']);
  });

  it('lists the scenes that were locked when an earlier Empty Trash ran, and the confirm warns about those only', async () => {
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
    expect([...(await slateNumbersUnknown(project.file))]).toEqual(['sc5']);
    expect([...store.getState().slateUnknown]).toEqual(['sc5']);
    await trashLast('sc4');
    const message = emptyTrashMessage(records(), 1, 0, store.getState().slateUnknown);
    expect(message).toContain('SC 05 is locked, and frames an earlier Empty Trash deleted there may have had letters');
    expect(message).not.toContain('SC 04');
  });
});

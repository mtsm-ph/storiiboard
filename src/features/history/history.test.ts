import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { shotFields } from '../../core/model/storyboard';
import { log, opsOfGroups, opsOfRecord, storedPictures, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, board, moveItem } from '../storyboard/board';
import { describeGroup } from './summary';

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const numbers = () => (board(records(), project.projectId)[0]?.shots ?? []).map((s) => s.fields.number);
const frame = async () => {
  const added = addShot(records(), project.projectId, 'sc4');
  await store.getState().apply(added.changes);
  return added.shotId;
};
const reopen = async () => {
  await store.getState().close();
  project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
};
/** Every step's line, oldest first, as the History tile works them out. */
async function lines(): Promise<string[]> {
  const groups = await log(project.file);
  const ops = await opsOfGroups(project.file, groups.map((g) => g.id));
  const stored = await storedPictures(project.file);
  const titles = new Map<string, string>();
  for (const group of groups) titles.set(group.id, describeGroup(group, ops.filter((op) => op.groupId === group.id), titles, stored));
  return groups.map((g) => titles.get(g.id) ?? '');
}
const lastGroup = async (): Promise<OpGroup> => {
  const group = (await log(project.file)).at(-1);
  if (!group) throw new Error('no history');
  return group;
};

describe('History', () => {
  it('says what each step did, in the board’s words, a drag that renumbers as one step', async () => {
    const [a, , c] = [await frame(), await frame(), await frame()];
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, c, 'sc4', a) }));
    await store.getState().undo();
    await store.getState().redo();
    expect(await lines()).toEqual([
      'Added scene SC 04',
      'Added frame 4A',
      'Added frame 4B',
      'Added frame 4C',
      '4A: lens — → 50mm',
      'Moved 4C',
      'Undid: Moved 4C',
      'Redid: Moved 4C',
    ]);
  });

  it('restores the project to a step as one new step that undo takes back', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await frame();
    expect(await store.getState().restoreTo(point.id)).toBe(true);
    expect(numbers()).toEqual(['4A']);
    expect((await lines()).at(-1)).toBe('Restored the project to: Added frame 4A');
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('restores after the project is closed and opened again, and the restore lasts another restart', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await reopen();
    await store.getState().restoreTo(point.id);
    await reopen();
    expect(numbers()).toEqual(['4A']);
    // And it can still be undone after the restart.
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B']);
  });

  it('changes nothing when a restore’s write dies halfway', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await frame();
    const write = project.file.tx.bind(project.file);
    project.file.tx = (statements) => {
      project.file.tx = write;
      const half = Math.ceil(statements.length / 2);
      return write([...statements.slice(0, half), { sql: 'INSERT INTO no_such_table VALUES (1)' }, ...statements.slice(half)]);
    };
    expect(await store.getState().restoreTo(point.id)).toBe(false);
    expect(store.getState().error).not.toBeNull();
    await reopen();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await lines()).at(-1)).toBe('Added frame 4C');
  });

  it('keeps one frame’s own changes, field by field, and an old value goes back as one step', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    const own = await opsOfRecord(project.file, a);
    expect(own.map((op) => [op.kind, op.after ? shotFields(op.after.props).lensMm : null])).toEqual([
      ['create', null],
      ['update', 35],
      ['update', 50],
    ]);
    // Put back: the 35mm the last change replaced.
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    expect(shotFields(records()[a]?.props ?? {}).lensMm).toBe(35);
    expect((await lines()).at(-1)).toBe('4A: lens 50mm → 35mm');
  });
});

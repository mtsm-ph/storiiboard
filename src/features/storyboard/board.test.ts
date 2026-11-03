import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, board, coverage, moveShot, setLettersAllowIO, setNumbersLocked, setSceneNumber, trashShot } from './board';

let folder: TestFolder;
const store = createProjectStore();
let projectId = '';
beforeEach(async () => {
  folder = makeTestFolder();
  const project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
  projectId = project.projectId;
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: projectId, sortKey: 'V', props: { number: '4', name: 'Penn Station' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const numbers = () => board(records(), projectId)[0]?.shots.map((s) => s.fields.number) ?? [];

/** Adds a frame after `after` (or at the end) as one edit, and returns its id. */
async function add(after: string | null = null): Promise<string> {
  const { changes, shotId } = addShot(records(), projectId, 'sc4', after);
  await store.getState().apply(changes);
  return shotId;
}

describe('numbering on the board', () => {
  it('numbers new frames 4A, 4B, 4C, and renumbers an insert in the same edit', async () => {
    const a = await add();
    await add();
    await add();
    expect(numbers()).toEqual(['4A', '4B', '4C']);

    await add(a);
    expect(numbers()).toEqual(['4A', '4B', '4C', '4D']);
    // One undo takes back the insert and the renumbering with it.
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('closes up when a frame goes to the Trash, unless the numbers are locked', async () => {
    await add();
    const b = await add();
    await add();
    await store.getState().apply(trashShot(records(), projectId, b));
    expect(numbers()).toEqual(['4A', '4B']);
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);

    await store.getState().apply(setNumbersLocked(records(), projectId, 'sc4', true));
    await store.getState().apply(trashShot(records(), projectId, b));
    expect(numbers()).toEqual(['4A', '4C']);
    // A frame added later takes the next free letter; 4B stays with the trashed frame.
    const first = board(records(), projectId)[0]?.shots[0]?.record.id ?? null;
    await add(first);
    expect(numbers()).toEqual(['4A', '4D', '4C']);
  });

  it('brings numbers back in line with the board when a scene is unlocked', async () => {
    await store.getState().apply(setNumbersLocked(records(), projectId, 'sc4', true));
    const a = await add();
    await add();
    await add(a);
    expect(numbers()).toEqual(['4A', '4C', '4B']);
    await store.getState().apply(setNumbersLocked(records(), projectId, 'sc4', false));
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('moves the shots to a scene’s new number unless locked', async () => {
    await add();
    await add();
    await store.getState().apply(setSceneNumber(records(), projectId, 'sc4', '7'));
    expect(numbers()).toEqual(['7A', '7B']);
    await store.getState().apply(setNumbersLocked(records(), projectId, 'sc4', true));
    await store.getState().apply(setSceneNumber(records(), projectId, 'sc4', '9'));
    expect(numbers()).toEqual(['7A', '7B']);
  });

  it('lets the project allow I and O, renumbering unlocked scenes', async () => {
    for (let i = 0; i < 9; i += 1) await add();
    expect(numbers().at(-1)).toBe('4J');
    await store.getState().apply(setLettersAllowIO(records(), projectId, true));
    expect(numbers().at(-1)).toBe('4I');
  });

  it('counts frames by status and works out coverage, without storing either', async () => {
    const a = await add();
    await add();
    await store.getState().apply([{ kind: 'update', id: a, set: { status: 'have' } }]);
    const [scene] = board(records(), projectId);
    expect(scene?.counts).toEqual({ have: 1, need: 1, source: 0 });
    expect(coverage(board(records(), projectId))).toBe(50);
    expect(coverage([])).toBeNull();
  });

  it('reorders within a scene and renumbers, as one edit', async () => {
    const a = await add();
    await add();
    const c = await add();
    await store.getState().apply(moveShot(records(), projectId, c, 'sc4', a));
    const shots = board(records(), projectId)[0]?.shots ?? [];
    expect(shots.map((s) => [s.record.id === c, s.fields.number])).toEqual([[true, '4A'], [false, '4B'], [false, '4C']]);
    await store.getState().undo();
    expect(board(records(), projectId)[0]?.shots.map((s) => s.record.id).at(-1)).toBe(c);
  });

  it('moves a frame into another scene, numbering it there and closing up where it left', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc5', type: 'scene', parentId: projectId, sortKey: 'k', props: { number: '5' } } },
    ]);
    await add();
    const b = await add();
    await store.getState().apply(setNumbersLocked(records(), projectId, 'sc5', true));
    await store.getState().apply(addShot(records(), projectId, 'sc5').changes);
    await store.getState().apply(moveShot(records(), projectId, b, 'sc5', null));
    const [four, five] = board(records(), projectId);
    expect(four?.shots.map((s) => s.fields.number)).toEqual(['4A']);
    // Scene 5 is locked: the frame that arrives takes its next free letter.
    expect(five?.shots.map((s) => s.fields.number)).toEqual(['5A', '5B']);
  });
});

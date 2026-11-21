import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { setLocale } from '../../core/i18n';
import { addShot } from '../storyboard/board';
import { loadSteps, undoRedoLines } from './steps';
import { lineText } from './summary';

// The top bar's Undo and Redo (item 8) name the step ⌘Z and ⌘⇧Z would take, in the words History shows for that step:
// read from the same lines, never a second wording.

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
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const frame = async () => {
  const added = addShot(store.getState().records, project.projectId, 'sc4');
  await store.getState().apply(added.changes);
  return added.shotId;
};
const text = async () => {
  const { undo, redo } = await undoRedoLines(project.file);
  return { undo: undo && lineText(undo), redo: redo && lineText(redo) };
};
/** History's line for each step, newest first. */
const historyLines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));

describe('the top bar’s Undo and Redo lines', () => {
  it('name the newest edit for Undo, as History words it, and nothing for Redo', async () => {
    await frame();
    const shown = await historyLines();
    expect(await text()).toEqual({ undo: shown[0], redo: null });
  });

  it('after an undo, name the step before for Undo and the undone one for Redo; after a redo, back', async () => {
    await frame();
    await frame();
    const [second, first] = await historyLines();
    await store.getState().undo();
    expect(await text()).toEqual({ undo: first, redo: second });
    // History's own line for the undo names the same step.
    expect((await historyLines())[0]).toBe(`Undid: ${second ?? ''}`);
    await store.getState().redo();
    expect(await text()).toEqual({ undo: second, redo: null });
  });

  it('are null with nothing to undo or redo', async () => {
    const empty = await createProject(folder.path('Empty.sbd'), { driver: nodeDriver, backups: false });
    try {
      expect(await undoRedoLines(empty.file)).toEqual({ undo: null, redo: null });
    } finally {
      await empty.close();
    }
  });

  it('name a restore as History does, with the step it went back to', async () => {
    await frame();
    const [made] = await historyLines();
    await frame();
    const steps = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps;
    const target = steps[1]?.group.id ?? null;
    await store.getState().restoreTo(target);
    const shown = await historyLines();
    expect(shown[0]).toContain(made ?? '');
    expect((await text()).undo).toBe(shown[0]);
  });

  it('follow the language', async () => {
    await frame();
    const english = (await text()).undo;
    setLocale('es');
    const shown = await historyLines();
    expect((await text()).undo).toBe(shown[0]);
    expect(shown[0]).not.toBe(english);
  });
});

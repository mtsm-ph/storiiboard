import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../../core/i18n';
import type { PlanUnit } from '../../core/model/length';
import type { ProjectFile } from '../../core/storage/driver';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { undoRedoLines, type UndoRedoLines } from '../../features/history/steps';
import { lineText } from '../../features/history/summary';
import { addShot } from '../../features/storyboard/board';
import { noticeStore } from '../notice';
import { createProjectStore } from '../projectStore';
import { readStepLines, shownLines, type ReadFor, type StepLinesRead } from './undoRedoRead';

// The top bar's Undo and Redo (item 8, #241's review): a name is shown only for the state it was read for. Right after
// an edit, an undo, a redo or a language change, until the new read lands, the buttons say "… a step", never the
// previous state's step, which a second Enter would otherwise act on under a name no longer true.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([{ kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } }]);
});
afterEach(async () => {
  setLocale('en');
  vi.restoreAllMocks();
  await store.getState().close();
  folder.remove();
});

const frame = async () => {
  await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
};
const unit: PlanUnit = 'metres';
/** The state the buttons see now. */
const now = (): ReadFor => {
  const s = store.getState();
  if (!s.project) throw new Error('no project');
  return { file: s.project.file, records: s.records, deletedForGood: s.deletedForGood, locale: getLocale(), unit };
};
/** What the buttons name with this read as the last one landed. */
const named = (read: StepLinesRead | null) => {
  const s = store.getState();
  const { undo, redo } = shownLines(read, now(), s);
  return { undo: undo && lineText(undo), redo: redo && lineText(redo) };
};

/** A read whose queries wait until `release` is called: a slow file, as Rust's round trips are on the desktop. */
function delayed() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = (file: ProjectFile): ProjectFile =>
    Object.assign(Object.create(file) as ProjectFile, {
      query: async (sql: string, params?: Parameters<ProjectFile['query']>[1]) => {
        await gate;
        return file.query(sql, params);
      },
    });
  return { read: (file: ProjectFile, u: PlanUnit): Promise<UndoRedoLines> => undoRedoLines(slow(file), u), release };
}

describe('the top bar’s Undo and Redo names', () => {
  it('say “a step” after an edit, an undo, a redo and a language change until that state’s read lands, never the step before', async () => {
    await frame();
    let read = await readStepLines(now());
    expect(named(read)).toEqual({ undo: 'Added frame 4A', redo: null });

    // An edit: the read just landed was for the state before it.
    await frame();
    expect(named(read)).toEqual({ undo: 'a step', redo: null });
    let slow = delayed();
    let pending = readStepLines(now(), slow.read);
    expect(named(read)).toEqual({ undo: 'a step', redo: null });
    slow.release();
    read = await pending;
    expect(named(read)).toEqual({ undo: 'Added frame 4B', redo: null });

    // An undo.
    await store.getState().undo();
    expect(named(read)).toEqual({ undo: 'a step', redo: 'a step' });
    slow = delayed();
    pending = readStepLines(now(), slow.read);
    expect(named(read)).toEqual({ undo: 'a step', redo: 'a step' });
    slow.release();
    read = await pending;
    expect(named(read)).toEqual({ undo: 'Added frame 4A', redo: 'Added frame 4B' });

    // A redo.
    await store.getState().redo();
    expect(named(read)).toEqual({ undo: 'a step', redo: null });
    read = await readStepLines(now());
    expect(named(read)).toEqual({ undo: 'Added frame 4B', redo: null });

    // A language change: the line was worded in English.
    setLocale('es');
    expect(named(read)).toEqual({ undo: 'un paso', redo: null });
    read = await readStepLines(now());
    expect(named(read).undo).not.toBe('Added frame 4B');
    expect(named(read).undo).toBe(lineText((await undoRedoLines(project.file, unit)).undo ?? []));
  });

  it('never name the state after a read with what a read begun before it found', async () => {
    await frame();
    const slow = delayed();
    const pending = readStepLines(now(), slow.read);
    await frame();
    slow.release();
    const late = await pending;
    // Begun for the state with one frame (its queries met the file with two): kept for the state it began for, so
    // shown now it says "a step" until a read begun for this state lands.
    expect(late).not.toBeNull();
    expect(named(late)).toEqual({ undo: 'a step', redo: null });
    expect(named(await readStepLines(now()))).toEqual({ undo: 'Added frame 4B', redo: null });
  });

  it('never show another project’s lines', async () => {
    await frame();
    const read = await readStepLines(now());
    const other = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(other);
    await store.getState().apply([{ kind: 'create', record: { id: 'sc9', type: 'scene', parentId: other.projectId, sortKey: 'V', props: { number: '9' } } }]);
    expect(named(read)).toEqual({ undo: 'a step', redo: null });
    expect(named(await readStepLines(now()))).toEqual({ undo: 'Added scene SC 09', redo: null });
  });

  it('fall back to “a step” quietly when a read fails: no notice, no console error', async () => {
    await frame();
    const errors = vi.spyOn(console, 'error');
    const seq = noticeStore.getState().seq;
    const read = await readStepLines(now(), () => Promise.reject(new Error('disk on fire')));
    expect(read).toBeNull();
    expect(named(read)).toEqual({ undo: 'a step', redo: null });
    expect(noticeStore.getState().seq).toBe(seq);
    expect(errors).not.toHaveBeenCalled();
  });

  it('fall back quietly when the project closes in the same tick as a read', async () => {
    await frame();
    const errors = vi.spyOn(console, 'error');
    const seq = noticeStore.getState().seq;
    const pending = readStepLines(now());
    const closing = store.getState().close();
    // Read in time or met a closed file: either way it settles, never throws.
    const done = await pending;
    await closing;
    expect(done === null || Array.isArray(done.lines.undo)).toBe(true);
    expect(noticeStore.getState().seq).toBe(seq);
    expect(errors).not.toHaveBeenCalled();
  });
});

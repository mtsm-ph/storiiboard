import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { ProjectFields } from './project/ProjectHome';
import { clearNotice, noticeStore, showInfo } from './notice';
import { createProjectStore, projectStore } from './projectStore';
import { undoCommandFor } from './shell/undoShortcuts';

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

const open = async (name = 'Bey County.sbd') =>
  createProject(folder.path(name), { driver: nodeDriver, backups: false });

describe('the project store', () => {
  it('mirrors the file after each edit, undo and redo', async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    const title = () => store.getState().records[project.projectId]?.props.title;
    expect(title()).toBe('Bey County');
    expect(store.getState().canUndo).toBe(false);

    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { title: 'Bey County: Pilot' } }]);
    expect(title()).toBe('Bey County: Pilot');
    expect(store.getState().canUndo).toBe(true);

    await store.getState().undo();
    expect(title()).toBe('Bey County');
    expect(store.getState().canRedo).toBe(true);
    await store.getState().redo();
    expect(title()).toBe('Bey County: Pilot');
    await store.getState().close();
  });

  it('switches from one open project to another without a moment with none, then closes the first', async () => {
    const store = createProjectStore();
    const first = await open('Bey County.sbd');
    const second = await open('Bey County Pilot.sbd');
    await store.getState().open(first);
    const closeFirst = first.close.bind(first);
    let firstClosed = 0;
    first.close = async () => {
      // Closed only once the second is the one on screen.
      expect(store.getState().project).toBe(second);
      firstClosed += 1;
      await closeFirst();
    };
    const seen: (string | null)[] = [];
    const stop = store.subscribe((s) => seen.push(s.project?.projectId ?? null));
    await store.getState().open(second);
    stop();
    expect(seen).not.toContain(null);
    expect(firstClosed).toBe(1);
    expect(store.getState().project?.projectId).toBe(second.projectId);
    expect(store.getState().records[first.projectId]).toBeUndefined();
    await store.getState().close();
  });

  it('drops an edit made in one project if a switch replaced it before the edit’s turn', async () => {
    const store = createProjectStore();
    const first = await open('Bey County.sbd');
    const second = await open('Bey County Pilot.sbd');
    await store.getState().open(first);
    const switching = store.getState().open(second);
    // Made while the first is still on screen, queued behind the switch.
    const edit = store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Bey County: Pilot' } }]);
    await Promise.all([switching, edit]);
    expect(store.getState().project).toBe(second);
    expect(store.getState().error).toBeNull();
    expect(store.getState().canUndo).toBe(false);
    await store.getState().close();
  });

  it('counts a project closed even when closing its file fails', async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    const closeFile = project.close.bind(project);
    project.close = async () => {
      await closeFile();
      throw new Error('poisoned');
    };
    await expect(store.getState().close()).rejects.toThrow('poisoned');
    expect(store.getState().project).toBeNull();
  });

  it('keeps the open project when another can’t be read, and closes the one that failed', async () => {
    const store = createProjectStore();
    const first = await open('Bey County.sbd');
    const broken = await open('Broken.sbd');
    await store.getState().open(first);
    // Its file is gone from under it, as a failed read would leave it.
    await broken.file.close();
    let brokenClosed = 0;
    const closeBroken = broken.close.bind(broken);
    broken.close = async () => {
      brokenClosed += 1;
      await closeBroken().catch(() => undefined);
    };
    await expect(store.getState().open(broken)).rejects.toThrow();
    expect(brokenClosed).toBe(1);
    expect(store.getState().project).toBe(first);
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Still open' } }]);
    expect(store.getState().records[first.projectId]?.props.title).toBe('Still open');
    await store.getState().close();
  });

  it('runs edits in the order they were made, even fired together', async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    const edits = ['A', 'B', 'C'].map((notes) =>
      store.getState().apply([{ kind: 'update', id: project.projectId, set: { notes } }]),
    );
    await Promise.all(edits);
    expect(store.getState().records[project.projectId]?.props.notes).toBe('C');
    await store.getState().close();
  });

  it('reports a failed edit in words instead of throwing, and says so on screen wherever it was made', async () => {
    const store = createProjectStore();
    await store.getState().open(await open());
    await store.getState().apply([{ kind: 'update', id: 'missing', set: {} }]);
    expect(store.getState().error).toBe('That item no longer exists.');
    expect(noticeStore.getState()).toMatchObject({ message: 'That item no longer exists.', kind: 'warning' });
    clearNotice();
    await store.getState().close();
  });

  it('takes away a notice about a step when that step is undone or redone, and no other notice (1.28’s low)', async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    // Nothing to undo: whatever notice is up stays.
    showInfo('Deleted SC 03 to the Trash.', { step: true });
    await store.getState().undo();
    expect(noticeStore.getState().message).toBe('Deleted SC 03 to the Trash.');
    // A notice that isn't about a step (a synced folder, an export) survives an undo.
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { title: 'Pilot' } }]);
    showInfo('This project is in a synced folder.');
    await store.getState().undo();
    expect(noticeStore.getState().message).toBe('This project is in a synced folder.');
    // One about the step goes with it, on undo and on redo.
    showInfo('Retitled.', { step: true });
    await store.getState().redo();
    expect(noticeStore.getState().message).toBeNull();
    showInfo('Retitled.', { step: true });
    await store.getState().undo();
    expect(noticeStore.getState().message).toBeNull();
    await store.getState().close();
  });

  it('says whether an edit worked out in the queue was written', async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    expect(await store.getState().applyWith(() => ({ changes: [{ kind: 'update', id: project.projectId, set: { notes: 'Day 1' } }] }))).toBe(true);
    expect(await store.getState().applyWith(() => ({ changes: [{ kind: 'update', id: 'missing', set: {} }] }))).toBe(false);
    // Nothing to write is no failure.
    expect(await store.getState().applyWith(() => ({ changes: [] }))).toBe(true);
    await store.getState().close();
  });
});

describe('the project home', () => {
  it("shows the open project's title and notes in labelled fields", async () => {
    const store = createProjectStore();
    const project = await open();
    await store.getState().open(project);
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { notes: 'Shoot day 1: dock' } }]);
    const record = store.getState().records[project.projectId];
    if (!record) throw new Error('the project record should be loaded');
    const html = renderToString(<ProjectFields record={record} error={null} onChange={() => undefined} />);
    expect(html).toContain('value="Bey County"');
    expect(html).toContain('Shoot day 1: dock');
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Notes<\/label>/);
    await store.getState().close();
  });
});

describe('undo shortcuts', () => {
  const key = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}, target: EventTarget | null = null) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
    ...mods,
  });

  it('are ⌘Z and ⇧⌘Z on a Mac', () => {
    expect(undoCommandFor(key('z', { metaKey: true }), true)).toBe('undo');
    expect(undoCommandFor(key('Z', { metaKey: true, shiftKey: true }), true)).toBe('redo');
    expect(undoCommandFor(key('z', { ctrlKey: true }), true)).toBeNull();
  });

  it('are Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z on Windows', () => {
    expect(undoCommandFor(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(undoCommandFor(key('y', { ctrlKey: true }), false)).toBe('redo');
    expect(undoCommandFor(key('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo');
    expect(undoCommandFor(key('z', { metaKey: true }), false)).toBeNull();
  });

  it("leave a text field's own undo alone", () => {
    const input = { tagName: 'INPUT', type: 'text', isContentEditable: false } as unknown as EventTarget;
    expect(undoCommandFor(key('z', { metaKey: true }, input), true)).toBeNull();
  });

  it('do nothing from inside a modal dialog, unless its work is project edits (the sketch editor)', () => {
    // A control inside an open dialog: what closest('dialog[open]') finds for it.
    const inside = (dialog: { hasAttribute: (name: string) => boolean } | null) =>
      ({ tagName: 'INPUT', type: 'range', isContentEditable: false, closest: () => dialog }) as unknown as EventTarget;
    const watermark = { hasAttribute: () => false };
    const sketch = { hasAttribute: (name: string) => name === 'data-project-undo' };
    expect(undoCommandFor(key('z', { ctrlKey: true }, inside(watermark)), false)).toBeNull();
    expect(undoCommandFor(key('Z', { metaKey: true, shiftKey: true }, inside(watermark)), true)).toBeNull();
    expect(undoCommandFor(key('z', { ctrlKey: true }, inside(sketch)), false)).toBe('undo');
    expect(undoCommandFor(key('z', { ctrlKey: true }, inside(null)), false)).toBe('undo');
  });
});

it('shows a failed edit beside the project fields, read out by the notice rather than twice', async () => {
  const store = createProjectStore();
  const project = await open('Alert.sbd');
  await store.getState().open(project);
  const record = store.getState().records[project.projectId];
  if (!record) throw new Error('the project record should be loaded');
  const html = renderToString(<ProjectFields record={record} error="The disk is full." onChange={() => undefined} />);
  expect(html).toContain('>The disk is full.<');
  expect(html).not.toContain('role="alert"');
  await store.getState().close();
});

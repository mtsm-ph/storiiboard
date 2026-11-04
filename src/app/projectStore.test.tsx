import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { ProjectFields } from './project/ProjectHome';
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

  it('switches from one open project to another without a moment with none', async () => {
    const store = createProjectStore();
    const first = await open('Bey County.sbd');
    const second = await open('Bey County Pilot.sbd');
    await store.getState().open(first);
    const seen: (string | null)[] = [];
    const stop = store.subscribe((s) => seen.push(s.project?.projectId ?? null));
    await store.getState().open(second);
    stop();
    expect(seen).not.toContain(null);
    expect(store.getState().project?.projectId).toBe(second.projectId);
    expect(store.getState().records[first.projectId]).toBeUndefined();
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

  it('reports a failed edit in words instead of throwing', async () => {
    const store = createProjectStore();
    await store.getState().open(await open());
    await store.getState().apply([{ kind: 'update', id: 'missing', set: {} }]);
    expect(store.getState().error).toBe('That item no longer exists.');
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
});

it('shows a failed edit as an alert', async () => {
  const store = createProjectStore();
  const project = await open('Alert.sbd');
  await store.getState().open(project);
  const record = store.getState().records[project.projectId];
  if (!record) throw new Error('the project record should be loaded');
  const html = renderToString(<ProjectFields record={record} error="The disk is full." onChange={() => undefined} />);
  expect(html).toMatch(/role="alert"[^>]*>The disk is full\.</);
  await store.getState().close();
});

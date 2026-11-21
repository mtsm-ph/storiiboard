import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGED_ON_DISK, type ProjectFile, type SqlDriver } from '../core/storage/driver';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { createProjectStore } from './projectStore';

// A hand backup queued when the project closes or switches (#244 round 3): made, but never inside the new project's
// edit queue, never told on the new project's state, and never for a file a sync replaced (the reopen path).

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

/** A gate copies wait at while it's shut; how many were begun; and a failure for those that pass it. */
interface Gate {
  shut: Promise<void> | null;
  open: () => void;
  copies: number;
  fail: Error | null;
}

/** nodeDriver, with every copy of the files it makes or opens held at `gate` while it's shut. */
function gatedDriver(gate: Gate): SqlDriver {
  const wrap = (file: ProjectFile): ProjectFile => ({
    ...file,
    backup: async (kind, name) => {
      gate.copies += 1;
      if (gate.shut) await gate.shut;
      if (gate.fail) throw gate.fail;
      await file.backup(kind, name);
    },
  });
  return {
    ...nodeDriver,
    create: async (path) => wrap(await nodeDriver.create(path)),
    open: async (path) => wrap(await nodeDriver.open(path)),
  };
}

function makeGate(): Gate {
  let release: () => void = () => undefined;
  const shut = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gate: Gate = {
    shut,
    open: () => {
      gate.shut = null;
      release();
    },
    copies: 0,
    fail: null,
  };
  return gate;
}

/** Waits for a project's close, wherever it was started from. */
function watchClose(project: Project): { done: Promise<void> } {
  const watched = { done: Promise.resolve() };
  const close = project.close.bind(project);
  project.close = (options) => {
    const closing = close(options);
    watched.done = closing.catch(() => undefined);
    return closing;
  };
  return watched;
}

/** The project's backups on disk, read from its Backups folder without opening anything. */
const listed = (): string[] => {
  const dir = folder.path('Backups');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith('Bey County ')).sort() : [];
};

describe('a hand backup queued at a switch', () => {
  /** The first project open in a store, with one hand copy made and another queued for its minute. */
  async function queuedIn(store: ReturnType<typeof createProjectStore>, gate: ReturnType<typeof makeGate>, onError = vi.fn()) {
    const first = await createProject(folder.path('Bey County.sbd'), { driver: gatedDriver(gate), backups: { onError } });
    await store.getState().open(first);
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'One' } }]);
    gate.open();
    await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'created' });
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Two' } }]);
    await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    return first;
  }

  it('never holds the new project’s first edit behind the old one’s copy, which is still made', async () => {
    const store = createProjectStore();
    const gate = makeGate();
    const first = await queuedIn(store, gate);
    const closed = watchClose(first);
    const handCopy = listed();
    expect(handCopy).toHaveLength(1);
    // The copy at the switch is slow (a large project's full copy, a share that stalls).
    const slow = makeGate();
    gate.shut = slow.shut;
    const second = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(second);
    expect(store.getState().project).toBe(second);
    // The old project's copy has begun, and waits.
    await vi.waitFor(() => {
      expect(gate.copies).toBe(2);
    });
    // The new project's edit lands meanwhile.
    await store.getState().apply([{ kind: 'update', id: second.projectId, set: { title: 'Pilot: first edit' } }]);
    expect(store.getState().records[second.projectId]?.props.title).toBe('Pilot: first edit');
    expect(listed()).toEqual(handCopy);
    slow.open();
    await closed.done;
    // Made as at its minute: in place of the hand copy under 5 minutes old.
    const names = listed();
    expect(names).toHaveLength(1);
    expect(names).not.toEqual(handCopy);
    await store.getState().close();
  });

  it('never sets changedOnDisk on the new project when the copy fails, nor tells onError', async () => {
    const store = createProjectStore();
    const gate = makeGate();
    const onError = vi.fn((error: unknown) => {
      // As the app's own (src/app/projects/actions.ts): a refused copy marks the open project's file as replaced.
      if (error instanceof Error && error.message === CHANGED_ON_DISK) store.setState({ changedOnDisk: true });
    });
    const first = await queuedIn(store, gate, onError);
    const closed = watchClose(first);
    gate.fail = new Error(CHANGED_ON_DISK);
    const second = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(second);
    await closed.done;
    expect(gate.copies).toBe(2);
    expect(onError).not.toHaveBeenCalled();
    expect(store.getState().project).toBe(second);
    expect(store.getState().changedOnDisk).toBe(false);
    await store.getState().close();
  });

  it('makes no copy on the reopen path, whether the newer version opens or the replaced one just closes', async () => {
    const store = createProjectStore();
    const gate = makeGate();
    const first = await queuedIn(store, gate);
    const closed = watchClose(first);
    const path = folder.path('Bey County.sbd');
    const before = listed();
    // The same file opened again: the reopen after a sync replaced it.
    const reopened = await openProject(path, { driver: gatedDriver(gate), backups: {} });
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Three' } }]);
    await store.getState().open(reopened);
    await closed.done;
    expect(gate.copies).toBe(1);
    expect(listed()).toEqual(before);

    // Its own queued copy, then the reopen failing: the store closes it without making it.
    // (The hand copy on disk is under a minute old, so a press queues one at once.)
    await store.getState().apply([{ kind: 'update', id: reopened.projectId, set: { title: 'Four' } }]);
    await expect(reopened.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    const copies = gate.copies;
    const after = listed();
    await store.getState().close({ flush: false });
    expect(gate.copies).toBe(copies);
    expect(listed()).toEqual(after);
  });
});

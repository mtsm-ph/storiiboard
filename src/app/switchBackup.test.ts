import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../core/i18n';
import { CHANGED_ON_DISK, type ProjectFile, type SqlDriver } from '../core/storage/driver';
import { nodeDriver } from '../core/storage/nodeDriver';
import { pathKey } from '../core/storage/paths';
import { createProject, openProject, type Project } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { clearNotice, noticeStore } from './notice';
import { openProjectFile } from './openFiles';
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

/** The first project open in a store, with one hand copy made and another queued for its minute. */
async function queuedHandCopy(
  store: ReturnType<typeof createProjectStore>,
  gate: ReturnType<typeof makeGate>,
  options: Omit<Parameters<typeof createProject>[1], 'driver'> = {},
) {
  const first = await createProject(folder.path('Bey County.sbd'), { driver: gatedDriver(gate), ...options });
  await store.getState().open(first);
  await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'One' } }]);
  gate.open();
  await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'created' });
  await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Two' } }]);
  await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
  return first;
}

describe('a hand backup queued at a switch', () => {
  const queuedIn = (store: ReturnType<typeof createProjectStore>, gate: ReturnType<typeof makeGate>, onError = vi.fn()) =>
    queuedHandCopy(store, gate, { backups: { onError } });

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
    // The same file opened again: the reopen after a sync replaced it, which says so (reopenChangedProject, round 4).
    const reopened = await openProject(path, { driver: gatedDriver(gate), backups: {} });
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Three' } }]);
    await store.getState().open(reopened, { flush: false });
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

/** The lock file nodeDriver writes beside the project, as lock.rs does. */
const lockFile = () => folder.path('.Bey County.sbd.lock');
const lockSession = (): string => (JSON.parse(readFileSync(lockFile(), 'utf8')) as { session: string }).session;
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe('opening a file again while its close is making a backup (#244 round 4)', () => {
  /** A switch from Bey County, with a hand copy queued and its copy held at `slow`, so Bey County closes on its own. */
  async function switchedAway(slow: Gate, options: Omit<Parameters<typeof createProject>[1], 'driver'> = {}) {
    const store = createProjectStore();
    const gate = makeGate();
    const first = await queuedHandCopy(store, gate, options);
    const closed = watchClose(first);
    gate.shut = slow.shut;
    const second = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(second);
    // The old project's copy has begun, and waits.
    await vi.waitFor(() => {
      expect(gate.copies).toBe(2);
    });
    return { store, closed };
  }

  it('waits for that close before it opens, and its lock file is there afterwards', async () => {
    const slow = makeGate();
    const { store, closed } = await switchedAway(slow);
    const order: string[] = [];
    void closed.done.then(() => order.push('closed'));
    const again = openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }).then((project) => {
      order.push('opened');
      return project;
    });
    await pause(50);
    expect(order).toEqual([]);
    slow.open();
    const reopened = await again;
    expect(order).toEqual(['closed', 'opened']);
    expect(existsSync(lockFile())).toBe(true);
    await reopened.close();
    await store.getState().close();
  });

  it('goes on past the time limit and says so; the old close never refreshes, nor takes, the new lock', async () => {
    const slow = makeGate();
    // The old project refreshes its lock every 10 ms while open: a refresh after its close began would rewrite the
    // lock file with its own session, over the new one's.
    const { store, closed } = await switchedAway(slow, { lockRefreshMs: 10 });
    const stillClosing = vi.fn();
    const reopened = await openProject(folder.path('Bey County.sbd'), {
      driver: nodeDriver,
      backups: false,
      closeWaitMs: 30,
      onStillClosing: stillClosing,
    });
    expect(stillClosing).toHaveBeenCalledTimes(1);
    // The old copy has not settled, and the new project is open beside it.
    let oldClosed = false;
    void closed.done.then(() => {
      oldClosed = true;
    });
    const session = lockSession();
    await pause(60);
    expect(oldClosed).toBe(false);
    expect(lockSession()).toBe(session);
    // Let go only to tidy up: the old close ends, and leaves the new lock where it was.
    slow.open();
    await closed.done;
    expect(existsSync(lockFile())).toBe(true);
    expect(lockSession()).toBe(session);
    await reopened.close();
    await store.getState().close();
  });

  it('names one file by both spellings of its path', () => {
    expect(pathKey('Z:\\Shoots\\A.sbd')).toBe(pathKey('z:/shoots/a.sbd'));
    expect(pathKey('\\\\Server\\Share\\A.sbd')).toBe(pathKey('//server/share/a.sbd'));
    // A Mac or Linux path keeps its case.
    expect(pathKey('/Shoots/A.sbd')).not.toBe(pathKey('/shoots/a.sbd'));
  });
});

/** A Storage in memory, as the webview's localStorage. */
function memoryStorage(): Storage {
  const kept = new Map<string, string>();
  return {
    get length() {
      return kept.size;
    },
    clear: () => {
      kept.clear();
    },
    getItem: (key) => kept.get(key) ?? null,
    key: (index) => [...kept.keys()][index] ?? null,
    removeItem: (key) => {
      kept.delete(key);
    },
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

describe('a backup that failed at a close (#244 round 4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearNotice();
  });

  it('is said once in the status line the next time that project opens, never on another', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const store = createProjectStore();
    const gate = makeGate();
    gate.open();
    const onDisk = async (name: string) => {
      const path = folder.path(name);
      await (await createProject(path, { driver: nodeDriver, backups: false })).close();
      return path;
    };
    const bey = await onDisk('Bey County.sbd');
    const pilot = await onDisk('Pilot.sbd');
    const options = { store, driver: gatedDriver(gate), backups: {} };
    await openProjectFile(bey, options);
    const first = store.getState().project;
    if (!first) throw new Error('Bey County didn’t open');
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'One' } }]);
    await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'created' });
    await store.getState().apply([{ kind: 'update', id: first.projectId, set: { title: 'Two' } }]);
    await expect(first.backups?.backUpByHand()).resolves.toMatchObject({ kind: 'queued' });
    // A plain close: the queued copy is made, and fails.
    gate.fail = new Error('The disk is full.');
    await store.getState().close();
    gate.fail = null;
    expect(noticeStore.getState().message).toBeNull();

    // Another project opens: nothing of Bey County's is said there.
    await openProjectFile(pilot, options);
    expect(noticeStore.getState().message).toBeNull();

    // Bey County opens again: said once.
    await openProjectFile(bey, options);
    expect(noticeStore.getState().message).toBe(t('backups.closeFailed', { project: 'Bey County', reason: 'The disk is full.' }));
    clearNotice();

    // Then forgotten.
    await openProjectFile(pilot, options);
    await openProjectFile(bey, options);
    expect(noticeStore.getState().message).toBeNull();
    await store.getState().close();
  });
});

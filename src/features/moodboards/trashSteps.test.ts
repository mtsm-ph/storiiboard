import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../trash/trash';
import { openDepartmentBoard, trashBoardChanges } from './boards';
import { connectChanges, connectorsOf } from './connectors';
import { createItems, trashItemsChanges } from './items';
import { moodboardStore } from './moodboardStore';

// Two steps in the same millisecond are never one step (6.24). The Trash tells a connector that went with its item,
// and an item that went with its board, by "trashed at the same time by the same person"; here the clock stands still
// for the whole test, so every step is made in one millisecond. What was deleted before must still be listed on its
// own and stay in the Trash when the other comes back. No wait anywhere.

const FROZEN = Date.parse('2026-11-16T10:00:00.000Z');

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  // Only the date: timers run as they are.
  vi.useFakeTimers({ toFake: ['Date'], now: FROZEN });
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  moodboardStore.getState().copy([], null, []);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
  vi.useRealTimers();
});

const records = () => store.getState().records;
const trashedAt = (id: string) => records()[id]?.trashedAt ?? null;
const listed = () => trashItems(records(), project.projectId).map((row) => row.id).sort();

/** The clock never moved, and still no two steps in the file share a time. */
async function expectOneMillisecond() {
  expect(Date.now()).toBe(FROZEN);
  const times = (await log(project.file)).map((group) => group.timestamp);
  expect(times[0]).toBe(new Date(FROZEN).toISOString());
  expect(new Set(times).size).toBe(times.length);
}

const sticky = (x: number, y: number) => ({ kind: 'sticky' as const, x, y, width: 200, height: 200, rotation: 0, text: 'Warm light' });
const rect = (x: number, y: number) => ({ kind: 'rect' as const, x, y, width: 200, height: 120, rotation: 0 });

/** The Camera board with a sticky joined to each of two rectangles by a connector. */
async function joined() {
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  const boardId = opened.id;
  const made = createItems(records(), boardId, [sticky(0, 0), rect(500, 40), rect(500, 400)]);
  await store.getState().apply(made.changes);
  const [a, b, c] = made.ids as [string, string, string];
  const connect = async (to: string) => {
    const drop = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'right' }, to: { item: to, side: 'left' } });
    await store.getState().apply(drop.changes);
    return drop.id as string;
  };
  return { boardId, a, b, c, toB: await connect(b), toC: await connect(c) };
}

describe('steps made in one millisecond, in the Trash (6.24)', () => {
  it('lists a connector deleted before its item on its own, and restoring the item brings back only the connector that went with it', async () => {
    const { boardId, a, toB, toC } = await joined();
    expect(connectorsOf(records(), boardId).map((r) => r.id).sort()).toEqual([toB, toC].sort());
    await store.getState().apply(trashItemsChanges(records(), [toB]));
    await store.getState().apply(trashItemsChanges(records(), [a]));
    // Two steps, two times; the connector that went with the item has the item's.
    expect(trashedAt(toB)).not.toBeNull();
    expect(trashedAt(toB)).not.toBe(trashedAt(a));
    expect(trashedAt(toC)).toBe(trashedAt(a));
    expect(listed()).toEqual([a, toB].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(trashedAt(a)).toBeNull();
    expect(trashedAt(toC)).toBeNull();
    expect(trashedAt(toB)).not.toBeNull();
    expect(listed()).toEqual([toB]);
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([toC]);
    await expectOneMillisecond();
  });

  it('lists an item deleted before its board on its own, and restoring the board brings back only what went with it', async () => {
    const { boardId, a, b, c, toB, toC } = await joined();
    // The second rectangle goes first, its connector with it; then the board with the rest.
    await store.getState().apply(trashItemsChanges(records(), [c]));
    await store.getState().apply(trashBoardChanges(records(), boardId));
    expect(trashedAt(c)).not.toBeNull();
    expect(trashedAt(toC)).toBe(trashedAt(c));
    expect(trashedAt(c)).not.toBe(trashedAt(boardId));
    for (const id of [a, b, toB]) expect(trashedAt(id)).toBe(trashedAt(boardId));
    expect(listed()).toEqual([boardId, c].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, boardId));
    for (const id of [boardId, a, b, toB]) expect(trashedAt(id)).toBeNull();
    expect(trashedAt(c)).not.toBeNull();
    expect(trashedAt(toC)).not.toBeNull();
    expect(listed()).toEqual([c]);
    await expectOneMillisecond();
  });
});

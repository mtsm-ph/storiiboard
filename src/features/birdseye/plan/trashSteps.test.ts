import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { sceneRoomId, shownItems, startRoomChanges, trashPlanChanges, wallsAlong } from '../../../core/model/plan';
import { log } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../../trash/trash';
import { nextPosition } from './planActions';
import { openingSpot, placeIconChanges, placeOpeningChanges, trashPlanItemsChanges } from './planItems';
import { planStore } from './planStore';

// Two steps in the same millisecond are never one step (6.24). The Trash tells what went with a room, a wall or a
// camera by "trashed at the same time by the same person"; here the clock stands still for the whole test, so every
// step is made in one millisecond, as a change file or an assistant applying many at once would make them. What was
// deleted before must still be listed on its own and stay in the Trash when the other comes back. No wait anywhere.

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

/** A scene with its room started and an L of two walls drawn in it. */
async function room(): Promise<{ sceneId: string; roomId: string; walls: [string, string] }> {
  const sceneId = crypto.randomUUID();
  await store.getState().apply([{ kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '4', name: 'Diner' } } }]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
  const made = wallsAlong(records(), roomId, [
    { x: 0, y: 0 },
    { x: 3.5, y: 0 },
    { x: 3.5, y: 3.81 },
  ]);
  await store.getState().apply(made.changes);
  const [first = '', second = ''] = made.ids;
  return { sceneId, roomId, walls: [first, second] };
}

/** A door in the wall under the point (canvas units), as the Door tool writes it. */
async function door(sceneId: string, x: number): Promise<string> {
  const spot = openingSpot(shownItems(records(), sceneId, null), { x, y: 0 }, 'door', 0.5);
  if (!spot) throw new Error('no spot');
  const id = crypto.randomUUID();
  await store.getState().apply(placeOpeningChanges(records(), spot, 'door', id));
  return id;
}

describe('steps made in one millisecond, in the Trash (6.24)', () => {
  it('lists a wall deleted before its room on its own, and restoring the room brings back only what went with it', async () => {
    const { sceneId, roomId, walls } = await room();
    const [first, second] = walls;
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    await store.getState().apply(trashPlanChanges(records(), roomId));
    // Two steps, two times; the wall that went with the room has the room's.
    expect(trashedAt(first)).not.toBeNull();
    expect(trashedAt(first)).not.toBe(trashedAt(roomId));
    expect(trashedAt(second)).toBe(trashedAt(roomId));
    expect(listed()).toEqual([roomId, first].sort());
    expect(restoreChanges(records(), project.projectId, roomId).flatMap((c) => (c.kind === 'restore' ? [c.id] : [])).sort()).toEqual([roomId, second].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, roomId));
    expect(trashedAt(roomId)).toBeNull();
    expect(trashedAt(second)).toBeNull();
    expect(trashedAt(first)).not.toBeNull();
    expect(listed()).toEqual([first]);
    expect(sceneRoomId(records(), records()[sceneId])).toBe(roomId);
    await expectOneMillisecond();
  });

  it('lists a door deleted before its wall on its own, and restoring the wall brings back only the door that went with it', async () => {
    const { sceneId, walls } = await room();
    const [wall] = walls;
    const before = await door(sceneId, 100);
    const withWall = await door(sceneId, 250);
    expect(records()[before]?.props.wall_id).toBe(wall);
    expect(records()[withWall]?.props.wall_id).toBe(wall);
    await store.getState().apply(trashPlanItemsChanges(records(), [before]));
    await store.getState().apply(trashPlanItemsChanges(records(), [wall]));
    expect(trashedAt(before)).not.toBeNull();
    expect(trashedAt(before)).not.toBe(trashedAt(wall));
    expect(trashedAt(withWall)).toBe(trashedAt(wall));
    // The door that went with the wall is in the wall's row; the one deleted before has its own.
    expect(listed()).toEqual([wall, before].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, wall));
    expect(trashedAt(wall)).toBeNull();
    expect(trashedAt(withWall)).toBeNull();
    expect(trashedAt(before)).not.toBeNull();
    expect(listed()).toEqual([before]);
    await expectOneMillisecond();
  });

  it('lists a camera position deleted before its camera on its own, and restoring the camera brings back only the one that went with it', async () => {
    const sceneId = crypto.randomUUID();
    const setupId = crypto.randomUUID();
    await store.getState().apply([
      { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1' } } },
      { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    ]);
    await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
    const view = { sceneId, setupId };
    const selected = () => planStore.getState().selections[`setup:${setupId}`] ?? [];
    const cam = crypto.randomUUID();
    await store.getState().apply(placeIconChanges(records(), view, 'camera/camera', { x: 0, y: 0 }, cam));
    expect(await nextPosition(view, cam, project, null, store)).toBeNull();
    const [withCamera = ''] = selected();
    expect(await nextPosition(view, withCamera, project, null, store)).toBeNull();
    const [before = ''] = selected();
    expect(new Set([cam, withCamera, before]).size).toBe(3);
    await store.getState().apply(trashPlanItemsChanges(records(), [before]));
    await store.getState().apply(trashPlanItemsChanges(records(), [cam]));
    expect(trashedAt(before)).not.toBeNull();
    expect(trashedAt(before)).not.toBe(trashedAt(cam));
    expect(trashedAt(withCamera)).toBe(trashedAt(cam));
    expect(listed()).toEqual([cam, before].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, cam));
    expect(trashedAt(cam)).toBeNull();
    expect(trashedAt(withCamera)).toBeNull();
    expect(trashedAt(before)).not.toBeNull();
    expect(listed()).toEqual([before]);
    await expectOneMillisecond();
  });
});

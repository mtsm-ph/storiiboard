import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { lastKeyUnder, openingFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import { setupOnlyChanges } from '../../../core/model/planRooms';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { drawMeasuresChanges, drawWallsChanges, openingSpot, placeIconChanges, placeOpeningChanges, planCanvasItems, planGeometryChanges, shownWalls } from './planItems';
import { addUnderlayChanges } from './underlayEdits';

// A door or window put in a wall never throws (6.22, Kevin: "an odd imported file must never make the app throw"): an
// imported file can hold any string as a sort key, and keyBetween throws on one it can't read. The new opening goes
// after the last key it can read; a file with only readable keys gets exactly the key it got before.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Odd Keys.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const apply = (changes: Change[]) => store.getState().apply(changes);

/** A key no keyBetween can go after: it sorts after every base-62 digit, as an imported file's might. */
const ODD = '~';

/** A scene with a setup, its room started, wall A along y = 0 and wall B along y = 3 m, B in the setup's plan only. */
async function walls(): Promise<{ sceneId: string; setupId: string; roomId: string; a: string; b: string; setupPlan: string }> {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
  ]);
  await apply(startRoomChanges(records(), project.projectId, sceneId));
  const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
  const first = drawWallsChanges(records(), sceneId, [{ x: -300, y: 0 }, { x: 300, y: 0 }]);
  await apply(first.changes);
  const second = drawWallsChanges(records(), sceneId, [{ x: -300, y: 300 }, { x: 300, y: 300 }]);
  await apply(second.changes);
  const a = first.ids[0] ?? '';
  const b = second.ids[0] ?? '';
  await apply(setupOnlyChanges(records(), sceneId, setupId, [b], true));
  const setupPlan = setupPlanOf(records(), setupId)?.id ?? '';
  expect(records()[b]?.parentId).toBe(setupPlan);
  return { sceneId, setupId, roomId, a, b, setupPlan };
}

/** A set piece in a plan whose sort key is one keyBetween can't read, as an imported file may hold. */
async function oddSibling(planId: string): Promise<void> {
  await apply([{ kind: 'create', record: { id: crypto.randomUUID(), type: 'plan_item', parentId: planId, sortKey: ODD, props: { kind: 'icon', icon: 'set-art/table', x: 2, y: 1, width: 1.2, height: 0.8, rotation: 0 } } }]);
  expect(lastKeyUnder(records(), planId, 'plan_item')).toBe(ODD);
}

describe('a door put in a wall with a sibling’s key that can’t be read (6.22)', () => {
  it('is the key keyBetween itself throws on', () => {
    expect(() => keyBetween(ODD, null)).toThrow();
  });

  it('puts the door in a wall in the setup’s own plan, the changes apply, and the door sits in the wall', async () => {
    const { sceneId, setupId, b, setupPlan } = await walls();
    await oddSibling(setupPlan);
    const view = { sceneId, setupId };
    const spot = openingSpot(shownItems(records(), sceneId, setupId), { x: 0, y: 300 }, 'door', 0.5);
    expect(spot?.wallId).toBe(b);
    if (!spot) throw new Error('no spot');
    const door = crypto.randomUUID();
    const changes = placeOpeningChanges(records(), spot, 'door', door, view);
    expect(changes).toHaveLength(1);
    await apply(changes);
    expect(records()[door]?.parentId).toBe(setupPlan);
    expect(openingFields(records()[door]?.props ?? {})?.wallId).toBe(b);
    expect(shownItems(records(), sceneId, setupId).map((i) => i.record.id)).toContain(door);
    // After every key that can be read; the odd one keeps its own.
    const key = records()[door]?.sortKey ?? '';
    const readable = Object.values(records()).filter((r) => r.parentId === setupPlan && r.id !== door && r.sortKey !== ODD);
    for (const r of readable) expect(key > r.sortKey, r.id).toBe(true);
    expect(Object.values(records()).filter((r) => r.sortKey === ODD)).toHaveLength(1);
  });

  it('moves a room’s door dragged onto the setup-only wall into the setup’s plan, the changes apply', async () => {
    const { sceneId, setupId, a, b, roomId, setupPlan } = await walls();
    const spot = openingSpot(shownItems(records(), sceneId, setupId), { x: 0, y: 0 }, 'door', 0.5);
    expect(spot?.wallId).toBe(a);
    if (!spot) throw new Error('no spot');
    const door = crypto.randomUUID();
    await apply(placeOpeningChanges(records(), spot, 'door', door));
    expect(records()[door]?.parentId).toBe(roomId);
    await oddSibling(setupPlan);
    const view = { sceneId, setupId };
    const box = planCanvasItems(records(), sceneId, setupId, 'metres', '#16150F').find((i) => i.id === door);
    if (!box) throw new Error('no door');
    const changes = planGeometryChanges(records(), [{ id: door, x: box.x, y: box.y + 300, width: box.width, height: box.height, rotation: box.rotation }], shownWalls(shownItems(records(), sceneId, setupId)), view);
    expect(changes.map((c) => c.kind)).toEqual(['update', 'move']);
    await apply(changes);
    expect(records()[door]?.parentId).toBe(setupPlan);
    expect(openingFields(records()[door]?.props ?? {})?.wallId).toBe(b);
    expect(shownItems(records(), sceneId, setupId).map((i) => i.record.id)).toContain(door);
  });

  it('puts the door in a wall in the room plan with an odd key there too', async () => {
    const { sceneId, setupId, a, roomId } = await walls();
    await oddSibling(roomId);
    const spot = openingSpot(shownItems(records(), sceneId, setupId), { x: 0, y: 0 }, 'door', 0.5);
    if (!spot) throw new Error('no spot');
    const door = crypto.randomUUID();
    const changes = placeOpeningChanges(records(), spot, 'window', door, { sceneId, setupId });
    expect(changes).toHaveLength(1);
    await apply(changes);
    expect(records()[door]?.parentId).toBe(roomId);
    expect(openingFields(records()[door]?.props ?? {})?.wallId).toBe(a);
  });

  it('places a set piece, a grip item and a measure past an odd key too', async () => {
    const { sceneId, setupId, roomId, setupPlan } = await walls();
    await oddSibling(roomId);
    await oddSibling(setupPlan);
    const view = { sceneId, setupId };
    const sofa = placeIconChanges(records(), view, 'set-art/sofa', { x: 0, y: 1.5 });
    expect(sofa).toHaveLength(1);
    await apply(sofa);
    const stand = placeIconChanges(records(), view, 'grip/c-stand', { x: 1, y: 1.5 });
    expect(stand).toHaveLength(1);
    await apply(stand);
    const measures = drawMeasuresChanges(records(), sceneId, [{ x: -100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }]);
    expect(measures.ids).toHaveLength(2);
    await apply(measures.changes);
    expect(measures.ids.map((id) => records()[id]?.parentId)).toEqual([roomId, roomId]);
  });

  it('adds an underlay under a room with an odd key, the changes apply; a sound file’s key as before', async () => {
    const { sceneId, roomId } = await walls();
    const bytes = new Uint8Array(3000).map((_, i) => (i * 3) % 256);
    const picture = {
      image: {
        original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg' as const, width: 2000, height: 1000, colorSpace: 'srgb' as const },
        thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg' as const, width: 640, height: 320, longEdge: 640 },
      },
      source: { name: 'plan.jpg', path: folder.path('refs/plan.jpg') },
    };
    const sound = addUnderlayChanges(records(), sceneId, picture, { x: 0, y: 0 }, project.file.path);
    const made = sound.changes[0];
    expect(made?.kind === 'create' ? made.record.sortKey : null).toBe(keyBetween(lastKeyUnder(records(), roomId, 'plan_item'), null));
    await oddSibling(roomId);
    const added = addUnderlayChanges(records(), sceneId, picture, { x: 0, y: 0 }, project.file.path);
    expect(added.changes).toHaveLength(2);
    await store.getState().apply(added.changes, { alsoWrite: added.alsoWrite });
    expect(records()[added.id]?.parentId).toBe(roomId);
  });

  it('gives a normal file exactly the key it got before', async () => {
    const { sceneId, setupId, roomId, setupPlan } = await walls();
    const view = { sceneId, setupId };
    const inRoom = openingSpot(shownItems(records(), sceneId, setupId), { x: 0, y: 0 }, 'door', 0.5);
    const inSetup = openingSpot(shownItems(records(), sceneId, setupId), { x: 0, y: 300 }, 'door', 0.5);
    if (!inRoom || !inSetup) throw new Error('no spot');
    for (const [spot, planId] of [[inRoom, roomId], [inSetup, setupPlan]] as const) {
      const last = lastKeyUnder(records(), planId, 'plan_item');
      const [made] = placeOpeningChanges(records(), spot, 'door', crypto.randomUUID(), view);
      expect(made?.kind === 'create' ? made.record.sortKey : null).toBe(keyBetween(last, null));
    }
  });
});

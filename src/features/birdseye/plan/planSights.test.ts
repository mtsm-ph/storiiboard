import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { cameraFields, lightFields, shownItems, startRoomChanges, stopsAtWalls } from '../../../core/model/plan';
import { stopAtWallsChanges } from '../../../core/model/planLight';
import { nextPositionChanges } from '../../../core/model/planBlocking';
import { copySetupChanges } from '../../../core/model/planRooms';
import type { Sight } from '../../../core/model/planSightlines';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { cameraLooks } from './cameraLooks';
import { lightLooks } from './lightLooks';
import { blockingLooks } from './markLooks';
import { drawWallsChanges, openingProps, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView } from './planItems';
import { liveSights } from './liveSights';
import { localSight, sightsKeeper } from './planSights';
import type { CanvasItem, Geometry } from '../../../ui/canvas/types';

// Walls stop cones and beams (6.18): the switch's reader (absent is on), its op, its copies, and the plan's shapes cut
// by the room's walls and openings, worked out again only when what they read changed.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const apply = (changes: Parameters<ReturnType<typeof store.getState>['apply']>[0]) => store.getState().apply(changes);
const box = { x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0 };

/** SC 01 with two setups, its room started, a body for the cameras, and a frame on 35 mm in the first setup. */
async function scene() {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  await apply([
    { kind: 'create', record: { id: 'body', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'Sony FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20 } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: otherId, type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
  ]);
  await apply(startRoomChanges(records(), project.projectId, sceneId));
  return { sceneId, setupId, otherId, view: { sceneId, setupId } };
}

async function place(view: { sceneId: string; setupId: string | null }, icon: string, centre: { x: number; y: number }, set: Record<string, number | boolean | string> = {}) {
  const id = crypto.randomUUID();
  await apply(placeIconChanges(records(), view, icon, centre, id));
  if (Object.keys(set).length > 0) await apply([{ kind: 'update', id, set }]);
  return id;
}

/** The view's shapes as the plan works them out. */
function sightsOf(view: { sceneId: string; setupId: string }, keep = sightsKeeper()) {
  const shown = shownItems(records(), view.sceneId, view.setupId);
  return keep(shown, shown, cameraLooks(records(), shown, 'metres', []), lightLooks(records(), shown, 'metres', []), blockingLooks(records(), view, shown, 'metres', []).marks);
}

describe('Stop at walls, as stored (6.18)', () => {
  it('reads as on when absent, off only for a stored false', () => {
    expect(stopsAtWalls(cameraFields({ kind: 'camera', ...box }) ?? {})).toBe(true);
    expect(stopsAtWalls(cameraFields({ kind: 'camera', ...box, stop_at_walls: false }) ?? {})).toBe(false);
    expect(stopsAtWalls(cameraFields({ kind: 'camera', ...box, stop_at_walls: true }) ?? {})).toBe(true);
    expect(stopsAtWalls(cameraFields({ kind: 'camera', ...box, stop_at_walls: 'false' }) ?? {})).toBe(true);
    expect(stopsAtWalls(lightFields({ kind: 'light', ...box }) ?? {})).toBe(true);
    expect(stopsAtWalls(lightFields({ kind: 'light', ...box, stop_at_walls: false }) ?? {})).toBe(false);
    // An older file's camera reads exactly as before: no new field while it is on.
    expect(cameraFields({ kind: 'camera', ...box })).not.toHaveProperty('stopAtWalls');
  });

  it('is written only as false, one op, and turned back on by taking the prop off', async () => {
    const { view } = await scene();
    const camera = await place(view, 'camera/camera', { x: 0, y: 0 });
    const light = await place(view, 'lighting/fresnel', { x: 1, y: 0 });
    expect(stopAtWallsChanges(records(), [camera, light], true)).toEqual([]);
    const off = stopAtWallsChanges(records(), [camera, light], false);
    expect(off).toEqual([
      { kind: 'update', id: camera, set: { stop_at_walls: false } },
      { kind: 'update', id: light, set: { stop_at_walls: false } },
    ]);
    await apply(off);
    expect(records()[camera]?.props.stop_at_walls).toBe(false);
    expect(stopAtWallsChanges(records(), [camera], true)).toEqual([{ kind: 'update', id: camera, unset: ['stop_at_walls'] }]);
    // Undo brings it back on.
    await store.getState().undo();
    expect(records()[camera]?.props).not.toHaveProperty('stop_at_walls');
    // A flag has no such switch.
    const flag = await place(view, 'grip/flag', { x: 2, y: 0 });
    expect(stopAtWallsChanges(records(), [flag], false)).toEqual([]);
  });

  it('is copied by copy and paste, and by a new setup from another’s state', async () => {
    const { sceneId, setupId, otherId, view } = await scene();
    const camera = await place(view, 'camera/camera', { x: 0, y: 0 }, { stop_at_walls: false });
    const light = await place(view, 'lighting/fresnel', { x: 1, y: 0 }, { stop_at_walls: false });
    const pasted = planPasteInView(records(), view, planClipOf(records(), [camera, light]), null);
    await apply(pasted.changes);
    expect(pasted.ids.map((id) => records()[id]?.props.stop_at_walls)).toEqual([false, false]);
    await apply(copySetupChanges(records(), setupId, otherId));
    const copied = shownItems(records(), sceneId, otherId).filter((i) => i.level === 'setup');
    expect(copied.length).toBeGreaterThanOrEqual(2);
    expect(copied.every((i) => i.record.props.stop_at_walls === false)).toBe(true);
  });
});

describe('the plan’s shapes (6.18)', () => {
  /** A camera at (0, 1) facing up on a 35 mm frame, and a wall across at y = -1 from x = -5 to 5 (face at -0.95). */
  async function walled() {
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 1 }, { body_id: 'body', lens_mm: 35 });
    const light = await place(s.view, 'lighting/fresnel', { x: 3, y: 1 });
    const wall = drawWallsChanges(records(), s.sceneId, [
      { x: -500, y: -100 },
      { x: 500, y: -100 },
    ]);
    await apply(wall.changes);
    return { ...s, camera, light, wallId: wall.ids[0] ?? '' };
  }

  it('cuts a camera’s cone and a light’s beam at the wall, and passes a door', async () => {
    const { view, camera, light, wallId } = await walled();
    const cut = sightsOf(view);
    const cone = cut.get(camera) as Sight;
    expect(cone.cut).toBe(true);
    for (const p of cone.points.slice(1)) expect(p.y).toBeGreaterThan(-0.95 - 0.002);
    expect(cut.get(light)?.cut).toBe(true);
    // A door in the middle: the cone goes through it, 6 m out at most.
    const roomId = records()[wallId]?.parentId ?? '';
    await apply([{ kind: 'create', record: { id: 'door', type: 'plan_item', parentId: roomId, sortKey: 'z', props: openingProps('door', wallId, 5) } }]);
    const through = sightsOf(view).get(camera) as Sight;
    expect(Math.min(...through.points.map((p) => p.y))).toBeLessThan(-3);
  });

  it('draws a camera whose switch is off as it always was', async () => {
    const { view, camera } = await walled();
    await apply(stopAtWallsChanges(records(), [camera], false));
    expect(sightsOf(view).get(camera)?.cut).toBe(false);
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const sights = sightsOf(view);
    const looks = cameraLooks(records(), shown, 'metres', []);
    const items = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lightLooks(records(), shown, 'metres', []), undefined, undefined, undefined, undefined, sights);
    const plain = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lightLooks(records(), shown, 'metres', []));
    // The same item as with no shapes at all: its whole cone.
    const draw = (list: typeof items) => JSON.stringify(list.find((i) => i.id === camera)?.beyond?.draw({ width: 40, height: 40, zoom: 1, rotation: 0, colours: { ink: '#000', paper: '#fff', raised: '#eee' }, inView: true }));
    expect(draw(items)).toBe(draw(plain));
  });

  it('works a shape out again only when what it reads changed', async () => {
    const { view, camera, light, sceneId } = await walled();
    const keep = sightsKeeper();
    const first = sightsOf(view, keep);
    // An edit elsewhere (a frame's name): the same shapes.
    await apply([{ kind: 'update', id: sceneId, set: { name: 'Diner, night' } }]);
    const again = sightsOf(view, keep);
    expect(again.get(camera)).toBe(first.get(camera));
    expect(again.get(light)).toBe(first.get(light));
    // The light turned: its shape again, the camera's kept.
    await apply([{ kind: 'update', id: light, set: { rotation: 90 } }]);
    const turned = sightsOf(view, keep);
    expect(turned.get(camera)).toBe(first.get(camera));
    expect(turned.get(light)).not.toBe(first.get(light));
  });

  it('cuts a camera move’s later positions by the same walls, with the camera’s one switch (6.18 review, item 6)', async () => {
    // The camera at (0, 1) facing up, its next position 3 m right at (3, 1), facing up as it does: the wall across at
    // y = -1 (face -0.95) cuts both cones there. The camera's Stop at walls off: both whole.
    const { view, camera } = await walled();
    const ghost = crypto.randomUUID();
    await apply(nextPositionChanges(records(), view, camera, { width: 0.4, depth: 0.4 }, { x: 3, y: 1 }, ghost));
    const cut = sightsOf(view).get(ghost) as Sight;
    expect(cut.cut).toBe(true);
    expect(Math.min(...cut.points.map((p) => p.y))).toBeGreaterThan(-0.95 - 0.002);
    expect(cut.points.every((p) => p.x > 0)).toBe(true);
    await apply(stopAtWallsChanges(records(), [camera], false));
    expect(sightsOf(view).get(ghost)?.cut).toBe(false);
    expect(sightsOf(view).get(camera)?.cut).toBe(false);
  });

  it('puts the cut shape in the item’s own box, turned back by its rotation', () => {
    // A camera at (1, 1) turned 90° (facing right), a wall 1 m to its right: in its own 40 × 40 box (cm) the shape points
    // up from the box's middle (20, 20) and ends 95 cm up (the wall's face 0.95 m away).
    const sight: Sight = {
      apex: { x: 1, y: 1 },
      points: [
        { x: 1, y: 1 },
        { x: 1.95, y: 0.5 },
        { x: 1.95, y: 1.5 },
      ],
      edges: ['side', 'wall', 'side'],
      cut: true,
      ring: false,
      empty: false,
      reach: [0, 1.07, 1.07],
    };
    const local = localSight(sight, { width: 40, height: 40, rotation: 90 }, 'cone');
    const round = (v: number[]) => v.map((n) => Math.round(n * 1000) / 1000);
    expect(round(local?.fill ?? [])).toEqual([20, 20, -30, -75, 70, -75]);
    // Its sides are drawn, the wall's edge not.
    expect(local?.strokes.map(round)).toEqual([
      [20, 20, -30, -75],
      [70, -75, 20, 20],
    ]);
    expect(localSight({ ...sight, cut: false }, { width: 40, height: 40, rotation: 90 }, 'cone')).toBeNull();
  });
});

describe('the cut while a gesture is under way (6.18 review, item 3)', () => {
  /** As above: a camera at (0, 1) facing up on a 35 mm frame, a fresnel at (3, 1), a wall across at y = -1 (face -0.95). */
  async function walled() {
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 1 }, { body_id: 'body', lens_mm: 35 });
    const light = await place(s.view, 'lighting/fresnel', { x: 3, y: 1 });
    const wall = drawWallsChanges(records(), s.sceneId, [
      { x: -500, y: -100 },
      { x: 500, y: -100 },
    ]);
    await apply(wall.changes);
    return { ...s, camera, light, wallId: wall.ids[0] ?? '' };
  }

  /** The view drawn as the plan draws it, and its live remake, with what it last published. */
  function drawn(view: { sceneId: string; setupId: string }) {
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    const lights = lightLooks(records(), shown, 'metres', []);
    const marks = blockingLooks(records(), view, shown, 'metres', []);
    const sights = sightsKeeper()(shown, shown, looks, lights, marks.marks);
    const built = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lights, undefined, marks, undefined, undefined, sights);
    const said: (string | null)[] = [];
    const remake = liveSights({ blocking: shown, items: shown, built, looks, lights, marks }, (summaries) => said.push(summaries));
    return { built, remake, said, sights };
  }
  const geometryOf = (item: CanvasItem | undefined): Geometry => ({ x: item?.x ?? 0, y: item?.y ?? 0, width: item?.width ?? 0, height: item?.height ?? 0, rotation: item?.rotation ?? 0 });
  const summary = (said: (string | null)[], id: string) => (JSON.parse(said.at(-1) ?? '{}') as Record<string, { cut: boolean; box: { minY: number } | null }>)[id];

  it('cuts a camera dragged toward a wall where the drag has it, and draws nothing anew for no gesture', async () => {
    // The camera at (0, 1) facing up and the wall across at y = -1, its cone cut at the face (-0.95, read 1 mm in: -0.951).
    // Dragged 2 m down (to y = 3): 3.95 m from the face, inside its cone's 6 cos 27° = 5.35 m, so still cut there.
    const { view, camera } = await walled();
    const { built, remake, said } = drawn(view);
    const was = built.find((item) => item.id === camera);
    const g = geometryOf(was);
    const live = remake(new Map([[camera, { ...g, y: g.y + 200 }]]));
    const made = live.get(camera);
    expect(made?.beyond).toBeDefined();
    expect(made?.beyond).not.toBe(was?.beyond);
    // Its own geometry as built: the canvas puts it where the drag has it.
    expect(geometryOf(made)).toEqual(g);
    expect(summary(said, camera)?.cut).toBe(true);
    expect(summary(said, camera)?.box?.minY).toBeCloseTo(-0.951, 3);
    // No gesture: nothing drawn anew, and the live shapes taken off.
    expect(remake(null).size).toBe(0);
    expect(said.at(-1)).toBeNull();
  });

  it('cuts a still camera by a wall dragged across it, and leaves out what no moving wall meets', async () => {
    // The wall dragged 3 m up (to y = -4, face -3.95): the camera's cone, 4.95 m to it from y = 1, inside its 5.35 m, is
    // cut there. The fresnel at (3, 1) faces up, its 4 m beam reaching y = -3, short of the wall where it is now, but cut
    // where the wall was: made again too, now whole.
    const { view, camera, light, wallId } = await walled();
    const { built, remake, said } = drawn(view);
    const g = geometryOf(built.find((item) => item.id === wallId));
    const live = remake(new Map([[wallId, { ...g, y: g.y - 300 }]]));
    expect(live.has(camera)).toBe(true);
    expect(summary(said, camera)?.cut).toBe(true);
    expect(summary(said, camera)?.box?.minY).toBeCloseTo(-3.951, 3);
    expect(live.has(light)).toBe(true);
    expect(summary(said, light)?.cut).toBe(false);
    // The wall itself is drawn by the canvas from the drag: not remade here.
    expect(live.has(wallId)).toBe(false);
  });

  it('draws nothing anew for a drag of items that neither block nor have a cone', async () => {
    const { view } = await walled();
    const chair = await place(view, 'set-art/chair', { x: 8, y: 8 });
    const { built, remake, said } = drawn(view);
    const g = geometryOf(built.find((item) => item.id === chair));
    expect(remake(new Map([[chair, { ...g, x: g.x + 50 }]])).size).toBe(0);
    expect(said.at(-1)).toBeNull();
  });
});

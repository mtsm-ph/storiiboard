import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { cameraFields, lightFields, recordsIndexed, shownItems, startRoomChanges, stopsAtWalls, wallBetween, wallProps } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { stopAtWallsChanges } from '../../../core/model/planLight';
import { nextPositionChanges } from '../../../core/model/planBlocking';
import { copySetupChanges } from '../../../core/model/planRooms';
import { sightline, wallBlocker, type Sight } from '../../../core/model/planSightlines';
import type { ReactElement } from 'react';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { cameraLooks } from './cameraLooks';
import { lightLooks } from './lightLooks';
import { blockingLooks } from './markLooks';
import { drawWallsChanges, openingProps, placeIconChanges, planClipOf, planGeometryChanges, planItemsBuilder, planPasteInView, shownWalls } from './planItems';
import { liveSights } from './liveSights';
import { glowBand, localSight, sightsKeeper, sightSummary, type LocalSight } from './planSights';
import type { CanvasItem, Geometry, LiveBy } from '../../../ui/canvas/types';

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
    const maker = liveSights({ records: records(), view, blocking: shown, items: shown, built, looks, lights, marks });
    // What the canvas would publish once it drew each remake (the plan's onLiveDrawn), as JSON.
    const remake = (live: ReadonlyMap<string, Geometry> | null, by: LiveBy = 'drag') => {
      const out = maker.items(live, by);
      const summaries = maker.summaries(out.size > 0 ? out : null);
      said.push(summaries === null ? null : JSON.stringify(summaries));
      return out;
    };
    return { built, remake, said, sights, shown };
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

describe('mid-gesture is what the drop writes (6.18 second review, item 1)', () => {
  /**
   * The review's example: a wall from (-5, -3) to (5, -3), 0.1 m thick, a 0.9 m door centred 5 m along it (x -0.45 to
   * 0.45), and a camera at (0, 0) facing up on 35 mm (about 54°: at the face, 2.95 m up, ±1.50 m).
   */
  async function doorway() {
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 0 }, { body_id: 'body', lens_mm: 35 });
    const wall = drawWallsChanges(records(), s.sceneId, [
      { x: -500, y: -300 },
      { x: 500, y: -300 },
    ]);
    await apply(wall.changes);
    const wallId = wall.ids[0] ?? '';
    await apply([{ kind: 'create', record: { id: 'door', type: 'plan_item', parentId: records()[wallId]?.parentId ?? '', sortKey: 'z', props: openingProps('door', wallId, 5) } }]);
    return { ...s, camera, wallId };
  }

  /** The canvas items for the view now. */
  function builtNow(view: { sceneId: string; setupId: string }) {
    const shown = shownItems(records(), view.sceneId, view.setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    const lights = lightLooks(records(), shown, 'metres', []);
    const marks = blockingLooks(records(), view, shown, 'metres', []);
    const built = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lights, undefined, marks, undefined, undefined, sightsKeeper()(shown, shown, looks, lights, marks.marks));
    return { shown, looks, lights, marks, built };
  }

  /** The camera's shape mid-gesture (its summary), and its shape from the records once the drop's edit is written. */
  async function liveThenDropped(view: { sceneId: string; setupId: string }, camera: string, live: ReadonlyMap<string, Geometry>, by: LiveBy) {
    const { shown, looks, lights, marks, built } = builtNow(view);
    const maker = liveSights({ records: records(), view, blocking: shown, items: shown, built, looks, lights, marks });
    const made = maker.items(live, by);
    const during = maker.summaries(made.size > 0 ? made : null)?.[camera] ?? null;
    // The drop, as the plan writes it (planActions: the view's walls, the view).
    await apply(planGeometryChanges(records(), [...live].map(([id, g]) => ({ id, ...g })), shownWalls(shownItems(records(), view.sceneId, view.setupId)), view));
    const after = sightSummary(sightsOf(view).get(camera));
    return { during, after };
  }

  /** An item's box as the canvas has it (canvas units: cm). */
  const boxOf = (view: { sceneId: string; setupId: string }, id: string): Geometry => {
    const item = builtNow(view).built.find((i) => i.id === id);
    if (!item) throw new Error('no item');
    return { x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation };
  };

  it('a wall resized from its start keeps its door where it is in the room, mid-gesture as at the drop', async () => {
    // Its start dragged 2 m right by the handles: the wall from -3 to 5, the door's distance along it 5 - 2 = 3, so the gap
    // stays at x -0.45 to 0.45 and the cone carries on through it, past y = -4. Taken as the box alone, the gap would have
    // moved to x 1.55 to 2.45, out of the cone, and the cone ended at the wall.
    const { view, camera, wallId } = await doorway();
    const g = boxOf(view, wallId);
    const { during, after } = await liveThenDropped(view, camera, new Map([[wallId, { ...g, x: g.x + 200, width: g.width - 200 }]]), 'handles');
    expect(records().door?.props.along_m).toBeCloseTo(3, 6);
    expect(during?.box?.minY).toBeLessThan(-4);
    expect(during).toEqual(after);
  });

  it('a wall shortened from its end past its door is held at the length the door needs, mid-gesture as at the drop', async () => {
    // Its end dragged 5.2 m left (to x = -0.2): the door needs 5.45 m, so the wall is held from -5 to 0.45, the gap at its
    // very end.
    const { view, camera, wallId } = await doorway();
    const g = boxOf(view, wallId);
    const { during, after } = await liveThenDropped(view, camera, new Map([[wallId, { ...g, width: g.width - 520 }]]), 'handles');
    expect(Number(records()[wallId]?.props.width)).toBeCloseTo(5.45, 6);
    expect(during?.cut).toBe(true);
    expect(during).toEqual(after);
  });

  it('a wall with a door turned by its handles, mid-gesture as at the drop', async () => {
    // Turned 20° about its middle (0, -3): the door turns with it, its gap still about the middle.
    const { view, camera, wallId } = await doorway();
    const g = boxOf(view, wallId);
    const { during, after } = await liveThenDropped(view, camera, new Map([[wallId, { ...g, rotation: 20 }]]), 'handles');
    expect(Number(records()[wallId]?.props.rotation)).toBeCloseTo(20, 6);
    expect(during?.cut).toBe(true);
    expect(during).toEqual(after);
  });

  it('a door dragged alone along its wall lands where the drop puts it, mid-gesture as at the drop', async () => {
    // The door's box dragged 1 m right: it lands 6 m along, its gap at x 0.55 to 1.45, and the cone's strip moves with it.
    const { view, camera } = await doorway();
    const g = boxOf(view, 'door');
    const { during, after } = await liveThenDropped(view, camera, new Map([['door', { ...g, x: g.x + 100 }]]), 'drag');
    expect(records().door?.props.along_m).toBeCloseTo(6, 4);
    expect(during?.box?.minY).toBeLessThan(-4);
    expect(during).toEqual(after);
  });
});

describe('a cut drawn while a resize is being written (6.18 second review, item 4)', () => {
  it('is put in the box the draft gives the item, its apex at the box’s middle', async () => {
    // The camera at (0, 1) under the wall across at y = -1, grown by its handles by 20 cm each way about its middle. Until
    // the edit is written the canvas draws it from the draft: the cut shape's first corner, its apex, is at the middle of
    // the draft's box. Under the handles themselves the item keeps its built box, and the apex is at that one's middle.
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 1 }, { body_id: 'body', lens_mm: 35 });
    await apply(
      drawWallsChanges(records(), s.sceneId, [
        { x: -500, y: -100 },
        { x: 500, y: -100 },
      ]).changes,
    );
    const shown = shownItems(records(), s.sceneId, s.setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    const lights = lightLooks(records(), shown, 'metres', []);
    const marks = blockingLooks(records(), s.view, shown, 'metres', []);
    const built = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lights, undefined, marks, undefined, undefined, sightsKeeper()(shown, shown, looks, lights, marks.marks));
    const was = built.find((item) => item.id === camera);
    if (!was) throw new Error('no camera');
    const grown = { x: was.x - 10, y: was.y - 10, width: was.width + 20, height: was.height + 20, rotation: 0 };
    const maker = liveSights({ records: records(), view: s.view, blocking: shown, items: shown, built, looks, lights, marks });
    const apexOf = (by: LiveBy) => {
      const made = maker.items(new Map([[camera, grown]]), by).get(camera);
      const drawn = made?.beyond?.draw({ width: grown.width, height: grown.height, zoom: 1, rotation: 0, colours: { ink: '#000', paper: '#fff', raised: '#eee' }, inView: true }) as ReactElement<{ cut: LocalSight | null }>;
      return drawn.props.cut?.fill.slice(0, 2).map((n) => Math.round(n * 1000) / 1000);
    };
    const middle = (w: number, h: number) => [Math.round((w / 2) * 1000) / 1000, Math.round((h / 2) * 1000) / 1000];
    expect(apexOf('drag')).toEqual(middle(grown.width, grown.height));
    expect(apexOf('handles')).toEqual(middle(was.width, was.height));
  });
});

describe('an all-round light’s glow on paper (6.18 second review, item 2)', () => {
  // A light at the origin shining all round, 4 m, and a long wall across at y = -2: its face at -1.95, read 1 mm in at
  // -1.951. A band of radius r under 1.951 meets no wall: a whole circle. One of 3 m is cut flat at the face where the
  // circle passes it (x within ±√(9 - 1.951²) = ±2.274) and is the circle elsewhere.
  const lit = () => sightline({ apex: { x: 0, y: 0 }, facing: 0, degrees: 360, length: 4, far: 'arc' }, [wallBlocker('w', { kind: 'wall', x: -50, y: -2.05, width: 100, height: 0.1, rotation: 0, heightM: null, name: '' }, [])]);

  it('a band clear of the wall is the whole circle', () => {
    const band = glowBand(lit(), 1);
    for (const p of band) expect(Math.abs(Math.hypot(p.x, p.y) - 1)).toBeLessThan(1e-9);
    // Its 180 2° chords hold 180 × ½ × sin 2° = 3.1409, within 1% of π.
    expect(Math.abs(shoelace(band) - Math.PI) / Math.PI).toBeLessThan(0.01);
  });

  it('a band past the wall is cut flat at its face and whole elsewhere', () => {
    const band = glowBand(lit(), 3);
    for (const p of band) expect(p.y).toBeGreaterThan(-1.951 - 1e-6);
    const flat = band.filter((p) => Math.abs(p.y + 1.951) < 1e-6);
    expect(Math.max(...flat.map((p) => Math.abs(p.x)))).toBeCloseTo(Math.sqrt(9 - 1.951 ** 2), 6);
    for (const p of band.filter((q) => q.y > -1.95)) expect(Math.abs(Math.hypot(p.x, p.y) - 3)).toBeLessThan(1e-9);
  });

  it('prints its 8 bands from these, never the shape’s corners brought in', () => {
    const local = localSight(lit(), { width: 40, height: 40, rotation: 0 }, 'beam');
    const bands = local?.bands() ?? [];
    expect(bands).toHaveLength(8);
    // The second smallest, 1 m: every point 100 cm from the box's middle (20, 20).
    const second = bands[6] ?? [];
    expect(second.length).toBeGreaterThan(300);
    for (let i = 0; i < second.length; i += 2) expect(Math.abs(Math.hypot((second[i] ?? 0) - 20, (second[i + 1] ?? 0) - 20) - 100)).toBeLessThan(1e-6);
  });
});

/** The shoelace area of a ring of points. */
function shoelace(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i] as { x: number; y: number };
    const q = points[(i + 1) % points.length] as { x: number; y: number };
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

describe('the live cut, read cheaply and safely (6.18 last review)', () => {
  /** The view's live remake made from these records (a proxy, to count what reads them). */
  function makerOver(recs: Readonly<Record<string, SbdRecord>>, view: { sceneId: string; setupId: string }) {
    const shown = shownItems(recs, view.sceneId, view.setupId);
    const looks = cameraLooks(recs, shown, 'metres', []);
    const lights = lightLooks(recs, shown, 'metres', []);
    const marks = blockingLooks(recs, view, shown, 'metres', []);
    const built = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lights, undefined, marks, undefined, undefined, sightsKeeper()(shown, shown, looks, lights, marks.marks));
    return { shown, built, maker: liveSights({ records: recs, view, blocking: shown, items: shown, built, looks, lights, marks }) };
  }

  it('reads the project’s records once at most for 90 moves of 40 walls, however many records it has', async () => {
    // 40 walls in a run across the room, a camera and a light facing them, and 2,000 strokes under a frame (a sketched
    // storyboard's): every move of the 40 walls together asks the drop's geometry for all of them, and reads the records'
    // list (Object.values: the proxy's ownKeys) no more than once over the 90.
    const s = await scene();
    await place(s.view, 'camera/camera', { x: 0, y: 3 }, { body_id: 'body', lens_mm: 35 });
    await place(s.view, 'lighting/fresnel', { x: 4, y: 3 });
    const run = Array.from({ length: 41 }, (_, i) => ({ x: -1000 + i * 50, y: i % 2 === 0 ? -100 : -150 }));
    const walls = drawWallsChanges(records(), s.sceneId, run);
    await apply(walls.changes);
    await apply([{ kind: 'create', record: { id: 'door', type: 'plan_item', parentId: records()[walls.ids[20] ?? '']?.parentId ?? '', sortKey: 'z', props: openingProps('door', walls.ids[20] ?? '', 0.26) } }]);
    await apply([{ kind: 'create', record: { id: 'frame', type: 'shot', parentId: s.sceneId, sortKey: 'm', props: { number: '1A' } } }]);
    await apply(Array.from({ length: 2000 }, (_, i) => ({ kind: 'create' as const, record: { id: `k${String(i)}`, type: 'stroke' as const, parentId: 'frame', sortKey: `a${String(i).padStart(4, '1')}`, props: { tool: 'pen', points: [0, 0, 1, 1], width: 0.004 } } })));
    expect(walls.ids).toHaveLength(40);
    let reads = 0;
    const counted = new Proxy(records(), {
      ownKeys: (target) => {
        reads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const { built, maker } = makerOver(counted, s.view);
    const boxes = new Map(built.map((item) => [item.id, item]));
    reads = 0;
    const indexed = recordsIndexed();
    for (let step = 1; step <= 90; step += 1) {
      const live = new Map(
        walls.ids.map((id) => {
          const b = boxes.get(id);
          return [id, { x: (b?.x ?? 0) + step, y: (b?.y ?? 0) - step, width: b?.width ?? 0, height: b?.height ?? 0, rotation: b?.rotation ?? 0 }] as const;
        }),
      );
      expect(maker.items(live, 'drag').size).toBeGreaterThan(0);
    }
    expect(reads).toBeLessThanOrEqual(1);
    expect(recordsIndexed() - indexed).toBeLessThanOrEqual(1);
  });

  it('never works out a sort key mid-gesture, so a key it can’t read throws nothing there', async () => {
    // A door in the room's wall across at y = -3 (x -0.45 to 0.45), and a wall at y = -6 placed in this setup only, in a
    // setup plan whose items' last sort key "~~" isn't one (an imported file's). The door dragged 3 m up lands on that
    // wall: the drop would carry it into the setup's plan, after its last key, and reading "~~" throws there. Mid-gesture
    // only where it lands is worked out: no throw, and the camera's cone, at (0, 0) facing up, is cut by the room's wall,
    // now without a door, at -2.95.
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 0 }, { body_id: 'body', lens_mm: 35 });
    const across = drawWallsChanges(records(), s.sceneId, [
      { x: -500, y: -300 },
      { x: 500, y: -300 },
    ]);
    await apply(across.changes);
    const wallId = across.ids[0] ?? '';
    // The setup's own plan, which placing the camera made.
    const setupPlan = records()[camera]?.parentId ?? '';
    await apply([
      { kind: 'create', record: { id: 'door', type: 'plan_item', parentId: records()[wallId]?.parentId ?? '', sortKey: 'z', props: openingProps('door', wallId, 5) } },
      { kind: 'create', record: { id: 'own', type: 'plan_item', parentId: setupPlan, sortKey: '~~', props: wallProps(wallBetween({ x: -5, y: -6 }, { x: 5, y: -6 })) } },
    ]);
    expect(records()[setupPlan]?.props.kind).toBe('setup');
    const { built, maker } = makerOver(records(), s.view);
    const door = built.find((item) => item.id === 'door');
    if (!door) throw new Error('no door');
    const live = new Map([['door', { x: door.x, y: door.y - 300, width: door.width, height: door.height, rotation: door.rotation }]]);
    expect(() => planGeometryChanges(records(), [{ id: 'door', ...(live.get('door') as Geometry) }], shownWalls(shownItems(records(), s.sceneId, s.setupId)), s.view)).toThrow(/sort key/);
    const made = maker.items(live, 'drag');
    const summary = maker.summaries(made)?.[camera];
    expect(summary?.cut).toBe(true);
    expect(summary?.box?.minY).toBeCloseTo(-2.951, 3);
  });

  it('prints no glow into the wall a light stands on the end of', () => {
    // The wall from (0, 0) to (5, 0), 0.1 m thick; a china ball (all round, 4 m) on its end, (0, 0), in the wall's middle:
    // it stands on that end, and the wall stops every ray into its body, so the shape lies on the left, x ≤ 0. A print band
    // of 2 m is that half circle, area ½ π 2² = 6.283, less the slivers its 2° steps leave either side of straight up and
    // down, where the rays turn from leaving by the wall's end to being stopped in its body (a few per cent, never more);
    // before, each ray into the right met nothing past the apex and took the band's radius (points such as (1.41, ±1.41)).
    const s = sightline({ apex: { x: 0, y: 0 }, facing: 0, degrees: 360, length: 4, far: 'arc' }, [wallBlocker('w', { kind: 'wall', x: 0, y: -0.05, width: 5, height: 0.1, rotation: 0, heightM: null, name: '' }, [])]);
    expect(s.empty).toBe(false);
    for (const p of s.points) expect(p.x).toBeLessThan(1e-3);
    const band = glowBand(s, 2);
    for (const p of band) expect(p.x).toBeLessThan(1e-3);
    expect(shoelace(band)).toBeLessThanOrEqual(2 * Math.PI * 1.001);
    expect(shoelace(band)).toBeGreaterThan(2 * Math.PI * 0.95);
  });
});

describe('the live cut, only where it is seen (6.18 last review)', () => {
  it('leaves a still item whose drawing is out of view as it is, and remakes the one in view', async () => {
    // The camera at (0, 1) under the wall across at y = -1; the wall dragged 1 m up. With the view far off (100 m away) the
    // camera's cone is out of it and is not drawn anew mid-drag; with the view over it, it is.
    const s = await scene();
    const camera = await place(s.view, 'camera/camera', { x: 0, y: 1 }, { body_id: 'body', lens_mm: 35 });
    const wall = drawWallsChanges(records(), s.sceneId, [
      { x: -500, y: -100 },
      { x: 500, y: -100 },
    ]);
    await apply(wall.changes);
    const shown = shownItems(records(), s.sceneId, s.setupId);
    const looks = cameraLooks(records(), shown, 'metres', []);
    const lights = lightLooks(records(), shown, 'metres', []);
    const marks = blockingLooks(records(), s.view, shown, 'metres', []);
    const built = planItemsBuilder()(shown, 'metres', '#000', 'en', looks, lights, undefined, marks, undefined, undefined, sightsKeeper()(shown, shown, looks, lights, marks.marks));
    const maker = liveSights({ records: records(), view: s.view, blocking: shown, items: shown, built, looks, lights, marks });
    const w = built.find((item) => item.id === wall.ids[0]);
    if (!w) throw new Error('no wall');
    const live = new Map([[w.id, { x: w.x, y: w.y - 100, width: w.width, height: w.height, rotation: w.rotation }]]);
    expect(maker.items(live, 'drag', { x: 10000, y: 10000, width: 800, height: 600 }).has(camera)).toBe(false);
    expect(maker.items(live, 'drag', { x: -400, y: -300, width: 800, height: 600 }).has(camera)).toBe(true);
  });
});

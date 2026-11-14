import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planUnitFor } from '../../../app/planUnits';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale, t } from '../../../core/i18n';
import { openingFields, planItemFields, sceneRoomId, shownItems, startRoomChanges, trashPlanChanges, wallBetween, wallEnds, wallProps, wallsAlong } from '../../../core/model/plan';
import { separateCopyChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { log, loadRecords, purgeIds, trashedRoots } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../../core/storage/project';
import { noticeStore } from '../../../app/notice';
import { normalisedRotation, tidy } from '../../../ui/canvas/placement';
import { drawWalls } from './planActions';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../../trash/trash';
import { SCALE_BAR_PIXELS, scaleBarLength } from '../../../ui/canvas/scale';
import {
  drawWallsChanges,
  flipDoorsChanges,
  openingDistances,
  openingPatchChanges,
  openingSpot,
  openingSpotInWall,
  placeOpeningChanges,
  planCanvasItems,
  planClipOf,
  planConstrain,
  planGeometryChanges,
  planItemsBuilder,
  planNudgeChanges,
  planPasteChanges,
  reorderPlanChanges,
  shownItemsKeeper,
  shownWalls,
  trashPlanItemsChanges,
  wallNeedOf,
  wallPatchChanges,
  wallsTakeLength,
} from './planItems';
import { PLAN_ZOOM, planScale, toCanvas, toMetres } from './planScale';
import { wallOutline } from './wallShape';

// The plan host (6.2a): metres to canvas units and back, the scale the canvas is given in each unit, walls drawn with
// clean corners, and every edit as one op group that one undo takes back, in the Trash and back; the units setting.

describe('canvas units', () => {
  it('are centimetres, never stored', () => {
    expect(toCanvas(3.5)).toBe(350);
    expect(toMetres(350)).toBe(3.5);
    expect(toMetres(toCanvas(3.8125))).toBe(3.8125);
  });

  it('read and write lengths in the unit shown, and grid by 0.5 m or 1 ft', () => {
    const metres = planScale('metres');
    const feet = planScale('feet');
    expect(metres.format(350)).toBe('3.50 m');
    expect(feet.format(381)).toBe('12\' 6"');
    expect(metres.parse('12\' 6"')).toBe(381);
    expect(feet.parse('10')).toBe(304.8);
    expect(metres.parse('wall')).toBeNull();
    expect(metres.grid).toEqual({ step: 50, major: 2, fine: 5 });
    expect(feet.grid.step).toBeCloseTo(30.48, 6);
    expect(feet.grid.major).toBe(5);
    expect(metres.label(100)).toBe('1 m');
    expect(feet.label(304.8)).toBe('10 ft');
  });

  it('always has a scale bar that fits its box, from the closest zoom to the furthest, in both units', () => {
    for (const unit of ['metres', 'feet'] as const) {
      const { rounds, label } = planScale(unit);
      for (const zoom of [PLAN_ZOOM.max, 10, 4, 1, 0.1, PLAN_ZOOM.min]) {
        const bar = scaleBarLength(zoom, rounds);
        expect(bar * zoom).toBeLessThanOrEqual(SCALE_BAR_PIXELS);
        expect(bar * zoom).toBeGreaterThan(SCALE_BAR_PIXELS / 4);
      }
      // Up close: 5 cm, or 2 inches.
      expect(label(scaleBarLength(PLAN_ZOOM.max, rounds))).toBe(unit === 'metres' ? '0.05 m' : '2 in');
    }
  });
});

describe('the units setting', () => {
  it('follows the region, or what Settings → App sets', () => {
    expect(planUnitFor('region', 'en-US')).toBe('feet');
    expect(planUnitFor('region', 'es-MX')).toBe('metres');
    expect(planUnitFor('region', null)).toBe('metres');
    expect(planUnitFor('metres', 'en-US')).toBe('metres');
    expect(planUnitFor('feet', 'en-GB')).toBe('feet');
  });

  it('is kept on this computer, and an unknown value reads as by region', () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(loadSettings(storage).planUnits).toBe('region');
    saveSettings({ planUnits: 'feet' }, storage);
    expect(loadSettings(storage).planUnits).toBe('feet');
    kept.set('storiiboard.settings', JSON.stringify({ planUnits: 'yards' }));
    expect(loadSettings(storage).planUnits).toBe('region');
  });
});

describe('a wall’s corners', () => {
  it('are mitred where two walls meet at an angle, square at a free end', () => {
    const a = { id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 10 };
    const b = { id: 'b', start: { x: 100, y: 0 }, end: { x: 100, y: 100 }, thickness: 10 };
    // a's box is 100 long and 10 across; its end corner reaches 5 past the joint on the outside, stops 5 short inside.
    const outline = wallOutline(a, [a, b]).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    expect(outline).toEqual([
      { x: 0, y: 10 },
      { x: 95, y: 10 },
      { x: 105, y: 0 },
      { x: 0, y: 0 },
    ]);
    // Alone, it's a plain bar.
    expect(wallOutline(a, [a])).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
    // A straight joint stays square.
    const c = { id: 'c', start: { x: 100, y: 0 }, end: { x: 200, y: 0 }, thickness: 10 };
    expect(wallOutline(a, [a, c]).map((p) => Math.round(p.x))).toEqual([0, 100, 100, 0]);
  });

  it('mitre on a 20 m wall at 36.869898° (not whole hundredths), its rotation kept and its stored end coming back within 0.1 mm', () => {
    const start = { x: 1.2345, y: 2.5 };
    const angle = 36.869898;
    const corner = { x: start.x + 20 * Math.cos((angle * Math.PI) / 180), y: start.y + 20 * Math.sin((angle * Math.PI) / 180) };
    const long = planItemFields(wallProps(wallBetween(start, corner)));
    const next = planItemFields(wallProps(wallBetween(corner, { x: corner.x - 4, y: corner.y + 3 })));
    if (!long || !next) throw new Error('no walls');
    // Kept to the millionth of a degree, never rounded to hundredths (36.87°).
    expect(Math.abs(long.rotation - angle)).toBeLessThan(1e-6);
    const [, end] = wallEnds(long);
    const [nextStart] = wallEnds(next);
    expect(Math.hypot(end.x - corner.x, end.y - corner.y)).toBeLessThanOrEqual(0.0001);
    expect(Math.hypot(nextStart.x - corner.x, nextStart.y - corner.y)).toBeLessThanOrEqual(0.0001);
    // Drawn, the corner is mitred: the long wall's two far corners are not square across its end.
    const line = (id: string, f: typeof long) => {
      const [a, b] = wallEnds(f);
      return { id, start: { x: toCanvas(a.x), y: toCanvas(a.y) }, end: { x: toCanvas(b.x), y: toCanvas(b.y) }, thickness: toCanvas(f.height) };
    };
    const outline = wallOutline(line('long', long), [line('long', long), line('next', next)]);
    const [, farA, farB] = outline;
    expect(Math.abs((farA?.x ?? 0) - (farB?.x ?? 0))).toBeGreaterThan(1);
  });
});

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
const groups = async () => (await log(project.file)).length;
const fieldsOf = (id: string) => planItemFields(records()[id]?.props ?? {});

/** A scene with its room started and an L of two walls drawn in it. */
async function room(): Promise<{ sceneId: string; roomId: string; walls: string[] }> {
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
  return { sceneId, roomId, walls: made.ids };
}

describe('the plan’s edits', () => {
  it('starts a room in one step, and draws a run of walls in one more, each undone by one undo', async () => {
    const before = await groups();
    const { sceneId, walls } = await room();
    // The scene, the room, the run of walls.
    expect(await groups()).toBe(before + 3);
    expect(shownItems(records(), sceneId, null).map((i) => i.record.id)).toEqual(walls);
    await store.getState().undo();
    expect(shownItems(records(), sceneId, null)).toEqual([]);
    await store.getState().undo();
    expect(sceneRoomId(records(), records()[sceneId])).toBeNull();
  });

  it('turns the canvas’s units into metres for a move, a resize, a turn and a nudge, and writes nothing that didn’t change', async () => {
    const { sceneId, walls } = await room();
    const [first = ''] = walls;
    const items = planCanvasItems(records(), sceneId, null, 'metres', '#16150F');
    const drawn = items.find((i) => i.id === first);
    expect(drawn).toMatchObject({ x: 0, y: -5, width: 350, height: 10, rotation: 0, label: 'Wall, 3.50 m' });
    expect(planGeometryChanges(records(), [{ id: first, x: 0, y: -5, width: 350, height: 10, rotation: 0 }])).toEqual([]);
    await store.getState().apply(planGeometryChanges(records(), [{ id: first, x: 100, y: 45, width: 350, height: 10, rotation: 90 }]));
    expect(fieldsOf(first)).toMatchObject({ x: 1, y: 0.45, width: 3.5, rotation: 90 });
    await store.getState().apply(planNudgeChanges(records(), [first], 10, 0));
    expect(fieldsOf(first)?.x).toBe(1.1);
    await store.getState().undo();
    expect(fieldsOf(first)?.x).toBe(1);
  });

  it('sets a length, a thickness, a height and a rotation in the Selection tile, keeping the wall’s start', async () => {
    const { walls } = await room();
    const [first = '', second = ''] = walls;
    await store.getState().apply(wallPatchChanges(records(), [first], { length: 5 }));
    const [start, end] = wallEnds(fieldsOf(first) as never);
    expect(start.x).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(5, 6);
    expect(fieldsOf(first)?.width).toBe(5);
    await store.getState().apply(wallPatchChanges(records(), [first, second], { heightM: 2.4, thickness: 0.15 }));
    expect([fieldsOf(first)?.heightM, fieldsOf(second)?.heightM, fieldsOf(second)?.height]).toEqual([2.4, 2.4, 0.15]);
    await store.getState().apply(wallPatchChanges(records(), [first], { rotation: 90 }));
    const [turnedStart, turnedEnd] = wallEnds(fieldsOf(first) as never);
    expect(turnedStart.x).toBeCloseTo(0, 6);
    expect(turnedEnd.y).toBeCloseTo(5, 6);
    await store.getState().apply(wallPatchChanges(records(), [first], { heightM: null }));
    expect(fieldsOf(first)?.heightM).toBeNull();
    expect(wallPatchChanges(records(), [first], { heightM: null })).toEqual([]);
  });

  it('reorders, copies and pastes within the room', async () => {
    const { roomId, walls } = await room();
    const [first = '', second = ''] = walls;
    await store.getState().apply(reorderPlanChanges(records(), [first], 'front'));
    const order = Object.values(records())
      .filter((r) => r.type === 'plan_item' && r.parentId === roomId)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      .map((r) => r.id);
    expect(order).toEqual([second, first]);
    const pasted = planPasteChanges(records(), roomId, planClipOf(records(), [first]), null);
    await store.getState().apply(pasted.changes);
    expect(fieldsOf(pasted.ids[0] ?? '')).toMatchObject({ x: (fieldsOf(first)?.x ?? 0) + 0.16, width: 3.5 });
  });

  it('deletes walls to the Trash, listed under their room, and restores them; Empty Trash takes them', async () => {
    const { walls } = await room();
    await store.getState().apply(trashPlanItemsChanges(records(), walls));
    const listed = trashItems(records(), project.projectId);
    expect(listed.map((row) => [row.kind, row.name])).toEqual([
      ['planItem', 'Wall in Diner'],
      ['planItem', 'Wall in Diner'],
    ]);
    expect(trashedRoots(Object.values(records())).sort()).toEqual([...walls].sort());
    expect(purgeIds(Object.values(records())).sort()).toEqual([...walls].sort());
    await store.getState().apply(restoreChanges(records(), project.projectId, walls[0] ?? ''));
    expect(records()[walls[0] ?? '']?.trashedAt).toBeNull();
  });

  it('rebuilds nothing for an unrelated edit, and only a wall and its neighbours for an edit to that wall', async () => {
    const { sceneId, roomId, walls } = await room();
    // A third wall well away from the L.
    await store.getState().apply(wallsAlong(records(), roomId, [{ x: 10, y: 10 }, { x: 12, y: 10 }]).changes);
    const keep = shownItemsKeeper();
    const build = planItemsBuilder();
    const before = build(keep(records(), sceneId, null), 'metres', '#16150F');
    // An edit elsewhere in the project: the same list and the same items.
    await store.getState().apply([{ kind: 'update', id: sceneId, set: { name: 'Diner, later' } }]);
    const after = build(keep(records(), sceneId, null), 'metres', '#16150F');
    expect(after).toBe(before);
    // One wall of the L made thicker: it and the wall joined to it are new, the far wall is the item it was.
    const [first = '', second = ''] = walls;
    await store.getState().apply(wallPatchChanges(records(), [first], { thickness: 0.2 }));
    const edited = build(keep(records(), sceneId, null), 'metres', '#16150F');
    const byId = (list: readonly { id: string }[], id: string) => list.find((item) => item.id === id);
    expect(byId(edited, first)).not.toBe(byId(before, first));
    expect(byId(edited, second)).not.toBe(byId(before, second));
    const far = before.find((item) => item.id !== first && item.id !== second);
    expect(far && byId(edited, far.id)).toBe(far);
    // Each wall snaps by its middle line's ends.
    expect(byId(edited, second)).toMatchObject({ snapPoints: [{ x: 350, y: 0 }, { x: 350, y: 381 }] });
  });

  it('writes a run into the room of the view it was drawn in, never another scene’s', async () => {
    const one = await room();
    const sceneTwo = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: sceneTwo, type: 'scene', parentId: project.projectId, sortKey: 'b', props: { number: '5' } } }]);
    await store.getState().apply(startRoomChanges(records(), project.projectId, sceneTwo));
    const made = drawWallsChanges(records(), one.sceneId, [{ x: 0, y: 500 }, { x: 300, y: 500 }]);
    await store.getState().apply(made.changes);
    expect(shownItems(records(), one.sceneId, null)).toHaveLength(3);
    expect(shownItems(records(), sceneTwo, null)).toEqual([]);
    // A scene with no room takes no walls.
    const bare = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: bare, type: 'scene', parentId: project.projectId, sortKey: 'c', props: { number: '6' } } }]);
    expect(drawWallsChanges(records(), bare, [{ x: 0, y: 0 }, { x: 100, y: 0 }]).changes).toEqual([]);
  });

  it('starts one room however many times Start the room is pressed', async () => {
    const sceneId = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '4' } } }]);
    const start = () => store.getState().applyWith((now) => ({ changes: startRoomChanges(now, project.projectId, sceneId) }));
    const before = await groups();
    // Two presses in a row, the second before the first is written: each reads the records at its turn.
    await Promise.all([start(), start()]);
    const rooms = Object.values(records()).filter((r) => r.type === 'plan');
    expect(rooms).toHaveLength(1);
    expect(sceneRoomId(records(), records()[sceneId])).toBe(rooms[0]?.id);
    expect(await groups()).toBe(before + 1);
  });

  it('trashes a room with its live items in one step, and restores it with them, not ones deleted before', async () => {
    const { sceneId, roomId, walls } = await room();
    const [first = '', second = ''] = walls;
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    await store.getState().apply(trashPlanChanges(records(), roomId));
    expect(records()[second]?.trashedAt).not.toBeNull();
    expect(sceneRoomId(records(), records()[sceneId])).toBeNull();
    // The Trash lists the room and the wall deleted before it; the wall that went with the room is in the room's row.
    expect(trashItems(records(), project.projectId).map((row) => row.kind).sort()).toEqual(['plan', 'planItem']);
    await store.getState().apply(restoreChanges(records(), project.projectId, roomId));
    expect(records()[roomId]?.trashedAt).toBeNull();
    expect(records()[second]?.trashedAt).toBeNull();
    expect(records()[first]?.trashedAt).not.toBeNull();
    expect(sceneRoomId(records(), records()[sceneId])).toBe(roomId);
  });

  it('restores a wall whose room is in the Trash with the room, whole', async () => {
    const { roomId, walls } = await room();
    const [first = '', second = ''] = walls;
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    await store.getState().apply(trashPlanChanges(records(), roomId));
    const back = restoreChanges(records(), project.projectId, first);
    expect(back.map((c) => (c.kind === 'restore' ? c.id : '')).sort()).toEqual([roomId, first, second].sort());
    await store.getState().apply(back);
    expect([roomId, first, second].map((id) => records()[id]?.trashedAt)).toEqual([null, null, null]);
  });

  it('keeps the room when its scene goes to the Trash: another scene may use it', async () => {
    const { sceneId, roomId } = await room();
    await store.getState().apply([{ kind: 'trash', id: sceneId }]);
    const roomRecord = records()[roomId] as SbdRecord;
    expect(roomRecord.trashedAt).toBeNull();
    expect(purgeIds(Object.values(records()))).not.toContain(roomId);
  });
});

// Doors and windows (6.2b): put into a wall where the pointer is, slid along it and onto another wall by a drag, nudged
// along it, held inside it and clear of each other, following the wall when it moves, trashed and restored with it.

const openingOf = (id: string) => openingFields(records()[id]?.props ?? {});

/** The L of walls with a door 1 m along the first, written as the Door tool writes it. */
async function withDoor(): Promise<{ sceneId: string; roomId: string; walls: string[]; door: string }> {
  const made = await room();
  const spot = openingSpot(shownItems(records(), made.sceneId, null), { x: 100, y: 0 }, 'door', 0.5);
  if (!spot) throw new Error('no spot');
  const door = crypto.randomUUID();
  await store.getState().apply(placeOpeningChanges(records(), spot, 'door', door));
  return { ...made, door };
}

describe('doors and windows', () => {
  it('go into the wall under the pointer, snapped along it, never over another, and over no wall nowhere', async () => {
    const { sceneId, roomId, walls, door } = await withDoor();
    expect(openingOf(door)).toMatchObject({ kind: 'door', wallId: walls[0], along: 1, width: 0.9, hinge: 'start', swing: 'left' });
    expect(records()[door]?.parentId).toBe(roomId);
    const shown = shownItems(records(), sceneId, null);
    // A window at 1.3 m would overlap the door: it takes the nearest free place.
    expect(openingSpot(shown, { x: 130, y: 0 }, 'window', 0.5)).toMatchObject({ wallId: walls[0], along: 2.05 });
    expect(openingSpot(shown, { x: 100, y: 100 }, 'window', 0.5)).toBeNull();
    // The keyboard's: the middle of the selected wall, or the nearest free place to it.
    expect(openingSpotInWall(shown, walls[1] ?? '', 'door')?.along).toBeCloseTo(1.905, 6);
    expect(placeOpeningChanges(records(), { wallId: walls[0] ?? '', wall: fieldsOf(walls[0] ?? '') as never, along: 1.2 }, 'door')).toEqual([]);
  });

  it('are drawn over the walls from their wall, moved only, and made again only when they or their wall change', async () => {
    const { sceneId, walls, door } = await withDoor();
    const keep = shownItemsKeeper();
    const build = planItemsBuilder();
    const before = build(keep(records(), sceneId, null), 'metres', '#16150F');
    expect(before.map((i) => i.id)).toEqual([...walls, door]);
    expect(before.at(-1)).toMatchObject({ x: 55, y: -95, width: 90, height: 100, rotation: 0, moveOnly: true, label: 'Door, 0.90 m' });
    await store.getState().apply(wallPatchChanges(records(), [walls[1] ?? ''], { thickness: 0.2 }));
    const after = build(keep(records(), sceneId, null), 'metres', '#16150F');
    expect(after.find((i) => i.id === door)).toBe(before.find((i) => i.id === door));
    await store.getState().apply(planGeometryChanges(records(), [{ id: walls[0] ?? '', x: 0, y: 95, width: 350, height: 10, rotation: 0 }]));
    const moved = build(keep(records(), sceneId, null), 'metres', '#16150F');
    expect(moved.find((i) => i.id === door)).not.toBe(before.find((i) => i.id === door));
    expect(moved.find((i) => i.id === door)?.y).toBe(5);
  });

  it('slide along their wall by a drag, snapped to the grid, never off its end, and onto another wall in one step', async () => {
    const { sceneId, walls, door } = await withDoor();
    const shown = shownItems(records(), sceneId, null);
    const constrain = planConstrain(shown, 'metres');
    const box = planCanvasItems(records(), sceneId, null, 'metres', '#16150F').find((i) => i.id === door);
    if (!box) throw new Error('no door');
    const drag = (dx: number, dy: number, snap: 'magnet' | 'fine' | 'off' = 'magnet') => {
      const out = constrain(new Map([[door, { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height, rotation: box.rotation }]]), snap).get(door);
      if (!out) throw new Error('not placed');
      return planGeometryChanges(records(), [{ id: door, ...out }], shownWalls(shown));
    };
    expect(drag(60, 0)).toEqual([{ kind: 'update', id: door, set: { along_m: 1.5 } }]);
    expect(drag(62, 0, 'fine')).toEqual([{ kind: 'update', id: door, set: { along_m: 1.6 } }]);
    // Pulled off the wall sideways it stays in the wall; past its end it stops there.
    expect(drag(60, 150)).toEqual([{ kind: 'update', id: door, set: { along_m: 1.5 } }]);
    expect(drag(400, 0)).toEqual([{ kind: 'update', id: door, set: { along_m: 3.05 } }]);
    // Onto the second wall: its wall and its place in the same op.
    const onto = drag(250, 200);
    expect(onto).toEqual([{ kind: 'update', id: door, set: { along_m: 2, wall_id: walls[1] } }]);
    const before = await groups();
    await store.getState().apply(onto);
    expect(await groups()).toBe(before + 1);
    expect(openingOf(door)).toMatchObject({ wallId: walls[1], along: 2 });
    await store.getState().undo();
    expect(openingOf(door)).toMatchObject({ wallId: walls[0], along: 1 });
  });

  it('follow their wall as it is dragged, and are left to follow it when moved with it', async () => {
    const { sceneId, walls, door } = await withDoor();
    const shown = shownItems(records(), sceneId, null);
    const items = planCanvasItems(records(), sceneId, null, 'metres', '#16150F');
    const wallBox = items.find((i) => i.id === walls[0]);
    const doorBox = items.find((i) => i.id === door);
    if (!wallBox || !doorBox) throw new Error('no items');
    const out = planConstrain(shown, 'metres')(new Map([[wallBox.id, { ...wallBox, y: wallBox.y + 100 }]]), 'magnet');
    expect(out.get(door)?.y).toBeCloseTo(doorBox.y + 100, 6);
    const written = planGeometryChanges(records(), [...out].map(([id, g]) => ({ id, ...g })));
    expect(written.map((c) => c.kind === 'update' && c.id)).toEqual([walls[0]]);
  });

  it('nudge along their wall, and stop against another opening', async () => {
    const { walls, door } = await withDoor();
    await store.getState().apply(planNudgeChanges(records(), [door], 10, 0));
    expect(openingOf(door)?.along).toBe(1.1);
    await store.getState().apply(planNudgeChanges(records(), [door], 0, -10));
    expect(openingOf(door)?.along).toBe(1);
    const window = crypto.randomUUID();
    await store.getState().apply(placeOpeningChanges(records(), { wallId: walls[0] ?? '', wall: fieldsOf(walls[0] ?? '') as never, along: 2.05 }, 'window', window));
    await store.getState().apply(planNudgeChanges(records(), [door], 10, 0));
    expect(openingOf(door)?.along).toBe(1);
  });

  it('hold a wall at the length they need: a resize stops there, a typed length is refused', async () => {
    const { walls } = await withDoor();
    const first = walls[0] ?? '';
    await store.getState().apply(planGeometryChanges(records(), [{ id: first, x: 0, y: -5, width: 100, height: 10, rotation: 0 }]));
    expect(fieldsOf(first)?.width).toBe(1.45);
    const [start] = wallEnds(fieldsOf(first) as never);
    expect(start.x).toBeCloseTo(0, 6);
    expect(wallsTakeLength(records(), [first], 1)).toBe(false);
    expect(wallPatchChanges(records(), [first], { length: 1 })).toEqual([]);
    expect(wallNeedOf(records(), first)).toBeCloseTo(1.45, 6);
  });

  it('change width, distances, hinge and swing from the Selection tile, refused where they don’t fit; F flips', async () => {
    const { walls, door } = await withDoor();
    const wall = fieldsOf(walls[0] ?? '') as NonNullable<ReturnType<typeof fieldsOf>>;
    expect(openingDistances(wall, openingOf(door) as never)).toEqual({ fromStart: 0.55, fromEnd: 2.05 });
    await store.getState().apply(openingPatchChanges(records(), [door], { fromEnd: 0.5 }) ?? []);
    expect(openingOf(door)?.along).toBe(2.55);
    await store.getState().apply(openingPatchChanges(records(), [door], { width: 0.8 }) ?? []);
    expect(openingOf(door)).toMatchObject({ width: 0.8, along: 2.55 });
    expect(openingPatchChanges(records(), [door], { fromEnd: -0.1 })).toBeNull();
    expect(openingPatchChanges(records(), [door], { width: 5 })).toBeNull();
    await store.getState().apply(flipDoorsChanges(records(), [door], 'swing'));
    await store.getState().apply(flipDoorsChanges(records(), [door], 'hinge'));
    expect(openingOf(door)).toMatchObject({ swing: 'right', hinge: 'end' });
  });

  it('go to the Trash with their wall and come back with it; one restored on its own brings its wall', async () => {
    const { walls, door } = await withDoor();
    const first = walls[0] ?? '';
    const trash = trashPlanItemsChanges(records(), [first]);
    expect(trash.map((c) => (c.kind === 'trash' ? c.id : '')).sort()).toEqual([first, door].sort());
    await store.getState().apply(trash);
    expect(trashItems(records(), project.projectId).map((row) => row.name)).toEqual(['Wall in Diner']);
    await store.getState().apply(restoreChanges(records(), project.projectId, first));
    expect([records()[first]?.trashedAt, records()[door]?.trashedAt]).toEqual([null, null]);
    // The door first, then its wall: both listed; the door restored brings the wall back.
    await store.getState().apply(trashPlanItemsChanges(records(), [door]));
    // Another moment: a step's Trash time is what ties the things that went together.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    expect(trashItems(records(), project.projectId).map((row) => row.name).sort()).toEqual(['Door in Diner', 'Wall in Diner']);
    await store.getState().apply(restoreChanges(records(), project.projectId, door));
    expect([records()[first]?.trashedAt, records()[door]?.trashedAt]).toEqual([null, null]);
  });

  it('are copied and pasted with their wall, into the copy of it', async () => {
    const { roomId, walls, door } = await withDoor();
    const clip = planClipOf(records(), [walls[0] ?? '']);
    expect(clip.map((c) => c.id)).toEqual([walls[0], door]);
    const pasted = planPasteChanges(records(), roomId, clip, null);
    await store.getState().apply(pasted.changes);
    const [newWall, newDoor] = pasted.ids;
    expect(openingOf(newDoor ?? '')?.wallId).toBe(newWall);
    // A door copied alone has nowhere to go.
    expect(planPasteChanges(records(), roomId, planClipOf(records(), [door]), null).changes).toEqual([]);
  });
});

describe('shared rooms in the store', () => {
  it('make a separate copy in one step that one undo takes back, the other scene untouched', async () => {
    const { sceneId, roomId, walls, door } = await withDoor();
    const other = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: 'b', props: { number: '7', room_id: roomId } } }]);
    expect(shownItems(records(), other, null).map((i) => i.record.id)).toEqual([...walls, door]);
    const before = await groups();
    await store.getState().apply(separateCopyChanges(records(), project.projectId, sceneId));
    expect(await groups()).toBe(before + 1);
    const copy = sceneRoomId(records(), records()[sceneId]);
    expect(copy).not.toBe(roomId);
    const mine = shownItems(records(), sceneId, null);
    expect(mine).toHaveLength(3);
    expect(mine.every((i) => i.record.parentId === copy)).toBe(true);
    expect(shownItems(records(), other, null).map((i) => i.record.id)).toEqual([...walls, door]);
    await store.getState().undo();
    expect(sceneRoomId(records(), records()[sceneId])).toBe(roomId);
    expect(Object.values(records()).filter((r) => r.type === 'plan' && r.trashedAt === null)).toHaveLength(1);
  });
});

describe('a run’s project and room (6.2a review)', () => {
  const run = [{ x: 0, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 800 }];
  const wallsIn = (list: readonly SbdRecord[]) => list.filter((r) => r.type === 'plan_item' && r.trashedAt === null).length;

  it('writes nothing to either file when it ends after a switch to a copy with the same ids', async () => {
    const { sceneId } = await room();
    const madeIn = store.getState().project;
    // A copy of the file keeps every id, as Open version and Open backup do; opened, it replaces the original.
    const copyPath = folder.path('Bey County (copy).sbd');
    await project.file.saveCopy(copyPath);
    const copy = await openProject(copyPath, { driver: nodeDriver, backups: false });
    await store.getState().open(copy);
    const copyGroups = (await log(copy.file)).length;
    // The run drawn in the original ends now (Enter, or the canvas going away): it is not written.
    expect(await drawWalls({ sceneId, setupId: null }, run, madeIn, store)).toBe(false);
    expect(wallsIn(Object.values(store.getState().records))).toBe(2);
    expect((await log(copy.file)).length).toBe(copyGroups);
    // Nor into the original, which still has its two walls and the steps it had.
    await store.getState().close();
    const original = await openProject(project.file.path, { driver: nodeDriver, backups: false });
    try {
      expect(wallsIn(await loadRecords(original.file))).toBe(2);
    } finally {
      await original.close();
    }
  });

  it('writes the run in the project it was drawn in, and says so when its scene went to the Trash', async () => {
    const { sceneId } = await room();
    const madeIn = store.getState().project;
    expect(await drawWalls({ sceneId, setupId: null }, run, madeIn, store)).toBe(true);
    expect(shownItems(records(), sceneId, null)).toHaveLength(4);
    // The scene to the Trash mid-run: its room is kept (another scene may use it), but the run doesn't go into it.
    await store.getState().apply([{ kind: 'trash', id: sceneId }]);
    const before = await groups();
    expect(await drawWalls({ sceneId, setupId: null }, run, madeIn, store)).toBe(false);
    expect(await groups()).toBe(before);
    expect(noticeStore.getState().message).toBe(t('plan.wallsNotDrawn'));
  });
});

describe('a handle pressed or dragged (6.2a review)', () => {
  /** A 3-4-5 wall: 5 m long, turned 36.869898° (atan2 of 3 over 4), not whole hundredths of a degree. */
  async function slanted(): Promise<string> {
    const { roomId } = await room();
    const made = wallsAlong(records(), roomId, [{ x: 0, y: 10 }, { x: 4, y: 13 }]);
    await store.getState().apply(made.changes);
    return made.ids[0] ?? '';
  }
  /** The box the canvas reports for a wall: its units rounded to hundredths, its rotation too. */
  const reported = (id: string) => {
    const f = fieldsOf(id);
    if (!f) throw new Error('no wall');
    return { id, x: tidy(toCanvas(f.x)), y: tidy(toCanvas(f.y)), width: tidy(toCanvas(f.width)), height: tidy(toCanvas(f.height)), rotation: normalisedRotation(f.rotation) };
  };

  it('writes no step for a press without a drag', async () => {
    const wall = await slanted();
    expect(fieldsOf(wall)?.rotation).not.toBe(normalisedRotation(fieldsOf(wall)?.rotation ?? 0));
    expect(planGeometryChanges(records(), [reported(wall)])).toEqual([]);
  });

  it('keeps the rotation to a millionth of a degree through a resize', async () => {
    const wall = await slanted();
    const exact = (Math.atan2(3, 4) * 180) / Math.PI;
    const box = reported(wall);
    await store.getState().apply(planGeometryChanges(records(), [{ ...box, x: box.x - 250, width: box.width + 500 }]));
    expect(fieldsOf(wall)?.width).toBe(10);
    expect(Math.abs((fieldsOf(wall)?.rotation ?? 0) - exact)).toBeLessThan(1e-6);
  });
});

describe('a wall’s words (6.2a review)', () => {
  it('follow a change of language', async () => {
    const { sceneId, walls } = await room();
    const build = planItemsBuilder();
    const keep = shownItemsKeeper();
    const label = (list: readonly { id: string; label?: string }[]) => list.find((item) => item.id === walls[0])?.label;
    expect(label(build(keep(records(), sceneId, null), 'metres', '#16150F', 'en'))).toBe('Wall, 3.50 m');
    setLocale('es');
    const spanish = label(build(keep(records(), sceneId, null), 'metres', '#16150F', 'es'));
    expect(spanish).toBe(t('plan.announce.wall', { length: '3.50 m' }));
    expect(spanish).not.toBe('Wall, 3.50 m');
  });
});

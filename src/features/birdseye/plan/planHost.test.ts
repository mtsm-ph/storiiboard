import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planUnitFor } from '../../../app/planUnits';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { planItemFields, sceneRoomId, shownItems, startRoomChanges, trashPlanChanges, wallBetween, wallEnds, wallProps, wallsAlong } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { log, purgeIds, trashedRoots } from '../../../core/ops/ops';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { restoreChanges, trashItems } from '../../trash/trash';
import { SCALE_BAR_PIXELS, scaleBarLength } from '../../../ui/canvas/scale';
import { drawWallsChanges, planCanvasItems, planClipOf, planGeometryChanges, planItemsBuilder, planNudgeChanges, planPasteChanges, reorderPlanChanges, shownItemsKeeper, trashPlanItemsChanges, wallPatchChanges } from './planItems';
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

  it('mitre on a 20 m wall at 37°, its stored end coming back within 0.1 mm', () => {
    const start = { x: 1.2345, y: 2.5 };
    const corner = { x: start.x + 20 * Math.cos((37 * Math.PI) / 180), y: start.y + 20 * Math.sin((37 * Math.PI) / 180) };
    const long = planItemFields(wallProps(wallBetween(start, corner)));
    const next = planItemFields(wallProps(wallBetween(corner, { x: corner.x - 4, y: corner.y + 3 })));
    if (!long || !next) throw new Error('no walls');
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

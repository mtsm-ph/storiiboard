import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Circle, Line, Text } from 'react-konva';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { northFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges, sunFields } from '../../../core/model/plan';
import { itemSetupId } from '../../../core/model/planCamera';
import { deleteRoomChanges, setupOnlyChanges } from '../../../core/model/planRooms';
import { roomNorth, sunReading, sunSetupId } from '../../../core/model/planSun';
import type { SbdRecord } from '../../../core/model/record';
import { planVector } from '../../../core/model/sunPath';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { GOLDEN_HOUR, PAPER, PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { northClash, restoreChanges, trashItems } from '../../trash/trash';
import { BesideLabels, HALO_PIXELS, UprightLabels } from './cameraDraw';
import { iconRefusal, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView, trashPlanItemsChanges, turnChanges, turnsByKey, unreadableAfter } from './planItems';
import { placeIcon } from './planActions';
import { planStore } from './planStore';
import { shownHeight, sunLabel, sunLooks } from './sunLooks';
import { SunBeyond, type SunLook } from './sunDraw';

// North and the sun path on a plan (6.6): north placed in the room's plan, one per room (a second placed selects the
// first, a paste never makes a second); a sun path placed in the setup's own plan at noon; the turn keys turn north and
// never a sun path, whose rotate handle is hidden; the sun drawn where north turns it; and the builder making a sun
// path's item again whenever anything it reads changes: its record, the room's north, the setup's frames, their day's
// date, the location's place or zone, the unit and the language.

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
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

/** Scene 1 at the Diner (New York, its zone set), its room started; Setup 1 with 1A on Day 1, 21 June 2026; a second setup. */
async function scene(): Promise<{ sceneId: string; setupId: string; otherId: string }> {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'diner', type: 'location', parentId: project.projectId, sortKey: 'a', props: { name: 'Diner', latitude: 40.7128, longitude: -74.006, map_name: 'Diner', time_zone: 'America/New_York' } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner', location_id: 'diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: otherId, type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
    { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2026-06-21' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, shoot_day_id: 'd1' } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  return { sceneId, setupId, otherId };
}

async function place(view: { sceneId: string; setupId: string | null }, icon: string, centre = { x: 0, y: 0 }): Promise<string> {
  const id = crypto.randomUUID();
  const changes = placeIconChanges(records(), view, icon, centre, id);
  expect(changes.length).toBeGreaterThan(0);
  await store.getState().apply(changes);
  return id;
}

describe('placing north and the sun path (6.6)', () => {
  it('puts north in the room’s plan and the sun path in the setup’s, at their sizes, the sun at noon', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north', { x: 1, y: 1 });
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    expect(records()[north]?.parentId).toBe(sceneRoomId(records(), records()[sceneId]));
    expect(northFields(records()[north]?.props ?? {})).toMatchObject({ kind: 'north', icon: 'production/north', y: 0.7, width: 0.28, height: 0.6, rotation: 0 });
    // Its arrow's proportions (6.6 review): 0.28 m wide, its middle at 1 m, so its left edge at 0.86 m.
    expect(northFields(records()[north]?.props ?? {})?.x).toBeCloseTo(0.86, 6);
    expect(records()[sun]?.parentId).toBe(setupPlanOf(records(), setupId)?.id);
    expect(sunFields(records()[sun]?.props ?? {})).toMatchObject({ kind: 'sun', width: 0.8, height: 0.8, time: '12:00' });
    expect(records()[sun]?.props.time).toBe('12:00');
    // North needs no setup (it's the room's); the sun path does.
    expect(iconRefusal(records(), { sceneId, setupId: null }, 'production/north')).toBeNull();
    expect(iconRefusal(records(), { sceneId, setupId: null }, 'lighting/sun-path')).toBe('noSetup');
  });

  it('one north per room: a second placed selects the first and says so', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const north = await place(view, 'production/north');
    expect(placeIconChanges(records(), view, 'production/north', { x: 3, y: 3 })).toEqual([]);
    expect(await placeIcon(view, 'production/north', { x: 3, y: 3 }, project, store)).toBe('hasNorth');
    expect(planStore.getState().selections[`setup:${setupId}`]).toEqual([north]);
    expect(shownItems(records(), sceneId, setupId).filter((i) => i.fields.kind === 'north')).toHaveLength(1);
  });

  it('a paste never makes a second north: not into a room with one, nor twice in one paste', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const north = await place(view, 'production/north');
    const pasted = planPasteInView(records(), view, planClipOf(records(), [north]), null);
    expect(pasted).toMatchObject({ ids: [], changes: [], northKept: 1 });
    // Into a scene with a room of its own and no north: one goes in, the second copy of it doesn't.
    const other = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2' } } }]);
    await store.getState().apply(startRoomChanges(records(), project.projectId, other));
    const clip = planClipOf(records(), [north]);
    const twice = planPasteInView(records(), { sceneId: other, setupId: null }, [...clip, ...clip], null);
    expect(twice.ids).toHaveLength(1);
    expect(twice.northKept).toBe(1);
    await store.getState().apply(twice.changes);
    expect(roomNorth(records(), sceneRoomId(records(), records()[other]))).toBe(0);
  });

  it('a sun path pasted goes into the setup shown, with its time', async () => {
    const { sceneId, setupId, otherId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    await store.getState().apply([{ kind: 'update', id: sun, set: { time: '14:30' } }]);
    const pasted = planPasteInView(records(), { sceneId, setupId: otherId }, planClipOf(records(), [sun]), null, 'plan-u2');
    await store.getState().apply(pasted.changes);
    const copy = records()[pasted.ids[0] ?? ''];
    expect(copy?.parentId).toBe('plan-u2');
    expect(copy?.props.time).toBe('14:30');
  });

  it('the turn keys turn north (its turn is the room’s north) and never a sun path', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const northRead = northFields(records()[north]?.props ?? {});
    const sunRead = sunFields(records()[sun]?.props ?? {});
    if (!northRead || !sunRead) throw new Error('not placed');
    expect(turnsByKey(northRead)).toBe(true);
    expect(turnsByKey(sunRead)).toBe(false);
    await store.getState().apply(turnChanges(records(), [north, sun], 35));
    expect(roomNorth(records(), sceneRoomId(records(), records()[sceneId]))).toBe(35);
    expect(records()[sun]?.props.rotation).toBe(0);
  });

  it('a write that would leave north or a sun path unreadable is refused, as every plan write is', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    expect(unreadableAfter(records(), [{ kind: 'update', id: north, set: { x: 1e308 } }])).toBe(true);
    expect(unreadableAfter(records(), [{ kind: 'update', id: sun, set: { width: 1e6 } }])).toBe(true);
    expect(unreadableAfter(records(), [{ kind: 'update', id: sun, set: { time: '14:30' } }])).toBe(false);
  });
});

describe('north and the sun path in the Trash (6.6)', () => {
  it('go to the Trash named as what they are, and come back with what they had', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    await store.getState().apply([{ kind: 'update', id: north, set: { rotation: 35 } }, { kind: 'update', id: sun, set: { time: '14:30' } }]);
    await store.getState().apply(trashPlanItemsChanges(records(), [north, sun]));
    expect(roomNorth(records(), sceneRoomId(records(), records()[sceneId]))).toBeNull();
    const rows = trashItems(records(), project.projectId);
    expect(rows.find((r) => r.id === north)?.name).toBe('North in Diner');
    expect(rows.find((r) => r.id === sun)?.name).toBe('Sun path');
    await store.getState().apply(restoreChanges(records(), project.projectId, north));
    await store.getState().apply(restoreChanges(records(), project.projectId, sun));
    expect(roomNorth(records(), sceneRoomId(records(), records()[sceneId]))).toBe(35);
    expect(records()[sun]?.props.time).toBe('14:30');
  });
});

describe('drawing the sun path (6.6)', () => {
  const zones = new Map<string, string | null>();

  it('says what is missing until north is placed, then draws the day turned by the room’s north', async () => {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const look = () => sunLooks(records(), shownItems(records(), sceneId, setupId), zones, []).get(sun);
    expect(look()).toEqual({ kind: 'missing', lines: ['No north in this room'], selected: false });
    const north = await place({ sceneId, setupId }, 'production/north');
    await store.getState().apply([{ kind: 'update', id: north, set: { rotation: 90 } }, { kind: 'update', id: sun, set: { time: '13:00' } }]);
    const drawn = look();
    if (drawn?.kind !== 'drawn') throw new Error('not drawn');
    // At 13:00 the sun bears 181.6° (USNO): with north turned 90° that's 271.6° clockwise from up the plan, to the left.
    const expected = planVector(181.6, 90);
    expect(drawn.sun.x).toBeCloseTo(expected.x, 2);
    expect(drawn.sun.y).toBeCloseTo(expected.y, 1);
    expect(drawn.sun.x).toBeLessThan(-0.99);
    expect(drawn.label).toMatch(/^13:00 · 18[12]° · 73° high$/);
    expect(drawn.hours.map((h) => h.label)).toEqual(['6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
    expect(drawn.rise?.label).toMatch(/^Rise 05:2\d$/);
    expect(drawn.set?.label).toMatch(/^Set 20:3\d$/);
    expect(drawn.segments.some((s) => s.golden)).toBe(true);
    expect(drawn.radius).toBe(300);
    // Late: the sun is down, said, no line drawn.
    await store.getState().apply([{ kind: 'update', id: sun, set: { time: '21:10' } }]);
    expect(look()).toMatchObject({ kind: 'drawn', label: '21:10 · the sun is down', sun: { up: false } });
  });

  it('a sun path has no rotate handle; north has one', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const shown = shownItems(records(), sceneId, setupId);
    const items = planItemsBuilder()(shown, 'metres', PAPER_COLOURS.ink, 'en', new Map(), new Map(), sunLooks(records(), shown, zones, []));
    expect(items.find((i) => i.id === sun)).toMatchObject({ noTurn: true, keepRatio: true });
    expect(items.find((i) => i.id === sun)?.beyond).toBeDefined();
    expect(items.find((i) => i.id === north)?.noTurn).toBeUndefined();
    expect(items.find((i) => i.id === north)?.label).toBe('North, 0°');
  });

  it('makes the sun path’s item again when anything it reads changes, and only then', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const build = planItemsBuilder();
    const item = (unit: 'metres' | 'feet' = 'metres', locale = 'en', zoneMap = zones) => {
      const shown = shownItems(records(), sceneId, setupId);
      return build(shown, unit, PAPER_COLOURS.ink, locale, new Map(), new Map(), sunLooks(records(), shown, zoneMap, [])).find((i) => i.id === sun);
    };
    let was = item();
    const changed = async (what: string, edit: () => Promise<unknown>) => {
      await edit();
      const now = item();
      expect(now, what).not.toBe(was);
      was = now;
    };
    // An edit elsewhere (a frame's name) leaves it as it was.
    await store.getState().apply([{ kind: 'update', id: 'a', set: { name: 'Mary wipes the counter' } }]);
    expect(item()).toBe(was);
    await changed('its record', () => store.getState().apply([{ kind: 'update', id: sun, set: { time: '15:00' } }]));
    await changed('the room’s north', () => store.getState().apply([{ kind: 'update', id: north, set: { rotation: 45 } }]));
    // A frame of the setup on the same day changes nothing drawn; one on an earlier day is the one drawn.
    await store.getState().apply([{ kind: 'create', record: { id: 'b', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, shoot_day_id: 'd1' } } }]);
    expect(item()).toBe(was);
    await changed('the setup’s frames', () =>
      store.getState().apply([
        { kind: 'create', record: { id: 'd0', type: 'shoot_day', parentId: project.projectId, sortKey: 'b', props: { date: '2026-06-01' } } },
        { kind: 'create', record: { id: 'c', type: 'shot', parentId: sceneId, sortKey: 'c', props: { number: '1C', setup_id: setupId, shoot_day_id: 'd0' } } },
      ]),
    );
    await store.getState().apply([{ kind: 'trash', id: 'c' }]);
    await changed('the frame’s day', () => store.getState().apply([{ kind: 'update', id: 'a', unset: ['shoot_day_id'] }, { kind: 'update', id: 'b', unset: ['shoot_day_id'] }]));
    await changed('back in the day', () => store.getState().apply([{ kind: 'update', id: 'a', set: { shoot_day_id: 'd1' } }]));
    await changed('the day’s date', () => store.getState().apply([{ kind: 'update', id: 'd1', set: { date: '2026-12-21' } }]));
    await changed('the location’s place', () => store.getState().apply([{ kind: 'update', id: 'diner', set: { latitude: 34.0522, longitude: -118.2437 } }]));
    await changed('the location’s zone', () => store.getState().apply([{ kind: 'update', id: 'diner', set: { time_zone: 'America/Los_Angeles' } }]));
    // The zone looked up from the place, when the location has none of its own.
    await changed('no zone of its own', () => store.getState().apply([{ kind: 'update', id: 'diner', unset: ['time_zone'] }]));
    const found = new Map([['diner', 'America/Los_Angeles']]);
    const looked = item('metres', 'en', found);
    expect(looked).not.toBe(was);
    was = looked;
    // The language: its words are in it. The unit alone changes nothing it draws, but makes it again (its key holds the unit).
    setLocale('es');
    const spanish = item('metres', 'es', found);
    expect(spanish).not.toBe(was);
    expect(spanish?.label).toMatch(/de altura|bajo el horizonte/);
    setLocale('en');
    expect(item('feet', 'en', found)).not.toBe(spanish);
  });
});

describe('the look’s words (6.6)', () => {
  it('names each thing missing in English and Spanish', async () => {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const look = (): SunLook | undefined => sunLooks(records(), shownItems(records(), sceneId, setupId), new Map(), []).get(sun);
    const lines = () => {
      const l = look();
      return l?.kind === 'missing' ? l.lines : [];
    };
    expect(lines()).toEqual(['No north in this room']);
    await store.getState().apply([{ kind: 'update', id: 'a', unset: ['shoot_day_id'] }]);
    expect(lines()).toEqual(['No shoot day']);
    setLocale('es');
    expect(lines()).toEqual(['Sin día de rodaje']);
  });
});

// The 6.6 review's fixes: one north per room through the Trash, undo and "This setup only"; a north pasted where there
// is no room; a sun path never turned; Fit all taking in its circle; the drawing's words inside the arc, with a paper
// halo; the golden stretches edged in ink; the arc's orientation; no stand-in zone; the height never below 0.

/** Every part of a drawing, its own and its children's, as elements (the drawing is never rendered here). */
function partsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      for (const child of n as ReactNode[]) visit(child);
      return;
    }
    if (!isValidElement<Record<string, unknown>>(n)) return;
    out.push(n);
    visit(n.props.children as ReactNode);
  };
  visit(node);
  return out;
}

/** A word's text element as its component draws it (MonoText is a function of its props). */
const drawnText = (element: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>> =>
  (element.type as (props: Record<string, unknown>) => ReactElement<Record<string, unknown>>)(element.props);

const liveNorths = () => Object.values(records()).filter((r) => r.type === 'plan_item' && r.props.kind === 'north' && r.trashedAt === null);

describe('one north per room, whatever comes back (6.6 review)', () => {
  it('never restores a north into a room that has one: the Trash says so, and the room keeps the north it has', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const roomId = sceneRoomId(records(), records()[sceneId]);
    const first = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: first, set: { rotation: 35 } }]);
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    const second = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: second, set: { rotation: 90 } }]);
    expect(northClash(records(), first)).toBe(true);
    expect(northClash(records(), second)).toBe(false);
    expect(restoreChanges(records(), project.projectId, first)).toEqual([]);
    expect(roomNorth(records(), roomId)).toBe(90);
    // With the room's north deleted too, it comes back.
    await store.getState().apply(trashPlanItemsChanges(records(), [second]));
    expect(northClash(records(), first)).toBe(false);
    await store.getState().apply(restoreChanges(records(), project.projectId, first));
    expect(roomNorth(records(), roomId)).toBe(35);
    expect(liveNorths()).toHaveLength(1);
  });

  it('never brings back a second north through a deleted room; the room itself comes back with its own (6.6 second review)', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
    const a = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: a, set: { rotation: 35 } }]);
    await store.getState().apply(trashPlanItemsChanges(records(), [a]));
    const b = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: b, set: { rotation: 90 } }]);
    const deleted = deleteRoomChanges(records(), sceneId);
    expect(deleted.length).toBeGreaterThan(0);
    await store.getState().apply(deleted);
    expect(records()[b]?.trashedAt).not.toBeNull();
    expect(liveNorths()).toHaveLength(0);
    // Restoring A would bring the room back with B: refused, as the Trash tile's guard says.
    expect(northClash(records(), a)).toBe(true);
    expect(restoreChanges(records(), project.projectId, a)).toEqual([]);
    // The room itself comes back with B alone, A still in the Trash.
    expect(northClash(records(), roomId)).toBe(false);
    const room = restoreChanges(records(), project.projectId, roomId);
    expect(room.some((c) => c.kind === 'restore' && c.id === b)).toBe(true);
    expect(room.some((c) => c.kind === 'restore' && c.id === a)).toBe(false);
    await store.getState().apply(room);
    expect(liveNorths().map((r) => r.id)).toEqual([b]);
    expect(roomNorth(records(), roomId)).toBe(90);
  });

  it('undo walks back the later north before the delete it followed: never two at once', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const roomId = sceneRoomId(records(), records()[sceneId]);
    const first = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: first, set: { rotation: 35 } }]);
    await store.getState().apply(trashPlanItemsChanges(records(), [first]));
    const second = await place(view, 'production/north');
    await store.getState().apply([{ kind: 'update', id: second, set: { rotation: 90 } }]);
    await store.getState().undo();
    expect(roomNorth(records(), roomId)).toBe(0);
    await store.getState().undo();
    // The later placement undone: no north at all, the first still in the Trash.
    expect(liveNorths()).toHaveLength(0);
    await store.getState().undo();
    expect(liveNorths().map((r) => r.id)).toEqual([first]);
    expect(roomNorth(records(), roomId)).toBe(35);
  });

  it('"This setup only" off moves a setup’s north to its room only where the room has none, and only one', async () => {
    const { sceneId, setupId } = await scene();
    const view = { sceneId, setupId };
    const roomId = sceneRoomId(records(), records()[sceneId]);
    const inRoom = await place(view, 'production/north');
    // An imported file's: norths in the setup's own plan.
    await place(view, 'lighting/sun-path');
    const planId = setupPlanOf(records(), setupId)?.id ?? '';
    const north = (id: string, sortKey: string) => ({ kind: 'create' as const, record: { id, type: 'plan_item' as const, parentId: planId, sortKey, props: { kind: 'north', icon: 'production/north', x: 0, y: 0, width: 0.28, height: 0.6, rotation: 50 } } });
    await store.getState().apply([north('n2', 'x1'), north('n3', 'x2')]);
    expect(setupOnlyChanges(records(), sceneId, setupId, ['n2'], false)).toEqual([]);
    await store.getState().apply(trashPlanItemsChanges(records(), [inRoom]));
    const back = setupOnlyChanges(records(), sceneId, setupId, ['n2', 'n3'], false);
    expect(back.filter((c) => c.kind === 'move')).toEqual([expect.objectContaining({ id: 'n2', parentId: roomId })]);
  });

  it('a north pasted into a scene with no room is left out, as any item with nowhere to go', async () => {
    const { sceneId, setupId } = await scene();
    const north = await place({ sceneId, setupId }, 'production/north');
    const other = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: '3', props: { number: '3' } } }]);
    const pasted = planPasteInView(records(), { sceneId: other, setupId: null }, planClipOf(records(), [north]), null);
    expect(pasted).toEqual({ ids: [], changes: [], leftOut: 1 });
  });
});

describe('a sun path’s reading (6.6 review)', () => {
  it('reads its rotation as 0, so one imported turned is drawn upright', async () => {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    await store.getState().apply([{ kind: 'update', id: sun, set: { rotation: 30 } }]);
    expect(sunFields(records()[sun]?.props ?? {})?.rotation).toBe(0);
    const shown = shownItems(records(), sceneId, setupId);
    const item = planItemsBuilder()(shown, 'metres', PAPER_COLOURS.ink, 'en', new Map(), new Map(), sunLooks(records(), shown, new Map(), [])).find((i) => i.id === sun);
    expect(item?.rotation).toBe(0);
  });

  it('reads only from the setup’s own plan, its first live one, as a camera does', async () => {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    expect(sunSetupId(records(), records()[sun] as SbdRecord)).toBe(setupId);
    const props = records()[sun]?.props ?? {};
    await store.getState().apply([
      { kind: 'create', record: { id: 'plan2', type: 'plan', parentId: setupId, sortKey: 'zz', props: { kind: 'setup', name: '' } } },
      { kind: 'create', record: { id: 'sun2', type: 'plan_item', parentId: 'plan2', sortKey: 'a', props } },
    ]);
    const copy = 'sun2';
    expect(sunSetupId(records(), records()[copy] as SbdRecord)).toBeNull();
    expect(sunSetupId(records(), records()[sun] as SbdRecord)).toBe(itemSetupId(records(), records()[sun] as SbdRecord));
  });

  it('never takes a stand-in zone: no entry is the lookup on its way (icon alone), null is "No time zone"', async () => {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    await place({ sceneId, setupId }, 'production/north');
    await store.getState().apply([{ kind: 'update', id: 'diner', unset: ['time_zone'] }]);
    expect(sunReading(records(), sun, new Map())).toMatchObject({ missing: 'noZone', pending: true });
    expect(sunReading(records(), sun, new Map([['diner', null]]))).toEqual({ missing: 'noZone', locationId: 'diner' });
    const look = (zones: ReadonlyMap<string, string | null>) => sunLooks(records(), shownItems(records(), sceneId, setupId), zones, []).get(sun);
    expect(look(new Map())).toEqual({ kind: 'missing', lines: [], selected: false });
    expect(look(new Map([['diner', null]]))).toEqual({ kind: 'missing', lines: ['No time zone'], selected: false });
    expect(look(new Map([['diner', 'America/New_York']]))?.kind).toBe('drawn');
  });

  it('draws for the earliest of two days with one date and one sort key by their ids, whatever order they were read in', async () => {
    const { sceneId, setupId } = await scene();
    await place({ sceneId, setupId }, 'production/north');
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    await store.getState().apply([
      { kind: 'create', record: { id: 'z-day', type: 'shoot_day', parentId: project.projectId, sortKey: 'k', props: { date: '2026-06-01' } } },
      { kind: 'create', record: { id: 'b-day', type: 'shoot_day', parentId: project.projectId, sortKey: 'k', props: { date: '2026-06-01' } } },
      { kind: 'update', id: 'a', set: { shoot_day_id: 'z-day' } },
      { kind: 'create', record: { id: 'b', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, shoot_day_id: 'b-day' } } },
    ]);
    const reading = sunReading(records(), sun, new Map());
    expect(reading && 'source' in reading ? reading.source.day.record.id : null).toBe('b-day');
  });

  it('says the height in whole degrees, never below 0 while the sun counts as up', () => {
    expect(shownHeight(-0.6)).toBe(0);
    expect(shownHeight(-0.4)).toBe(0);
    expect(Object.is(shownHeight(-0.4), -0)).toBe(false);
    expect(shownHeight(37.6)).toBe(38);
    const at = { time: '05:26', instant: new Date(0), bearing: 58.2, altitude: -0.7, apparent: -0.2, up: true };
    expect(sunLabel(at)).toBe('05:26 · 58° · 0° high');
    expect(sunLabel({ ...at, up: false })).toBe('05:26 · the sun is down');
  });
});

describe('the sun path’s drawing (6.6 review)', () => {
  const ny = new Map<string, string | null>();

  /** Scene 1's sun path at 14:30 and its room's north, placed once per test. */
  async function placed() {
    const { sceneId, setupId } = await scene();
    const sun = await place({ sceneId, setupId }, 'lighting/sun-path');
    const north = await place({ sceneId, setupId }, 'production/north');
    await store.getState().apply([{ kind: 'update', id: sun, set: { time: '14:30' } }]);
    return { sceneId, setupId, sun, north };
  }

  /** The sun path drawn with the room's north turned to `turn`. */
  async function drawn(turn: number, at?: Awaited<ReturnType<typeof placed>>) {
    const { sceneId, setupId, sun, north } = at ?? (await placed());
    await store.getState().apply([{ kind: 'update', id: north, set: { rotation: turn } }]);
    const shown = shownItems(records(), sceneId, setupId);
    const looks = sunLooks(records(), shown, ny, []);
    const look = looks.get(sun);
    if (look?.kind !== 'drawn') throw new Error('not drawn');
    const item = planItemsBuilder()(shown, 'metres', PAPER_COLOURS.ink, 'en', new Map(), new Map(), looks).find((i) => i.id === sun);
    return { look, item };
  }

  it('turns the arc with north: up the plan, rise on the right and set on the left; north at 90°, rise below and set above', async () => {
    // New York, 21 June: sunrise bears about 58°, sunset about 302° (clockwise from north). With north up the plan, 58°
    // is up and to the right (x = sin 58° > 0) and 302° up and to the left (x < 0). With north turned 90° clockwise,
    // they turn with it: 148° from up the plan is down and to the right (y = −cos 148° > 0, y down) and 392° = 32° up
    // and to the right (y < 0).
    const at = await placed();
    const up = (await drawn(0, at)).look;
    expect(up.rise?.x).toBeGreaterThan(0.5);
    expect(up.set?.x).toBeLessThan(-0.5);
    // The arc starts at sunrise and ends at sunset.
    const first = up.segments[0]?.points ?? [];
    const last = up.segments.at(-1)?.points ?? [];
    expect(first[0]).toBeCloseTo((up.rise?.x ?? 0) * up.radius, 0);
    expect(last.at(-2)).toBeCloseTo((up.set?.x ?? 0) * up.radius, 0);
    const turned = (await drawn(90, at)).look;
    expect(turned.rise?.y).toBeGreaterThan(0.5);
    expect(turned.set?.y).toBeLessThan(-0.5);
  });

  it('draws the shadows line straight opposite the sun’s', async () => {
    const { look } = await drawn(30);
    const parts = partsOf(SunBeyond({ width: 80, height: 80, zoom: 1, rotation: 0, colours: PAPER_COLOURS, look }));
    const lines = parts.filter((p) => p.type === Line);
    const fromMiddle = (p: ReactElement<Record<string, unknown>>) => {
      const points = p.props.points as number[];
      return points[0] === 0 && points[1] === 0 ? points : null;
    };
    const sunLine = lines.find((p) => fromMiddle(p) && p.props.dash === undefined);
    const shadowLine = lines.find((p) => fromMiddle(p) && p.props.dash !== undefined);
    const s = sunLine?.props.points as number[];
    const d = shadowLine?.props.points as number[];
    const sunLength = Math.hypot(s[2] ?? 0, s[3] ?? 0);
    const shadowLength = Math.hypot(d[2] ?? 0, d[3] ?? 0);
    expect((d[2] ?? 0) / shadowLength).toBeCloseTo(-(s[2] ?? 0) / sunLength, 6);
    expect((d[3] ?? 0) / shadowLength).toBeCloseTo(-(s[3] ?? 0) / sunLength, 6);
  });

  it('edges each golden stretch in ink: ink 5 px under gold 3 px, at every zoom', async () => {
    const { look } = await drawn(0);
    const parts = partsOf(SunBeyond({ width: 80, height: 80, zoom: 0.5, rotation: 0, colours: PAPER_COLOURS, look }));
    const gold = parts.filter((p) => p.type === Line && p.props.stroke === GOLDEN_HOUR);
    const casings = parts.filter((p) => p.type === Line && p.props.name === 'golden-casing');
    expect(gold.length).toBe(look.segments.filter((s) => s.golden).length);
    expect(gold.length).toBeGreaterThan(0);
    expect(casings).toHaveLength(gold.length);
    for (const [i, line] of gold.entries()) {
      expect(line.props).toMatchObject({ strokeWidth: 3, strokeScaleEnabled: false });
      expect(casings[i]?.props).toMatchObject({ stroke: PAPER_COLOURS.ink, strokeWidth: 5, strokeScaleEnabled: false, points: line.props.points });
      // The casing first, so the gold is drawn over it.
      expect(parts.indexOf(casings[i] as ReactElement<Record<string, unknown>>)).toBeLessThan(parts.indexOf(line));
    }
  });

  it('lays every word inside the arc, each with a paper halo', async () => {
    const at = await placed();
    // Up close and zoomed out, where the sun's label takes a line per part to stay inside.
    for (const [north, zoom] of [[0, 1], [90, 1], [200, 1], [0, 0.4], [135, 0.4]] as const) {
      const { look } = await drawn(north, at);
      const parts = partsOf(SunBeyond({ width: 80, height: 80, zoom, rotation: 0, colours: PAPER_COLOURS, look }));
      const texts = parts.filter((p) => typeof p.type === 'function' && 'text' in p.props).map(drawnText);
      // The hours, sunrise and sunset, the sun's label and "shadows".
      expect(texts.length).toBe(look.hours.length + 2 + 2);
      for (const text of texts) {
        const size = text.props.fontSize as number;
        const word = text.props.text as string;
        const lines = word.split('\n');
        const half = (Math.max(...lines.map((l) => l.length)) * 0.6 * size) / 2;
        const tall = lines.length === 1 ? size : lines.length * size * 1.2;
        const cx = (text.props.x as number) + (text.props.width as number) / 2;
        const cy = (text.props.y as number) + tall / 2;
        // Every corner of the word's box inside the circle.
        for (const [dx, dy] of [[-half, -tall / 2], [half, -tall / 2], [half, tall / 2], [-half, tall / 2]] as const) {
          expect(Math.hypot(cx + dx, cy + dy), `${word} at north ${String(north)}, zoom ${String(zoom)}`).toBeLessThan(look.radius);
        }
        expect(text.props).toMatchObject({ stroke: PAPER, strokeWidth: HALO_PIXELS / zoom, fillAfterStrokeEnabled: true, fill: PAPER_COLOURS.ink });
      }
      const label = zoom === 1 ? look.label : look.label.split(' · ').join('\n');
      expect(texts.map((t) => t.props.text)).toEqual(expect.arrayContaining([label, look.shadows, look.rise?.label, look.set?.label]));
    }
  });

  it('gives an upright label a paper halo through the shared label code', () => {
    const labels = UprightLabels({ width: 40, height: 40, zoom: 1, rotation: 30, colours: PAPER_COLOURS, lines: ['A · 35 mm · 54.4°', '1.20 m'] });
    const texts = partsOf(labels).filter((p) => p.type === Text);
    expect(texts).toHaveLength(2);
    for (const text of texts) expect(text.props).toMatchObject({ stroke: PAPER, strokeWidth: HALO_PIXELS, fillAfterStrokeEnabled: true });
  });

  it('counts its whole 3 m circle for Fit all; with something missing, its box alone', async () => {
    const at = await placed();
    const { item, look } = await drawn(0, at);
    const centre = { x: (item?.x ?? 0) + (item?.width ?? 0) / 2, y: (item?.y ?? 0) + (item?.height ?? 0) / 2 };
    expect(item?.fitExtent).toEqual({ x: centre.x - look.radius, y: centre.y - look.radius, width: 2 * look.radius, height: 2 * look.radius });
    // Far smaller than what is kept drawn for culling.
    expect(item?.beyond?.bounds.width ?? 0).toBeGreaterThan(item?.fitExtent?.width ?? 0);
    // With no north, nothing drawn: its box alone.
    await store.getState().apply(trashPlanItemsChanges(records(), [at.north]));
    const shown = shownItems(records(), at.sceneId, at.setupId);
    const missing = planItemsBuilder()(shown, 'metres', PAPER_COLOURS.ink, 'en', new Map(), new Map(), sunLooks(records(), shown, ny, [])).find((i) => i.id === at.sun);
    expect(missing?.fitExtent).toBeUndefined();
  });

  it('keeps every label’s halo HALO_PIXELS wide on screen at every zoom (6.6 second review)', async () => {
    // Konva scales a text's stroke with the view whatever strokeScaleEnabled says, so the width is in plan units:
    // strokeWidth × zoom is what shows on screen.
    const { look } = await drawn(0);
    for (const zoom of [0.25, 1, 4]) {
      const camera = partsOf(UprightLabels({ width: 40, height: 40, zoom, rotation: 0, colours: PAPER_COLOURS, lines: ['A · 35 mm'] })).filter((p) => p.type === Text);
      const beside = partsOf(BesideLabels({ width: 300, height: 10, zoom, rotation: 0, colours: PAPER_COLOURS, spec: { lines: ['2.40 m'], side: 1, edge: 5 } })).filter((p) => p.type === Text);
      const sun = partsOf(SunBeyond({ width: 80, height: 80, zoom, rotation: 0, colours: PAPER_COLOURS, look }))
        .filter((p) => typeof p.type === 'function' && 'text' in p.props)
        .map(drawnText);
      for (const [what, texts] of [['camera', camera], ['beside', beside], ['sun', sun]] as const) {
        expect(texts.length, what).toBeGreaterThan(0);
        for (const text of texts) {
          expect((text.props.strokeWidth as number) * zoom, `${what} at zoom ${String(zoom)}`).toBeCloseTo(HALO_PIXELS, 9);
          expect(text.props.strokeScaleEnabled, what).toBeUndefined();
        }
      }
    }
  });

  it('draws only the arc, its golden stretches and the sun where the circle is too small for words (zoom 0.1)', async () => {
    const { look } = await drawn(0);
    const parts = partsOf(SunBeyond({ width: 80, height: 80, zoom: 0.1, rotation: 0, colours: PAPER_COLOURS, look }));
    expect(parts.filter((p) => 'text' in p.props)).toHaveLength(0);
    const lines = parts.filter((p) => p.type === Line);
    expect(lines.filter((p) => p.props.stroke === GOLDEN_HOUR).length).toBe(look.segments.filter((s) => s.golden).length);
    // The arc's stretches, each golden one over its casing, and the sun's line; no ticks, no shadow line.
    const golden = look.segments.filter((s) => s.golden).length;
    expect(lines).toHaveLength(look.segments.length + golden + 1);
    expect(lines.filter((p) => p.props.dash !== undefined)).toHaveLength(0);
    expect(parts.filter((p) => p.type === Circle)).toHaveLength(1);
    // Up close, the words are back.
    const near = partsOf(SunBeyond({ width: 80, height: 80, zoom: 1, rotation: 0, colours: PAPER_COLOURS, look }));
    expect(near.filter((p) => typeof p.type === 'function' && 'text' in p.props).length).toBe(look.hours.length + 4);
  });
});

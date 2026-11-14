import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { northFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges, sunFields } from '../../../core/model/plan';
import { roomNorth } from '../../../core/model/planSun';
import { planVector } from '../../../core/model/sunPath';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { restoreChanges, trashItems } from '../../trash/trash';
import { iconRefusal, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView, trashPlanItemsChanges, turnChanges, turnsByKey, unreadableAfter } from './planItems';
import { placeIcon } from './planActions';
import { planStore } from './planStore';
import { sunLooks } from './sunLooks';
import type { SunLook } from './sunDraw';

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
    expect(northFields(records()[north]?.props ?? {})).toMatchObject({ kind: 'north', icon: 'production/north', x: 0.7, y: 0.7, width: 0.6, height: 0.6, rotation: 0 });
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

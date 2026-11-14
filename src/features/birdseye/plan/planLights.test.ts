import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { gripFields, lightFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import { lightWatts } from '../../../core/model/planLight';
import { copySetupChanges, separateCopyChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { gearWattsChange } from '../../gear/gearEdits';
import { beamWedge } from './lightDraw';
import { lightLooks, wattsLabel } from './lightLooks';
import { parseBeam, parseWatts } from './LightSelection';
import { frameSizeChanges, heightLines, iconCentre, placeIconChanges, planClipOf, planItemsBuilder, planPasteInView, turnChanges, unreadableAfter } from './planItems';
import { LIGHT_TOOL, PLAN_TOOLS } from './planScale';

// Lights, flags and diffusion on a plan (6.5): placed from the Library or the L tool into the setup shown, drawn with
// their beam (or soft circle) and labels past their box, turned by the turn keys, sized by the names crews use, and
// copied with their gear item, watts and beam.

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

/** A scene with two setups, its room started, a frame in the first, and a 1,200 W fresnel in Gear. */
async function scene(): Promise<{ sceneId: string; setupId: string; otherId: string }> {
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  await store.getState().apply([
    { kind: 'create', record: { id: 'k1', type: 'gear_item', parentId: project.projectId, sortKey: 'a', props: { name: 'Fresnel 1K', department: 'grip-electric', watts: 1200 } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1', name: 'Diner' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: otherId, type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId } } },
  ]);
  await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
  expect(sceneRoomId(records(), records()[sceneId])).not.toBeNull();
  return { sceneId, setupId, otherId };
}

async function place(view: { sceneId: string; setupId: string | null }, icon: string, centre = { x: 0, y: 0 }): Promise<string> {
  const id = crypto.randomUUID();
  const changes = placeIconChanges(records(), view, icon, centre, id);
  expect(changes.length).toBeGreaterThan(0);
  await store.getState().apply(changes);
  return id;
}

describe('placing lights, flags and diffusion (6.5)', () => {
  it('puts a light as a `light`, a flag as a `flag` and a frame as a `diffusion` in the setup shown, at their sizes', async () => {
    const { sceneId, setupId } = await scene();
    const fresnel = await place({ sceneId, setupId }, 'lighting/fresnel', { x: 1, y: 2 });
    const flag = await place({ sceneId, setupId }, 'grip/flag');
    const frame = await place({ sceneId, setupId }, 'grip/overhead-8x8');
    expect(records()[fresnel]?.parentId).toBe(setupPlanOf(records(), setupId)?.id);
    expect(lightFields(records()[fresnel]?.props ?? {})).toMatchObject({ kind: 'light', icon: 'lighting/fresnel', x: 0.8, y: 1.8, width: 0.4, height: 0.4, gearId: null, watts: null, beamDeg: null });
    expect(gripFields(records()[flag]?.props ?? {})).toMatchObject({ kind: 'flag', icon: 'grip/flag', width: 0.91, height: 0.05 });
    expect(gripFields(records()[frame]?.props ?? {})).toMatchObject({ kind: 'diffusion', icon: 'grip/overhead-8x8', width: 2.44, height: 2.44 });
    // The beam is a picture, the sun path comes later, and with only the scene shown a light has no setup to go in.
    expect(placeIconChanges(records(), { sceneId, setupId }, 'lighting/beam-cone', { x: 0, y: 0 })).toEqual([]);
    expect(placeIconChanges(records(), { sceneId, setupId }, 'lighting/sun-path', { x: 0, y: 0 })).toEqual([]);
    expect(placeIconChanges(records(), { sceneId, setupId: null }, 'lighting/fresnel', { x: 0, y: 0 })).toEqual([]);
  });

  it('has the L tool on the plan, a letter nothing else there uses', () => {
    const keys = PLAN_TOOLS.map((tool) => tool.key);
    expect(PLAN_TOOLS.find((tool) => tool.id === LIGHT_TOOL)?.key).toBe('L');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuses a light written past the plan’s reach, as every item', async () => {
    const { sceneId, setupId } = await scene();
    const id = await place({ sceneId, setupId }, 'lighting/fresnel');
    expect(unreadableAfter(records(), [{ kind: 'update', id, set: { x: 1e308 } }])).toBe(true);
    expect(unreadableAfter(records(), [{ kind: 'update', id, set: { watts: 650 } }])).toBe(false);
  });
});

describe('a light on the canvas (6.5)', () => {
  it('draws its beam past its box, its labels its name, watts (its gear item’s, live) and height, made again when they change', async () => {
    const { sceneId, setupId } = await scene();
    const id = await place({ sceneId, setupId }, 'lighting/fresnel');
    await store.getState().apply([{ kind: 'update', id, set: { gear_id: 'k1', height_m: 2.4, name: 'Key' } }]);
    const build = planItemsBuilder();
    const shown = shownItems(records(), sceneId, setupId);
    const looks = lightLooks(records(), shown, 'metres', []);
    expect(looks.get(id)).toEqual({ degrees: 40, lines: ['Key', '1,200 W', '2.40 m'], selected: false });
    const first = build(shown, 'metres', '#16150F', 'en', new Map(), looks);
    const item = first.find((i) => i.id === id);
    expect(item?.keepRatio).toBe(true);
    // It reaches the whole circle its 4 m beam could sweep, round its middle.
    expect(item?.beyond?.bounds.width).toBeGreaterThanOrEqual(800);
    expect(item?.beyond?.bounds.height).toBeGreaterThanOrEqual(800);
    expect(build(shown, 'metres', '#16150F', 'en', new Map(), lightLooks(records(), shown, 'metres', []))).toBe(first);
    // The gear item's watts changed in Gear: a new light item, with no edit to the plan.
    await store.getState().apply(gearWattsChange(records(), 'k1', 2000));
    const again = lightLooks(records(), shownItems(records(), sceneId, setupId), 'metres', []);
    expect(again.get(id)?.lines).toEqual(['Key', '2,000 W', '2.40 m']);
    expect(build(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en', new Map(), again).find((i) => i.id === id)).not.toBe(item);
  });

  it('points its beam up its box, as wide as its angle; all round has no wedge', () => {
    expect(beamWedge(40)).toEqual({ rotation: -110, angle: 40 });
    expect(beamWedge(120)).toEqual({ rotation: -150, angle: 120 });
    expect(beamWedge(360)).toBeNull();
  });

  it('turns by the turn keys, as a camera does; a flag doesn’t', async () => {
    const { sceneId, setupId } = await scene();
    const light = await place({ sceneId, setupId }, 'lighting/led-panel');
    const flag = await place({ sceneId, setupId }, 'grip/flag');
    expect(turnChanges(records(), [light, flag], 5)).toEqual([{ kind: 'update', id: light, set: { rotation: 5 } }]);
    expect(turnChanges(records(), [light], -5)).toEqual([{ kind: 'update', id: light, set: { rotation: 355 } }]);
  });

  it('draws a set height as a label by any item, its name with it', async () => {
    const { sceneId, setupId } = await scene();
    const stand = await place({ sceneId, setupId }, 'grip/c-stand');
    const build = planItemsBuilder();
    expect(build(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en').find((i) => i.id === stand)?.beyond).toBeUndefined();
    await store.getState().apply([{ kind: 'update', id: stand, set: { height_m: 3, name: 'Backlight stand' } }]);
    expect(build(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en').find((i) => i.id === stand)?.beyond).toBeDefined();
    expect(heightLines({ heightM: 3, name: 'Backlight stand' }, 'metres')).toEqual(['Backlight stand', '3.00 m']);
    expect(heightLines({ heightM: 3, name: '' }, 'feet')).toEqual(['9\' 10"']);
    expect(heightLines({ heightM: null, name: 'X' }, 'metres')).toEqual([]);
  });
});

describe('a frame’s size (6.5)', () => {
  it('changes a standing 4×4 to an 8×8 about its middle, its depth kept; an overhead both sides; one group', async () => {
    const { sceneId, setupId } = await scene();
    const frame = await place({ sceneId, setupId }, 'grip/diffusion-4x4', { x: 1, y: 1 });
    const over = await place({ sceneId, setupId }, 'grip/overhead-8x8');
    const before = iconCentre(gripFields(records()[frame]?.props ?? {}) ?? { x: 0, y: 0, width: 0, height: 0, rotation: 0 });
    await store.getState().apply(frameSizeChanges(records(), [frame, over], '12x12'));
    const after = gripFields(records()[frame]?.props ?? {});
    expect(after).toMatchObject({ width: 3.66, height: 0.05 });
    expect(after && iconCentre(after)).toEqual(before);
    expect(gripFields(records()[over]?.props ?? {})).toMatchObject({ width: 3.66, height: 3.66 });
    await store.getState().undo();
    expect(gripFields(records()[frame]?.props ?? {})).toMatchObject({ width: 1.22 });
    expect(frameSizeChanges(records(), [frame], 'nope')).toEqual([]);
  });
});

describe('copies keep a light’s gear item, watts and beam (6.5)', () => {
  it('in a setup started from another, a paste, a duplicate and a separate copy', async () => {
    const { sceneId, setupId, otherId } = await scene();
    const id = await place({ sceneId, setupId }, 'lighting/fresnel');
    const flag = await place({ sceneId, setupId }, 'grip/floppy');
    await store.getState().apply([
      { kind: 'update', id, set: { gear_id: 'k1', watts: 650, beam_deg: 25 } },
      { kind: 'update', id: flag, set: { gear_id: 'k1' } },
    ]);
    const kept = (props: SbdRecord['props'] | undefined) => ({ gear: props?.gear_id, watts: props?.watts, beam: props?.beam_deg });
    // Start from another setup.
    await store.getState().apply(copySetupChanges(records(), setupId, otherId));
    const copied = shownItems(records(), sceneId, otherId).filter((i) => i.level === 'setup');
    expect(copied.map((i) => kept(i.record.props))).toEqual([
      { gear: 'k1', watts: 650, beam: 25 },
      { gear: 'k1', watts: undefined, beam: undefined },
    ]);
    // Paste and duplicate.
    const pasted = planPasteInView(records(), { sceneId, setupId }, planClipOf(records(), [id]), null);
    await store.getState().apply(pasted.changes);
    expect(pasted.ids.map((p) => kept(records()[p]?.props))).toEqual([{ gear: 'k1', watts: 650, beam: 25 }]);
    expect(lightWatts(records(), pasted.ids[0] ?? '')?.watts).toBe(650);
    // The separate copy of a room carries any such item that sits in the room.
    const room = sceneRoomId(records(), records()[sceneId]) ?? '';
    const other = crypto.randomUUID();
    await store.getState().apply([
      { kind: 'create', record: { id: other, type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '2', room_id: room } } },
      { kind: 'create', record: { id: 'roomLight', type: 'plan_item', parentId: room, sortKey: 'z', props: { kind: 'light', icon: 'lighting/practical', x: 0, y: 0, width: 0.3, height: 0.3, gear_id: 'k1', watts: 60, beam_deg: 360 } } },
    ]);
    await store.getState().apply(separateCopyChanges(records(), project.projectId, other));
    const copyRoom = sceneRoomId(records(), records()[other]);
    const inCopy = Object.values(records()).filter((r) => r.type === 'plan_item' && r.parentId === copyRoom && r.props.kind === 'light');
    expect(inCopy.map((r) => kept(r.props))).toEqual([{ gear: 'k1', watts: 60, beam: 360 }]);
  });
});

describe('typed watts and beams (6.5)', () => {
  it('reads watts as typed, grouped or with a unit, and refuses the rest', () => {
    expect(parseWatts('650')).toBe(650);
    expect(parseWatts('650 W')).toBe(650);
    expect(parseWatts('1,200')).toBe(1200);
    expect(parseWatts('1.200')).toBe(1200);
    expect(parseWatts('7,5')).toBe(7.5);
    expect(parseWatts('0')).toBeNull();
    expect(parseWatts('lots')).toBeNull();
    expect(parseWatts('200000')).toBeNull();
    expect(wattsLabel(4200)).toBe('4,200 W');
  });

  it('reads a beam in degrees, 360 or the words for all round, and refuses the rest', () => {
    expect(parseBeam('40')).toBe(40);
    expect(parseBeam('25°')).toBe(25);
    expect(parseBeam('360')).toBe(360);
    expect(parseBeam('all round')).toBe(360);
    expect(parseBeam('0')).toBeNull();
    expect(parseBeam('400')).toBeNull();
    setLocale('es');
    expect(parseBeam('En todas direcciones')).toBe(360);
  });

  it('writes a gear item’s watts to a tenth, or takes them off', async () => {
    await scene();
    expect(gearWattsChange(records(), 'k1', 650.04)).toEqual([{ kind: 'update', id: 'k1', set: { watts: 650 } }]);
    expect(gearWattsChange(records(), 'k1', 1200)).toEqual([]);
    expect(gearWattsChange(records(), 'k1', null)).toEqual([{ kind: 'update', id: 'k1', unset: ['watts'] }]);
    expect(gearWattsChange(records(), 'k1', -1)).toEqual([]);
  });
});

import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { gripFields, lightFields, sceneRoomId, setupPlanOf, shownItems, startRoomChanges } from '../../../core/model/plan';
import { BEAM_FACING, BEAM_LENGTH_M, beamDirection, beamFacing, LIGHT_ICONS, lightWatts } from '../../../core/model/planLight';
import { copySetupChanges, separateCopyChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { gearWattsChange } from '../../gear/gearEdits';
import { beamAxis, beamWedge } from './lightDraw';
import { lightLooks, wattsLabel } from './lightLooks';
import { parseBeam, parseWatts } from './LightSelection';
import { frameSizeChanges, gripAnnounce, heightLines, iconCentre, placeIconChanges, planClipOf, planItemsBuilder, planGeometryChanges, planPasteInView, turnChanges, unreadableAfter } from './planItems';
import { aFrame, frameLabel, iconLabel } from './iconWords';
import { planLegend } from '../../../core/model/planLegend';
import { LIGHT_TOOL, PLAN_TOOLS, toCanvas } from './planScale';
import { pickBoxOf } from '../../../ui/canvas/hitTest';
import { PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { itemAt } from '../../../ui/canvas/picking';
import { handledSize, MIN_SIZE, shrunkBelow } from '../../../ui/canvas/placement';

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

  // Which way each lighting icon's own drawing shines, read from its vectors (iconBoxes.ts) for this test, apart from
  // BEAM_FACING: the lens's rays up the box, the HMI's and the RGB light's beam and gel to the right, the window's rays
  // down out of it; the all-round ones none.
  const SHINES: Readonly<Record<string, { x: number; y: number } | null>> = {
    'lighting/fresnel': { x: 0, y: -1 },
    'lighting/led-panel': { x: 0, y: -1 },
    'lighting/tube': { x: 0, y: -1 },
    'lighting/cob-softbox': { x: 0, y: -1 },
    'lighting/hmi-par': { x: 1, y: 0 },
    'lighting/china-ball': null,
    'lighting/practical': null,
    'lighting/spacelight': null,
    'lighting/rgb-gel': { x: 1, y: 0 },
    'lighting/window-light': { x: 0, y: 1 },
  };

  it('has a facing for every light it places', () => {
    expect(Object.keys(BEAM_FACING).sort()).toEqual([...LIGHT_ICONS].sort());
    expect(Object.keys(SHINES).sort()).toEqual([...LIGHT_ICONS].sort());
  });

  for (const icon of LIGHT_ICONS) {
    it(`draws ${icon}’s beam the way its drawing shines, turned with the light (6.5 review)`, async () => {
      const { sceneId, setupId } = await scene();
      const id = await place({ sceneId, setupId }, icon);
      const shown = shownItems(records(), sceneId, setupId);
      const item = planItemsBuilder()(shown, 'metres', '#16150F', 'en', new Map(), lightLooks(records(), shown, 'metres', [])).find((i) => i.id === id);
      const drawn = item?.beyond?.draw({ width: item.width, height: item.height, zoom: 1, inView: true, rotation: 0, colours: PAPER_COLOURS }) as ReactElement<{ facing: number; look: { degrees: number } }> | undefined;
      expect(drawn?.props.facing).toBe(beamFacing(icon));
      const axis = beamAxis(drawn?.props.look.degrees ?? 0, drawn?.props.facing ?? 0);
      expect(axis).toEqual(SHINES[icon]);
      // The plan's direction is the light's rotation plus that facing: turned 90°, an up-facing beam points right.
      await store.getState().apply(turnChanges(records(), [id], 90));
      const fields = lightFields(records()[id]?.props ?? {});
      expect(fields && beamDirection(fields)).toBe((90 + beamFacing(icon)) % 360);
    });
  }

  it('draws an all-round light’s soft circle 4 m round its middle, inside its bounds', async () => {
    const { sceneId, setupId } = await scene();
    const id = await place({ sceneId, setupId }, 'lighting/china-ball', { x: 1, y: 2 });
    const shown = shownItems(records(), sceneId, setupId);
    const item = planItemsBuilder()(shown, 'metres', '#16150F', 'en', new Map(), lightLooks(records(), shown, 'metres', [])).find((i) => i.id === id);
    if (!item?.beyond) throw new Error('no beyond');
    expect(beamWedge(360)).toBeNull();
    const radius = toCanvas(BEAM_LENGTH_M);
    expect(radius).toBe(400);
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const b = item.beyond.bounds;
    expect(b.x).toBeLessThanOrEqual(cx - radius);
    expect(b.y).toBeLessThanOrEqual(cy - radius);
    expect(b.x + b.width).toBeGreaterThanOrEqual(cx + radius);
    expect(b.y + b.height).toBeGreaterThanOrEqual(cy + radius);
    // No further than the circle and its box round it: the beam's bounds don't grow with nothing to draw.
    expect(b.width).toBeLessThanOrEqual(2 * radius + item.width + 1);
  });

  it('turns by the turn keys, as a camera does, and so do flags and diffusion (6.5 review); a set piece doesn’t', async () => {
    const { sceneId, setupId } = await scene();
    const light = await place({ sceneId, setupId }, 'lighting/led-panel');
    const flag = await place({ sceneId, setupId }, 'grip/flag');
    const frame = await place({ sceneId, setupId }, 'grip/diffusion-4x4');
    const stand = await place({ sceneId, setupId }, 'grip/c-stand');
    expect(turnChanges(records(), [light, flag, frame, stand], 5)).toEqual([
      { kind: 'update', id: light, set: { rotation: 5 } },
      { kind: 'update', id: flag, set: { rotation: 5 } },
      { kind: 'update', id: frame, set: { rotation: 5 } },
    ]);
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

describe('a standing frame under the handles (6.5 review, M1)', () => {
  it('keeps a 4×4’s 5 cm depth through a turn and a stretch by the handles, and never takes it under a centimetre', async () => {
    const { sceneId, setupId } = await scene();
    const frame = await place({ sceneId, setupId }, 'grip/diffusion-4x4', { x: 1, y: 1 });
    const g = gripFields(records()[frame]?.props ?? {});
    if (!g) throw new Error('no frame');
    const box = { x: toCanvas(g.x), y: toCanvas(g.y), width: toCanvas(g.width), height: toCanvas(g.height) };
    // What the canvas reports for a pure turn (no scale on either side), and for a stretch along its length only.
    const turned = { id: frame, ...box, width: handledSize(box.width, 1, 1), height: handledSize(box.height, 1, 1), rotation: 30 };
    expect(turned).toMatchObject({ width: 122, height: 5 });
    expect(planGeometryChanges(records(), [turned])).toEqual([{ kind: 'update', id: frame, set: { x: g.x, y: g.y, width: 1.22, height: 0.05, rotation: 30 } }]);
    const stretched = { id: frame, ...box, width: handledSize(box.width, 1.5, 1), height: handledSize(box.height, 1, 1), rotation: 0 };
    expect(planGeometryChanges(records(), [stretched])).toEqual([{ kind: 'update', id: frame, set: expect.objectContaining({ width: 1.83, height: 0.05 }) as unknown }]);
    // Squeezed: the plan's least, a centimetre, where a board's least would be 8 units (8 cm here).
    expect(handledSize(box.height, 0.01, 1)).toBe(1);
    expect(handledSize(box.height, 0.01)).toBe(MIN_SIZE);
  });

  it('turns a standing frame by the handles at any zoom: only a side shrunk under the least is refused', () => {
    // 5 cm at 200% is 10 px, under the least (8 units) on screen: a turn keeps it 10 px, and is allowed.
    expect(shrunkBelow(10, 10, 16)).toBe(false);
    expect(shrunkBelow(10, 9, 16)).toBe(true);
    expect(shrunkBelow(10, 12, 16)).toBe(false);
    expect(shrunkBelow(40, 20, 16)).toBe(false);
  });

  it('is picked at least 8 screen pixels thick, about its middle, at any zoom; drawn with its whole box', async () => {
    const { sceneId, setupId } = await scene();
    const frame = await place({ sceneId, setupId }, 'grip/flag', { x: 0, y: 0 });
    const over = await place({ sceneId, setupId }, 'grip/overhead-8x8', { x: 5, y: 5 });
    const built = planItemsBuilder()(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en');
    const item = built.find((i) => i.id === frame);
    expect(item?.pickThickness).toBe(8);
    expect(built.find((i) => i.id === over)?.pickThickness).toBeUndefined();
    if (!item) throw new Error('no item');
    // At 20% the 5 cm bar is 1 px: a click 3 px off its line (15 cm) still picks it; 5 px off doesn't.
    expect(itemAt(built, { x: 0, y: 15 }, 0.2)?.id).toBe(frame);
    expect(itemAt(built, { x: 0, y: 25 }, 0.2)).toBeUndefined();
    // Exactly, without the zoom (a board's rule).
    expect(itemAt(built, { x: 0, y: 15 })).toBeUndefined();
    // At 400% it is 20 px: picked by its box.
    expect(pickBoxOf(item, 4)).toBe(item);
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
    // Never negative, never wrapped round (6.5 review).
    expect(parseBeam('-30')).toBeNull();
    expect(parseBeam('−30°')).toBeNull();
    expect(parseBeam('-0')).toBeNull();
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

  it('refuses watts the Gear tile’s field would refuse, and keeps watts this version can’t read (6.5 review)', async () => {
    await scene();
    for (const bad of [0, -5, 100_001, Number.NaN, Number.POSITIVE_INFINITY]) expect(gearWattsChange(records(), 'k1', bad)).toEqual([]);
    expect(gearWattsChange(records(), 'k1', 100_000)).toEqual([{ kind: 'update', id: 'k1', set: { watts: 100000 } }]);
    await store.getState().apply([{ kind: 'update', id: 'k1', set: { watts: '1.2 kW' } }]);
    expect(gearWattsChange(records(), 'k1', 650)).toEqual([]);
    expect(gearWattsChange(records(), 'k1', null)).toEqual([]);
    expect(records().k1?.props.watts).toBe('1.2 kW');
  });
});

describe('a frame named by its kind and size, never the icon it was placed as (6.5 review)', () => {
  it('reads "Diffusion · 8×8" for a 4×4 made an 8×8, a typed size in the unit shown, in every label', async () => {
    const { sceneId, setupId } = await scene();
    const frame = await place({ sceneId, setupId }, 'grip/diffusion-4x4');
    const bounce = await place({ sceneId, setupId }, 'grip/bounce');
    await store.getState().apply(frameSizeChanges(records(), [frame], '8x8'));
    await store.getState().apply([{ kind: 'update', id: bounce, set: { width: 1.5 } }]);
    const fieldsOf = (id: string) => {
      const fields = gripFields(records()[id]?.props ?? {});
      if (!fields) throw new Error('no frame');
      return fields;
    };
    expect(frameLabel(fieldsOf(frame), 'metres')).toBe('Diffusion · 8×8');
    expect(frameLabel(fieldsOf(bounce), 'metres')).toBe('Bounce · 1.50 m');
    expect(frameLabel(fieldsOf(bounce), 'feet')).toMatch(/^Bounce · 4' 11"$/);
    expect(frameLabel({ icon: 'grip/flag', width: 0.91, height: 0.05 }, 'metres')).toBe('Flag · 2×3');
    expect(frameLabel({ icon: 'grip/overhead-8x8', width: 2, height: 3 }, 'metres')).toBe('Overhead · 2.00 m × 3.00 m');
    // Aloud, and the Trash and History.
    const built = planItemsBuilder()(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en');
    expect(built.find((i) => i.id === frame)?.label).toBe('Diffusion · 8×8, 2.44 m by 0.05 m');
    expect(aFrame(fieldsOf(frame), 'metres')).toBe('a diffusion · 8×8');
    setLocale('es');
    expect(frameLabel(fieldsOf(frame), 'metres')).toBe('Difusión · 8×8');
    expect(gripAnnounce(fieldsOf(bounce), 'metres')).toBe('Rebote · 1.50 m, 1.50 m por 0.05 m');
  });

  it('keeps a light’s gear item, watts and beam through Duplicate', async () => {
    const { sceneId, setupId } = await scene();
    const id = await place({ sceneId, setupId }, 'lighting/fresnel');
    await store.getState().apply([{ kind: 'update', id, set: { gear_id: 'k1', watts: 650, beam_deg: 25 } }]);
    // Duplicate is a paste of the selection's clip taken in its view, with no point (planActions.duplicatePlanSelection).
    const view = { sceneId, setupId };
    const made = planPasteInView(records(), view, planClipOf(records(), [id], view), null);
    await store.getState().apply(made.changes);
    expect(made.ids).toHaveLength(1);
    const copy = records()[made.ids[0] ?? ''];
    expect([copy?.props.gear_id, copy?.props.watts, copy?.props.beam_deg]).toEqual(['k1', 650, 25]);
  });
});

describe('a wall’s, a door’s and a window’s height (6.5 review, decision 11)', () => {
  async function room() {
    const { sceneId, setupId } = await scene();
    const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
    const wall = (id: string, y: number, heightM?: number) => ({
      kind: 'create' as const,
      record: { id, type: 'plan_item' as const, parentId: roomId, sortKey: id, props: { kind: 'wall', x: 0, y, width: 3, height: 0.1, rotation: 0, ...(heightM ? { height_m: heightM } : {}) } },
    });
    await store.getState().apply([
      wall('w1', 0, 2.4),
      wall('w2', 2, 2.4),
      wall('w3', 4, 3),
      wall('w4', 6),
      { kind: 'create', record: { id: 'door', type: 'plan_item', parentId: roomId, sortKey: 'x', props: { kind: 'door', wall_id: 'w1', along_m: 1, width_m: 0.9, height_m: 2.1 } } },
      { kind: 'create', record: { id: 'win', type: 'plan_item', parentId: roomId, sortKey: 'y', props: { kind: 'window', wall_id: 'w2', along_m: 1, width_m: 1.2 } } },
    ]);
    return { sceneId, setupId };
  }

  it('draws a set height as a label: at a wall’s middle, upright, over its ink; by a door; none without one', async () => {
    const { sceneId, setupId } = await room();
    const built = planItemsBuilder()(shownItems(records(), sceneId, setupId), 'metres', '#16150F', 'en');
    const drawnBy = (id: string) => {
      const item = built.find((i) => i.id === id);
      return item?.draw?.({ width: item.width, height: item.height, zoom: 1, inView: true, colours: PAPER_COLOURS }) as ReactElement<{ children?: ReactElement[] }> | undefined;
    };
    // A wall with a height draws its bar and, over it, the label at its middle.
    const labelled = drawnBy('w1')?.props.children ?? [];
    const label = labelled[1] as ReactElement<{ lines: string[]; at: string; rotation: number }> | undefined;
    expect(label?.props).toMatchObject({ lines: ['2.40 m'], at: 'middle', rotation: 0 });
    // One without draws its bar alone.
    expect(drawnBy('w4')?.props.children).toBeUndefined();
    // A door's height is a label by it, past its box; a window without one has none.
    expect(built.find((i) => i.id === 'door')?.beyond).toBeDefined();
    expect(built.find((i) => i.id === 'win')?.beyond).toBeUndefined();
  });

  it('lists the room first in the legend: walls by height with a count, then openings with a height', async () => {
    const { sceneId, setupId } = await room();
    const legend = planLegend(records(), sceneId, setupId, iconLabel);
    expect(legend.room).toEqual([
      { kind: 'wall', metres: 2.4, count: 2 },
      { kind: 'wall', metres: 3, count: 1 },
      { kind: 'door', metres: 2.1, count: 1 },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { gearWatts } from './gear';
import { boxFields, gripFields, lightFields, planItemLayer, shownFields } from './plan';
import {
  ALL_ROUND,
  beamOf,
  BEAM_DEFAULTS,
  defaultBeam,
  FRAME_SIZES,
  frameSizeBox,
  frameSizeOf,
  gripKindOf,
  isAllRound,
  isLightIcon,
  lightBeamChanges,
  lightWatts,
  lightWattsChanges,
  planGearChanges,
  planItemGear,
} from './planLight';
import type { Props, SbdRecord } from './record';

// Lights, flags and diffusion (6.5): their readers, a light's wattage through its one reader, the beam and its
// defaults, the sizes crews call frames by, and the edits.

const at = '2026-11-14T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));
const box = { x: 1, y: 2, width: 0.4, height: 0.4, rotation: 30 };
const light = (id: string, props: Props = {}, trashedAt: string | null = null) => record(id, 'plan_item', 'plan', { kind: 'light', icon: 'lighting/fresnel', ...box, ...props }, trashedAt);

const base = () =>
  recordsOf(
    record('p', 'project', null, {}),
    record('plan', 'plan', 's', { kind: 'setup', name: '' }),
    record('k1', 'gear_item', 'p', { name: 'Fresnel 1K', department: 'grip-electric', watts: 1200 }),
    record('dim', 'gear_item', 'p', { name: 'Dimmer' }),
    record('gone', 'gear_item', 'p', { name: 'Old HMI', watts: 4000 }, at),
    light('typed', { watts: 650, gear_id: 'k1' }),
    light('fromGear', { gear_id: 'k1' }),
    light('trashedGear', { gear_id: 'gone' }),
    light('noWatts', { gear_id: 'dim' }),
    light('bare'),
  );

describe('a light’s fields (6.5)', () => {
  it('reads a light, a flag and a diffusion frame as boxes, with their gear, watts and beam as stored', () => {
    expect(lightFields({ kind: 'light', ...box, gear_id: 'k1', watts: 650, beam_deg: 25, height_m: 2.4, name: 'Key' })).toEqual({
      kind: 'light',
      icon: 'lighting/fresnel',
      ...box,
      heightM: 2.4,
      name: 'Key',
      gearId: 'k1',
      watts: 650,
      beamDeg: 25,
    });
    // Odd values read as none, never dropped from the record.
    expect(lightFields({ kind: 'light', icon: 'lighting/tube', ...box, watts: -5, beam_deg: 400, gear_id: '' })).toMatchObject({ icon: 'lighting/tube', watts: null, beamDeg: null, gearId: null });
    expect(gripFields({ kind: 'flag', ...box })).toMatchObject({ kind: 'flag', icon: 'grip/flag', gearId: null });
    expect(gripFields({ kind: 'diffusion', ...box, icon: 'grip/overhead-8x8', gear_id: 'k1' })).toMatchObject({ kind: 'diffusion', icon: 'grip/overhead-8x8', gearId: 'k1' });
    expect(lightFields({ kind: 'light', x: 1, y: 1, width: 0, height: 1 })).toBeNull();
    expect(gripFields({ kind: 'flag', ...box, x: 1e308 })).toBeNull();
    for (const kind of ['light', 'flag', 'diffusion']) {
      expect(shownFields({ kind, ...box })?.kind).toBe(kind);
      expect(boxFields({ kind, ...box })?.kind).toBe(kind);
    }
    expect(planItemLayer({ kind: 'light' })).toBe('lighting');
    expect(planItemLayer({ kind: 'flag' })).toBe('grip');
    expect(planItemLayer({ kind: 'diffusion' })).toBe('grip');
  });

  it('places each light icon as a light, each flag and frame as its kind, and nothing else', () => {
    expect(isLightIcon('lighting/china-ball')).toBe(true);
    expect(isLightIcon('lighting/beam-cone')).toBe(false);
    expect(isLightIcon('lighting/sun-path')).toBe(false);
    expect(gripKindOf('grip/floppy')).toBe('flag');
    expect(gripKindOf('grip/neg-fill')).toBe('flag');
    expect(gripKindOf('grip/bounce')).toBe('diffusion');
    expect(gripKindOf('grip/overhead-8x8')).toBe('diffusion');
    expect(gripKindOf('grip/c-stand')).toBeNull();
  });
});

describe('a light’s wattage (6.5)', () => {
  it('is typed on the light first, else its gear item’s read live; a trashed gear item or none is unknown', () => {
    const records = base();
    expect(lightWatts(records, 'typed')).toEqual({ from: 'light', watts: 650 });
    expect(lightWatts(records, 'fromGear')).toMatchObject({ from: 'gear', watts: 1200 });
    expect(lightWatts(records, 'trashedGear')).toBeNull();
    expect(lightWatts(records, 'noWatts')).toBeNull();
    expect(lightWatts(records, 'bare')).toBeNull();
    // Live: the gear item's watts changed, the light follows with no edit to it.
    const changed = { ...records, k1: { ...(records.k1 as SbdRecord), props: { ...records.k1?.props, watts: 2000 } } };
    expect(lightWatts(changed, 'fromGear')?.watts).toBe(2000);
    expect(lightWatts(changed, 'typed')?.watts).toBe(650);
    // A light in the Trash has none.
    const gone = { ...records, fromGear: { ...(records.fromGear as SbdRecord), trashedAt: at } };
    expect(lightWatts(gone, 'fromGear')).toBeNull();
  });

  it('reads a gear item’s watts above 0 up to 100 kW, and a plan item’s gear only while it is live', () => {
    expect(gearWatts({ watts: 1200 })).toBe(1200);
    expect(gearWatts({ watts: 0 })).toBeNull();
    expect(gearWatts({ watts: '1200' })).toBeNull();
    expect(gearWatts({ watts: 200000 })).toBeNull();
    const records = base();
    expect(planItemGear(records, records.fromGear?.props ?? {})?.id).toBe('k1');
    expect(planItemGear(records, records.trashedGear?.props ?? {})).toBeNull();
  });
});

describe('a light’s beam (6.5)', () => {
  it('defaults by icon, and the china ball, practical and spacelight shine all round', () => {
    expect(BEAM_DEFAULTS).toEqual({
      'lighting/fresnel': 40,
      'lighting/led-panel': 100,
      'lighting/tube': 120,
      'lighting/cob-softbox': 90,
      'lighting/hmi-par': 30,
      'lighting/china-ball': 360,
      'lighting/practical': 360,
      'lighting/spacelight': 360,
      'lighting/rgb-gel': 60,
      'lighting/window-light': 90,
    });
    const read = (props: Props) => {
      const fields = lightFields({ kind: 'light', ...box, ...props });
      if (!fields) throw new Error('not a light');
      return beamOf(fields);
    };
    expect(read({ icon: 'lighting/hmi-par' })).toBe(30);
    expect(read({ icon: 'lighting/hmi-par', beam_deg: 12.5 })).toBe(12.5);
    expect(read({ icon: 'lighting/practical' })).toBe(ALL_ROUND);
    expect(isAllRound(read({ icon: 'lighting/practical' }))).toBe(true);
    expect(isAllRound(read({ icon: 'lighting/fresnel', beam_deg: 360 }))).toBe(true);
    expect(isAllRound(read({ icon: 'lighting/fresnel' }))).toBe(false);
    // An icon this version doesn't know draws a fresnel's beam.
    expect(defaultBeam('lighting/newer')).toBe(40);
  });
});

describe('frame sizes (6.5)', () => {
  it('holds the names crews use, in metres', () => {
    expect(FRAME_SIZES.map((s) => [s.id, s.short, s.long])).toEqual([
      ['2x3', 0.61, 0.91],
      ['4x4', 1.22, 1.22],
      ['6x6', 1.83, 1.83],
      ['8x8', 2.44, 2.44],
      ['12x12', 3.66, 3.66],
      ['20x20', 6.1, 6.1],
    ]);
  });

  it('sets a standing frame’s width, keeping its depth, and an overhead’s whole size; and reads which size a frame is', () => {
    const [twoByThree, fourByFour, , eightByEight] = FRAME_SIZES;
    if (!twoByThree || !fourByFour || !eightByEight) throw new Error('sizes');
    expect(frameSizeBox({ icon: 'grip/diffusion-4x4', height: 0.05 }, eightByEight)).toEqual({ width: 2.44, depth: 0.05 });
    expect(frameSizeBox({ icon: 'grip/overhead-8x8', height: 2.44 }, twoByThree)).toEqual({ width: 0.91, depth: 0.61 });
    expect(frameSizeOf({ icon: 'grip/diffusion-4x4', width: 1.22, height: 0.05 })?.id).toBe('4x4');
    expect(frameSizeOf({ icon: 'grip/flag', width: 0.91, height: 0.05 })?.id).toBe('2x3');
    expect(frameSizeOf({ icon: 'grip/overhead-8x8', width: 2.44, height: 2.44 })?.id).toBe('8x8');
    expect(frameSizeOf({ icon: 'grip/overhead-8x8', width: 0.61, height: 0.91 })?.id).toBe('2x3');
    // Typed by hand: no name fits.
    expect(frameSizeOf({ icon: 'grip/flag', width: 1.5, height: 0.05 })).toBeNull();
    expect(frameSizeOf({ icon: 'grip/overhead-8x8', width: 2.44, height: 1.22 })).toBeNull();
  });
});

describe('a light’s, flag’s and frame’s edits (6.5)', () => {
  it('picks the gear item each is, or takes it off; never one in the Trash', () => {
    const records = { ...base(), flag: record('flag', 'plan_item', 'plan', { kind: 'flag', icon: 'grip/flag', ...box }) };
    expect(planGearChanges(records, ['bare', 'flag', 'fromGear'], 'k1')).toEqual([
      { kind: 'update', id: 'bare', set: { gear_id: 'k1' } },
      { kind: 'update', id: 'flag', set: { gear_id: 'k1' } },
    ]);
    expect(planGearChanges(records, ['fromGear'], null)).toEqual([{ kind: 'update', id: 'fromGear', unset: ['gear_id'] }]);
    expect(planGearChanges(records, ['bare'], 'gone')).toEqual([]);
    expect(planGearChanges(records, ['bare'], 'nothing')).toEqual([]);
  });

  it('types watts to a tenth or takes them off; refuses none above 0 up to 100 kW', () => {
    const records = base();
    expect(lightWattsChanges(records, ['fromGear'], 650.04)).toEqual([{ kind: 'update', id: 'fromGear', set: { watts: 650 } }]);
    expect(lightWattsChanges(records, ['typed'], 650)).toEqual([]);
    expect(lightWattsChanges(records, ['typed'], null)).toEqual([{ kind: 'update', id: 'typed', unset: ['watts'] }]);
    expect(lightWattsChanges(records, ['bare'], 0)).toEqual([]);
    expect(lightWattsChanges(records, ['bare'], 200000)).toEqual([]);
  });

  it('sets a beam above 0 up to 360, nothing when it is the light’s already', () => {
    const records = base();
    expect(lightBeamChanges(records, ['bare'], 40)).toEqual([]);
    expect(lightBeamChanges(records, ['bare'], 25)).toEqual([{ kind: 'update', id: 'bare', set: { beam_deg: 25 } }]);
    expect(lightBeamChanges(records, ['bare'], 360)).toEqual([{ kind: 'update', id: 'bare', set: { beam_deg: 360 } }]);
    expect(lightBeamChanges(records, ['bare'], 0)).toEqual([]);
    expect(lightBeamChanges(records, ['bare'], 361)).toEqual([]);
  });
});

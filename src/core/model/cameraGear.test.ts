import { afterEach, describe, expect, it } from 'vitest';
import {
  cameraLetterChange,
  framesOutsideRange,
  gearKindChange,
  lensRangeChange,
  lensSqueezeChange,
  sensorModeNameChange,
  sensorModePick,
  sensorSizeChange,
} from '../../features/gear/gearEdits';
import { setLocale } from '../i18n';
import { gearIdsOf, projectGear } from './gear';
import {
  bodyFields,
  defaultBody,
  frameLens,
  frameSqueeze,
  freeLetters,
  gearKind,
  inRange,
  lensFields,
  lensLabel,
  lensSpec,
  pickLens,
  projectBodies,
  projectBodyFields,
  projectLenses,
  rangeMessage,
} from './cameraGear';
import type { Props, SbdRecord } from './record';
import { EQUIVALENT_MODE } from './sensorModes';

// Camera bodies and lenses (6.1): gear items of two kinds, read safely; letters unique; the default body; a frame's
// lens through one reader; and the edits the Gear tile and the Inspector make.

const at = '2026-11-13T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const base = (...extra: SbdRecord[]) =>
  recordsOf(
    record('p', 'project', null, {}),
    record('slider', 'gear_item', 'p', { name: 'Slider' }, 'a'),
    record('fx3', 'gear_item', 'p', { name: 'FX3', kind: 'camera_body', camera_letter: 'B', sensor_width_mm: 35.6, sensor_height_mm: 20 }, 'b'),
    record('mini', 'gear_item', 'p', { name: 'Mini LF', kind: 'camera_body', camera_letter: 'A', sensor_width_mm: 35.64, sensor_height_mm: 20.05 }, 'c'),
    record('p35', 'gear_item', 'p', { name: 'Cooke S4', kind: 'lens', focal_min_mm: 35, focal_max_mm: 35 }, 'd'),
    record('z', 'gear_item', 'p', { name: '', kind: 'lens', focal_min_mm: 24, focal_max_mm: 70, squeeze: 2 }, 'e'),
    record('sc', 'scene', 'p', { number: '1' }),
    record('a', 'shot', 'sc', { number: '1A', lens_mm: 50 }),
    ...extra,
  );

afterEach(() => {
  setLocale('en');
});

describe('what a gear item is', () => {
  it('is gear unless it says camera body or lens: every item from before reads as gear', () => {
    expect(gearKind({})).toBe('gear');
    expect(gearKind({ kind: 'tripod' })).toBe('gear');
    expect(gearKind({ kind: 'camera_body' })).toBe('camera_body');
    expect(gearKind({ kind: 'lens' })).toBe('lens');
  });

  it('counts bodies and lenses as the gear they are: in the catalogue and day lists unchanged', () => {
    const records = base();
    expect(projectGear(records, 'p').map((g) => g.record.id).sort()).toEqual(['fx3', 'mini', 'p35', 'slider', 'z']);
    expect(gearIdsOf({ gear_ids: ['fx3', 'z'] })).toEqual(['fx3', 'z']);
  });

  it('keeps every other prop when it changes, so turning it back loses nothing', () => {
    const records = base();
    expect(gearKindChange(records, 'p35', 'gear')).toEqual([{ kind: 'update', id: 'p35', unset: ['kind'] }]);
    expect(gearKindChange(records, 'p35', 'lens')).toEqual([]);
    // A new body takes the first free letter in the same edit.
    expect(gearKindChange(records, 'slider', 'camera_body')).toEqual([{ kind: 'update', id: 'slider', set: { kind: 'camera_body', camera_letter: 'C' } }]);
    expect(gearKindChange(records, 'slider', 'lens')).toEqual([{ kind: 'update', id: 'slider', set: { kind: 'lens' } }]);
  });
});

describe('camera bodies', () => {
  it('reads a body’s fields safely', () => {
    expect(bodyFields({})).toEqual({ sensorMode: '', sensorWidthMm: null, sensorHeightMm: null, letter: null, focalEquivalent: false });
    expect(bodyFields({ sensor_width_mm: -1, sensor_height_mm: 'x', camera_letter: 'a', sensor_mode: 4 })).toEqual({
      sensorMode: '',
      sensorWidthMm: null,
      sensorHeightMm: null,
      letter: null,
      focalEquivalent: false,
    });
    expect(bodyFields({ sensor_width_mm: 36, sensor_height_mm: 24, camera_letter: 'C', focal_equivalent: true, sensor_mode: EQUIVALENT_MODE }).focalEquivalent).toBe(true);
  });

  it('lists bodies by letter and makes the first the default', () => {
    const records = base();
    expect(projectBodies(records, 'p').map((b) => b.record.id)).toEqual(['mini', 'fx3']);
    expect(defaultBody(records, 'p')?.record.id).toBe('mini');
    // Trashed, the next by letter is the default.
    const trashed = { ...records, mini: { ...records.mini, trashedAt: at } as SbdRecord };
    expect(defaultBody(trashed, 'p')?.record.id).toBe('fx3');
    expect(defaultBody(recordsOf(record('p', 'project', null, {})), 'p')).toBeNull();
  });

  it('offers each letter to one live body only, in order', () => {
    const records = base();
    expect(freeLetters(records, 'p').slice(0, 2)).toEqual(['C', 'D']);
    expect(freeLetters(records, 'p', 'fx3').slice(0, 2)).toEqual(['B', 'C']);
    expect(cameraLetterChange(records, 'fx3', 'A')).toEqual([]);
    expect(cameraLetterChange(records, 'fx3', 'C')).toEqual([{ kind: 'update', id: 'fx3', set: { camera_letter: 'C' } }]);
    expect(cameraLetterChange(records, 'fx3', 'B')).toEqual([]);
    // Not a body: no letter.
    expect(cameraLetterChange(records, 'slider', 'C')).toEqual([]);
  });

  it('reads a letter two live bodies share as the first’s by sort key: a body restored after its letter was reused', () => {
    // FX3 was A cam, went to the Trash, the Mini LF took A, and FX3 came back: both hold A in the file.
    const records = base();
    const both = { ...records, fx3: { ...records.fx3, props: { ...records.fx3?.props, camera_letter: 'A' } } as SbdRecord };
    // FX3 sorts first ('b' before 'c'), so it keeps A; the Mini LF reads as having none.
    expect(projectBodyFields(both, 'p', 'fx3')?.letter).toBe('A');
    expect(projectBodyFields(both, 'p', 'mini')?.letter).toBeNull();
    expect(projectBodies(both, 'p').map((b) => [b.record.id, b.fields.letter])).toEqual([
      ['fx3', 'A'],
      ['mini', null],
    ]);
    // The Mini LF is offered None and the free letters (A isn't one); nothing is rewritten.
    expect(freeLetters(both, 'p', 'mini').slice(0, 2)).toEqual(['B', 'C']);
    expect(cameraLetterChange(both, 'mini', 'A')).toEqual([]);
    expect(cameraLetterChange(both, 'mini', 'B')).toEqual([{ kind: 'update', id: 'mini', set: { camera_letter: 'B' } }]);
    expect(records.mini?.props.camera_letter).toBe('A');
  });

  it('keeps the bodies’ order stable: the lowest letter, then the first made without one, whatever order records load in', () => {
    const records = base();
    // FX3 and the Mini LF both hold A in the file, and a URSA holds B: the Mini LF reads as having none, so B cam is
    // the second body, never the Mini LF beside A.
    const both = {
      ...records,
      fx3: { ...records.fx3, props: { ...records.fx3?.props, camera_letter: 'A' } } as SbdRecord,
      ursa: record('ursa', 'gear_item', 'p', { name: 'URSA', kind: 'camera_body', camera_letter: 'B' }, 'f'),
    };
    const reversed = Object.fromEntries(Object.entries(both).reverse());
    for (const loaded of [both, reversed]) {
      expect(defaultBody(loaded, 'p')?.record.id).toBe('fx3');
      expect(projectBodies(loaded, 'p').map((b) => [b.record.id, b.fields.letter])).toEqual([
        ['fx3', 'A'],
        ['ursa', 'B'],
        ['mini', null],
      ]);
    }
    // Two bodies with the same sort key (made on two computers) and the same letter: the lower id keeps it, in either
    // load order.
    const twins = {
      ...records,
      fx3: { ...records.fx3, sortKey: 'b', props: { ...records.fx3?.props, camera_letter: 'A' } } as SbdRecord,
      mini: { ...records.mini, sortKey: 'b' } as SbdRecord,
    };
    expect(defaultBody(twins, 'p')?.record.id).toBe('fx3');
    expect(defaultBody(Object.fromEntries(Object.entries(twins).reverse()), 'p')?.record.id).toBe('fx3');
    expect(projectBodyFields(Object.fromEntries(Object.entries(twins).reverse()), 'p', 'mini')?.letter).toBeNull();
    // No letters at all: the first made.
    const none = Object.fromEntries(
      Object.entries(records).map(([id, r]): [string, SbdRecord] => [id, r.type === 'gear_item' ? { ...r, props: Object.fromEntries(Object.entries(r.props).filter(([k]) => k !== 'camera_letter')) } : r]),
    );
    expect(defaultBody(none, 'p')?.record.id).toBe('fx3');
    expect(defaultBody(Object.fromEntries(Object.entries(none).reverse()), 'p')?.record.id).toBe('fx3');
    // A lettered body comes before one without, even one made earlier.
    const later = { ...none, mini: { ...none.mini, props: { ...none.mini?.props, camera_letter: 'C' } } as SbdRecord };
    expect(defaultBody(later, 'p')?.record.id).toBe('mini');
  });

  it('takes full-frame equivalents off a body whose size is typed over the phones entry’s, in the same edit', () => {
    const records = base();
    const phone = { ...records, fx3: { ...records.fx3, props: { ...records.fx3?.props, sensor_width_mm: 36, sensor_height_mm: 24, focal_equivalent: true } } as SbdRecord };
    expect(sensorSizeChange(phone, 'fx3', 'sensor_width_mm', 35.6)).toEqual([{ kind: 'update', id: 'fx3', set: { sensor_width_mm: 35.6 }, unset: ['focal_equivalent'] }]);
    expect(sensorSizeChange(phone, 'fx3', 'sensor_height_mm', null)).toEqual([{ kind: 'update', id: 'fx3', unset: ['sensor_height_mm', 'focal_equivalent'] }]);
    // Typed back to 36 × 24 (the other side first), it stays.
    const wide = { ...phone, fx3: { ...phone.fx3, props: { ...phone.fx3.props, sensor_width_mm: 35 } } as SbdRecord };
    expect(sensorSizeChange(wide, 'fx3', 'sensor_width_mm', 36)).toEqual([{ kind: 'update', id: 'fx3', set: { sensor_width_mm: 36 } }]);
    // Picking the phones entry sets it again.
    expect(sensorModePick(records, 'fx3', 'equivalent')[0]).toMatchObject({ set: { focal_equivalent: true } });
  });

  it('fills the mode from the table, then keeps whatever is typed over it', () => {
    const records = base();
    expect(sensorModePick(records, 'fx3', 'minilf-43k-169')).toEqual([
      { kind: 'update', id: 'fx3', set: { sensor_mode: '4.3K LF 16:9', sensor_width_mm: 35.64, sensor_height_mm: 20.05 } },
    ]);
    expect(sensorModePick(records, 'fx3', 'equivalent')).toEqual([
      { kind: 'update', id: 'fx3', set: { sensor_mode: EQUIVALENT_MODE, sensor_width_mm: 36, sensor_height_mm: 24, focal_equivalent: true } },
    ]);
    expect(sensorModePick(records, 'fx3', 'no-such-mode')).toEqual([]);
    expect(sensorSizeChange(records, 'fx3', 'sensor_width_mm', 35.9)).toEqual([{ kind: 'update', id: 'fx3', set: { sensor_width_mm: 35.9 } }]);
    expect(sensorSizeChange(records, 'fx3', 'sensor_width_mm', 0)).toEqual([]);
    expect(sensorSizeChange(records, 'fx3', 'sensor_width_mm', 150)).toEqual([]);
    expect(sensorSizeChange(records, 'fx3', 'sensor_height_mm', null)).toEqual([{ kind: 'update', id: 'fx3', unset: ['sensor_height_mm'] }]);
    expect(sensorModeNameChange(records, 'fx3', ' My mode ')).toEqual([{ kind: 'update', id: 'fx3', set: { sensor_mode: 'My mode' } }]);
  });
});

describe('lenses', () => {
  it('reads a prime, a zoom and odd values safely', () => {
    expect(lensFields({})).toEqual({ range: null, squeeze: 1 });
    expect(lensFields({ focal_min_mm: 35, focal_max_mm: 35 })).toEqual({ range: { min: 35, max: 35 }, squeeze: 1 });
    expect(lensFields({ focal_min_mm: 24, focal_max_mm: 70, squeeze: 2 })).toEqual({ range: { min: 24, max: 70 }, squeeze: 2 });
    // A to shorter than the from reads as a prime; a squeeze out of range as 1.
    expect(lensFields({ focal_min_mm: 70, focal_max_mm: 24, squeeze: 3 })).toEqual({ range: { min: 70, max: 70 }, squeeze: 1 });
    expect(lensFields({ focal_max_mm: 50 })).toEqual({ range: { min: 50, max: 50 }, squeeze: 1 });
    expect(lensFields({ focal_min_mm: -5, squeeze: 0.5 })).toEqual({ range: null, squeeze: 1 });
  });

  it('names a lens by its range and squeeze', () => {
    const records = base();
    const lenses = projectLenses(records, 'p');
    expect(lenses.map(lensLabel)).toEqual(['Cooke S4 · 35 mm', '24–70 mm 2×']);
    expect(lensSpec({ range: null, squeeze: 1 })).toBe('no focal length');
  });

  it('takes a range from ≤ to, and a squeeze from 1 to 2.5', () => {
    const records = base();
    expect(lensRangeChange(records, 'z', 18, 55)).toEqual([{ kind: 'update', id: 'z', set: { focal_min_mm: 18, focal_max_mm: 55 } }]);
    expect(lensRangeChange(records, 'z', 55, 18)).toEqual([]);
    expect(lensRangeChange(records, 'z', 0, 18)).toEqual([]);
    expect(lensRangeChange(records, 'z', 24, 70)).toEqual([]);
    expect(lensRangeChange(records, 'fx3', 24, 70)).toEqual([]);
    expect(lensSqueezeChange(records, 'p35', 1.33)).toEqual([{ kind: 'update', id: 'p35', set: { squeeze: 1.33 } }]);
    expect(lensSqueezeChange(records, 'p35', 2.4)).toEqual([{ kind: 'update', id: 'p35', set: { squeeze: 2.4 } }]);
    expect(lensSqueezeChange(records, 'p35', 1)).toEqual([]);
    expect(lensSqueezeChange(records, 'p35', 0.9)).toEqual([]);
    expect(lensSqueezeChange(records, 'p35', 2.6)).toEqual([]);
    expect(inRange({ range: { min: 24, max: 70 }, squeeze: 1 }, 70)).toBe(true);
    expect(inRange({ range: { min: 24, max: 70 }, squeeze: 1 }, 85)).toBe(false);
  });
});

describe('a lens’s range and the frames using it', () => {
  const frames = (...extra: SbdRecord[]) =>
    base(
      record('b', 'shot', 'sc', { number: '1B', lens_id: 'z', lens_mm: 30 }, 'b'),
      record('c', 'shot', 'sc', { number: '1C', lens_id: 'z', lens_mm: 70 }, 'c'),
      record('d', 'shot', 'sc', { number: '1D', lens_id: 'z', lens_mm: 18 }, 'd'),
      ...extra,
    );

  it('leaves frames inside the new range untouched', () => {
    const records = frames();
    expect(framesOutsideRange(records, 'z', 18, 70)).toEqual([]);
    expect(lensRangeChange(records, 'z', 18, 70)).toEqual([{ kind: 'update', id: 'z', set: { focal_min_mm: 18, focal_max_mm: 70 } }]);
  });

  it('sets each frame outside it to the nearer end, in the same edit as the range', () => {
    const records = frames();
    expect(lensRangeChange(records, 'z', 24, 40)).toEqual([
      { kind: 'update', id: 'z', set: { focal_min_mm: 24, focal_max_mm: 40 } },
      { kind: 'update', id: 'c', set: { lens_mm: 40 } },
      { kind: 'update', id: 'd', set: { lens_mm: 24 } },
    ]);
    // Made a prime: every frame takes its one length.
    expect(framesOutsideRange(records, 'z', 24, 24)).toEqual([
      { id: 'b', mm: 24, trashed: false },
      { id: 'c', mm: 24, trashed: false },
      { id: 'd', mm: 24, trashed: false },
    ]);
  });

  it('sets frames in the Trash too, marked so, and leaves frames of another lens as they are', () => {
    const records = frames(
      record('t', 'shot', 'sc', { number: '1E', lens_id: 'z', lens_mm: 85 }, 't', at),
      record('o', 'shot', 'sc', { number: '1F', lens_id: 'p35', lens_mm: 85 }, 'o'),
    );
    expect(framesOutsideRange(records, 'z', 24, 40)).toEqual([
      { id: 'c', mm: 40, trashed: false },
      { id: 'd', mm: 24, trashed: false },
      { id: 't', mm: 40, trashed: true },
    ]);
    // Only one in the Trash: still set, in the same edit as the range (the Gear tile doesn't ask).
    const onlyTrashed = frames(record('t', 'shot', 'sc', { number: '1E', lens_id: 'z', lens_mm: 85 }, 't', at));
    expect(lensRangeChange(onlyTrashed, 'z', 18, 70)).toEqual([
      { kind: 'update', id: 'z', set: { focal_min_mm: 18, focal_max_mm: 70 } },
      { kind: 'update', id: 't', set: { lens_mm: 70 } },
    ]);
  });

  it('gives a frame of the lens with no focal length the wide end, as picking the lens does', () => {
    const records = frames(record('n', 'shot', 'sc', { number: '1G', lens_id: 'z' }, 'n'));
    expect(framesOutsideRange(records, 'z', 18, 70)).toEqual([{ id: 'n', mm: 18, trashed: false }]);
    expect(lensRangeChange(records, 'z', 18, 70)).toEqual([
      { kind: 'update', id: 'z', set: { focal_min_mm: 18, focal_max_mm: 70 } },
      { kind: 'update', id: 'n', set: { lens_mm: 18 } },
    ]);
    // One this version can't read (a newer one's) is never written over.
    const odd = frames(record('n', 'shot', 'sc', { number: '1G', lens_id: 'z', lens_mm: 'wide' }, 'n'));
    expect(framesOutsideRange(odd, 'z', 18, 70)).toEqual([]);
  });

  it('leaves frames whose lens is in the Trash as they are: no range change reaches them', () => {
    const records = frames();
    const trashed = { ...records, z: { ...records.z, trashedAt: at } as SbdRecord };
    expect(framesOutsideRange(trashed, 'z', 24, 40)).toEqual([]);
    expect(lensRangeChange(trashed, 'z', 24, 40)).toEqual([]);
  });

  it('says the range in the Inspector’s words', () => {
    expect(rangeMessage({ min: 24, max: 70 })).toBe('This lens goes from 24 to 70 mm.');
    expect(rangeMessage({ min: 35, max: 35 })).toBe('This lens is 35 mm.');
  });
});

describe('a frame’s lens', () => {
  it('reads through one reader: a live lens, else none and squeeze 1', () => {
    const shot = (lensId: unknown) => record('a', 'shot', 'sc', { lens_id: lensId as never });
    const records = base();
    expect(frameLens(records, shot('z'))?.record.id).toBe('z');
    expect(frameSqueeze(records, shot('z'))).toBe(2);
    for (const id of ['nothing', '', 3, undefined, 'fx3', 'slider']) {
      expect(frameLens(records, shot(id)), String(id)).toBeNull();
      expect(frameSqueeze(records, shot(id))).toBe(1);
    }
    // In the Trash: none, and the frame keeps its id, so a restore brings it back.
    const trashed = { ...records, z: { ...records.z, trashedAt: at } as SbdRecord };
    expect(frameLens(trashed, shot('z'))).toBeNull();
    expect(frameSqueeze(trashed, shot('z'))).toBe(1);
  });

  it('picks a prime with its focal length, a zoom keeping the frame’s inside its range or the nearest end', () => {
    const records = base();
    expect(pickLens(records, 'a', 'p35')).toEqual([{ kind: 'update', id: 'a', set: { lens_id: 'p35', lens_mm: 35 } }]);
    expect(pickLens(records, 'a', 'z')).toEqual([{ kind: 'update', id: 'a', set: { lens_id: 'z' } }]);
    const long = { ...records, a: { ...records.a, props: { lens_mm: 135 } } as SbdRecord };
    expect(pickLens(long, 'a', 'z')).toEqual([{ kind: 'update', id: 'a', set: { lens_id: 'z', lens_mm: 70 } }]);
    const wide = { ...records, a: { ...records.a, props: { lens_mm: 12 } } as SbdRecord };
    expect(pickLens(wide, 'a', 'z')).toEqual([{ kind: 'update', id: 'a', set: { lens_id: 'z', lens_mm: 24 } }]);
    const none = { ...records, a: { ...records.a, props: {} } as SbdRecord };
    expect(pickLens(none, 'a', 'z')).toEqual([{ kind: 'update', id: 'a', set: { lens_id: 'z', lens_mm: 24 } }]);
    // No lens picked keeps the focal length.
    const picked = { ...records, a: { ...records.a, props: { lens_id: 'z', lens_mm: 50 } } as SbdRecord };
    expect(pickLens(picked, 'a', null)).toEqual([{ kind: 'update', id: 'a', unset: ['lens_id'] }]);
    expect(pickLens(picked, 'a', 'z')).toEqual([]);
    expect(pickLens(records, 'a', null)).toEqual([]);
    // Only live lenses.
    expect(pickLens(records, 'a', 'fx3')).toEqual([]);
    expect(pickLens(records, 'a', 'gone')).toEqual([]);
  });
});

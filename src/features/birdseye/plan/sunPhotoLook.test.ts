import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../core/i18n';
import { compassModel, sameCompassModel } from '../../../core/model/planCompass';
import type { Props, SbdRecord } from '../../../core/model/record';
import { planVector } from '../../../core/model/sunPath';
import { sunReadingOf } from '../../../core/model/sunSources';
import { sunLookOf } from './sunLooks';

// The light reference photo on the plan (6.27): a sun path shown at the photo's time draws the photo's date's path and a
// mark where the sun stood when the photo was taken, "Photo Nov 3, 16:42"; with the switch off its look has no mark at all, as
// before. The compass reads the same reading. The place is made up: a point in the open Atlantic.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({ id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
const box = { x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0 };
const image = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600 };

const project = (sun: Props = {}, photo: Props = {}, location: Props = { light_photo_id: 'dusk' }): Records =>
  Object.fromEntries(
    [
      record('p', 'project', null, { name: 'Bey County' }),
      record('quay', 'location', 'p', { name: 'Quay', latitude: 12.51, longitude: -45.25, map_name: '12.51000, -45.25000', time_zone: 'Etc/GMT+3', ...location }),
      record('dusk', 'media', 'quay', { ...image, source_name: 'quay-dusk.jpg', taken_at: '2026-11-03T16:42:07', ...photo }),
      record('room', 'plan', 'p', { kind: 'room', name: 'Quay' }),
      record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 20 }),
      record('s1', 'scene', 'p', { number: '1', location_id: 'quay', room_id: 'room' }),
      record('u1', 'setup', 's1', { name: '' }),
      record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
      record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, time: '13:00', ...sun }),
      record('d1', 'shoot_day', 'p', { date: '2027-06-21' }, 'a'),
      record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', shoot_day_id: 'd1' }, 'a'),
    ].map((r) => [r.id, r]),
  );
const none = new Map<string, string | null>();

beforeEach(() => {
  setLocale('en');
});

describe('a sun path shown at the light reference photo’s time (6.27)', () => {
  it('marks where the sun stood when the photo was taken, with its time', () => {
    const records = project({ at_photo: true });
    const reading = sunReadingOf(records, 'sun', none);
    if (!reading || 'missing' in reading || !reading.photoAt) throw new Error('no photo sun');
    const look = sunLookOf(records, 'sun', none, false);
    if (look?.kind !== 'drawn') throw new Error('not drawn');
    // Its date with its time, always: the arc, Rise and Set are for that date, on screen and on paper.
    expect(look.photo).toEqual({ ...planVector(reading.photoAt.bearing, 20), label: 'Photo Nov 3, 16:42 · Quay', up: true });
    // The sun at the item's own time is still drawn, on the photo's date.
    expect(look.label).toMatch(/^13:00 · /);
    setLocale('es');
    const spanish = sunLookOf(records, 'sun', none, false);
    expect(spanish?.kind === 'drawn' ? spanish.photo?.label : null).toBe('Foto 3 nov, 16:42 · Quay');
  });

  it('says the date in the zone the sun is drawn in, for a photo that carries its own offset', () => {
    // A phone on Tokyo time wrote the small hours of the 4th: at the quay it was the afternoon of the 3rd.
    const look = sunLookOf(project({ at_photo: true }, { taken_at: '2026-11-04T01:30:00', taken_offset: '+09:00' }), 'sun', none, false);
    expect(look?.kind === 'drawn' ? look.photo?.label : null).toBe('Photo Nov 3, 13:30 · Quay');
  });

  it('has no mark with the switch off, with no reference or for a photo in the Trash; one taken after dark says its date and time with no mark on the path', () => {
    const plain = sunLookOf(project({}, {}, {}), 'sun', none, false);
    expect(plain?.kind).toBe('drawn');
    expect(plain).not.toHaveProperty('photo');
    // The switch off: the very look it had before, to the last value.
    expect(sunLookOf(project(), 'sun', none, false)).toEqual(plain);
    expect(sunLookOf(project({ at_photo: true }, {}, {}), 'sun', none, false)).toEqual(plain);
    const trashed = project({ at_photo: true });
    trashed.dusk = { ...(trashed.dusk as SbdRecord), trashedAt: at };
    expect(sunLookOf(trashed, 'sun', none, false)).toEqual(plain);
    // After dark: the photo's date is drawn and said, with no mark on a path that runs from sunrise to sunset (`up`).
    const night = sunLookOf(project({ at_photo: true }, { taken_at: '2026-11-03T22:10:00' }), 'sun', none, false);
    expect(night?.kind === 'drawn' ? night.photo : null).toMatchObject({ label: 'Photo Nov 3, 22:10 · Quay', up: false });
    expect(night).not.toEqual(plain);
  });

  it('gives the compass the same reading, and a new compass when the switch turns', () => {
    const view = { sceneId: 's1', setupId: 'u1' };
    const off = compassModel(project(), view, none);
    const on = compassModel(project({ at_photo: true }), view, none);
    expect(on.reading).toEqual(sunReadingOf(project({ at_photo: true }), 'sun', none));
    expect(on.reading && !('missing' in on.reading) ? on.reading.date.source : null).toBe('photo');
    expect(off.reading && !('missing' in off.reading) ? off.reading.date.source : null).toBe('shootDay');
    expect(sameCompassModel(off, on)).toBe(false);
  });
});

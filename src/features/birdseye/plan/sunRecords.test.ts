import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../core/i18n';
import { compassModel } from '../../../core/model/planCompass';
import { liveSun } from '../../../core/model/planSun';
import { RECORD_TYPES, type JsonValue, type Props, type SbdRecord } from '../../../core/model/record';
import { sunLightFresh, sunLightOf, sunLightZonePoint, sunReadingFresh, sunReadingOf, sunZonePointFresh, sunZonePointOf } from '../../../core/model/sunSources';
import { sunLookFrom, sunLookOf } from './sunLooks';

// The records a sun path's reading is kept by (6.26 round 2): sunSources.ts names the record types it reads (SUN_TYPES,
// and of the plans' items the sun paths and norths), and keeps a reading while those records are the same. A type it
// reads and doesn't name is a reading that goes stale. So here every record of every type in the model is changed in
// every plain way (trashed, gone, moved, reordered, each prop taken off and changed, a second one added), and every input
// the reading is known to have is changed by name; after each change the kept reading, its zone point, its look and the
// compass's reading must equal ones worked out anew, with nothing kept. A reader added to the sun's reading that reads
// another type fails here the day it is added, provided this project holds a record it would read: add one with it.

type Records = Readonly<Record<string, SbdRecord>>;

const at = '2026-11-14T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({ id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));

const NYC = { latitude: 40.7128, longitude: -74.006, map_name: 'Diner, New York' };
const LA = { latitude: 34.0522, longitude: -118.2437, map_name: 'Bar, Los Angeles' };
const box = { x: 0, y: 0, width: 0.6, height: 0.6, rotation: 0 };

/**
 * Bey County: SC 1 at the Diner (New York, its zone typed) in room `room` with north turned 90°; SC 2 at the Bar (Los
 * Angeles, no zone typed) in `room2` with its own north. SC 1's Setup 1 shoots 1A on Day 1 and 1B (at the Bar) on Day 2,
 * and its plan holds the sun path; Setup 2 has a plan and no frames; 1C is in no setup. And one record of every other
 * type the model has, so the walk below changes every type.
 */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County', title: 'Bey County' }),
    // The Diner's light reference (6.27): a photo of it with the time it was taken, and a second photo to choose instead.
    record('diner', 'location', 'p', { name: 'Diner', ...NYC, time_zone: 'America/New_York', light_photo_id: 'photo1' }),
    record('photo1', 'media', 'diner', { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, taken_at: '2026-11-03T16:42:07' }, 'a'),
    record('photo2', 'media', 'diner', { kind: 'image', file: 'b'.repeat(64), mime: 'image/jpeg', width: 800, height: 600, taken_at: '2026-03-20T08:15:00', taken_offset: '+01:00' }, 'b'),
    record('bar', 'location', 'p', { name: 'Bar', ...LA }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner', location_id: 'diner' }),
    record('room2', 'plan', 'p', { kind: 'room', name: 'Bar', location_id: 'bar' }),
    record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 90 }),
    record('north2', 'plan_item', 'room2', { kind: 'north', icon: 'production/north', ...box, rotation: 200 }),
    record('wall', 'plan_item', 'room', { kind: 'wall', x: 0, y: 0, width: 4, height: 0.1, rotation: 0 }),
    record('s1', 'scene', 'p', { number: '1', location_id: 'diner', room_id: 'room' }, '1'),
    record('s2', 'scene', 'p', { number: '2', location_id: 'bar', room_id: 'room2' }, '2'),
    record('u1', 'setup', 's1', { name: '' }, 'a'),
    record('u2', 'setup', 's1', { name: 'Wide' }, 'b'),
    record('u3', 'setup', 's2', { name: '' }, 'a'),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('own2', 'plan', 'u2', { kind: 'setup', name: '' }),
    record('blocking', 'plan', 's1', { kind: 'blocking', name: '' }),
    record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, width: 0.8, height: 0.8, time: '13:00' }),
    record('light', 'plan_item', 'own', { kind: 'light', icon: 'lighting/fresnel', ...box, rotation: 30, watts: 650 }),
    record('d1', 'shoot_day', 'p', { date: '2026-06-21' }, 'a'),
    record('d2', 'shoot_day', 'p', { date: '2026-09-01' }, 'b'),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', shoot_day_id: 'd1' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', setup_id: 'u1', shoot_day_id: 'd2', location_id: 'bar' }, 'b'),
    record('c', 'shot', 's1', { number: '1C' }, 'c'),
    record('e', 'shot', 's2', { number: '2A', setup_id: 'u3', shoot_day_id: 'd2' }, 'a'),
    // One of every other type, each with a link to what the sun reads, so a reader of that type would have something to follow.
    record('media1', 'media', 'a', { kind: 'link', url: 'https://example.org', location_id: 'diner', shoot_day_id: 'd1' }),
    record('person1', 'person', 'p', { name: 'Ana', location_id: 'diner', time_zone: 'Europe/Madrid' }),
    record('dept1', 'department', 'p', { name: 'camera' }),
    record('gear1', 'gear_item', 'p', { name: 'Fresnel', watts: 650, location_id: 'diner' }),
    record('sheet1', 'callsheet', 'd1', { notes: 'x', location_id: 'diner', time_zone: 'Europe/Madrid' }),
    record('board1', 'board', 'p', { name: 'Looks', scene_id: 's1', location_id: 'diner' }),
    record('bitem1', 'board_item', 'board1', { kind: 'sticky', ...box, text: 'x' }),
    record('design1', 'design', 'p', { name: 'x' }),
    record('comment1', 'comment', 'a', { text: 'x' }),
    record('sugg1', 'suggestion', 'p', { text: 'x' }),
    record('avail1', 'availability', 'person1', { date: '2026-06-21', shoot_day_id: 'd1' }),
    record('note1', 'note', 's1', { text: 'x', location_id: 'diner' }),
    record('char1', 'character', 'p', { name: 'ANNA' }),
    record('stroke1', 'stroke', 'a', { tool: 'pen', points: [0, 0, 1, 1], width: 0.01 }),
    record('preset1', 'settings_preset', 'p', { name: 'Day', settings: {} }),
  );

const view = { sceneId: 's1', setupId: 'u1' };

/** The zone answers a plan may hold: none yet, found, and none to find. */
const ZONES: ReadonlyMap<string, string | null>[] = [
  new Map(),
  new Map<string, string | null>([['bar', 'America/Los_Angeles'], ['diner', 'America/Chicago'], ['sun', 'Europe/Madrid']]),
  new Map<string, string | null>([['bar', null], ['diner', null], ['sun', null]]),
];

/** The kept reading, zone point, look and compass of these records equal ones worked out anew, for every zone answer. */
function expectFresh(records: Records, why: string) {
  // The light reference beside the switch (6.27 round 4), and the point its zone is looked up at.
  expect(sunLightOf(records, 'sun'), `${why}: light`).toEqual(sunLightFresh(records, 'sun'));
  expect(sunLightZonePoint(sunLightOf(records, 'sun')), `${why}: light point`).toEqual(sunLightZonePoint(sunLightFresh(records, 'sun')));
  for (const [n, zones] of ZONES.entries()) {
    const said = `${why} (zones ${String(n)})`;
    const fresh = sunReadingFresh(records, 'sun', zones);
    expect(sunReadingOf(records, 'sun', zones), said).toEqual(fresh);
    expect(sunZonePointOf(records, 'sun'), said).toEqual(sunZonePointFresh(records, 'sun'));
    const sun = liveSun(records, 'sun');
    expect(sunLookOf(records, 'sun', zones, false), said).toEqual(sun ? sunLookFrom(fresh, sun.fields.time, false) : null);
    // The compass reads the setup's first sun path, whichever that is now.
    const model = compassModel(records, view, zones);
    expect(model.reading, said).toEqual(model.sunId === null ? null : sunReadingFresh(records, model.sunId, zones));
  }
}

/** A value unlike the one given, of its own kind. */
function other(value: JsonValue): JsonValue {
  if (typeof value === 'number') return value + 7;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return `${value}x`;
  return null;
}

/** Every plain change to one record: the records after each, named. */
function changesTo(records: Records, id: string): [string, Records][] {
  const was = records[id];
  if (!was) return [];
  const put = (next: SbdRecord): Records => ({ ...records, [id]: next });
  const out: [string, Records][] = [
    ['trashed', put({ ...was, trashedAt: at })],
    ['gone', Object.fromEntries(Object.entries(records).filter(([key]) => key !== id))],
    ['moved under nothing', put({ ...was, parentId: 'nowhere' })],
    ['first in its order', put({ ...was, sortKey: '0' })],
    ['last in its order', put({ ...was, sortKey: 'zzzz' })],
    ['made later', put({ ...was, createdAt: '2027-01-01T00:00:00.000Z' })],
    ['a second one', { ...records, [`${id}-again`]: { ...was, id: `${id}-again`, sortKey: `${was.sortKey}0` } }],
    ['a second one before it', { [`${id}-before`]: { ...was, id: `${id}-before`, sortKey: '0' }, ...records }],
  ];
  for (const [prop, value] of Object.entries(was.props)) {
    out.push([`${prop} taken off`, put({ ...was, props: Object.fromEntries(Object.entries(was.props).filter(([key]) => key !== prop)) })]);
    out.push([`${prop} changed`, put({ ...was, props: { ...was.props, [prop]: other(value) } })]);
  }
  return out;
}

const patched = (records: Records, id: string, set: Props, unset: readonly string[] = []): Records => {
  const was = records[id];
  if (!was) return records;
  return { ...records, [id]: { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...set }).filter(([key]) => !unset.includes(key))) } };
};
const trashed = (records: Records, id: string): Records => (records[id] ? { ...records, [id]: { ...records[id], trashedAt: at } } : records);
const restored = (records: Records, id: string): Records => (records[id] ? { ...records, [id]: { ...records[id], trashedAt: null } } : records);
const moved = (records: Records, id: string, parentId: string): Records => (records[id] ? { ...records, [id]: { ...records[id], parentId } } : records);

beforeEach(() => {
  setLocale('en');
});

describe('the records a sun path’s reading is kept by (6.26 round 2)', () => {
  it('holds a record of every type the model has, and a sun path that is drawn', () => {
    const records = base();
    const held = new Set(Object.values(records).map((r) => r.type));
    for (const type of RECORD_TYPES) expect(held, type).toContain(type);
    expect(sunReadingOf(records, 'sun', new Map())).toMatchObject({ zone: { zone: 'America/New_York' }, north: 90 });
    expectFresh(records, 'as it is');
  });

  for (const type of RECORD_TYPES) {
    it(`${type}: every plain change to each of its records leaves the kept reading equal to one worked out anew`, () => {
      const ids = Object.values(base()).filter((r) => r.type === type).map((r) => r.id);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        // From the same records each time, read first, as an edit follows a render: what is kept is the reading before it.
        const records = base();
        for (const [name, changed] of changesTo(records, id)) {
          expectFresh(records, `${id} before: ${name}`);
          expectFresh(changed, `${id} ${name}`);
        }
        // And back: the records as they were, in a new object.
        expectFresh({ ...records }, `${id}: back as it was`);
      }
    });
  }

  // 6.27: the reading follows the location's light reference photo, a `media` record, only while the sun path shows the
  // sun at the photo's time. The walk above changes the photos with the switch off (the reading then reads none of
  // them); this one changes them with it on, when a kept reading that didn't name `media` would go stale.
  it('media, with the sun shown at the photo’s time: every plain change to the location’s photos leaves the kept reading equal to one worked out anew', () => {
    const lit = (): Records => patched(base(), 'sun', { at_photo: true });
    expect(sunReadingOf(lit(), 'sun', new Map())).toMatchObject({ date: { source: 'photo', date: '2026-11-03', time: '16:42' } });
    for (const id of ['photo1', 'photo2', 'media1']) {
      const records = lit();
      for (const [name, changed] of changesTo(records, id)) {
        expectFresh(records, `${id} before: ${name}`);
        expectFresh(changed, `${id} ${name}`);
      }
      expectFresh({ ...records }, `${id}: back as it was`);
    }
  });

  // 6.27 round 3: with no shoot day the sun is drawn wholly from the light reference photo, at its own GPS (its zone
  // looked up by the photo's id) or its location's place. Each input of that, changed by name, with the zone answers
  // for the photo's point among those the plan may hold.
  it('scouting before a schedule: every input of the sun drawn from the photo, changed by name, one step after another', () => {
    const zonesWithPhoto: ReadonlyMap<string, string | null>[] = [
      ...ZONES,
      new Map<string, string | null>([['photo1', 'Europe/Lisbon']]),
      new Map<string, string | null>([['photo1', 'Atlantic/Azores'], ['photo2', 'Europe/Madrid'], ['diner', 'America/Chicago']]),
      new Map<string, string | null>([['photo1', null], ['photo2', null]]),
    ];
    const fresh = (records: Records, why: string) => {
      expect(sunLightOf(records, 'sun'), `${why}: light`).toEqual(sunLightFresh(records, 'sun'));
      expect(sunLightZonePoint(sunLightOf(records, 'sun')), `${why}: light point`).toEqual(sunLightZonePoint(sunLightFresh(records, 'sun')));
      for (const [n, zones] of zonesWithPhoto.entries()) {
        const said = `${why} (zones ${String(n)})`;
        const anew = sunReadingFresh(records, 'sun', zones);
        expect(sunReadingOf(records, 'sun', zones), said).toEqual(anew);
        expect(sunZonePointOf(records, 'sun'), said).toEqual(sunZonePointFresh(records, 'sun'));
        const sun = liveSun(records, 'sun');
        expect(sunLookOf(records, 'sun', zones, false), said).toEqual(sun ? sunLookFrom(anew, sun.fields.time, false) : null);
        const model = compassModel(records, view, zones);
        expect(model.reading, said).toEqual(model.sunId === null ? null : sunReadingFresh(records, model.sunId, zones));
      }
    };
    const steps: [string, (records: Records) => Records][] = [
      ['the frames taken off their days', (r) => patched(patched(r, 'a', {}, ['shoot_day_id']), 'b', {}, ['shoot_day_id'])],
      ['the sun shown at the photo’s time', (r) => patched(r, 'sun', { at_photo: true })],
      ['the photo’s GPS set', (r) => patched(r, 'photo1', { gps_latitude: 38.7223, gps_longitude: -9.1393 })],
      ['the photo’s GPS changed', (r) => patched(r, 'photo1', { gps_latitude: 37.7412, gps_longitude: -25.6756 })],
      ['the photo given an offset', (r) => patched(r, 'photo1', { taken_offset: '-01:00' })],
      ['the photo’s offset changed', (r) => patched(r, 'photo1', { taken_offset: '+05:30' })],
      ['the photo’s offset taken off', (r) => patched(r, 'photo1', {}, ['taken_offset'])],
      ['the photo’s GPS removed', (r) => patched(r, 'photo1', {}, ['gps_latitude', 'gps_longitude'])],
      ['the location’s zone cleared', (r) => patched(r, 'diner', {}, ['time_zone'])],
      ['the photo’s GPS set again, with no zone on the location', (r) => patched(r, 'photo1', { gps_latitude: 38.7223, gps_longitude: -9.1393 })],
      // Round 5: exactly the location's own pin, then off it again, with no zone typed and then with one.
      ['the photo’s GPS set exactly to its location’s pin, with no zone on the location', (r) => patched(r, 'photo1', { gps_latitude: NYC.latitude, gps_longitude: NYC.longitude })],
      ['the photo’s GPS moved off its location’s pin, with no zone on the location', (r) => patched(r, 'photo1', { gps_latitude: 38.7223, gps_longitude: -9.1393 })],
      ['the location’s zone typed', (r) => patched(r, 'diner', { time_zone: 'America/New_York' })],
      ['the photo’s GPS set exactly to its location’s pin', (r) => patched(r, 'photo1', { gps_latitude: NYC.latitude, gps_longitude: NYC.longitude })],
      ['the photo’s GPS moved off its location’s pin', (r) => patched(r, 'photo1', { gps_latitude: 38.7223, gps_longitude: -9.1393 })],
      ['the location’s place removed', (r) => patched(r, 'diner', {}, ['latitude', 'longitude'])],
      ['the photo’s GPS removed with no place on the location', (r) => patched(r, 'photo1', {}, ['gps_latitude', 'gps_longitude'])],
      ['the location’s place back', (r) => patched(r, 'diner', { latitude: NYC.latitude, longitude: NYC.longitude })],
      ['the other photo chosen, with its offset', (r) => patched(r, 'diner', { light_photo_id: 'photo2' })],
      ['the other photo given GPS', (r) => patched(r, 'photo2', { gps_latitude: 40.4168, gps_longitude: -3.7038 })],
      ['the sun path’s own place and date set', (r) => patched(r, 'sun', { own_latitude: 48.8566, own_longitude: 2.3522, own_date: '2026-03-20' })],
      ['the scene’s location taken off', (r) => patched(r, 's1', {}, ['location_id'])],
      ['the frame given the Bar as its location', (r) => patched(r, 'a', { location_id: 'bar' })],
      ['the frame’s location taken off', (r) => patched(r, 'a', {}, ['location_id'])],
      ['the scene’s location back', (r) => patched(r, 's1', { location_id: 'diner' })],
      ['north trashed', (r) => trashed(r, 'north')],
      ['north restored', (r) => restored(r, 'north')],
      ['the photo trashed', (r) => trashed(r, 'photo2')],
      ['the photo restored', (r) => restored(r, 'photo2')],
      ['the sun no longer shown at the photo’s time', (r) => patched(r, 'sun', {}, ['at_photo'])],
      ['the frames back on their days', (r) => patched(patched(r, 'a', { shoot_day_id: 'd1' }), 'b', { shoot_day_id: 'd2' })],
      ['the sun shown at the photo’s time again, with a day', (r) => patched(r, 'sun', { at_photo: true })],
    ];
    let records = base();
    fresh(records, 'as it is');
    for (const [name, step] of steps) {
      const next = step(records);
      expect(next, name).not.toBe(records);
      fresh(next, name);
      records = next;
    }
    // On the way it was drawn from the photo with no day at all.
    const scouting = patched(patched(patched(base(), 'a', {}, ['shoot_day_id']), 'b', {}, ['shoot_day_id']), 'sun', { at_photo: true });
    expect(sunReadingOf(scouting, 'sun', new Map())).toMatchObject({ date: { source: 'photo', date: '2026-11-03' }, place: { source: 'location' } });
  });

  it('every input the reading has, changed by name, one step after another', () => {
    const steps: [string, (records: Records) => Records][] = [
      // The zone: typed on the location, cleared, typed on the other.
      ['the Diner’s time zone cleared', (r) => patched(r, 'diner', {}, ['time_zone'])],
      ['the Diner’s time zone typed again', (r) => patched(r, 'diner', { time_zone: 'America/Chicago' })],
      ['the Bar’s time zone typed', (r) => patched(r, 'bar', { time_zone: 'America/Los_Angeles' })],
      ['the Bar’s time zone cleared', (r) => patched(r, 'bar', {}, ['time_zone'])],
      // The sun path's own place and date: set, changed, removed (they count once the setup gives none).
      ['the sun path’s own latitude and longitude set', (r) => patched(r, 'sun', { own_latitude: 48.8566, own_longitude: 2.3522 })],
      ['its own date set', (r) => patched(r, 'sun', { own_date: '2026-03-20' })],
      ['the frames taken off their days', (r) => patched(patched(r, 'a', {}, ['shoot_day_id']), 'b', {}, ['shoot_day_id'])],
      ['its own date changed', (r) => patched(r, 'sun', { own_date: '2026-12-21' })],
      ['the scene’s and the frame’s locations taken off', (r) => patched(patched(r, 's1', {}, ['location_id']), 'b', {}, ['location_id'])],
      ['its own latitude changed', (r) => patched(r, 'sun', { own_latitude: -33.8688 })],
      ['its own longitude changed', (r) => patched(r, 'sun', { own_longitude: 151.2093 })],
      ['its own date removed', (r) => patched(r, 'sun', {}, ['own_date'])],
      ['its own place removed', (r) => patched(r, 'sun', {}, ['own_latitude', 'own_longitude'])],
      ['the frames back on their days', (r) => patched(patched(r, 'a', { shoot_day_id: 'd1' }), 'b', { shoot_day_id: 'd2' })],
      ['the scene’s location back', (r) => patched(r, 's1', { location_id: 'diner' })],
      ['the frame’s own location set', (r) => patched(r, 'a', { location_id: 'bar' })],
      ['the frame’s own location taken off', (r) => patched(r, 'a', {}, ['location_id'])],
      ['the scene’s location changed', (r) => patched(r, 's1', { location_id: 'bar' })],
      ['the scene’s location back again', (r) => patched(r, 's1', { location_id: 'diner' })],
      // The sun path itself: its time, trashed, restored, moved to another plan and back.
      ['the sun path’s time changed', (r) => patched(r, 'sun', { time: '09:15' })],
      ['the sun path trashed', (r) => trashed(r, 'sun')],
      ['the sun path restored', (r) => restored(r, 'sun')],
      ['the sun path moved to Setup 2’s plan', (r) => moved(r, 'sun', 'own2')],
      ['the sun path moved to the room', (r) => moved(r, 'sun', 'room')],
      ['the sun path moved back', (r) => moved(r, 'sun', 'own')],
      // North and the room.
      ['north turned', (r) => patched(r, 'north', { rotation: 45 })],
      ['north trashed', (r) => trashed(r, 'north')],
      ['north restored', (r) => restored(r, 'north')],
      ['the scene set in the other room', (r) => patched(r, 's1', { room_id: 'room2' })],
      ['the other room’s plan trashed', (r) => trashed(r, 'room2')],
      ['the other room’s plan restored', (r) => restored(r, 'room2')],
      ['the scene back in its room', (r) => patched(r, 's1', { room_id: 'room' })],
      ['the room’s plan trashed', (r) => trashed(r, 'room')],
      ['the room’s plan restored', (r) => restored(r, 'room')],
      ['the setup’s plan trashed', (r) => trashed(r, 'own')],
      ['the setup’s plan restored', (r) => restored(r, 'own')],
      // The location.
      ['the location trashed', (r) => trashed(r, 'diner')],
      ['the location restored', (r) => restored(r, 'diner')],
      ['the location’s place removed', (r) => patched(r, 'diner', {}, ['latitude', 'longitude'])],
      ['the location’s place set elsewhere', (r) => patched(r, 'diner', { latitude: 51.5072, longitude: -0.1276 })],
      // The frames: joining and leaving the setup, trashed, restored, moved to another scene.
      ['a frame joining the setup', (r) => patched(r, 'c', { setup_id: 'u1', shoot_day_id: 'd2' })],
      ['a frame leaving the setup', (r) => patched(r, 'a', {}, ['setup_id'])],
      ['a frame joining it again', (r) => patched(r, 'a', { setup_id: 'u1' })],
      ['a frame trashed', (r) => trashed(r, 'a')],
      ['a frame restored', (r) => restored(r, 'a')],
      ['a frame moved to another scene', (r) => moved(r, 'a', 's2')],
      ['the frame moved back', (r) => moved(r, 'a', 's1')],
      ['the frames in another order', (r) => ({ ...r, a: { ...(r['a'] as SbdRecord), sortKey: 'z' } })],
      // The setup.
      ['the setup trashed', (r) => trashed(r, 'u1')],
      ['the setup restored', (r) => restored(r, 'u1')],
      ['the scene trashed', (r) => trashed(r, 's1')],
      ['the scene restored', (r) => restored(r, 's1')],
      // The shoot days: trashed, added, redated.
      ['a shoot day trashed', (r) => trashed(r, 'd1')],
      ['a shoot day restored', (r) => restored(r, 'd1')],
      ['a shoot day added before the others', (r) => ({ ...r, d0: record('d0', 'shoot_day', 'p', { date: '2026-01-05' }, '0') })],
      ['a frame put on the new day', (r) => patched(r, 'b', { shoot_day_id: 'd0' })],
      ['a shoot day redated', (r) => patched(r, 'd1', { date: '2026-12-24' })],
      ['a shoot day’s date taken off', (r) => patched(r, 'd1', {}, ['date'])],
      ['the new day redated after the others', (r) => patched(r, 'd0', { date: '2027-02-02' })],
      // The light reference photo (6.27): the sun shown at its time, then every change to the photo and to which one it is.
      ['the sun shown at the photo’s time', (r) => patched(r, 'sun', { at_photo: true })],
      ['the photo’s time changed', (r) => patched(r, 'photo1', { taken_at: '2026-12-21T09:30:00' })],
      ['the photo given an offset', (r) => patched(r, 'photo1', { taken_offset: '+09:00' })],
      ['the photo’s offset taken off', (r) => patched(r, 'photo1', {}, ['taken_offset'])],
      ['the photo trashed', (r) => trashed(r, 'photo1')],
      ['the photo restored', (r) => restored(r, 'photo1')],
      ['the photo’s time made unreadable', (r) => patched(r, 'photo1', { taken_at: 'sometime' })],
      ['the photo’s time back', (r) => patched(r, 'photo1', { taken_at: '2026-11-03T16:42:07' })],
      ['another photo chosen', (r) => patched(r, 'diner', { light_photo_id: 'photo2' })],
      ['the other photo’s time changed', (r) => patched(r, 'photo2', { taken_at: '2026-06-01T19:00:00' })],
      ['the other photo moved to another location', (r) => moved(r, 'photo2', 'bar')],
      ['the other photo moved back', (r) => moved(r, 'photo2', 'diner')],
      ['the light reference cleared', (r) => patched(r, 'diner', {}, ['light_photo_id'])],
      ['the first photo chosen again', (r) => patched(r, 'diner', { light_photo_id: 'photo1' })],
      ['the location’s zone cleared, the photo still chosen', (r) => patched(r, 'diner', {}, ['time_zone'])],
      ['the location’s zone typed again', (r) => patched(r, 'diner', { time_zone: 'America/New_York' })],
      ['the sun no longer shown at the photo’s time', (r) => patched(r, 'sun', {}, ['at_photo'])],
      ['the photo’s time changed while it isn’t shown', (r) => patched(r, 'photo1', { taken_at: '2026-01-02T03:04:05' })],
    ];
    let records = base();
    expectFresh(records, 'as it is');
    for (const [name, step] of steps) {
      const next = step(records);
      expect(next, name).not.toBe(records);
      expectFresh(next, name);
      records = next;
    }
  });
});

import { describe, expect, it } from 'vitest';
import { sunReading } from './planSun';
import type { Props, SbdRecord } from './record';
import { ownDateChanges, ownPlaceChanges, ownPlaceText, ownSunOf, sunReadingOf, sunZonePointOf } from './sunSources';

// Quick sun (6.5.5): the one reading of what a sun path is drawn for. The setup's location and shoot day win over the
// item's own place and date; each says its source; the own values fill in only what the setup lacks, one at a time;
// with neither, what's missing is said as 6.6 says it; the zone of an own place is looked up from its coordinates.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const patched = (records: Records, id: string, props: Props): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: { ...was.props, ...props } } };
};
const without = (records: Records, id: string, ...names: string[]): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: Object.fromEntries(Object.entries(was.props).filter(([name]) => !names.includes(name))) } };
};

const box = { x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0 };
/** Fort Tryon Park as Google Maps copies it, and New York City's own point (the US Naval Observatory's check). */
const OWN = { own_latitude: 40.7128, own_longitude: -74.006, own_date: '2026-06-21' };

/**
 * Bey County: scene 1 at the Diner (in Cusco, its zone set), room `room` with north at 0°; Setup 1 with frame 1A on Day
 * 1, 3 March 2027; a sun path at 13:00.
 */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('diner', 'location', 'p', { name: 'Diner', latitude: -13.51677, longitude: -71.97878, map_name: 'Plaza de Armas', time_zone: 'America/Lima' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 0 }),
    record('s1', 'scene', 'p', { number: '1', location_id: 'diner', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, time: '13:00' }),
    record('d1', 'shoot_day', 'p', { date: '2027-03-03' }, 'a'),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', shoot_day_id: 'd1' }, 'a'),
  );
/** The same setup with no location and no shoot day: its frame in no day, its scene at no location. */
const bare = (): Records => without(without(base(), 'a', 'shoot_day_id'), 's1', 'location_id');
const none = new Map<string, string | null>();
const ny = new Map<string, string | null>([['sun', 'America/New_York']]);

describe('what a sun path is drawn for (6.5.5)', () => {
  it('reads the setup’s location and shoot day when it has them, over its own, exactly as 6.6 does', () => {
    const records = patched(base(), 'sun', OWN);
    const reading = sunReadingOf(records, 'sun', none);
    if (!reading || 'missing' in reading) throw new Error('not drawn');
    expect(reading.place).toMatchObject({ source: 'location', latitude: -13.51677, longitude: -71.97878 });
    expect(reading.place.source === 'location' ? reading.place.location.id : null).toBe('diner');
    expect(reading.date).toMatchObject({ source: 'shootDay', date: '2027-03-03' });
    expect(reading.date.source === 'shootDay' ? reading.date.day.record.id : null).toBe('d1');
    expect(reading.zone).toEqual({ zone: 'America/Lima', source: 'location' });
    expect(reading.frame?.id).toBe('a');
    // The setup's rule, as 6.6 reads it.
    const old = sunReading(records, 'sun', none);
    if (!old || 'missing' in old) throw new Error('not drawn');
    expect(reading.north).toBe(old.source.north);
    expect(reading.at?.time).toBe('13:00');
    expect(sunZonePointOf(records, 'sun')).toBeNull();
  });

  it('with no own values, says what is missing exactly as 6.6 does', () => {
    for (const records of [bare(), without(base(), 'a', 'shoot_day_id'), without(base(), 's1', 'location_id'), without(base(), 'north', 'kind')]) {
      const reading = sunReadingOf(records, 'sun', none);
      const old = sunReading(records, 'sun', none);
      expect(reading && 'missing' in reading).toBe(true);
      expect(reading).toEqual({ ...old, place: null, date: null });
    }
  });

  it('takes its own place and date for a setup with neither, said as its own, the zone from its coordinates', () => {
    const records = patched(bare(), 'sun', OWN);
    // The zone is looked up at its own coordinates, by its own id.
    expect(sunZonePointOf(records, 'sun')).toEqual({ id: 'sun', latitude: 40.7128, longitude: -74.006, own: true });
    // While the answer is on its way, nothing is said yet; none found: no time zone.
    expect(sunReadingOf(records, 'sun', none)).toMatchObject({ missing: 'noZone', pending: true, place: { source: 'own' }, date: { source: 'own' } });
    expect(sunReadingOf(records, 'sun', new Map([['sun', null]]))).toMatchObject({ missing: 'noZone', place: { source: 'own' } });
    expect(sunReadingOf(records, 'sun', new Map([['sun', null]]))).not.toHaveProperty('pending');
    const reading = sunReadingOf(records, 'sun', ny);
    if (!reading || 'missing' in reading) throw new Error('not drawn');
    expect(reading.place).toEqual({ source: 'own', latitude: 40.7128, longitude: -74.006 });
    expect(reading.date).toEqual({ source: 'own', date: '2026-06-21' });
    expect(reading.zone).toEqual({ zone: 'America/New_York', source: 'map' });
    expect(reading.frame).toBeNull();
    expect(reading.otherDays).toEqual([]);
    // New York at 13:00 on 21 June 2026: azimuth 181.63°, altitude 72.72° (US Naval Observatory), within 0.5° and 0.3°.
    expect(Math.abs((reading.at?.bearing ?? 0) - 181.63)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((reading.at?.altitude ?? 0) - 72.72)).toBeLessThanOrEqual(0.3);
    expect(reading.path?.day.sunrise).toMatch(/^05:2\d$/);
    expect(reading.path?.day.sunset).toMatch(/^20:3\d$/);
    // Solar noon there is just before 13:00 by the clock (summer time), the sun due south.
    expect(reading.noon?.time).toMatch(/^12:5\d$/);
    expect(Math.abs((reading.noon?.bearing ?? 0) - 180)).toBeLessThanOrEqual(1);
  });

  it('mixes sources: the shoot day’s date with its own place, its own date with the location’s place', () => {
    // A shoot day, no location: the day's date, its own place.
    const dayOnly = patched(without(base(), 's1', 'location_id'), 'sun', OWN);
    const first = sunReadingOf(dayOnly, 'sun', ny);
    if (!first || 'missing' in first) throw new Error('not drawn');
    expect(first.date).toMatchObject({ source: 'shootDay', date: '2027-03-03' });
    expect(first.place).toMatchObject({ source: 'own', latitude: 40.7128 });
    expect(first.zone).toEqual({ zone: 'America/New_York', source: 'map' });
    // A location, no shoot day: the location's place and zone, its own date.
    const placeOnly = patched(without(base(), 'a', 'shoot_day_id'), 'sun', OWN);
    const second = sunReadingOf(placeOnly, 'sun', none);
    if (!second || 'missing' in second) throw new Error('not drawn');
    expect(second.place).toMatchObject({ source: 'location', latitude: -13.51677 });
    expect(second.date).toEqual({ source: 'own', date: '2026-06-21' });
    expect(second.zone).toEqual({ zone: 'America/Lima', source: 'location' });
    expect(sunZonePointOf(placeOnly, 'sun')).toBeNull();
    // The location without a zone of its own: looked up at its place, by its id, as 6.6 does.
    const zoneless = without(placeOnly, 'diner', 'time_zone');
    expect(sunZonePointOf(zoneless, 'sun')).toEqual({ id: 'diner', latitude: -13.51677, longitude: -71.97878, own: false });
    expect(sunReadingOf(zoneless, 'sun', new Map([['diner', 'America/Lima']]))).toMatchObject({ zone: { zone: 'America/Lima', source: 'map' } });
  });

  it('says what is missing when neither has a place or a date, keeping what it has', () => {
    // Its own place, no date anywhere: no shoot day, its own date the field that would complete it; nothing said as drawn.
    const placeOnly = patched(bare(), 'sun', { own_latitude: 40.7128, own_longitude: -74.006 });
    expect(sunReadingOf(placeOnly, 'sun', ny)).toEqual({ missing: 'noDay', frameId: 'a', ownField: 'date', place: null, date: null });
    // Its own date, no place anywhere: no location.
    const dateOnly = patched(bare(), 'sun', { own_date: '2026-06-21' });
    expect(sunReadingOf(dateOnly, 'sun', ny)).toEqual({ missing: 'noLocation', frameId: 'a', ownField: 'place', place: null, date: null });
    // A location with no place on the map, and its own date: the location's to fix.
    const unplaced = patched(without(without(base(), 'a', 'shoot_day_id'), 'diner', 'latitude'), 'sun', { own_date: '2026-06-21' });
    expect(sunReadingOf(unplaced, 'sun', ny)).toEqual({ missing: 'noPlace', locationId: 'diner', ownField: 'place', place: null, date: null });
    // Both its own, no north: no north.
    expect(sunReadingOf(patched(without(bare(), 'north', 'kind'), 'sun', OWN), 'sun', ny)).toMatchObject({ missing: 'noNorth', place: { source: 'own' }, date: { source: 'own' } });
    // A setup with no frames at all reads its own values too.
    const frameless = Object.fromEntries(Object.entries(patched(bare(), 'sun', OWN)).filter(([id]) => id !== 'a'));
    expect(sunReadingOf(frameless, 'sun', ny)).toMatchObject({ place: { source: 'own' }, date: { source: 'own' } });
    expect(sunReadingOf(frameless, 'nothing', ny)).toBeNull();
  });

  it('never pairs a day from one frame with a place from another (6.5.5 review): 1A on Day 1 nowhere, 1B on no day at the Lot', () => {
    // 1A on Day 1 with no location (its scene has none); 1B on no day, at the placed Lot.
    const split = (): Records =>
      recordsOf(
        ...Object.values(without(base(), 's1', 'location_id')),
        record('lot', 'location', 'p', { name: 'Lot', latitude: 40.75, longitude: -73.99, map_name: 'Lot', time_zone: 'America/New_York' }),
        record('b', 'shot', 's1', { number: '1B', setup_id: 'u1', location_id: 'lot' }, 'b'),
      );
    const drawn = (records: Records) => {
      const reading = sunReadingOf(records, 'sun', ny);
      if (!reading || 'missing' in reading) throw new Error(`not drawn: ${JSON.stringify(reading)}`);
      return { place: reading.place.source, at: reading.place.source === 'location' ? reading.place.location.id : 'own', date: reading.date.source, day: reading.date.date };
    };
    const place = { own_latitude: 40.7128, own_longitude: -74.006 };
    const date = { own_date: '2026-06-21' };
    expect(drawn(patched(split(), 'sun', place))).toEqual({ place: 'own', at: 'own', date: 'shootDay', day: '2027-03-03' });
    expect(drawn(patched(split(), 'sun', date))).toEqual({ place: 'location', at: 'lot', date: 'own', day: '2026-06-21' });
    expect(drawn(patched(split(), 'sun', { ...place, ...date }))).toEqual({ place: 'own', at: 'own', date: 'shootDay', day: '2027-03-03' });
    // Neither: 6.6's "No location", exactly.
    expect(sunReadingOf(split(), 'sun', ny)).toEqual({ missing: 'noLocation', frameId: 'a', place: null, date: null });
    expect(sunReading(split(), 'sun', ny)).toEqual({ missing: 'noLocation', frameId: 'a' });
  });

  it('crosses the own values with 6.6’s other cases: a location with no place, frames with neither, no frames', () => {
    const place = { own_latitude: 40.7128, own_longitude: -74.006 };
    const date = { own_date: '2026-06-21' };
    const sources = (records: Records) => {
      const reading = sunReadingOf(records, 'sun', ny);
      return reading && !('missing' in reading) ? `${reading.date.source}+${reading.place.source}` : reading;
    };
    // 1A on Day 1 at a location with no place on the map (6.6: noPlace).
    const unplaced = () => without(base(), 'diner', 'latitude');
    expect(sources(patched(unplaced(), 'sun', place))).toBe('shootDay+own');
    expect(sources(patched(unplaced(), 'sun', date))).toEqual({ missing: 'noPlace', locationId: 'diner', ownField: 'place', place: null, date: null });
    expect(sources(patched(unplaced(), 'sun', { ...place, ...date }))).toBe('shootDay+own');
    expect(sources(unplaced())).toEqual({ missing: 'noPlace', locationId: 'diner', place: null, date: null });
    // Frames with no day and no place (6.6: noDay).
    expect(sources(patched(bare(), 'sun', place))).toEqual({ missing: 'noDay', frameId: 'a', ownField: 'date', place: null, date: null });
    expect(sources(patched(bare(), 'sun', date))).toEqual({ missing: 'noLocation', frameId: 'a', ownField: 'place', place: null, date: null });
    expect(sources(patched(bare(), 'sun', { ...place, ...date }))).toBe('own+own');
    expect(sources(bare())).toEqual({ missing: 'noDay', frameId: 'a', place: null, date: null });
    // No frames at all (6.6: noFrames).
    const frameless = () => Object.fromEntries(Object.entries(bare()).filter(([id]) => id !== 'a'));
    expect(sources(patched(frameless(), 'sun', place))).toEqual({ missing: 'noFrames', ownField: 'date', place: null, date: null });
    expect(sources(patched(frameless(), 'sun', date))).toEqual({ missing: 'noFrames', ownField: 'place', place: null, date: null });
    expect(sources(patched(frameless(), 'sun', { ...place, ...date }))).toBe('own+own');
    expect(sources(frameless())).toEqual({ missing: 'noFrames', place: null, date: null });
  });

  it('reads a sun path outside a setup as 6.6 does there, own values or not', () => {
    // Moved into the room's plan: no setup, so no frames, whatever it holds.
    const inRoom = patched(bare(), 'sun', OWN);
    const moved = { ...inRoom, sun: { ...(inRoom.sun as SbdRecord), parentId: 'room' } };
    expect(sunReadingOf(moved, 'sun', ny)).toEqual({ ...sunReading(moved, 'sun', ny), place: null, date: null });
    expect(sunReadingOf(moved, 'sun', ny)).toMatchObject({ missing: 'noFrames' });
  });

  it('reads own values only as they can be: both coordinates in range, a real date', () => {
    expect(ownSunOf({ ...OWN, time: '13:00' })).toEqual({ place: { latitude: 40.7128, longitude: -74.006 }, date: '2026-06-21', ownTime: true });
    expect(ownSunOf({ own_latitude: 40.7128 })).toEqual({ place: null, date: null, ownTime: false });
    expect(ownSunOf({ own_latitude: 95, own_longitude: 10, own_date: '2026-02-30' })).toEqual({ place: null, date: null, ownTime: false });
    expect(ownSunOf({ own_latitude: '40', own_longitude: -74, own_date: 'June 21' }).place).toBeNull();
    expect(ownPlaceText({ own_latitude: 40.867712, own_longitude: -73.921234 })).toBe('40.8677, -73.9212');
    expect(ownPlaceText({})).toBe('');
  });

  it('writes its own place and date in one op each, and takes them off', () => {
    const records = bare();
    expect(ownPlaceChanges(records, 'sun', { latitude: 40.867712, longitude: -73.921234 })).toEqual([
      { kind: 'update', id: 'sun', set: { own_latitude: 40.867712, own_longitude: -73.921234 } },
    ]);
    expect(ownPlaceChanges(records, 'sun', { latitude: 91, longitude: 0 })).toEqual([]);
    expect(ownPlaceChanges(records, 'sun', null)).toEqual([]);
    const placed = patched(records, 'sun', OWN);
    expect(ownPlaceChanges(placed, 'sun', { latitude: 40.7128, longitude: -74.006 })).toEqual([]);
    expect(ownPlaceChanges(placed, 'sun', null)).toEqual([{ kind: 'update', id: 'sun', unset: ['own_latitude', 'own_longitude'] }]);
    expect(ownDateChanges(records, 'sun', '2026-06-21')).toEqual([{ kind: 'update', id: 'sun', set: { own_date: '2026-06-21' } }]);
    expect(ownDateChanges(records, 'sun', '21/06/2026')).toEqual([]);
    expect(ownDateChanges(placed, 'sun', '2026-06-21')).toEqual([]);
    expect(ownDateChanges(placed, 'sun', null)).toEqual([{ kind: 'update', id: 'sun', unset: ['own_date'] }]);
    // Only on a live sun path.
    expect(ownDateChanges(records, 'north', '2026-06-21')).toEqual([]);
  });
});

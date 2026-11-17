import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from './record';
import { sunAt, sunPath, sunPosition } from './sunPath';
import { atPhotoChanges, photoWhen, sunAtPhoto, sunLightOf, sunLightZone, sunLightZonePoint, sunReadingFresh, sunReadingOf, sunZonePointOf } from './sunSources';
import { windowSunsOf } from './windowSun';

// The light reference in the sun's one reading (6.27): a sun path with "Show the sun at the photo's time" on, whose
// place comes from a location that has a light reference photo with a time, is drawn for the PHOTO's date and says
// where the sun stood when it was taken. With the switch off, no reference, a photo in the Trash or a time that can't
// be read, the reading is exactly what it was before. The place is made up: a point in the open Atlantic, three hours
// behind Greenwich by the sun and by its zone.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({ id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const patched = (records: Records, id: string, props: Props, unset: readonly string[] = []): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...props }).filter(([name]) => !unset.includes(name))) } };
};
const trashed = (records: Records, id: string): Records => ({ ...records, [id]: { ...(records[id] as SbdRecord), trashedAt: at } });

const box = { x: 0, y: 0, width: 0.8, height: 0.8, rotation: 0 };
const PLACE = { latitude: 12.51, longitude: -45.25 };
const ZONE = 'Etc/GMT+3';
const image = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600 };

/**
 * A quay at a made-up point, its zone typed; scene 1 there, in a room with north at 20°; Setup 1 with frame 1A on Day 1,
 * 21 June 2027; a sun path at 13:00. The quay has two photos: one taken on 3 November 2026 at 16:42:07 by its camera's
 * clock, one with no time.
 */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('quay', 'location', 'p', { name: 'Quay', ...PLACE, map_name: '12.51000, -45.25000', time_zone: ZONE }),
    record('dusk', 'media', 'quay', { ...image, source_name: 'quay-dusk.jpg', taken_at: '2026-11-03T16:42:07' }),
    record('untimed', 'media', 'quay', { ...image, file: 'b'.repeat(64) }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Quay' }),
    record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 20 }),
    record('s1', 'scene', 'p', { number: '1', location_id: 'quay', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, time: '13:00' }),
    record('d1', 'shoot_day', 'p', { date: '2027-06-21' }, 'a'),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', shoot_day_id: 'd1' }, 'a'),
  );
const none = new Map<string, string | null>();

/** The quay's light reference set to a photo, and the sun path's switch on. */
const referenced = (records: Records, photoId = 'dusk'): Records => patched(records, 'quay', { light_photo_id: photoId });
const switchedOn = (records: Records): Records => patched(records, 'sun', { at_photo: true });

function drawn(records: Records, zones: ReadonlyMap<string, string | null> = none) {
  const reading = sunReadingOf(records, 'sun', zones);
  if (!reading || 'missing' in reading) throw new Error('not drawn');
  // Whatever is kept, the reading is the one worked out anew.
  expect(reading).toEqual(sunReadingFresh(records, 'sun', zones));
  return reading;
}

describe('the sun’s reading with a light reference photo (6.27)', () => {
  it('is exactly as before with the switch off, with no reference, or with neither', () => {
    const before = drawn(base());
    expect(before.date).toMatchObject({ source: 'shootDay', date: '2027-06-21' });
    expect(before).not.toHaveProperty('photoAt');
    // The switch on, no reference: the same reading, to the last value.
    expect(drawn(switchedOn(base()))).toEqual(before);
    // A reference, the switch off: the same, but for the location record it names (which now holds the reference).
    const withReference = referenced(base());
    const off = drawn(withReference);
    expect(off).toEqual({ ...before, place: { ...before.place, location: withReference.quay } });
    expect(off).not.toHaveProperty('photoAt');
    // A switch stored as anything but `true` is off.
    for (const odd of [false, 'true', 1, null]) expect(drawn(patched(withReference, 'sun', { at_photo: odd }))).toEqual(off);
    expect(sunAtPhoto({ at_photo: true })).toBe(true);
    expect(sunAtPhoto({ at_photo: 'true' })).toBe(false);
    expect(sunAtPhoto({})).toBe(false);
  });

  it('with the switch on, is drawn for the photo’s date, and says where the sun stood at the photo’s time', () => {
    const records = switchedOn(referenced(base()));
    const reading = drawn(records);
    // The place is still the location's; the date is the photo's, over the shoot day's.
    expect(reading.place).toMatchObject({ source: 'location', ...PLACE });
    expect(reading.date).toEqual({ source: 'photo', date: '2026-11-03', time: '16:42', photo: records.dusk });
    expect(reading.zone).toEqual({ zone: ZONE, source: 'location' });
    expect(reading.north).toBe(20);
    // The day's path and the sun at the item's own time, on the photo's date.
    expect(reading.path).toEqual(sunPath('2026-11-03', PLACE.latitude, PLACE.longitude, ZONE));
    expect(reading.at).toEqual(sunAt('2026-11-03', '13:00', PLACE.latitude, PLACE.longitude, ZONE));
    expect(reading.path).not.toEqual(sunPath('2027-06-21', PLACE.latitude, PLACE.longitude, ZONE));
    // The sun when the photo was taken: 16:42:07 on the quay's clock, three hours behind UTC, to the second.
    const instant = new Date('2026-11-03T19:42:07.000Z');
    expect(reading.photoAt).toEqual({ ...sunPosition(instant, PLACE.latitude, PLACE.longitude), time: '16:42', instant, up: true });
    // Late afternoon in November, north of the equator: low in the south-west.
    expect(reading.photoAt?.bearing).toBeGreaterThan(225);
    expect(reading.photoAt?.bearing).toBeLessThan(270);
    expect(reading.photoAt?.altitude).toBeGreaterThan(0);
    expect(reading.photoAt?.altitude).toBeLessThan(25);
    // The setup's own day is still said, never drawn.
    expect(reading.frame?.id).toBe('a');
    // Nothing needs looking up: the zone is the location's own.
    expect(sunZonePointOf(records, 'sun')).toBeNull();
  });

  it('wins over the sun path’s own date too, and leaves a sun path with its own place alone', () => {
    // No shoot day: the setup gives the place, the sun path its own date; the photo, chosen, is the date drawn.
    const ownDate = patched(patched(switchedOn(referenced(base())), 'a', {}, ['shoot_day_id']), 'sun', { own_date: '2027-01-15' });
    expect(drawn(ownDate).date).toMatchObject({ source: 'photo', date: '2026-11-03' });
    expect(drawn(patched(ownDate, 'sun', {}, ['at_photo'])).date).toEqual({ source: 'own', date: '2027-01-15' });
    // No location on the scene: the place is the sun path's own, so there is no location's photo to read.
    const ownPlace = patched(patched(switchedOn(referenced(base())), 's1', {}, ['location_id']), 'sun', { own_latitude: 40.7128, own_longitude: -74.006 });
    const reading = drawn(ownPlace, new Map([['sun', 'America/New_York']]));
    expect(reading.place.source).toBe('own');
    expect(reading.date).toMatchObject({ source: 'shootDay', date: '2027-06-21' });
    expect(reading).not.toHaveProperty('photoAt');
  });

  it('is as before for a photo in the Trash, one with no time that reads, or a reference that names nothing', () => {
    const on = switchedOn(referenced(base()));
    const before = (records: Records) => {
      const off = drawn(patched(records, 'sun', {}, ['at_photo']));
      const reading = drawn(records);
      expect(reading).toEqual(off);
      expect(reading.date).toMatchObject({ source: 'shootDay', date: '2027-06-21' });
      expect(reading).not.toHaveProperty('photoAt');
    };
    before(trashed(on, 'dusk'));
    before(patched(on, 'dusk', { taken_at: '2026-13-40T99:00:00' }));
    before(patched(on, 'dusk', {}, ['taken_at']));
    before(switchedOn(referenced(base(), 'untimed')));
    before(switchedOn(referenced(base(), 'gone')));
    before(switchedOn(referenced(base(), 'a')));
    // Restored, it is the date again.
    expect(drawn(on).date.source).toBe('photo');
  });

  it('reads a photo that carries its own offset as that instant, in the location’s zone', () => {
    // A phone set to Madrid's winter time (+01:00) wrote 20:42:07: 19:42:07 UTC, 16:42 on the quay.
    const madrid = patched(switchedOn(referenced(base())), 'dusk', { taken_at: '2026-11-03T20:42:07', taken_offset: '+01:00' });
    const reading = drawn(madrid);
    expect(reading.date).toMatchObject({ source: 'photo', date: '2026-11-03', time: '16:42' });
    expect(reading.photoAt?.instant.toISOString()).toBe('2026-11-03T19:42:07.000Z');
    // The same sun as the camera clock read on the quay itself.
    expect(reading.photoAt).toEqual(drawn(switchedOn(referenced(base()))).photoAt);
    // A phone on Tokyo time wrote the small hours of the 4th: on the quay it was still the afternoon of the 3rd.
    const tokyo = patched(madrid, 'dusk', { taken_at: '2026-11-04T01:30:00', taken_offset: '+09:00' });
    const far = drawn(tokyo);
    expect(far.date).toMatchObject({ source: 'photo', date: '2026-11-03', time: '13:30' });
    expect(far.path).toEqual(sunPath('2026-11-03', PLACE.latitude, PLACE.longitude, ZONE));
    expect(far.photoAt?.instant.toISOString()).toBe('2026-11-03T16:30:00.000Z');
    // An offset that can't be read is no offset: the camera's clock, read on the quay.
    const odd = patched(madrid, 'dusk', { taken_offset: '+25:00' });
    expect(drawn(odd).date).toMatchObject({ date: '2026-11-03', time: '20:42' });
    // A photo taken after dark: the date is still the photo's, and the sun was down.
    const night = patched(switchedOn(referenced(base())), 'dusk', { taken_at: '2026-11-03T22:10:00' });
    expect(drawn(night).photoAt).toMatchObject({ time: '22:10', up: false });
  });

  it('says the photo’s date as its camera wrote it while the zone isn’t known, and what is missing as before', () => {
    const records = patched(switchedOn(referenced(base())), 'quay', {}, ['time_zone']);
    // The lookup on its way, then none found.
    const pending = sunReadingOf(records, 'sun', none);
    expect(pending).toMatchObject({ missing: 'noZone', locationId: 'quay', pending: true, place: { source: 'location' } });
    expect(pending?.date).toEqual({ source: 'photo', date: '2026-11-03', time: '16:42', photo: records.dusk });
    expect(sunReadingOf(records, 'sun', new Map([['quay', null]]))).toMatchObject({ missing: 'noZone', date: { source: 'photo', date: '2026-11-03' } });
    expect(sunZonePointOf(records, 'sun')).toEqual({ id: 'quay', ...PLACE, own: false });
    // Found: drawn in it.
    expect(drawn(records, new Map([['quay', ZONE]])).date).toMatchObject({ source: 'photo', date: '2026-11-03', time: '16:42' });
    // No north: said exactly as before, with no place or date claimed.
    const northless = trashed(switchedOn(referenced(base())), 'north');
    expect(sunReadingOf(northless, 'sun', none)).toEqual(sunReadingOf(patched(northless, 'sun', {}, ['at_photo']), 'sun', none));
    expect(sunReadingOf(northless, 'sun', none)).toMatchObject({ missing: 'noNorth', place: null, date: null });
  });

  it('gives the windows’ hours for the date drawn', () => {
    // The reading a window's sun follows is this one: nothing throws, with or without the photo.
    expect(() => windowSunsOf(switchedOn(referenced(base())), { sceneId: 's1', setupId: 'u1' }, none)).not.toThrow();
  });
});

describe('a photo’s date and time as they are said beside a sun path (6.27 round 2)', () => {
  it('is one reading for the light reference line and the date’s source: in the zone drawn once known, the camera’s clock until then', () => {
    // No zone yet: as its camera wrote it, offset or not.
    expect(photoWhen('2026-11-04T01:30:00', '+09:00', null)).toEqual({ date: '2026-11-04', time: '01:30', instant: null });
    expect(photoWhen('2026-11-03T16:42:07', null, null)).toEqual({ date: '2026-11-03', time: '16:42', instant: null });
    // The zone known: a photo with its own offset is that instant, read there.
    expect(photoWhen('2026-11-04T01:30:00', '+09:00', ZONE)).toEqual({ date: '2026-11-03', time: '13:30', instant: new Date('2026-11-03T16:30:00.000Z') });
    // With none, the camera's clock is the place's.
    expect(photoWhen('2026-11-03T16:42:07', null, ZONE)).toEqual({ date: '2026-11-03', time: '16:42', instant: new Date('2026-11-03T19:42:07.000Z') });
    // A zone that isn't one: as written.
    expect(photoWhen('2026-11-03T16:42:07', null, 'Nowhere/Land')).toEqual({ date: '2026-11-03', time: '16:42', instant: null });
    // And it is what the reading's date says.
    const tokyo = patched(switchedOn(referenced(base())), 'dusk', { taken_at: '2026-11-04T01:30:00', taken_offset: '+09:00' });
    const { date, time } = photoWhen('2026-11-04T01:30:00', '+09:00', ZONE);
    expect(drawn(tokyo).date).toMatchObject({ source: 'photo', date, time });
  });
});

describe('scouting before a schedule: the sun drawn wholly from the photo (6.27 round 3)', () => {
  /** No shoot day at all: the frame on none, the day gone. */
  const unscheduled = (records: Records): Records => Object.fromEntries(Object.entries(patched(records, 'a', {}, ['shoot_day_id'])).filter(([id]) => id !== 'd1'));
  /** The photo's own GPS: another made-up point in the open sea, an hour behind Greenwich by its zone. */
  const GPS = { latitude: 20.25, longitude: -25.5 };
  const withGps = (records: Records): Records => patched(records, 'dusk', { gps_latitude: GPS.latitude, gps_longitude: GPS.longitude });
  const GPS_ZONE = 'Etc/GMT+1';

  it('with no shoot day, the light reference shows and the switch draws the photo’s date at its location’s place, in its typed zone', () => {
    const records = unscheduled(referenced(base()));
    // The switch off: as before (no day, so nothing drawn), but the light reference is there to turn on.
    expect(sunReadingOf(records, 'sun', none)).toMatchObject({ missing: 'noDay' });
    expect(sunLightOf(records, 'sun')).toMatchObject({ location: { id: 'quay' }, reference: { kind: 'ready' }, place: { source: 'location', ...PLACE } });
    const on = drawn(switchedOn(records));
    expect(on.place).toMatchObject({ source: 'location', ...PLACE, location: { id: 'quay' } });
    expect(on.date).toEqual({ source: 'photo', date: '2026-11-03', time: '16:42', photo: records.dusk });
    expect(on.zone).toEqual({ zone: ZONE, source: 'location' });
    expect(on.path).toEqual(sunPath('2026-11-03', PLACE.latitude, PLACE.longitude, ZONE));
    expect(on.photoAt?.instant.toISOString()).toBe('2026-11-03T19:42:07.000Z');
    expect(on.frame).toBeNull();
    expect(sunZonePointOf(switchedOn(records), 'sun')).toBeNull();
    // With a shoot day it is the same rule: the same place, date and sun, the frame still said.
    const scheduled = drawn(switchedOn(referenced(base())));
    expect(scheduled.frame?.id).toBe('a');
    expect({ ...scheduled, frame: null }).toEqual(on);
  });

  it('uses the photo’s own GPS when it has one, its zone looked up at that point by the photo’s id', () => {
    for (const records of [switchedOn(withGps(unscheduled(referenced(base())))), switchedOn(withGps(referenced(base())))]) {
      // The point is the photo's own.
      expect(sunZonePointOf(records, 'sun')).toEqual({ id: 'dusk', ...GPS, own: true });
      // On its way, then none found, then found.
      expect(sunReadingOf(records, 'sun', none)).toMatchObject({ missing: 'noZone', pending: true, place: { source: 'photo', ...GPS }, date: { source: 'photo', date: '2026-11-03', time: '16:42' } });
      expect(sunReadingOf(records, 'sun', new Map([['dusk', null]]))).toMatchObject({ missing: 'noZone', place: { source: 'photo' } });
      expect(sunReadingOf(records, 'sun', new Map([['dusk', null]]))).not.toHaveProperty('pending');
      // The location's zone is not the photo's place's.
      expect(sunReadingOf(records, 'sun', new Map([['quay', 'Etc/GMT+3']]))).toMatchObject({ missing: 'noZone' });
      const zones = new Map([['dusk', GPS_ZONE]]);
      const reading = drawn(records, zones);
      expect(reading.place).toEqual({ source: 'photo', ...GPS, photo: records.dusk, location: records.quay });
      expect(reading.zone).toEqual({ zone: GPS_ZONE, source: 'map' });
      // No offset: the camera's clock read as the wall clock at the photo's place, an hour behind Greenwich.
      expect(reading.photoAt?.instant.toISOString()).toBe('2026-11-03T17:42:07.000Z');
      expect(reading.photoAt).toMatchObject(sunPosition(new Date('2026-11-03T17:42:07.000Z'), GPS.latitude, GPS.longitude));
      expect(reading.path).toEqual(sunPath('2026-11-03', GPS.latitude, GPS.longitude, GPS_ZONE));
      expect(sunLightZone(sunLightOf(records, 'sun'), zones)).toBe(GPS_ZONE);
      expect(sunLightZonePoint(sunLightOf(records, 'sun'))).toEqual({ id: 'dusk', ...GPS, own: true });
    }
  });

  it('with the photo’s own offset, fixes the instant by it and says it in the zone of the place used', () => {
    // A phone on Tokyo time: 04:42 on the 4th there is 19:42 UTC on the 3rd.
    const tokyo = (records: Records): Records => patched(records, 'dusk', { taken_at: '2026-11-04T04:42:07', taken_offset: '+09:00' });
    const atGps = drawn(switchedOn(tokyo(withGps(unscheduled(referenced(base()))))), new Map([['dusk', GPS_ZONE]]));
    expect(atGps.photoAt?.instant.toISOString()).toBe('2026-11-03T19:42:07.000Z');
    expect(atGps.date).toMatchObject({ source: 'photo', date: '2026-11-03', time: '18:42' });
    const atLocation = drawn(switchedOn(tokyo(unscheduled(referenced(base())))));
    expect(atLocation.photoAt?.instant.toISOString()).toBe('2026-11-03T19:42:07.000Z');
    expect(atLocation.date).toMatchObject({ source: 'photo', date: '2026-11-03', time: '16:42' });
  });

  it('with the location’s zone cleared, looks it up at the location’s place; with none yet, says the camera’s date and draws nothing', () => {
    const records = switchedOn(patched(unscheduled(referenced(base())), 'quay', {}, ['time_zone']));
    expect(sunZonePointOf(records, 'sun')).toEqual({ id: 'quay', ...PLACE, own: false });
    expect(sunReadingOf(records, 'sun', none)).toMatchObject({ missing: 'noZone', pending: true, date: { source: 'photo', date: '2026-11-03', time: '16:42' } });
    expect(drawn(records, new Map([['quay', ZONE]])).zone).toEqual({ zone: ZONE, source: 'map' });
    expect(sunLightZone(sunLightOf(records, 'sun'), none)).toBeNull();
    expect(sunLightZone(sunLightOf(records, 'sun'), new Map([['quay', ZONE]]))).toBe(ZONE);
  });

  it('with no place for the photo nor its location, is as before and says the place is missing', () => {
    const placeless = patched(unscheduled(referenced(base())), 'quay', {}, ['latitude', 'longitude']);
    expect(sunLightOf(placeless, 'sun')).toMatchObject({ reference: { kind: 'ready' }, place: null });
    expect(sunReadingOf(switchedOn(placeless), 'sun', none)).toEqual(sunReadingOf(placeless, 'sun', none));
    // With its GPS, it draws.
    expect(drawn(switchedOn(withGps(placeless)), new Map([['dusk', GPS_ZONE]])).place.source).toBe('photo');
  });

  it('never takes a place from another frame or the sun path’s own values, and wants the room’s north', () => {
    // The sun path's own place and date are set: with the switch on, the photo's place and date win.
    const own = patched(switchedOn(unscheduled(referenced(base()))), 'sun', { own_latitude: 40.7128, own_longitude: -74.006, own_date: '2027-01-15' });
    const reading = drawn(own);
    expect(reading.place).toMatchObject({ source: 'location', ...PLACE });
    expect(reading.date.source).toBe('photo');
    // No location among the frames: no light reference, as before.
    const nowhere = patched(switchedOn(unscheduled(referenced(base()))), 's1', {}, ['location_id']);
    expect(sunLightOf(nowhere, 'sun')).toBeNull();
    expect(sunReadingOf(nowhere, 'sun', none)).toEqual(sunReadingOf(patched(nowhere, 'sun', {}, ['at_photo']), 'sun', none));
    // No north: said as the setup's rule says it.
    expect(sunReadingOf(trashed(switchedOn(unscheduled(referenced(base()))), 'north'), 'sun', none)).toEqual({ missing: 'noNorth', place: null, date: null });
  });
});

describe('the photo’s sun, round 4', () => {
  it('takes the location’s typed zone when the photo’s GPS is the location’s own pin, still said as the photo’s place', () => {
    const pin = { latitude: 40.2, longitude: -72.9 };
    const records = switchedOn(
      patched(patched(referenced(base()), 'quay', { ...pin, map_name: '40.20000, -72.90000', time_zone: 'America/New_York' }), 'dusk', {
        taken_at: '2026-06-21T15:20:00',
        gps_latitude: pin.latitude,
        gps_longitude: pin.longitude,
      }),
    );
    const zones = new Map([['dusk', 'Etc/GMT+5']]);
    const reading = drawn(records, zones);
    expect(reading.place).toMatchObject({ source: 'photo', ...pin });
    expect(reading.zone).toEqual({ zone: 'America/New_York', source: 'location' });
    // 15:20 on New York's summer clock, not on a fixed five hours behind.
    expect(reading.photoAt?.instant.toISOString()).toBe('2026-06-21T19:20:00.000Z');
    expect(reading.date).toMatchObject({ source: 'photo', date: '2026-06-21', time: '15:20' });
    // Nothing to look up: the zone is typed.
    expect(sunZonePointOf(records, 'sun')).toBeNull();
    expect(sunLightZonePoint(sunLightOf(records, 'sun'))).toBeNull();
    expect(sunLightZone(sunLightOf(records, 'sun'), zones)).toBe('America/New_York');
    // With no zone typed, it is looked up at the location's pin, by the location's id.
    const untyped = patched(records, 'quay', {}, ['time_zone']);
    expect(sunZonePointOf(untyped, 'sun')).toEqual({ id: 'quay', ...pin, own: false });
    expect(drawn(untyped, new Map([['quay', 'America/New_York'], ['dusk', 'Etc/GMT+5']])).zone).toEqual({ zone: 'America/New_York', source: 'map' });
    // A GPS a little off the pin is a point of its own again.
    const off = patched(records, 'dusk', { gps_latitude: 40.21 });
    expect(sunZonePointOf(off, 'sun')).toEqual({ id: 'dusk', latitude: 40.21, longitude: pin.longitude, own: true });
  });

  it('says no other days or places while the date drawn is the photo’s', () => {
    // A second frame in the setup on another day: said with the shoot day's date, not with the photo's.
    const twoDays = (records: Records): Records =>
      recordsOf(
        ...Object.values(records),
        record('d2', 'shoot_day', 'p', { date: '2027-07-01' }, 'b'),
        record('b', 'shot', 's1', { number: '1B', setup_id: 'u1', shoot_day_id: 'd2' }, 'b'),
      );
    const off = drawn(twoDays(referenced(base())));
    expect(off.date.source).toBe('shootDay');
    expect(off.otherDays.map((d) => d.record.id)).toEqual(['d2']);
    const on = drawn(switchedOn(twoDays(referenced(base()))));
    expect(on.date.source).toBe('photo');
    expect(on.otherDays).toEqual([]);
    expect(on.otherPlaces).toEqual([]);
  });
});

describe('the photo’s sun, round 5', () => {
  it('names the location when a photo at its own pin has no zone yet, so Open Locations opens it', () => {
    // The photo's GPS is the quay's pin exactly, and the quay has no zone typed.
    const records = switchedOn(patched(patched(referenced(base()), 'quay', {}, ['time_zone']), 'dusk', { gps_latitude: PLACE.latitude, gps_longitude: PLACE.longitude }));
    expect(sunZonePointOf(records, 'sun')).toEqual({ id: 'quay', ...PLACE, own: false });
    // On its way, and none found: both name the quay, the place still said as the photo's.
    const pending = sunReadingOf(records, 'sun', none);
    expect(pending).toMatchObject({ missing: 'noZone', locationId: 'quay', pending: true, place: { source: 'photo', ...PLACE } });
    const notFound = sunReadingOf(records, 'sun', new Map([['quay', null]]));
    expect(notFound).toMatchObject({ missing: 'noZone', locationId: 'quay', place: { source: 'photo' } });
    expect(notFound).not.toHaveProperty('pending');
    // A GPS off the pin is a point of its own: no location to open.
    const off = patched(records, 'dusk', { gps_latitude: 20.25 });
    expect(sunReadingOf(off, 'sun', new Map([['dusk', null]]))).not.toHaveProperty('locationId');
  });
});

describe('"Show the sun at the photo’s time", the edit', () => {
  it('is one op, stored only as true, and nothing when it reads so already', () => {
    expect(atPhotoChanges(base(), 'sun', true)).toEqual([{ kind: 'update', id: 'sun', set: { at_photo: true } }]);
    expect(atPhotoChanges(switchedOn(base()), 'sun', true)).toEqual([]);
    expect(atPhotoChanges(switchedOn(base()), 'sun', false)).toEqual([{ kind: 'update', id: 'sun', unset: ['at_photo'] }]);
    expect(atPhotoChanges(base(), 'sun', false)).toEqual([]);
    // An odd stored value is taken off by Off, and replaced by On.
    expect(atPhotoChanges(patched(base(), 'sun', { at_photo: 'yes' }), 'sun', false)).toEqual([{ kind: 'update', id: 'sun', unset: ['at_photo'] }]);
    expect(atPhotoChanges(patched(base(), 'sun', { at_photo: 'yes' }), 'sun', true)).toEqual([{ kind: 'update', id: 'sun', set: { at_photo: true } }]);
    expect(atPhotoChanges(base(), 'north', true)).toEqual([]);
    expect(atPhotoChanges(trashed(base(), 'sun'), 'sun', true)).toEqual([]);
  });
});

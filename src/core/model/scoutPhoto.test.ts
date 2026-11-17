import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { Props, SbdRecord } from './record';
import { dateTimeLabel, lightReferenceOf, photoName, photoTakenOf, photoUses, takenLabel, takenProps } from './scoutPhoto';

// Scout photos (6.27): the one reader of what a photo's EXIF said (odd values read as not there), what the import
// writes from the EXIF reader's answer, and a location's light reference as its `light_photo_id` reads now. The place
// in every case is made up: a point in the open sea.

const at = '2026-11-16T12:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({ id, type, parentId, sortKey: id, props, trashedAt, trashedBy: null, createdAt: at, updatedAt: at });
const image = { kind: 'image', file: 'a'.repeat(64), mime: 'image/jpeg', width: 800, height: 600 };
const taken = { taken_at: '2026-11-03T16:42:07', taken_offset: '+02:00', gps_latitude: 12.510001, gps_longitude: -45.250002 };

beforeEach(() => {
  setLocale('en');
});

describe('the one reader of a photo’s EXIF props', () => {
  it('reads the time, its offset and the place as stored, every decimal kept', () => {
    expect(photoTakenOf({ ...image, ...taken })).toEqual({ takenAt: '2026-11-03T16:42:07', offset: '+02:00', place: { latitude: 12.510001, longitude: -45.250002 } });
    expect(photoTakenOf(image)).toEqual({ takenAt: null, offset: null, place: null });
  });

  it('reads a time that isn’t one as not there, and its offset with it', () => {
    for (const odd of ['2026-11-03 16:42:07', '2026-11-03T16:42', '2026-13-03T16:42:07', '2026-02-30T16:42:07', '2026-11-03T24:00:00', '2026-11-03T16:60:00', '2026-11-03T16:42:07Z', '2026-11-03T16:42:07+02:00', '', 20261103, null, true, ['2026-11-03T16:42:07']]) {
      expect(photoTakenOf({ ...taken, taken_at: odd }), String(odd)).toEqual({ takenAt: null, offset: null, place: { latitude: 12.510001, longitude: -45.250002 } });
    }
  });

  it('reads an offset that isn’t one as not there, the time kept', () => {
    for (const odd of ['2:00', '+2:00', '0200', '+15:00', '+14:30', '+02:60', 'Z', 'Europe/Madrid', 2, null]) {
      expect(photoTakenOf({ ...taken, taken_offset: odd }), String(odd)).toMatchObject({ takenAt: '2026-11-03T16:42:07', offset: null });
    }
    for (const fine of ['+00:00', '-00:00', '-09:30', '+05:45', '+14:00', '-12:00']) expect(photoTakenOf({ ...taken, taken_offset: fine }).offset, fine).toBe(fine);
  });

  it('reads a place only with both halves, both numbers, both on the Earth', () => {
    const none = (props: Props) => {
      expect(photoTakenOf({ ...taken, ...props }).place, JSON.stringify(props)).toBeNull();
    };
    none({ gps_latitude: 90.0001 });
    none({ gps_latitude: -91 });
    none({ gps_longitude: 180.5 });
    none({ gps_longitude: -181 });
    none({ gps_latitude: '12.51' });
    none({ gps_longitude: null });
    none({ gps_latitude: Number.NaN });
    none({ gps_longitude: Number.POSITIVE_INFINITY });
    expect(photoTakenOf({ taken_at: taken.taken_at, gps_latitude: 12.51 }).place).toBeNull();
    expect(photoTakenOf({ gps_longitude: -45.25 }).place).toBeNull();
    // The poles and the date line are places.
    expect(photoTakenOf({ gps_latitude: -90, gps_longitude: 180 }).place).toEqual({ latitude: -90, longitude: 180 });
  });

  it('says what "Use this photo’s place and time" would use', () => {
    expect(photoUses({ ...image, ...taken })).toEqual({ place: true, time: true });
    expect(photoUses({ ...image, taken_at: taken.taken_at })).toEqual({ place: false, time: true });
    expect(photoUses({ ...image, gps_latitude: 1, gps_longitude: 2 })).toEqual({ place: true, time: false });
    expect(photoUses(image)).toEqual({ place: false, time: false });
  });
});

describe('what the import writes from the EXIF reader’s answer', () => {
  it('writes only what reads, through the one reader', () => {
    expect(takenProps({ takenAt: '2026-11-03T16:42:07', takenOffset: '+02:00', latitude: 12.510001, longitude: -45.250002 })).toEqual(taken);
    expect(takenProps({ takenAt: '2026-11-03T16:42:07', takenOffset: null, latitude: null, longitude: null })).toEqual({ taken_at: '2026-11-03T16:42:07' });
    expect(takenProps({ takenAt: null, takenOffset: '+02:00', latitude: 12.5, longitude: -45.25 })).toEqual({ gps_latitude: 12.5, gps_longitude: -45.25 });
  });

  it('writes nothing for a picture with no EXIF, or an answer that is odd', () => {
    expect(takenProps(null)).toEqual({});
    expect(takenProps(undefined)).toEqual({});
    expect(takenProps({})).toEqual({});
    expect(takenProps({ takenAt: null, takenOffset: null, latitude: null, longitude: null })).toEqual({});
    expect(takenProps({ takenAt: 'yesterday', takenOffset: 'east', latitude: 120, longitude: 'far' })).toEqual({});
    expect(takenProps({ takenAt: { at: 1 }, latitude: [12.5], longitude: -45.25 })).toEqual({});
    // One half of a place is no place.
    expect(takenProps({ latitude: 12.5 })).toEqual({});
  });
});

describe('a location’s light reference', () => {
  const location = (props: Props) => record('loc', 'location', 'p', { name: 'Quay', ...props });
  const records = (loc: SbdRecord, ...rest: SbdRecord[]) => Object.fromEntries([record('p', 'project', null, {}), loc, ...rest].map((r) => [r.id, r]));

  it('is the photo its `light_photo_id` names, with its time', () => {
    const loc = location({ light_photo_id: 'ph' });
    const photo = record('ph', 'media', 'loc', { ...image, ...taken, source_name: 'quay-dusk.jpg' });
    expect(lightReferenceOf(records(loc, photo), loc)).toEqual({ kind: 'ready', photo, takenAt: '2026-11-03T16:42:07', offset: '+02:00' });
    expect(photoName(photo)).toBe('quay-dusk.jpg');
    expect(photoName(record('x', 'media', 'loc', image))).toBe('');
  });

  it('is none without one, or when the id names nothing, another location’s photo, a PDF or another kind of record', () => {
    const photo = record('ph', 'media', 'loc', { ...image, ...taken });
    expect(lightReferenceOf(records(location({}), photo), location({}))).toEqual({ kind: 'none' });
    for (const id of ['gone', 'p', 'loc', 'other-photo', 'pdf', 7, null]) {
      const loc = location({ light_photo_id: id });
      const all = records(loc, photo, record('other', 'location', 'p', { name: 'Yard' }), record('other-photo', 'media', 'other', { ...image, ...taken }), record('pdf', 'media', 'loc', { kind: 'pdf', ...taken }));
      expect(lightReferenceOf(all, loc), String(id)).toEqual({ kind: 'none' });
    }
  });

  it('says a photo in the Trash, and one whose time can’t be read', () => {
    const loc = location({ light_photo_id: 'ph' });
    const trashed = record('ph', 'media', 'loc', { ...image, ...taken }, at);
    expect(lightReferenceOf(records(loc, trashed), loc)).toEqual({ kind: 'trashed', photo: trashed });
    const untimed = record('ph', 'media', 'loc', { ...image, ...taken, taken_at: 'sometime' });
    expect(lightReferenceOf(records(loc, untimed), loc)).toEqual({ kind: 'noTime', photo: untimed });
  });
});

describe('what both readers refuse (6.27 round 2)', () => {
  it('reads a year before 1970 as no time: a camera’s clock that was never set', () => {
    for (const early of ['1969-12-31T23:59:59', '1904-01-01T00:00:00', '0001-01-01T00:00:00']) {
      expect(photoTakenOf({ ...taken, taken_at: early }), early).toMatchObject({ takenAt: null, offset: null });
      expect(takenProps({ takenAt: early, takenOffset: '+02:00' }), early).toEqual({});
    }
    expect(photoTakenOf({ taken_at: '1970-01-01T00:00:00' }).takenAt).toBe('1970-01-01T00:00:00');
    expect(photoUses({ ...image, taken_at: '1969-07-20T20:17:00' })).toEqual({ place: false, time: false });
  });

  it('reads a place of exactly 0, 0 as none, stored or answered: what a camera with no fix writes', () => {
    expect(photoTakenOf({ ...taken, gps_latitude: 0, gps_longitude: 0 })).toEqual({ takenAt: '2026-11-03T16:42:07', offset: '+02:00', place: null });
    expect(photoTakenOf({ gps_latitude: -0, gps_longitude: 0 }).place).toBeNull();
    expect(takenProps({ takenAt: '2026-11-03T16:42:07', latitude: 0, longitude: 0 })).toEqual({ taken_at: '2026-11-03T16:42:07' });
    expect(takenProps({ latitude: 0, longitude: 0 })).toEqual({});
    // On the equator or on the meridian, away from the other, is a place.
    expect(photoTakenOf({ gps_latitude: 0, gps_longitude: -45.25 }).place).toEqual({ latitude: 0, longitude: -45.25 });
    expect(photoTakenOf({ gps_latitude: 12.5, gps_longitude: 0 }).place).toEqual({ latitude: 12.5, longitude: 0 });
    expect(takenProps({ latitude: 12.5, longitude: 0 })).toEqual({ gps_latitude: 12.5, gps_longitude: 0 });
  });
});

describe('when a photo was taken, in words', () => {
  it('is the date and a 24-hour time, with the year where asked, in the app’s language', () => {
    expect(takenLabel('2026-11-03T16:42:07')).toBe('Nov 3, 16:42');
    expect(takenLabel('2026-11-03T16:42:07', true)).toBe('Nov 3, 2026, 16:42');
    expect(dateTimeLabel('2026-01-01', '00:05')).toBe('Jan 1, 00:05');
    setLocale('es');
    expect(takenLabel('2026-11-03T06:02:59', true)).toBe('3 nov 2026, 06:02');
  });
});

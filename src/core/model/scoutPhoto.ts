import { formatDate, t } from '../i18n';
import type { Coordinates } from './coordinates';
import type { JsonValue, Props, SbdRecord } from './record';
import { isDayDate } from './shootDay';

// Scout photos (6.27, Kevin Nov 16): a location's photo keeps the date, the time and the place its EXIF gave when it
// was imported (read on this computer, src-tauri/src/exif.rs; never sent anywhere, and the stored picture carries no
// EXIF: it is drawn again on import), as props on its `media` record:
// - `taken_at`: the wall-clock time as the camera wrote it, `YYYY-MM-DDTHH:mm:ss`, with no zone;
// - `taken_offset`: the camera's offset from UTC then (`+02:00`), only when the file said;
// - `gps_latitude`, `gps_longitude`: decimal degrees, every decimal kept.
// All optional; this is the ONE reader, and it refuses odd values (they read as not there). "Use this photo's place and
// time" puts the photo's place on its location as pasted coordinates are put, and makes the photo the location's light
// reference (`light_photo_id` on the location, one per location; the edits are in locationEdits.ts), which a sun path
// can be drawn for (sunSources.ts).
// Where and when a photo was taken says where a shoot is: History never shows the coordinates, and they count as
// contact details for what an assistant may read (Phase 7).

type Records = Readonly<Record<string, SbdRecord>>;

/** What a photo's EXIF said, as stored on its record; each part null when it has none, or none that reads. */
export interface PhotoTaken {
  /** `YYYY-MM-DDTHH:mm:ss`, the camera's own clock. */
  takenAt: string | null;
  /** `+02:00`, only beside a time. */
  offset: string | null;
  place: Coordinates | null;
}

const TAKEN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const OFFSET = /^[+-](\d{2}):([0-5]\d)$/;

const takenAtOf = (value: JsonValue | undefined): string | null => {
  const m = typeof value === 'string' ? TAKEN.exec(value) : null;
  // No digital photo is from before 1970: an earlier year is a camera's clock that was never set (Rust's reader
  // refuses it too, src-tauri/src/exif.rs).
  return m && isDayDate(m[1] ?? '') && Number((m[1] ?? '').slice(0, 4)) >= 1970 ? (value as string) : null;
};

const offsetOf = (value: JsonValue | undefined): string | null => {
  const m = typeof value === 'string' ? OFFSET.exec(value) : null;
  if (!m) return null;
  const hours = Number(m[1]);
  // The offsets clocks use: 14 hours either way at most.
  return hours < 14 || (hours === 14 && m[2] === '00') ? (value as string) : null;
};

const degrees = (value: JsonValue | undefined, range: number): number | null => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= range ? value : null);

/** The one reader of a photo's EXIF props: a time only as written, an offset only beside a time, a place only with both halves in range. */
export function photoTakenOf(props: Props): PhotoTaken {
  const takenAt = takenAtOf(props.taken_at);
  const latitude = degrees(props.gps_latitude, 90);
  const longitude = degrees(props.gps_longitude, 180);
  return {
    takenAt,
    offset: takenAt === null ? null : offsetOf(props.taken_offset),
    // 0, 0 is what a camera with no fix writes, never where a photo was taken: no place (Rust's reader drops it too).
    place: latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0) ? { latitude, longitude } : null,
  };
}

/** What the EXIF reader answers for a picture (src/app/photoExif.ts): anything, checked here. */
export interface PhotoExif {
  takenAt?: unknown;
  takenOffset?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  /** Why it holds what it holds (6.27 round 3): read through exifReasonOf. */
  reason?: unknown;
}

/**
 * Why a photo's EXIF answer holds what it holds (6.27 round 3, Kevin Nov 17): `read` (its values, or none of them in
 * it), `none` (no EXIF at all), `refused` (the reader refused it: a block too costly or malformed to read), `heic` (a
 * HEIF or HEIC file whose date and place couldn't be read: boxes the reader can't follow, or an EXIF item stored a way
 * it doesn't read). The photo imports whatever it is.
 */
export type ExifReason = 'read' | 'none' | 'refused' | 'heic';

/** An answer's reason as one of the four; anything else, or none, as `none`. */
export function exifReasonOf(exif: PhotoExif | null | undefined): ExifReason {
  const reason = exif?.reason;
  return reason === 'read' || reason === 'refused' || reason === 'heic' ? reason : 'none';
}

const json = (value: unknown): JsonValue | undefined => (typeof value === 'string' || typeof value === 'number' ? value : undefined);

/** The props a photo's record gets from its EXIF, through the one reader: only what reads, nothing for a picture with none. */
export function takenProps(exif: PhotoExif | null | undefined): Props {
  if (!exif) return {};
  const read = photoTakenOf({ taken_at: json(exif.takenAt), taken_offset: json(exif.takenOffset), gps_latitude: json(exif.latitude), gps_longitude: json(exif.longitude) } as Props);
  return {
    ...(read.takenAt !== null ? { taken_at: read.takenAt } : {}),
    ...(read.offset !== null ? { taken_offset: read.offset } : {}),
    ...(read.place ? { gps_latitude: read.place.latitude, gps_longitude: read.place.longitude } : {}),
  };
}

/** The props a photo's EXIF is kept in: History never shows the two coordinates (summary.ts), and the CSV exports carry none. */
export const TAKEN_PROPS = ['taken_at', 'taken_offset', 'gps_latitude', 'gps_longitude'] as const;

/** "16:42" of a stored time. */
export const takenClock = (takenAt: string): string => takenAt.slice(11, 16);
/** "2026-11-03" of a stored time. */
export const takenDate = (takenAt: string): string => takenAt.slice(0, 10);

/** "Nov 3, 16:42" (or "Nov 3, 2026, 16:42" with the year) for a date (YYYY-MM-DD) and a clock time, in the app's language; the time on a 24-hour clock, as every time in the app. */
export function dateTimeLabel(date: string, clock: string, withYear = false): string {
  // Read at noon UTC, so no time zone moves it a day.
  const day = formatDate(new Date(`${date}T12:00:00Z`), { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' });
  return t('photo.dateTime', { date: day, time: clock });
}

/** A stored time as "Nov 3, 16:42", or with its year. */
export const takenLabel = (takenAt: string, withYear = false): string => dateTimeLabel(takenDate(takenAt), takenClock(takenAt), withYear);

/** A location's photo by id: a live or trashed picture under a live location (not a PDF or a link attached to it); else null. */
export function locationPhoto(records: Records, photoId: string): { photo: SbdRecord; location: SbdRecord } | null {
  const photo = records[photoId];
  const location = photo?.parentId ? records[photo.parentId] : undefined;
  if (photo?.type !== 'media' || photo.props.kind === 'pdf' || photo.props.kind === 'link') return null;
  if (location?.type !== 'location' || location.trashedAt !== null) return null;
  return { photo, location };
}

/**
 * A location's light reference (6.27), as its `light_photo_id` reads now:
 * - `none`: it has none (or the id names nothing, or something that isn't one of this location's photos);
 * - `trashed`: the photo is in the Trash; `noTime`: its time can't be read: either way a sun path can't use it, and says why;
 * - `ready`: the photo, with its time.
 */
export type LightReference =
  | { kind: 'none' }
  | { kind: 'trashed' | 'noTime'; photo: SbdRecord }
  | { kind: 'ready'; photo: SbdRecord; takenAt: string; offset: string | null };

export function lightReferenceOf(records: Records, location: SbdRecord): LightReference {
  const id = location.props.light_photo_id;
  const found = typeof id === 'string' ? locationPhoto(records, id) : null;
  if (!found || found.location.id !== location.id) return { kind: 'none' };
  const { photo } = found;
  if (photo.trashedAt !== null) return { kind: 'trashed', photo };
  const taken = photoTakenOf(photo.props);
  return taken.takenAt === null ? { kind: 'noTime', photo } : { kind: 'ready', photo, takenAt: taken.takenAt, offset: taken.offset };
}

/** A photo's name as its file was called, or '' for one with none (the UI then says "a photo"). */
export const photoName = (photo: SbdRecord): string => (typeof photo.props.source_name === 'string' ? photo.props.source_name : '');

/** What "Use this photo's place and time" would use of a photo: its place, its time, both, or nothing (then there is no button). */
export function photoUses(props: Props): { place: boolean; time: boolean } {
  const taken = photoTakenOf(props);
  return { place: taken.place !== null, time: taken.takenAt !== null };
}

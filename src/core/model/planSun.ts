import type { Change } from '../ops/ops';
import { frameLocationId, locationFields, mapPlace } from './location';
import { northFields, planFields, sceneRoomId, sunFields, type NorthFields, type SunFields } from './plan';
import { cameraSetupFrames, itemSetupId } from './planCamera';
import type { SbdRecord } from './record';
import { frameDayId, projectShootDays, type ShootDay } from './shootDay';
import { isTimeZone } from './sunTimes';

// The room's north and a setup's sun path (6.6, docs/PHASE6_DECISIONS.md "north and the sun"). North is a `plan_item`
// of kind `north` in the room's plan, one per room, and its rotation IS the room's north. A sun path is a `plan_item` of
// kind `sun` in a setup's own plan; what it draws is read live, never copied: the setup's frames, the one shot first
// that has a dated shoot day and a location with a place on the map, that location's zone, and the room's north. What
// is missing for it is said, one thing at a time, in the order a person fixes them. Every reading here is kept per
// records object, as a camera's are (planCamera.ts): a plan reads it for each sun path on every edit.

type Records = Readonly<Record<string, SbdRecord>>;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const memos = new WeakMap<Records, Map<string, unknown>>();

function memo<T>(records: Records, key: string, make: () => T): T {
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  if (known.has(key)) return known.get(key) as T;
  const made = make();
  known.set(key, made);
  return made;
}

let readings = 0;

/** How many sun readings have been worked out from records: for tests, which check it's once per records. */
export const sunReadingsMade = (): number => readings;

/** A room's live north items in plan order: the first is the room's north (a file may carry more; the app never writes a second). */
function northsOf(records: Records, roomId: string): readonly { record: SbdRecord; fields: NorthFields }[] {
  return memo(records, `norths:${roomId}`, () =>
    Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.parentId === roomId && r.trashedAt === null)
      .sort(bySortKey)
      .flatMap((record) => {
        const fields = northFields(record.props);
        return fields ? [{ record, fields }] : [];
      }),
  );
}

/** The room's north item, or null: the room has no north. */
export function roomNorthItem(records: Records, roomId: string | null): { record: SbdRecord; fields: NorthFields } | null {
  if (roomId === null) return null;
  const room = records[roomId];
  if (room?.type !== 'plan' || room.trashedAt !== null || planFields(room.props)?.kind !== 'room') return null;
  return northsOf(records, roomId)[0] ?? null;
}

/** The room's north, degrees clockwise from up the plan, or null for none. */
export const roomNorth = (records: Records, roomId: string | null): number | null => roomNorthItem(records, roomId)?.fields.rotation ?? null;

/** A scene's room's north, or null (no room, or no north in it). */
export const sceneNorth = (records: Records, sceneId: string): number | null => roomNorth(records, sceneRoomId(records, records[sceneId]));

/** A live sun path, with its fields. */
export function liveSun(records: Records, id: string): { record: SbdRecord; fields: SunFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = sunFields(record.props);
  return fields ? { record, fields } : null;
}

/**
 * The live setup a sun path's plan belongs to, or null (one in a room or a blocking plan has no frames to read): the
 * same rule as a camera's (itemSetupId), the setup's first live plan only (6.6 review).
 */
export const sunSetupId = itemSetupId;

/** What a sun path lacks, the first of them in this order. */
export type SunMissing = 'noFrames' | 'noDay' | 'noDate' | 'noLocation' | 'noPlace' | 'noNorth' | 'noZone';

/** What a sun path draws from: the frame chosen, its day, its location and place, the room's north, and what else the setup shoots. */
export interface SunSource {
  frame: SbdRecord;
  day: ShootDay;
  location: SbdRecord;
  place: { latitude: number; longitude: number };
  /** The room's north, degrees clockwise from up the plan. */
  north: number;
  /** The setup's other days and places, among its frames with a dated day: said, never drawn. */
  otherDays: ShootDay[];
  otherPlaces: SbdRecord[];
}

/** A sun path's reading without its zone: what's missing (with where it is fixed), or what it draws from. */
export type SunBase =
  | { missing: Exclude<SunMissing, 'noZone'>; frameId?: string; dayId?: string; locationId?: string }
  | { source: SunSource };

/** The project a record sits in, by its ancestors. */
function projectOf(records: Records, record: SbdRecord): string | null {
  let at: SbdRecord | undefined = record;
  for (let i = 0; at && i < 16; i += 1) {
    if (at.type === 'project') return at.id;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return null;
}

const daysOf = (records: Records, projectId: string): readonly ShootDay[] => memo(records, `days:${projectId}`, () => projectShootDays(records, projectId));

/**
 * What a setup's sun path reads (6.6), worked out once per records: its frames in board order (6.0's reader), those with a
 * live shoot day, those whose day has a date, those with a location (the frame's own, else its scene's: frameLocationId)
 * and those whose location has a place on the map. The frame drawn is the one with the earliest day (by date, then the
 * days' order), then board order. Then the room's north.
 */
export function setupSunBase(records: Records, setupId: string): SunBase {
  return memo(records, `sun:${setupId}`, (): SunBase => {
    readings += 1;
    const setup = records[setupId];
    if (setup?.type !== 'setup' || setup.trashedAt !== null) return { missing: 'noFrames' };
    const frames = cameraSetupFrames(records, setupId);
    if (frames.length === 0) return { missing: 'noFrames' };
    const projectId = projectOf(records, setup);
    const days = projectId === null ? [] : daysOf(records, projectId);
    const dayById = new Map(days.map((d) => [d.record.id, d]));
    const withDay = frames.flatMap((frame, index) => {
      const id = frameDayId(records, frame);
      const day = id === null ? undefined : dayById.get(id);
      return day ? [{ frame, index, day }] : [];
    });
    const [firstWithDay] = withDay;
    if (!firstWithDay) return { missing: 'noDay', frameId: frames[0]?.id ?? '' };
    const dated = withDay.filter((f) => f.day.fields.date !== '');
    if (dated.length === 0) return { missing: 'noDate', dayId: firstWithDay.day.record.id };
    const located = dated.flatMap((f) => {
      const id = frameLocationId(records, f.frame);
      const location = id === null ? undefined : records[id];
      return location ? [{ ...f, location }] : [];
    });
    const [firstLocated] = located;
    if (!firstLocated) return { missing: 'noLocation', frameId: dated[0]?.frame.id ?? '' };
    const placed = located.flatMap((f) => {
      const place = mapPlace(f.location.props);
      return place ? [{ ...f, place: { latitude: place.latitude, longitude: place.longitude } }] : [];
    });
    // The earliest day first (the days' own order: by date, then as made), then board order.
    const chosen = [...placed].sort((a, b) => a.day.number - b.day.number || a.index - b.index)[0];
    if (!chosen) return { missing: 'noPlace', locationId: firstLocated.location.id };
    const north = sceneNorth(records, setup.parentId ?? '');
    if (north === null) return { missing: 'noNorth' };
    const otherDays = [...new Map(dated.filter((f) => f.day.record.id !== chosen.day.record.id).map((f) => [f.day.record.id, f.day])).values()].sort((a, b) => a.number - b.number);
    const otherPlaces = [...new Map(located.filter((f) => f.location.id !== chosen.location.id).map((f) => [f.location.id, f.location])).values()];
    return { source: { frame: chosen.frame, day: chosen.day, location: chosen.location, place: chosen.place, north, otherDays, otherPlaces } };
  });
}

/** A sun path's base, read from the setup its plan belongs to; null for one that isn't a live sun path. */
export function sunBase(records: Records, sunId: string): SunBase | null {
  const sun = liveSun(records, sunId);
  if (!sun) return null;
  const setupId = sunSetupId(records, sun.record);
  return setupId === null ? { missing: 'noFrames' } : setupSunBase(records, setupId);
}

/** Where a sun path's zone comes from: typed on the location, or looked up from its place (never this computer's). */
export interface SunZone {
  zone: string;
  source: 'location' | 'map';
}

/**
 * The zone a source's times are in: its location's own `time_zone`, else the one looked up from its place (`zones`, by
 * location id: a zone, null for none, no entry while the answer is on its way); null for none. Unlike a call sheet, this
 * computer's zone never stands in: a sun drawn in the wrong zone would be hours off. Outside the desktop app, where there
 * is no lookup, the caller gives null for every place (useSunZonesAt), so only a location's own zone counts there.
 */
export function sourceZone(source: SunSource, zones: ReadonlyMap<string, string | null>): SunZone | null {
  const own = locationFields(source.location.props).time_zone;
  if (own !== '') return { zone: own, source: 'location' };
  const looked = zones.get(source.location.id) ?? null;
  return looked !== null && isTimeZone(looked) ? { zone: looked, source: 'map' } : null;
}

/**
 * A sun path's whole reading: what's missing, or its source with the zone its times are in. `pending`: no zone yet, the
 * lookup's answer on its way (no entry in `zones`), so nothing is said about it yet (6.6 review: no "No time zone" flash).
 */
export type SunReading = { missing: SunMissing; frameId?: string; dayId?: string; locationId?: string; pending?: true } | { source: SunSource; zone: SunZone };

export function sunReading(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>): SunReading | null {
  const base = sunBase(records, sunId);
  if (!base) return null;
  if ('missing' in base) return base;
  const zone = sourceZone(base.source, zones);
  if (zone) return { source: base.source, zone };
  const pending = locationFields(base.source.location.props).time_zone === '' && !zones.has(base.source.location.id);
  return { missing: 'noZone', locationId: base.source.location.id, ...(pending ? { pending: true as const } : {}) };
}

/** The place whose zone a sun path needs looked up: its location's, when it has a place and no zone of its own; else null. */
export function sunZonePoint(records: Records, sunId: string): { id: string; latitude: number; longitude: number } | null {
  const base = sunBase(records, sunId);
  if (!base || 'missing' in base || locationFields(base.source.location.props).time_zone !== '') return null;
  return { id: base.source.location.id, ...base.source.place };
}

// The edits.

/** "HH:mm" for a time of day in minutes, wrapped round midnight. */
export function clockOf(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A time typed: "14:30", "1430", "9:05", "9" (on the hour); null when it isn't one. */
export function parseSunTime(typed: string): string | null {
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?$/.exec(typed.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  return hour <= 23 && minute <= 59 ? clockOf(hour * 60 + minute) : null;
}

/** A time stepped by `by` minutes (15, or 60 with Shift), landing on the step: 14:07 up a quarter is 14:15, down 14:00. */
export function steppedTime(time: string, by: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const now = h * 60 + m;
  const step = Math.abs(by);
  const next = by > 0 ? Math.floor(now / step) * step + step : Math.ceil(now / step) * step - step;
  return clockOf(next);
}

/** A sun path's time set (one op), "HH:mm"; nothing when it reads so already or isn't a time. */
export function sunTimeChanges(records: Records, ids: readonly string[], time: string): Change[] {
  if (parseSunTime(time) !== time) return [];
  return ids.flatMap((id): Change[] => {
    const sun = liveSun(records, id);
    return sun && (sun.fields.time !== time || sun.record.props.time !== time) ? [{ kind: 'update', id, set: { time } }] : [];
  });
}

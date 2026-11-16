import type { Change } from '../ops/ops';
import { formatCoordinates, type Coordinates } from './coordinates';
import { frameLocationId, locationFields, mapPlace } from './location';
import { cameraSetupFrames } from './planCamera';
import { liveSun, locationZone, sceneNorth, setupSunBase, sunSetupId, type SunMissing, type SunZone } from './planSun';
import type { JsonValue, Props, SbdRecord } from './record';
import { frameDayId, isDayDate, projectShootDays, type ShootDay } from './shootDay';
import { solarNoon, sunAt, sunPath, type SunAt, type SunPath } from './sunPath';
import { isTimeZone, zoneClock } from './sunTimes';

// Quick sun (6.5.5, Kevin Nov 16): what a sun path is drawn for, the ONE reading the Selection tile, the plan's drawing,
// the compass and the exports use, and that the MCP's `get_plan` will return for each sun path, with Phase 10's 3D scene.
// A sun path may carry its own place and date (`own_latitude`, `own_longitude`, `own_date`), typed or pasted, for a
// setup with no location or shoot day. Where the setup has them, they win:
// - the place is the frames' location's when one has a place on the map, else the item's own;
// - the date is the frames' shoot day's when one has a date, else the item's own;
// - the zone is the location's `time_zone` where the place is the location's (else the one looked up from its place),
//   and for the item's own place the one looked up from its coordinates, offline (tzf-rs on the desktop);
// each saying where it came from. The setup's own rule (planSun.ts, 6.6) is kept exactly: when it finds a day and a place
// together, that is what is drawn, its other days and places said as before; only when it finds none do the setup's day
// and place count one at a time, then the item's own values. A sun path with no own values reads exactly as 6.6 made it.
// Nothing is stored but the own values; nothing is requested.

type Records = Readonly<Record<string, SbdRecord>>;

/** Where a sun path's place comes from: the frames' location, or its own coordinates. */
export type SunPlace = (Coordinates & { source: 'location'; location: SbdRecord }) | (Coordinates & { source: 'own' });

/** Where a sun path's date (YYYY-MM-DD) comes from: the frames' shoot day, or its own. */
export type SunDate = { source: 'shootDay'; date: string; day: ShootDay } | { source: 'own'; date: string };

/**
 * What a sun path is drawn for, worked out live (6.5.5): this is what `get_plan` will return for each sun path, and what
 * Phase 10's 3D scene lights its set with.
 * - `place` and `date`, each with its source; either may be null while missing, so the settings can say both always.
 * - `zone`: the IANA zone its times are in, from the location (`location`) or looked up from the coordinates (`map`).
 * - `north`: the room's north, degrees clockwise from up the plan.
 * - `path`: the day's sun positions (sunrise to sunset every 5 minutes, the whole hours, rise and set: sunPath.ts), and
 *   `at`: the sun at the item's `time`; `noon`: the sun at solar noon, what the compass shows when the item has no time
 *   of its own. Null for a date or place SunCalc can't read.
 * - `frame`, `otherDays` and `otherPlaces`: the frame the setup's rule drew from and the setup's other days and places,
 *   said, never drawn (none when a value is the item's own).
 * Missing: what it lacks, the first of them in the order a person fixes them, with the place and date it has so far.
 */
export type SunReadingOf =
  | {
      missing: SunMissing;
      frameId?: string;
      dayId?: string;
      locationId?: string;
      /** No zone yet: the lookup's answer on its way, so nothing is said about it yet. */
      pending?: true;
      /** The sun path's own field that would complete what's missing (6.5.5), when it has the other own value. */
      ownField?: 'place' | 'date';
      place: SunPlace | null;
      date: SunDate | null;
    }
  | {
      place: SunPlace;
      date: SunDate;
      zone: SunZone;
      north: number;
      frame: SbdRecord | null;
      otherDays: ShootDay[];
      otherPlaces: SbdRecord[];
      path: SunPath | null;
      at: SunAt | null;
      noon: SunAt | null;
    };

/** A sun path's own place and date as stored; each null when it has none, or none that reads. */
export interface OwnSun {
  place: Coordinates | null;
  date: string | null;
  /** Whether its `time` is its own ("HH:mm" as stored), not the default noon. */
  ownTime: boolean;
}

const coordinate = (value: JsonValue | undefined, range: number): number | null => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= range ? value : null);

/** The own values a sun path's props hold (6.5.5): a place only with both coordinates in range, a date only as YYYY-MM-DD. */
export function ownSunOf(props: Props): OwnSun {
  const latitude = coordinate(props.own_latitude, 90);
  const longitude = coordinate(props.own_longitude, 180);
  const date = typeof props.own_date === 'string' && isDayDate(props.own_date) ? props.own_date : null;
  const time = typeof props.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(props.time);
  return { place: latitude !== null && longitude !== null ? { latitude, longitude } : null, date, ownTime: time };
}

const memos = new WeakMap<Records, Map<string, SetupSources>>();

/** The project a record sits in, by its ancestors. */
function projectOf(records: Records, record: SbdRecord): string | null {
  let at: SbdRecord | undefined = record;
  for (let i = 0; at && i < 16; i += 1) {
    if (at.type === 'project') return at.id;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return null;
}

/** The setup's day and place one at a time, and why each is missing (in 6.6's words), for when its own rule finds neither together. */
interface SetupSources {
  date: { date: string; day: ShootDay } | null;
  place: { location: SbdRecord; latitude: number; longitude: number } | null;
  dateMissing: { missing: 'noFrames' | 'noDay' | 'noDate'; frameId?: string; dayId?: string };
  placeMissing: { missing: 'noFrames' | 'noLocation' | 'noPlace'; frameId?: string; locationId?: string };
}

/**
 * The setup's day and place, each read alone, once per records: the earliest dated day among its frames (by the days'
 * order, then board order), and the first place on the map among its frames' locations (those with a dated day first,
 * the earliest day first, then board order), so either can stand with the item's own other half.
 */
function setupSources(records: Records, setupId: string): SetupSources {
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  const found = known.get(setupId);
  if (found) return found;
  const setup = records[setupId];
  const frames = setup?.type === 'setup' && setup.trashedAt === null ? cameraSetupFrames(records, setupId) : [];
  const projectId = setup ? projectOf(records, setup) : null;
  const days = projectId === null ? [] : projectShootDays(records, projectId);
  const dayById = new Map(days.map((d) => [d.record.id, d]));
  const withDay = frames.flatMap((frame, index) => {
    const id = frameDayId(records, frame);
    const day = id === null ? undefined : dayById.get(id);
    return day ? [{ frame, index, day }] : [];
  });
  const dated = withDay.filter((f) => f.day.fields.date !== '').sort((a, b) => a.day.number - b.day.number || a.index - b.index);
  const [earliest] = dated;
  const located = frames
    .map((frame, index) => {
      const id = frameLocationId(records, frame);
      const location = id === null ? undefined : records[id];
      const day = dated.find((f) => f.frame.id === frame.id)?.day;
      return { frame, index, location, rank: day ? day.number : Number.POSITIVE_INFINITY };
    })
    .filter((f): f is typeof f & { location: SbdRecord } => f.location !== undefined)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const placed = located.flatMap((f) => {
    const place = mapPlace(f.location.props);
    return place ? [{ location: f.location, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const sources: SetupSources = {
    date: earliest ? { date: earliest.day.fields.date, day: earliest.day } : null,
    place: placed[0] ?? null,
    // In 6.6's words: a setup with no frames says so whichever half it lacks.
    dateMissing: withDay[0] ? { missing: 'noDate', dayId: withDay[0].day.record.id } : frames[0] ? { missing: 'noDay', frameId: frames[0].id } : { missing: 'noFrames' },
    placeMissing: located[0] ? { missing: 'noPlace', locationId: located[0].location.id } : frames[0] ? { missing: 'noLocation', frameId: frames[0].id } : { missing: 'noFrames' },
  };
  known.set(setupId, sources);
  return sources;
}

/** The point whose zone a sun path needs looked up: its location's place (by the location's id) or its own (by its own id). */
export interface SunZonePoint extends Coordinates {
  id: string;
  /** Its own coordinates, not a location's. */
  own: boolean;
}

interface Drawn {
  place: SunPlace;
  date: SunDate;
  north: number;
  frame: SbdRecord | null;
  otherDays: ShootDay[];
  otherPlaces: SbdRecord[];
}

type Base = { drawn: Drawn } | { missing: Extract<SunReadingOf, { missing: SunMissing }> };

/**
 * What a sun path draws from, its zone aside (6.5.5, the rule after review). It never pairs a day from one frame with a
 * place from another, and never claims a source it doesn't draw:
 * (a) one frame gives both a dated day and a placed location: 6.6's rule (setupSunBase), unchanged; own values unused.
 * (b) otherwise the frames may still give a day alone (the earliest dated day) or a place alone (the first placed
 *     location), maybe from different frames; two setup halves from different frames are never paired. So:
 *     - no own values: exactly 6.6's result and words, with no place or date said as drawn;
 *     - the setup gives a day, and an own place is set: that day with the own place;
 *     - the setup gives a place, an own date is set, and the case above doesn't apply: that place with the own date;
 *     - the setup gives neither half: the own place and own date, where both are set;
 *     - anything else: what is missing, said as 6.6 says it (the setup's own reason for that half), naming the own
 *       field that would complete it (`ownField`).
 * A sun path outside a setup (in a room or a blocking plan) reads as 6.6 reads it there, own values or not. Only once
 * a pair is settled are north and the zone asked for; the pair is then kept on what's missing (noNorth, noZone).
 */
function baseOf(records: Records, sunId: string): Base | null {
  const sun = liveSun(records, sunId);
  if (!sun) return null;
  const setupId = sunSetupId(records, sun.record);
  if (setupId === null) return { missing: { missing: 'noFrames', place: null, date: null } };
  const rule = setupSunBase(records, setupId);
  if ('source' in rule) {
    const { source } = rule;
    return {
      drawn: {
        place: { source: 'location', location: source.location, ...source.place },
        date: { source: 'shootDay', date: source.day.fields.date, day: source.day },
        north: source.north,
        frame: source.frame,
        otherDays: source.otherDays,
        otherPlaces: source.otherPlaces,
      },
    };
  }
  const own = ownSunOf(sun.record.props);
  // No own values: exactly what 6.6 said. Nor when one frame gives both and only north is lacking: that's case (a).
  if ((!own.place && !own.date) || rule.missing === 'noNorth') return { missing: { ...rule, place: null, date: null } };
  const setup = setupSources(records, setupId);
  const ownPlace: SunPlace | null = own.place ? { source: 'own', ...own.place } : null;
  const ownDate: SunDate | null = own.date ? { source: 'own', date: own.date } : null;
  let pair: { place: SunPlace; date: SunDate } | null = null;
  if (setup.date && ownPlace) pair = { place: ownPlace, date: { source: 'shootDay', ...setup.date } };
  else if (setup.place && ownDate) pair = { place: { source: 'location', ...setup.place }, date: ownDate };
  else if (!setup.date && !setup.place && ownPlace && ownDate) pair = { place: ownPlace, date: ownDate };
  if (!pair) {
    // The half nothing gives: the place when a date is to hand (the setup's day or its own), else the date.
    const lacksPlace = setup.date !== null || (ownDate !== null && !setup.place);
    const why = lacksPlace ? setup.placeMissing : setup.dateMissing;
    return { missing: { ...why, ownField: lacksPlace ? 'place' : 'date', place: null, date: null } };
  }
  const north = sceneNorth(records, records[setupId]?.parentId ?? '');
  if (north === null) return { missing: { missing: 'noNorth', ...pair } };
  return { drawn: { ...pair, north, frame: null, otherDays: [], otherPlaces: [] } };
}

/** The point a sun path's zone is looked up at: its location's place (one with no zone of its own), or its own coordinates; else null. */
export function sunZonePointOf(records: Records, sunId: string): SunZonePoint | null {
  const base = baseOf(records, sunId);
  if (!base || !('drawn' in base)) return null;
  const { place } = base.drawn;
  if (place.source === 'own') return { id: sunId, latitude: place.latitude, longitude: place.longitude, own: true };
  if (zoneOfLocation(place.location) !== null) return null;
  return { id: place.location.id, latitude: place.latitude, longitude: place.longitude, own: false };
}

/** A location's own zone, typed on it, or null (planSun.ts reads it the same way). */
const zoneOfLocation = (location: SbdRecord): string | null => {
  const zone = locationFields(location.props).time_zone;
  return zone === '' ? null : zone;
};

const paths = new Map<string, SunPath | null>();

/** A day's path, kept by what it is worked out from: the same place, date and zone are worked out once. */
function pathFor(date: string, latitude: number, longitude: number, zone: string): SunPath | null {
  const key = `${date}|${String(latitude)}|${String(longitude)}|${zone}`;
  if (!paths.has(key)) {
    // A small cache: a plan shows few places and dates.
    if (paths.size > 64) paths.clear();
    paths.set(key, sunPath(date, latitude, longitude, zone));
  }
  return paths.get(key) ?? null;
}

/** "HH:mm" of solar noon on the date at the place, in the zone; null when it can't be worked out. */
function noonClock(date: string, latitude: number, longitude: number, zone: string): string | null {
  const noon = solarNoon(date, latitude, longitude, zone);
  const clock = noon ? zoneClock(new Date(Math.round(noon.getTime() / 60_000) * 60_000), zone) : null;
  return clock ? `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}` : null;
}

/**
 * A sun path's whole reading (6.5.5): `zones` holds the zones looked up, by the point's id (sunZonePointOf): a zone, null
 * for none, no entry while the answer is on its way. Null for an id that isn't a live sun path.
 */
export function sunReadingOf(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>): SunReadingOf | null {
  const base = baseOf(records, sunId);
  if (!base) return null;
  if ('missing' in base) return base.missing;
  const { place, date } = base.drawn;
  let zone: SunZone | null;
  let pendingId: string;
  if (place.source === 'location') {
    zone = locationZone(place.location, zones);
    pendingId = place.location.id;
  } else {
    const looked = zones.get(sunId) ?? null;
    zone = looked !== null && isTimeZone(looked) ? { zone: looked, source: 'map' } : null;
    pendingId = sunId;
  }
  if (!zone) {
    const pending = (place.source === 'own' || zoneOfLocation(place.location) === null) && !zones.has(pendingId);
    return { missing: 'noZone', ...(place.source === 'location' ? { locationId: place.location.id } : {}), ...(pending ? { pending: true as const } : {}), place, date };
  }
  const time = liveSun(records, sunId)?.fields.time ?? '12:00';
  const path = pathFor(date.date, place.latitude, place.longitude, zone.zone);
  const at = sunAt(date.date, time, place.latitude, place.longitude, zone.zone);
  const noonAt = noonClock(date.date, place.latitude, place.longitude, zone.zone);
  const noon = noonAt === null ? null : sunAt(date.date, noonAt, place.latitude, place.longitude, zone.zone);
  return { ...base.drawn, zone, path, at, noon };
}

// The edits.

/** A sun path's own place set (both coordinates, every place kept) or taken off (null), one op; nothing when it reads so already. */
export function ownPlaceChanges(records: Records, sunId: string, place: Coordinates | null): Change[] {
  const sun = liveSun(records, sunId);
  if (!sun) return [];
  const props = sun.record.props;
  if (place === null) {
    const unset = ['own_latitude', 'own_longitude'].filter((prop) => prop in props);
    return unset.length === 0 ? [] : [{ kind: 'update', id: sunId, unset }];
  }
  if (!(Math.abs(place.latitude) <= 90) || !(Math.abs(place.longitude) <= 180)) return [];
  if (props.own_latitude === place.latitude && props.own_longitude === place.longitude) return [];
  return [{ kind: 'update', id: sunId, set: { own_latitude: place.latitude, own_longitude: place.longitude } }];
}

/** A sun path's own date set (YYYY-MM-DD) or taken off (null), one op; nothing when it reads so already or isn't a date. */
export function ownDateChanges(records: Records, sunId: string, date: string | null): Change[] {
  const sun = liveSun(records, sunId);
  if (!sun) return [];
  if (date === null) return 'own_date' in sun.record.props ? [{ kind: 'update', id: sunId, unset: ['own_date'] }] : [];
  if (!isDayDate(date) || sun.record.props.own_date === date) return [];
  return [{ kind: 'update', id: sunId, set: { own_date: date } }];
}

/** A sun path's own place as its field shows it: "40.8677, -73.9212", or '' for none. */
export const ownPlaceText = (props: Props): string => {
  const place = ownSunOf(props).place;
  return place ? formatCoordinates(place) : '';
};

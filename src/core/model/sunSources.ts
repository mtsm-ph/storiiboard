import type { Change } from '../ops/ops';
import { formatCoordinates, type Coordinates } from './coordinates';
import { frameLocationId, locationFields, mapPlace } from './location';
import { cameraSetupFrames } from './planCamera';
import { liveSun, locationZone, sceneNorth, setupSunBase, sunSetupId, type SunMissing, type SunZone } from './planSun';
import type { JsonValue, Props, SbdRecord } from './record';
import { unchangedToken } from './recordIndex';
import { lightReferenceOf, photoTakenOf, takenClock, takenDate, type LightReference } from './scoutPhoto';
import { frameDayId, isDayDate, projectShootDays, type ShootDay } from './shootDay';
import { isSunUp, solarNoon, sunAt, sunPath, sunPosition, type SunAt, type SunPath } from './sunPath';
import { isTimeZone, wallInstant, zoneClock } from './sunTimes';

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
//
// The light reference (6.27, Kevin Nov 16 and 17), by the person's explicit choice: a sun path with "Show the sun at
// the photo's time" on (`at_photo: true`), in a setup whose frames give a location (the location half of the rule
// above: the location drawn from, else the setup's first placed location, else its first location) that has a light
// reference photo with a time (scoutPhoto.ts), is drawn wholly from the photo, with or without a shoot day (one rule):
// - the date and time are the photo's, and `photoAt` says where the sun stood then;
// - the place is the photo's own GPS when it has one (source `photo`), else its location's (source `location`): the
//   photo is filed under that location, so no half comes from another frame, nor from the sun path's own values;
// - the zone is the location's typed `time_zone` when the place is the location's (else the one looked up from it, as
//   before), and for the photo's GPS the one looked up from that point, keyed by the photo's id. A photo with its own
//   offset is that instant, said in the zone; without one, the camera's clock is read as wall time there.
// With the switch off, no reference photo, one in the Trash, with no time that reads, or with no place (neither its
// GPS nor its location's), the reading is exactly what it was before 6.27.

type Records = Readonly<Record<string, SbdRecord>>;

/**
 * Where a sun path's place comes from: the frames' location, its own coordinates, or (6.27 round 3, with the sun shown at
 * the light reference photo's time) the photo's own GPS, `location` being the location the photo is filed under.
 */
export type SunPlace =
  | (Coordinates & { source: 'location'; location: SbdRecord })
  | (Coordinates & { source: 'own' })
  | (Coordinates & { source: 'photo'; photo: SbdRecord; location: SbdRecord });

/**
 * Where a sun path's date (YYYY-MM-DD) comes from: the frames' shoot day, its own, or the location's light reference
 * photo (6.27): then `time` is the photo's time of day ("HH:mm"), both in the zone the sun is drawn in (a photo that
 * carries its own offset is that instant, read in the location's zone; until the zone is known, as its camera wrote it).
 */
export type SunDate = { source: 'shootDay'; date: string; day: ShootDay } | { source: 'own'; date: string } | { source: 'photo'; date: string; time: string; photo: SbdRecord };

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
 * - `photoAt` (6.27): only when the date's source is `photo`: the sun at the instant the light reference photo was
 *   taken (its `time` in the zone drawn), or null when that can't be worked out. Absent for every other source.
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
      photoAt?: SunAt | null;
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
  /** The first of its frames' locations in the same order, placed or not (6.27 round 3: whose light reference counts). */
  location: SbdRecord | null;
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
    location: located[0]?.location ?? null,
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
 * Every record a sun path's reading can read (6.26): the project, its scenes, setups, frames, shoot days, locations and
 * plans, a location's light reference photo (6.27: a `media` record, so every media record; one changes when a picture
 * is added or removed, never while a plan is being drawn), and of the plans' items only the sun paths and the rooms'
 * norths. A reading is kept while these are the same
 * records (recordIndex.ts, unchangedToken), so an edit to anything else on the plan (a light turned, a wall moved, a
 * mark placed) works no sun out again. A reader added here that reads another type adds it to this list;
 * sunRecords.test.ts changes every record of every type and fails when a kept reading differs from one worked out anew.
 */
const SUN_TYPES: readonly SbdRecord['type'][] = ['project', 'scene', 'setup', 'shot', 'shoot_day', 'location', 'plan', 'media'];
const SUN_ITEMS = { type: 'plan_item' as const, counts: (record: SbdRecord) => record.props.kind === 'sun' || record.props.kind === 'north' };

/** The same object while no record a sun path's reading reads has changed: what its readings and the compass are kept by. */
export const sunRecordsToken = (records: Records): object => unchangedToken(records, 'sunSources', SUN_TYPES, SUN_ITEMS);

const bases = new WeakMap<object, Map<string, Base | null>>();
const kept = new WeakMap<object, Map<string, SunReadingOf>>();
let made = 0;

/** How many sun readings have been worked out (sunReadingOf): for tests, which check an edit a sun path doesn't read works none out. */
export const sunReadingsOfMade = (): number => made;

function keptBy<T>(memo: WeakMap<object, Map<string, T>>, token: object): Map<string, T> {
  let known = memo.get(token);
  if (!known) {
    known = new Map();
    memo.set(token, known);
  }
  return known;
}

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
  const known = keptBy(bases, sunRecordsToken(records));
  if (known.has(sunId)) return known.get(sunId) ?? null;
  const base = baseWorkedOut(records, sunId);
  known.set(sunId, base);
  return base;
}

/** A sun path's "Show the sun at the photo's time" (6.27): only a stored `true` is on. */
export const sunAtPhoto = (props: Props): boolean => props.at_photo === true;

/**
 * A sun path's light reference (6.27 round 3), whether or not its switch is on: the location its setup's frames give
 * (the location drawn from, else the setup's first placed location, else its first location), that location's light
 * reference, and the place the sun would be drawn at for it (the photo's GPS, else the location's place; null for
 * neither). Null when the setup gives no location or the location has no light reference.
 */
export interface SunLight {
  location: SbdRecord;
  reference: Exclude<LightReference, { kind: 'none' }>;
  place: SunPlace | null;
}

function lightOf(records: Records, sunId: string, base: Base | null): SunLight | null {
  const sun = liveSun(records, sunId);
  const setupId = sun ? sunSetupId(records, sun.record) : null;
  if (!base || setupId === null) return null;
  const drawn = 'drawn' in base ? base.drawn.place : null;
  const setup = setupSources(records, setupId);
  const location = drawn?.source === 'location' ? drawn.location : (setup.place?.location ?? setup.location);
  if (!location) return null;
  const reference = lightReferenceOf(records, location);
  if (reference.kind === 'none') return null;
  const gps = photoTakenOf(reference.photo.props).place;
  const mapped = mapPlace(location.props);
  const place: SunPlace | null = gps
    ? { source: 'photo', ...gps, photo: reference.photo, location }
    : mapped
      ? { source: 'location', location, latitude: mapped.latitude, longitude: mapped.longitude }
      : null;
  return { location, reference, place };
}

const lights = new WeakMap<object, Map<string, SunLight | null>>();

/** A sun path's light reference (SunLight), kept as its reading is: what its settings say beside the switch. */
export function sunLightOf(records: Records, sunId: string): SunLight | null {
  const known = keptBy(lights, sunRecordsToken(records));
  if (known.has(sunId)) return known.get(sunId) ?? null;
  const light = lightOf(records, sunId, baseBeforePhoto(records, sunId));
  known.set(sunId, light);
  return light;
}

/** The point a light reference's place has its zone looked up at: the photo's GPS (by the photo's id), or its location's place when it has no zone typed. */
export function sunLightZonePoint(light: SunLight | null): SunZonePoint | null {
  const place = light?.place;
  if (!place) return null;
  if (place.source === 'photo' && !atLocationPin(place)) return { id: place.photo.id, latitude: place.latitude, longitude: place.longitude, own: true };
  if (place.source === 'own' || zoneOfLocation(place.location) !== null) return null;
  return { id: place.location.id, latitude: place.latitude, longitude: place.longitude, own: false };
}

/** The zone a light reference's place is in, when it is known (typed on the location, or looked up); else null. */
export function sunLightZone(light: SunLight | null, zones: ReadonlyMap<string, string | null>): string | null {
  const place = light?.place;
  if (!place || place.source === 'own') return null;
  if (place.source === 'location' || atLocationPin(place)) return locationZone(place.location, zones)?.zone ?? null;
  const looked = zones.get(place.photo.id) ?? null;
  return looked !== null && isTimeZone(looked) ? looked : null;
}

/**
 * The base, drawn wholly from the light reference photo where the person chose it (6.27 round 3): its date and time,
 * its GPS or its location's place, the room's north; the setup's frame and other days and places still said when the
 * setup's rule drew. Anything that keeps the photo from being drawn for leaves the base exactly as it was.
 */
function baseWorkedOut(records: Records, sunId: string): Base | null {
  const base = baseBeforePhoto(records, sunId);
  const sun = liveSun(records, sunId);
  if (!base || !sun || !sunAtPhoto(sun.record.props)) return base;
  const light = lightOf(records, sunId, base);
  if (!light?.place || light.reference.kind !== 'ready') return base;
  const { reference } = light;
  const date: SunDate = { source: 'photo', date: takenDate(reference.takenAt), time: takenClock(reference.takenAt), photo: reference.photo };
  const setupId = sunSetupId(records, sun.record);
  const north = setupId === null ? null : sceneNorth(records, records[setupId]?.parentId ?? '');
  // As the setup's rule says a missing north: nothing claimed as drawn.
  if (north === null) return { missing: { missing: 'noNorth', place: null, date: null } };
  const kept = 'drawn' in base ? base.drawn : null;
  // No other days or places said (round 4): the date drawn is the photo's, so "also shoots on…" would be about days
  // that aren't drawn.
  return { drawn: { place: light.place, date, north, frame: kept?.frame ?? null, otherDays: [], otherPlaces: [] } };
}

/** sunLightOf worked out anew, nothing kept: for the test that guards SUN_TYPES (sunRecords.test.ts). */
export const sunLightFresh = (records: Records, sunId: string): SunLight | null => lightOf(records, sunId, baseBeforePhoto(records, sunId));

/**
 * Whether a photo's GPS is its location's own pin (round 4): then the place is still said as the photo's, but its zone
 * is the location's (typed, else looked up at the pin), so a typed zone always wins at the location's own place.
 */
function atLocationPin(place: SunPlace): boolean {
  if (place.source !== 'photo') return false;
  const pin = mapPlace(place.location.props);
  return pin !== null && pin.latitude === place.latitude && pin.longitude === place.longitude;
}

function baseBeforePhoto(records: Records, sunId: string): Base | null {
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
  return zonePointFrom(baseOf(records, sunId), sunId);
}

/** sunZonePointOf worked out anew, nothing kept (6.26 round 2): for the test that guards SUN_TYPES, as sunReadingFresh. */
export const sunZonePointFresh = (records: Records, sunId: string): SunZonePoint | null => zonePointFrom(baseWorkedOut(records, sunId), sunId);

function zonePointFrom(base: Base | null, sunId: string): SunZonePoint | null {
  if (!base || !('drawn' in base)) return null;
  const { place } = base.drawn;
  if (place.source === 'own') return { id: sunId, latitude: place.latitude, longitude: place.longitude, own: true };
  // The photo's GPS is a point of its own, with no location to type a zone on (6.27 round 3), unless it is the
  // location's own pin (round 4).
  if (place.source === 'photo' && !atLocationPin(place)) return { id: place.photo.id, latitude: place.latitude, longitude: place.longitude, own: true };
  if (zoneOfLocation(place.location) !== null) return null;
  return { id: place.location.id, latitude: place.latitude, longitude: place.longitude, own: false };
}

/** The id a place's looked-up zone is kept by: its location's, the photo's (its GPS), or the sun path's own. */
const zoneKeyOf = (place: SunPlace, sunId: string): string =>
  place.source === 'own' ? sunId : place.source === 'location' || atLocationPin(place) ? place.location.id : place.photo.id;

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
  // Kept by the records it reads and the one zone answer it reads (6.26): the same reading, the same object, until one
  // of them changes.
  const asked = zoneKeyOf(base.drawn.place, sunId);
  const known = keptBy(kept, sunRecordsToken(records));
  const key = `${sunId}|${zones.has(asked) ? `=${String(zones.get(asked))}` : '?'}`;
  const found = known.get(key);
  if (found) return found;
  const reading = readingWorkedOut(records, sunId, zones, base.drawn);
  known.set(key, reading);
  return reading;
}

/**
 * A sun path's reading worked out anew, nothing kept and nothing read from what is kept (6.26 round 2): what the kept
 * reading must always equal. For the test that guards SUN_TYPES (sunRecords.test.ts): a reader of a record type the list
 * doesn't name gives a kept reading that differs from this one.
 */
export function sunReadingFresh(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>): SunReadingOf | null {
  const base = baseWorkedOut(records, sunId);
  if (!base) return null;
  return 'missing' in base ? base.missing : readingWorkedOut(records, sunId, zones, base.drawn);
}

function readingWorkedOut(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>, drawn: Drawn): SunReadingOf {
  made += 1;
  const { place, date } = drawn;
  let zone: SunZone | null;
  const pendingId = zoneKeyOf(place, sunId);
  // The location's zone at its own place, and at its pin when that is where the photo was taken (round 4).
  const byLocation = place.source === 'location' || atLocationPin(place);
  if (place.source !== 'own' && byLocation) zone = locationZone(place.location, zones);
  else {
    const looked = zones.get(pendingId) ?? null;
    zone = looked !== null && isTimeZone(looked) ? { zone: looked, source: 'map' } : null;
  }
  if (!zone) {
    const pending = (place.source === 'own' || !byLocation || zoneOfLocation(place.location) === null) && !zones.has(pendingId);
    // A photo at its location's own pin takes the location's zone, so "Open Locations" opens it too (round 5): typing
    // the zone there is the fix.
    return { missing: 'noZone', ...(byLocation && place.source !== 'own' ? { locationId: place.location.id } : {}), ...(pending ? { pending: true as const } : {}), place, date };
  }
  const time = liveSun(records, sunId)?.fields.time ?? '12:00';
  // The light reference photo (6.27): the instant it was taken, read in the zone drawn, gives the date and the sun then.
  const photo = date.source === 'photo' ? photoMoment(date, place, zone.zone) : null;
  const day = photo ? photo.date : date;
  const path = pathFor(day.date, place.latitude, place.longitude, zone.zone);
  const at = sunAt(day.date, time, place.latitude, place.longitude, zone.zone);
  const noonAt = noonClock(day.date, place.latitude, place.longitude, zone.zone);
  const noon = noonAt === null ? null : sunAt(day.date, noonAt, place.latitude, place.longitude, zone.zone);
  return { ...drawn, date: day, zone, path, at, noon, ...(date.source === 'photo' ? { photoAt: photo?.at ?? null } : {}) };
}

/**
 * When a light reference photo was taken, in the zone the sun is drawn in (6.27): the instant is the photo's own when it
 * carries its offset (a phone's), else its camera's clock read as the location's wall clock; its date and time of day
 * are that instant's in the zone, the minute as the clock showed it (never rounded up); and the sun then. Null when the
 * instant can't be worked out (the date is then left as the camera wrote it, with no sun for it).
 */
function photoMoment(date: Extract<SunDate, { source: 'photo' }>, place: Coordinates, zone: string): { date: Extract<SunDate, { source: 'photo' }>; at: SunAt } | null {
  const taken = photoTakenOf(date.photo.props);
  const when = taken.takenAt === null ? null : photoWhen(taken.takenAt, taken.offset, zone);
  if (!when?.instant || !(Math.abs(place.latitude) <= 90) || !(Math.abs(place.longitude) <= 180)) return null;
  const position = sunPosition(when.instant, place.latitude, place.longitude);
  return { date: { ...date, date: when.date, time: when.time }, at: { ...position, time: when.time, instant: when.instant, up: isSunUp(position.altitude) } };
}

/**
 * A photo's date and time of day as they are said beside a sun path (6.27): in the zone the sun is drawn in when it is
 * known (the photo's own instant when it carries an offset, else its camera's clock, which is then the same), and as
 * its camera wrote them while no zone is known, or when the instant can't be worked out (`instant` null). One function,
 * so the "Light reference" line and the date's source always say the same time.
 */
export function photoWhen(takenAt: string, offset: string | null, zone: string | null): { date: string; time: string; instant: Date | null } {
  const written = { date: takenDate(takenAt), time: takenClock(takenAt), instant: null };
  if (zone === null) return written;
  let instant: Date | null;
  if (offset !== null) instant = new Date(`${takenAt}${offset}`);
  else {
    const [hour = 0, minute = 0, second = 0] = takenAt.slice(11).split(':').map(Number);
    const wall = wallInstant(takenDate(takenAt), hour, minute, zone);
    instant = wall ? new Date(wall.getTime() + second * 1000) : null;
  }
  const clock = instant ? zoneClock(instant, zone) : null;
  if (!instant || !clock) return written;
  return { date: clock.date, time: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`, instant };
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

/**
 * "Show the sun at the photo's time" (6.27) turned on or off, one op: `at_photo` is stored only as `true` (off takes it
 * off the record); nothing when it reads so already.
 */
export function atPhotoChanges(records: Records, sunId: string, on: boolean): Change[] {
  const sun = liveSun(records, sunId);
  if (!sun) return [];
  if (on) return sun.record.props.at_photo === true ? [] : [{ kind: 'update', id: sunId, set: { at_photo: true } }];
  return 'at_photo' in sun.record.props ? [{ kind: 'update', id: sunId, unset: ['at_photo'] }] : [];
}

/** A sun path's own place as its field shows it: "40.8677, -73.9212", or '' for none. */
export const ownPlaceText = (props: Props): string => {
  const place = ownSunOf(props).place;
  return place ? formatCoordinates(place) : '';
};

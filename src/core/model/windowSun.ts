import { wallAxes } from './openings';
import { isOpening, isSun, isWallFields, normalDegrees, shownItems, wallEnds, type OpeningFields, type PlanItemFields, type Point } from './plan';
import { openingHeights, type OpeningHeights } from './planHeights';
import { sceneNorth, type SunMissing } from './planSun';
import type { SbdRecord } from './record';
import { isSunUp, sunPosition } from './sunPath';
import { sunReadingOf, sunZonePointOf, type SunDate, type SunPlace, type SunZonePoint } from './sunSources';
import { wallInstant, zoneClock } from './sunTimes';

// Sun through the windows (6.5.6, Kevin Nov 16): for each window in an outside wall, the hours direct sun can come
// through it on the plan's date, from the way it faces and the sun's path. Pure, worked out from the records and never
// stored (a rollup), kept per records object and view; nothing outside the room is known (buildings, trees), and the
// words always say so.
//
// Which side is outside: from the window's middle, a ray along each of its wall's two normals, counting the walls shown
// with it that the ray crosses (windowWall says the rule). Each wall is taken whole, its own doors and windows not cut
// out of it: a door across the room from a window would otherwise read as a way out. The facing is a compass bearing
// through the room's north.
//
// The hours: the day in the place's zone, minute by minute (SunCalc, as sunPath.ts reads it), where the sun is up
// (sunAt's `up`) and within 90° of the window's outward direction, in front of the glass. Each stretch's ends are rounded
// to 5 minutes; a stretch that runs to midnight ends "24:00". At high latitudes, in summer, a window can have two (one
// facing north: the early hours and the evening); a day with none has none. A window's sill and top, when set, add the
// sun's height range in each stretch, for the 3D set: they never change the hours (with no overhang, any sun in front of
// the glass comes through).
//
// What `get_plan` (the MCP) and Phase 10's 3D set will read for each window: `WindowSunOf`, below.

type Records = Readonly<Record<string, SbdRecord>>;

/** The eight points of the compass a window faces, by name. */
export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPointName = (typeof COMPASS_POINTS)[number];

/** A bearing's nearest of the eight points (N for 337.5° up to 22.5°). */
export const compassPointOf = (bearing: number): CompassPointName => COMPASS_POINTS[Math.round(normalDegrees(bearing) / 45) % 8] ?? 'N';

/** A window's wall, seen from the window: outside (and which way out, on the plan), inside, or not closed. */
export type WindowWall =
  | {
      kind: 'outside';
      /** The way out of the room, a unit vector on the plan (y down). */
      outward: Point;
      /** That way in degrees clockwise from up the plan, 0 up to 360. */
      planAngle: number;
    }
  | { kind: 'inside' }
  | { kind: 'unclosed' }
  | { kind: 'unknown' };

/** Degrees clockwise from up the plan of a direction on it (y down). */
const planAngleOf = (d: Point): number => normalDegrees((Math.atan2(d.x, -d.y) * 180) / Math.PI);

/** How far a wall's middle line reaches past its stored ends, metres: the 1 mm within which two walls' ends join (planSightlines.ts END_REACH_M). */
const JOIN_M = 0.001;
/** Crossings this close along a ray are one: the ray through a corner where two walls meet crosses the room once. */
const SAME_CROSSING_M = 0.005;

/** How many walls a ray from `p` along the unit `d` crosses (each wall's middle line, its ends a joint's width longer). */
function crossings(walls: readonly PlanItemFields[], p: Point, d: Point): number {
  const at: number[] = [];
  for (const wall of walls) {
    const [a0, b0] = wallEnds(wall);
    const len = wall.width;
    const ux = (b0.x - a0.x) / len;
    const uy = (b0.y - a0.y) / len;
    const a = { x: a0.x - ux * JOIN_M, y: a0.y - uy * JOIN_M };
    const ex = ux * (len + 2 * JOIN_M);
    const ey = uy * (len + 2 * JOIN_M);
    const den = d.x * ey - d.y * ex;
    // A wall along the ray is never crossed by it.
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) at.push(t);
  }
  at.sort((x, y) => x - y);
  return at.filter((t, i) => i === 0 || t - (at[i - 1] ?? 0) > SAME_CROSSING_M).length;
}

/**
 * Which side of a window is outside (6.5.6 round 2): from its middle (`along` its wall), a ray each way along the wall's
 * normal, counting every other wall it crosses (all of them, not only the first; two walls meeting at a corner the ray
 * passes through count once). A side crossing none is open: one open side is outside; both open, the room isn't closed
 * (`unclosed`). Both crossing walls, by parity: a ray leaving a closed room crosses an odd number of its walls, and from
 * just outside an even number, so exactly one even side is the outside (a U-shaped room's notch, a courtyard, a recessed
 * entrance); both odd is an inside wall (a partition); both even can't be told (`unknown`). A free-standing wall inside
 * the room adds a crossing to the rays that pass it: with the outside side clear, as it is for a window in an outer wall
 * the free wall faces, the answer stands; only where both sides cross walls can it flip the count, a case a person sees
 * at once on the plan. A ray grazing a corner without passing through it counts it once too, the same rare case.
 * Null when the wall isn't among `walls`.
 */
export function windowWall(walls: readonly { id: string; fields: PlanItemFields }[], wallId: string, along: number): WindowWall | null {
  const own = walls.find((w) => w.id === wallId);
  if (!own) return null;
  const [start] = wallEnds(own.fields);
  const { dir, normal } = wallAxes(own.fields);
  const middle = { x: start.x + dir.x * along, y: start.y + dir.y * along };
  const others = walls.filter((w) => w.id !== wallId).map((w) => w.fields);
  const back = { x: -normal.x, y: -normal.y };
  const [ahead, behind] = [normal, back].map((d) => crossings(others, middle, d)) as [number, number];
  let outsideAhead: boolean;
  if (ahead === 0 && behind === 0) return { kind: 'unclosed' };
  if (ahead === 0 || behind === 0) outsideAhead = ahead === 0;
  else if (ahead % 2 !== behind % 2) outsideAhead = ahead % 2 === 0;
  else return { kind: ahead % 2 === 1 ? 'inside' : 'unknown' };
  const way = outsideAhead ? normal : back;
  // To a billionth, as planVector gives a direction: a wall drawn right to left has no float noise in its normal.
  const tidy = (v: number) => {
    const r = Math.round(v * 1e9) / 1e9;
    return r === 0 ? 0 : r;
  };
  const outward = { x: tidy(way.x), y: tidy(way.y) };
  return { kind: 'outside', outward, planAngle: planAngleOf(way) };
}

/** A stretch of direct sun through a window. */
export interface DirectSun {
  /** "HH:mm" in the place's zone, rounded to 5 minutes; `to` is "24:00" for one that runs to the day's end. */
  from: string;
  to: string;
  /** The rounded instants. */
  start: Date;
  end: Date;
  /** The sun's true height in it, lowest and highest, degrees: only when the window's sill or top is set (for 3D). */
  altitude?: { min: number; max: number };
}

const MINUTE = 60_000;
const ROUND = 5 * MINUTE;

interface Sample {
  bearing: number;
  altitude: number;
  up: boolean;
}

interface DaySamples {
  start: number;
  end: number;
  samples: Sample[];
}

const days = new Map<string, DaySamples | null>();

/** The day after a YYYY-MM-DD date, or null for one that isn't a date. */
const nextDate = (date: string): string | null => {
  const noon = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  return Number.isNaN(noon) ? null : new Date(noon + 86_400_000).toISOString().slice(0, 10);
};

/** The sun every minute of the place's day (its zone's midnight to midnight), worked out once per place, date and zone. */
function daySamples(date: string, latitude: number, longitude: number, zone: string): DaySamples | null {
  const key = `${date}|${String(latitude)}|${String(longitude)}|${zone}`;
  if (!days.has(key)) {
    // A small cache: a plan shows one place and date at a time.
    if (days.size > 16) days.clear();
    const after = nextDate(date);
    const from = after === null ? null : wallInstant(date, 0, 0, zone);
    const to = after === null ? null : wallInstant(after, 0, 0, zone);
    if (!from || !to || to <= from || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) days.set(key, null);
    else {
      const samples: Sample[] = [];
      for (let at = from.getTime(); at < to.getTime(); at += MINUTE) {
        const p = sunPosition(new Date(at), latitude, longitude);
        samples.push({ bearing: p.bearing, altitude: p.altitude, up: isSunUp(p.altitude) });
      }
      days.set(key, { start: from.getTime(), end: to.getTime(), samples });
    }
  }
  return days.get(key) ?? null;
}

/** How far apart two bearings are, degrees, 0 to 180. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(normalDegrees(a) - normalDegrees(b));
  return d > 180 ? 360 - d : d;
};

/**
 * The stretches of a day (YYYY-MM-DD, at a place, in its zone) when the sun is up and in front of glass facing `facing`
 * (a compass bearing): within 90° of it. Null for a date, place or zone that can't be read; none on a day with none.
 */
export function directSun(date: string, latitude: number, longitude: number, zone: string, facing: number, withAltitude = false): DirectSun[] | null {
  const day = daySamples(date, latitude, longitude, zone);
  if (!day) return null;
  const lit = (s: Sample) => s.up && apart(s.bearing, facing) < 90;
  const clock = (ms: number): string => {
    if (ms >= day.end) return '24:00';
    const read = zoneClock(new Date(ms), zone);
    return read ? `${String(read.hour).padStart(2, '0')}:${String(read.minute).padStart(2, '0')}` : '';
  };
  const out: DirectSun[] = [];
  const n = day.samples.length;
  for (let i = 0; i < n; ) {
    if (!lit(day.samples[i] as Sample)) {
      i += 1;
      continue;
    }
    let j = i;
    let min = Infinity;
    let max = -Infinity;
    while (j < n && lit(day.samples[j] as Sample)) {
      const altitude = (day.samples[j] as Sample).altitude;
      min = Math.min(min, altitude);
      max = Math.max(max, altitude);
      j += 1;
    }
    const start = Math.max(day.start, Math.round((day.start + i * MINUTE) / ROUND) * ROUND);
    const end = j >= n ? day.end : Math.min(day.end, Math.round((day.start + j * MINUTE) / ROUND) * ROUND);
    if (end > start) {
      const tidy = (d: number) => Math.round(d * 10) / 10;
      out.push({ from: clock(start), to: clock(end), start: new Date(start), end: new Date(end), ...(withAltitude ? { altitude: { min: tidy(min), max: tidy(max) } } : {}) });
    }
    i = j;
  }
  return out;
}

/**
 * What keeps a window's hours off, the first of them: its wall (inside, not closed, or which side can't be told), the
 * room's north, no setup picked, no sun path in the setup, or what the sun path lacks.
 */
export type WindowSunMissing = 'insideWall' | 'unclosed' | 'unknownSide' | 'noNorth' | 'noSetup' | 'noSunPath' | SunMissing;

/** Why directSun read nothing for a day: the date, the zone or the place it can't read (in that order), as the sun path says them. */
export function unreadable(date: string, latitude: number, longitude: number, zone: string): 'noDate' | 'noZone' | 'noPlace' {
  if (nextDate(date) === null || wallInstant(date, 0, 0, 'UTC') === null) return 'noDate';
  if (wallInstant(date, 0, 0, zone) === null) return 'noZone';
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? 'noDate' : 'noPlace';
}

/**
 * A window's sun (6.5.6): what `get_plan` will return for each window, and what Phase 10's 3D set reads.
 * - `wall`: `outside`, `inside`, `unclosed` (both its sides open: a wall standing alone, a room not closed yet) or
 *   `unknown` (both sides cross an even number of walls: which is outside can't be told).
 * - `outward`: the way out on the plan (a unit vector, y down, and degrees clockwise from up), for an outside wall.
 * - `facing`: that way as a compass bearing through the room's north, and its point (N, NE…); null without north.
 * - `heights`: its sill and top (and `height_m`), metres, as stored (planHeights.ts).
 * - `missing`: what keeps the hours off, or null when they are worked out; `pending` while the zone is being found.
 * - `place`, `date`, `zone`: what the hours are for, from the view's sun path's reading (sunSources.ts, 6.5.5).
 * - `hours`: the stretches of direct sun that day, local times rounded to 5 minutes; [] for none; null while missing.
 */
export interface WindowSunOf {
  windowId: string;
  wallId: string;
  wall: 'outside' | 'inside' | 'unclosed' | 'unknown';
  outward: (Point & { planAngle: number }) | null;
  facing: { bearing: number; point: CompassPointName } | null;
  heights: OpeningHeights;
  missing: WindowSunMissing | null;
  pending: boolean;
  place: SunPlace | null;
  date: SunDate | null;
  zone: string | null;
  hours: DirectSun[] | null;
}

interface View {
  sceneId: string;
  setupId: string | null;
}

/** The sun path a view's hours come from: the setup's first, in plan order, as the compass reads it; null for none. */
export function viewSunId(records: Records, view: View): string | null {
  if (view.setupId === null) return null;
  return shownItems(records, view.sceneId, view.setupId).find((item) => isSun(item.fields) && item.level === 'setup')?.record.id ?? null;
}

/** The point whose zone the view's sun path needs looked up (sunZonePointOf), or null. */
export const viewSunZonePoint = (records: Records, view: View): SunZonePoint | null => {
  const sunId = viewSunId(records, view);
  return sunId === null ? null : sunZonePointOf(records, sunId);
};

const memos = new WeakMap<Records, Map<string, readonly WindowSunOf[]>>();
let made = 0;

/** How many times a view's windows have been worked out: for tests, which check it's once per records, view and zone. */
export const windowSunsMade = (): number => made;

/**
 * Every window a view shows, in plan order, with its sun. Kept per records object, view and the zone answer it reads, so
 * a render that changes none of them works nothing out again; a view's items come from shownItems (kept per records).
 */
export function windowSunsOf(records: Records, view: View, zones: ReadonlyMap<string, string | null>): readonly WindowSunOf[] {
  const sunId = viewSunId(records, view);
  const point = sunId === null ? null : sunZonePointOf(records, sunId);
  const zone = point === null ? '-' : zones.has(point.id) ? `=${String(zones.get(point.id))}` : '?';
  const key = `${view.sceneId}|${view.setupId ?? ''}|${zone}`;
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  const found = known.get(key);
  if (found) return found;
  const list = workedOut(records, view, sunId, zones);
  known.set(key, list);
  return list;
}

/** One window's sun in a view, or null when the view doesn't show it as a window. */
export const windowSunOf = (records: Records, view: View, windowId: string, zones: ReadonlyMap<string, string | null>): WindowSunOf | null =>
  windowSunsOf(records, view, zones).find((w) => w.windowId === windowId) ?? null;

function workedOut(records: Records, view: View, sunId: string | null, zones: ReadonlyMap<string, string | null>): WindowSunOf[] {
  made += 1;
  const items = shownItems(records, view.sceneId, view.setupId);
  const walls = items.flatMap((item) => (isWallFields(item.fields) ? [{ id: item.record.id, fields: item.fields }] : []));
  const windows = items.flatMap((item): { record: SbdRecord; fields: OpeningFields }[] => (isOpening(item.fields) && item.fields.kind === 'window' ? [{ record: item.record, fields: item.fields }] : []));
  if (windows.length === 0) return [];
  const north = sceneNorth(records, view.sceneId);
  const reading = sunId === null ? null : sunReadingOf(records, sunId, zones);
  return windows.flatMap(({ record, fields }): WindowSunOf[] => {
    const side = windowWall(walls, fields.wallId, fields.along);
    const heights = openingHeights(record.props);
    if (!side || !heights) return [];
    const base = { windowId: record.id, wallId: fields.wallId, heights, place: null, date: null, zone: null, hours: null, pending: false };
    if (side.kind !== 'outside') return [{ ...base, wall: side.kind, outward: null, facing: null, missing: side.kind === 'inside' ? 'insideWall' : side.kind === 'unknown' ? 'unknownSide' : 'unclosed' }];
    const outward = { ...side.outward, planAngle: side.planAngle };
    if (north === null) return [{ ...base, wall: 'outside', outward, facing: null, missing: 'noNorth' }];
    const bearing = normalDegrees(side.planAngle - north);
    const facing = { bearing, point: compassPointOf(bearing) };
    const at = { ...base, wall: 'outside' as const, outward, facing };
    // No setup picked: a sun path goes in a setup, so that is what's said; a setup with none says it has none.
    if (!reading) return [{ ...at, missing: view.setupId === null ? 'noSetup' : 'noSunPath' }];
    if ('missing' in reading) return [{ ...at, missing: reading.pending ? null : reading.missing, pending: reading.pending === true, place: reading.place, date: reading.date }];
    const withAltitude = heights.sillM !== null || heights.topM !== null;
    const hours = directSun(reading.date.date, reading.place.latitude, reading.place.longitude, reading.zone.zone, bearing, withAltitude);
    if (!hours) {
      const why = unreadable(reading.date.date, reading.place.latitude, reading.place.longitude, reading.zone.zone);
      return [{ ...at, missing: why, place: reading.place, date: reading.date, zone: reading.zone.zone }];
    }
    return [{ ...at, missing: null, place: reading.place, date: reading.date, zone: reading.zone.zone, hours }];
  });
}

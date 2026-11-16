import { getPosition, getTimes } from 'suncalc';
import { isDayDate } from './shootDay';
import { noonIn, sunTimes, wallInstant, zoneClock, type SunDay } from './sunTimes';

// The sun over a plan (6.6, docs/PHASE6_DECISIONS.md "north and the sun"), pure: from a place's latitude and longitude,
// a date, its time zone and a time of day, where the sun is (its compass bearing and height) and its day's path from
// sunrise to sunset with the whole hours marked. Sunrise, sunset and golden hour are sunTimes.ts's, so a plan and a call
// sheet never disagree. Every instant is built from the zone (wallInstant), never from this computer's zone, so a day
// the clocks change keeps its marks on the place's whole hours. Nothing is requested.

/** How far from its middle a sun path draws its arc, metres: a constant, never a prop. */
export const SUN_RADIUS_M = 3;

/** The sun's height at sunrise and sunset as SunCalc reckons them (refraction and the sun's half width): above it, it's up. */
const HORIZON = -0.833;
/** Golden hour, as CLAUDE.md defines it for call sheets: the sun from 6° above to 4° below the horizon. */
const GOLDEN_HIGH = 6;
const GOLDEN_LOW = -4;
/** How far apart the arc's points are, minutes. */
const ARC_STEP_MINUTES = 5;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

/** SunCalc's refraction (Meeus 16.4, flat below the horizon), degrees, for a true height in degrees: what getPosition adds. */
function refractionAt(trueDegrees: number): number {
  const h = (Math.max(trueDegrees, 0) * Math.PI) / 180;
  return ((0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179))) * 180) / Math.PI;
}

/**
 * The true (geometric) height from SunCalc's apparent one, which has refraction added to the true height: solved back by
 * a few steps of h = apparent − refraction(h), which settles to well under a thousandth of a degree (the refraction's
 * slope is under 0.15 of the height's, near the horizon its steepest).
 */
export function trueAltitude(apparent: number): number {
  let h = apparent;
  for (let i = 0; i < 12; i += 1) h = apparent - refractionAt(h);
  return h;
}

export interface SunPosition {
  /** Compass bearing, degrees from north, clockwise (90 east, 180 south), 0 up to 360. */
  bearing: number;
  /** True (geometric) height above the horizon, degrees: what the US Naval Observatory publishes. */
  altitude: number;
  /** Apparent height, refraction included, degrees: what the eye sees. */
  apparent: number;
}

/**
 * Where the sun is at an instant, seen from a place. SunCalc 2 gives its azimuth already as a compass bearing in degrees
 * (north 0, clockwise: suncalc's index.d.ts), not SunCalc 1's radians from the south, so nothing is added to it.
 */
export function sunPosition(at: Date, latitude: number, longitude: number): SunPosition {
  const p = getPosition(at, latitude, longitude);
  return { bearing: ((p.azimuth % 360) + 360) % 360, altitude: trueAltitude(p.altitude), apparent: p.altitude };
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "14:30" as hours and minutes, or null. */
export function clockParts(time: string): { hour: number; minute: number } | null {
  const m = CLOCK.exec(time);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export interface SunAt extends SunPosition {
  time: string;
  instant: Date;
  /** Above the height sunrise and sunset are reckoned at. */
  up: boolean;
}

/** The sun at a time of day ("HH:mm", in `timeZone`) on a date (YYYY-MM-DD) at a place; null for one that can't be read. */
export function sunAt(date: string, time: string, latitude: number, longitude: number, timeZone: string): SunAt | null {
  const clock = clockParts(time);
  const instant = clock ? wallInstant(date, clock.hour, clock.minute, timeZone) : null;
  if (!instant || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  const position = sunPosition(instant, latitude, longitude);
  return { ...position, time, instant, up: position.altitude > HORIZON };
}

export interface SunMark extends SunPosition {
  instant: Date;
  /** "05:25", in the zone. */
  time: string;
}

export interface SunHourMark extends SunMark {
  /** The whole hour of the zone's clock, 0 to 23. */
  hour: number;
}

export interface SunArcPoint {
  bearing: number;
  altitude: number;
  /** In golden hour: 6° above to 4° below the horizon. */
  golden: boolean;
}

export interface SunPath {
  /** The day as a call sheet gives it (sunTimes.ts): sunrise, sunset, golden and blue hours. */
  day: SunDay;
  /** The sun's bearing from sunrise to sunset, every few minutes, sunrise and sunset themselves included; none on a day it never rises. */
  arc: SunArcPoint[];
  /** Every whole hour of the zone's clock while the sun is up. */
  hours: SunHourMark[];
  rise: SunMark | null;
  set: SunMark | null;
}

const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The instant of a sunTimes clock time ("05:25" on the day, the day after or the day before). */
function momentOf(date: string, time: string, next: boolean, prev: boolean, timeZone: string): Date | null {
  const clock = clockParts(time);
  return clock ? wallInstant(next ? shiftDate(date, 1) : prev ? shiftDate(date, -1) : date, clock.hour, clock.minute, timeZone) : null;
}

const golden = (altitude: number): boolean => altitude <= GOLDEN_HIGH && altitude >= GOLDEN_LOW;

/** The whole hours of the zone's clock strictly between two instants, each one that exists there (a clock change skips one). */
function wholeHours(from: Date, to: Date, date: string, timeZone: string): Date[] {
  const out = new Map<number, Date>();
  for (const day of [shiftDate(date, -1), date, shiftDate(date, 1)]) {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = wallInstant(day, hour, 0, timeZone);
      if (!at || at <= from || at >= to) continue;
      // Built from the zone: an hour the clocks skip comes back as another hour, and is left out.
      const read = zoneClock(at, timeZone);
      if (read?.date !== day || read.hour !== hour || read.minute !== 0) continue;
      out.set(at.getTime(), at);
    }
  }
  return [...out.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** "HH:mm" of an instant in the zone. */
function clockIn(at: Date, timeZone: string): string {
  const read = zoneClock(new Date(Math.round(at.getTime() / MINUTE) * MINUTE), timeZone);
  return read ? `${String(read.hour).padStart(2, '0')}:${String(read.minute).padStart(2, '0')}` : '';
}

/** The sun's day at a place (6.6): its path from sunrise to sunset and the hours on it; null for a date, zone or place that can't be read. */
export function sunPath(date: string, latitude: number, longitude: number, timeZone: string): SunPath | null {
  const day = sunTimes(date, latitude, longitude, timeZone);
  if (!day) return null;
  const mark = (at: Date): SunMark => ({ ...sunPosition(at, latitude, longitude), instant: at, time: clockIn(at, timeZone) });
  let from: Date | null = null;
  let to: Date | null = null;
  let rise: SunMark | null = null;
  let set: SunMark | null = null;
  if (day.state === 'normal') {
    from = momentOf(date, day.sunrise, day.sunriseNext, day.sunrisePrev, timeZone);
    to = momentOf(date, day.sunset, day.sunsetNext, day.sunsetPrev, timeZone);
    rise = from ? mark(from) : null;
    set = to ? mark(to) : null;
  } else if (day.state === 'up') {
    // The sun never sets: the whole day, midnight to midnight.
    from = wallInstant(date, 0, 0, timeZone);
    to = wallInstant(shiftDate(date, 1), 0, 0, timeZone);
  }
  if (!from || !to || to <= from) return { day, arc: [], hours: [], rise, set };
  const arc: SunArcPoint[] = [];
  const step = ARC_STEP_MINUTES * MINUTE;
  for (let at = from.getTime(); at < to.getTime(); at += step) {
    const p = sunPosition(new Date(at), latitude, longitude);
    arc.push({ bearing: p.bearing, altitude: p.altitude, golden: golden(p.altitude) });
  }
  const last = sunPosition(to, latitude, longitude);
  arc.push({ bearing: last.bearing, altitude: last.altitude, golden: golden(last.altitude) });
  const hours = wholeHours(from, to, date, timeZone).map((at): SunHourMark => ({ ...mark(at), hour: zoneClock(at, timeZone)?.hour ?? 0 }));
  return { day, arc, hours, rise, set };
}

/** The instant of solar noon (the sun highest) on a date at a place, its day read in the zone; null for one that can't be read. */
export function solarNoon(date: string, latitude: number, longitude: number, timeZone: string): Date | null {
  const noon = isDayDate(date) ? noonIn(date, timeZone) : null;
  if (!noon || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  const at = getTimes(noon, latitude, longitude).solarNoon;
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A compass bearing as a direction on the plan, a unit vector with y down (the canvas's): the room's north is `north`
 * degrees clockwise from up the plan, and a bearing is degrees clockwise from north, so the bearing is north + bearing
 * clockwise from up: x = sin, y = −cos of it.
 */
export function planVector(bearing: number, north: number): { x: number; y: number } {
  const turn = ((north + bearing) * Math.PI) / 180;
  const tidy = (v: number) => {
    const r = Math.round(v * 1e9) / 1e9;
    return r === 0 ? 0 : r;
  };
  return { x: tidy(Math.sin(turn)), y: tidy(-Math.cos(turn)) };
}

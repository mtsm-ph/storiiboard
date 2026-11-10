import { addTime, getPosition, getTimes } from 'suncalc';
import { isDayDate } from './shootDay';

// A day's sun at a place (4.3), worked out offline with SunCalc from the place's latitude and longitude and the day's
// date, and written in the place's own time zone. Nothing is requested; a call sheet shows what this gives.

// Kevin's golden and blue hours (Nov 9) are not SunCalc's own: its golden hour ends at the horizon, ours runs from 6
// degrees above to 4 below it, and blue hour is 4 to 6 below. SunCalc already has 6 above (goldenHourEnd, goldenHour)
// and 6 below (dawn, dusk), so the only angle added is 4 below, once, here, the one module that reads SunCalc.
const MINUS_FOUR_RISING = 'storiiboardMinus4Rising';
const MINUS_FOUR_SETTING = 'storiiboardMinus4Setting';
addTime(-4, MINUS_FOUR_RISING, MINUS_FOUR_SETTING);

/** A stretch of the day as "06:12" and "06:48"; `...Next` marks a time on the day after the sheet's (shown "+1"), `...Prev` one on the day before ("−1"). */
export interface SunRange {
  start: string;
  end: string;
  startNext: boolean;
  endNext: boolean;
  startPrev: boolean;
  endPrev: boolean;
}

/**
 * One band of sun height (golden hour, blue hour) on the day. Where the sun crosses both edges it has a morning and an
 * evening stretch. At high latitudes it may not: `whole` is one stretch (the sun rises into the band and goes back
 * without leaving it by the top), `evening` may run to the next morning, `morning` may begin at midnight, and
 * `allDay` is the sun staying inside the band for the whole 24 hours. All null and false: the band doesn't happen.
 */
export interface SunBand {
  allDay: boolean;
  morning: SunRange | null;
  evening: SunRange | null;
  whole: SunRange | null;
}

export interface SunDay {
  /** `up`: the sun doesn't set that day; `down`: it doesn't rise; `normal`: it does both. */
  state: 'normal' | 'up' | 'down';
  /** HH:MM; '' unless the state is normal. `Next`: it falls on the day after (a sunset at 00:03). */
  sunrise: string;
  sunriseNext: boolean;
  sunrisePrev: boolean;
  sunset: string;
  sunsetNext: boolean;
  sunsetPrev: boolean;
  golden: SunBand;
  blue: SunBand;
}

/** Whether `timeZone` is an IANA zone this computer knows. Odd values read as unset (the file may come from anywhere). */
export function isTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(instant: Date, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds (summer time included). */
function offsetAt(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant it is noon on `date` in `timeZone`. Noon UTC would be the wrong day for places far from Greenwich
 * (SunCalc reads the solar day around the instant it's given), and noon is never inside a clock change.
 */
export function noonIn(date: string, timeZone: string): Date | null {
  const m = DAY.exec(date);
  if (!m || !isTimeZone(timeZone)) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  // The offset is read near the answer, so it's the one in force at noon even on a day the clocks change.
  const first = new Date(wall - offsetAt(new Date(wall), timeZone));
  return new Date(wall - offsetAt(first, timeZone));
}

/** HH:MM in the zone, to the nearest minute, on a 24-hour clock, and whether that is after or before the day `date`. */
function clock(instant: Date, timeZone: string, date: string): Moment {
  const p = parts(new Date(Math.round(instant.getTime() / 60000) * 60000), timeZone);
  const day = `${String(p.year ?? 0).padStart(4, '0')}-${String(p.month ?? 0).padStart(2, '0')}-${String(p.day ?? 0).padStart(2, '0')}`;
  return { time: `${String(p.hour ?? 0).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`, next: day > date, prev: day < date };
}

interface Moment {
  time: string;
  next: boolean;
  prev: boolean;
}
const NO_MOMENT: Moment = { time: '', next: false, prev: false };

/** SunCalc's refraction (Meeus 16.4, flat below the horizon) in degrees at an apparent height in degrees. */
function refractionDeg(apparent: number): number {
  const h = (Math.max(apparent, 0) * Math.PI) / 180;
  return ((0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179))) * 180) / Math.PI;
}

/** The sun's height edges of a band, and SunCalc's names for crossing them going up and going down. */
interface Edge {
  angle: number;
  up: string;
  down: string;
}
const SIX_ABOVE: Edge = { angle: 6, up: 'goldenHourEnd', down: 'goldenHour' };
const FOUR_BELOW: Edge = { angle: -4, up: MINUS_FOUR_RISING, down: MINUS_FOUR_SETTING };
const SIX_BELOW: Edge = { angle: -6, up: 'dawn', down: 'dusk' };

/**
 * The sun on `date` (YYYY-MM-DD) at a place, as HH:MM in `timeZone`; null for a date or zone that can't be read, or a
 * place off the globe. Times are formatted with Intl, never offsets added by hand.
 */
export function sunTimes(date: string, latitude: number, longitude: number, timeZone: string): SunDay | null {
  const noon = isDayDate(date) ? noonIn(date, timeZone) : null;
  if (!noon || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  const sun = getTimes(noon, latitude, longitude);
  // The next day's, for a stretch that runs through the night to the next morning.
  const nextDate = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const nextNoon = noonIn(nextDate, timeZone);
  const tomorrow = nextNoon ? getTimes(nextNoon, latitude, longitude) : sun;
  // And the previous day's, for a stretch that began the evening before, after that day's midnight on this clock.
  const previousDate = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const previousNoon = noonIn(previousDate, timeZone);
  const yesterday = previousNoon ? getTimes(previousNoon, latitude, longitude) : sun;
  // The day's highest and lowest height of the sun, as true heights (getPosition adds refraction): used only to tell
  // "below the band all day" from "above it all day" when no edge is crossed. Which edges are crossed comes from
  // SunCalc's own times, which are null where the sun never reaches that height.
  const apparentHigh = getPosition(sun.solarNoon, latitude, longitude).altitude;
  const apparentLow = getPosition(sun.nadir, latitude, longitude).altitude;
  const highest = apparentHigh - refractionDeg(apparentHigh);
  const lowest = apparentLow - refractionDeg(apparentLow);

  const instant = (times: typeof sun, name: string): Date | null => {
    const value = times[name];
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  };
  const range = (from: Date | 'midnight' | null, to: Date | null): SunRange | null => {
    if (from === null || to === null) return null;
    const start = from === 'midnight' ? { time: '00:00', next: false, prev: false } : clock(from, timeZone, date);
    const end = clock(to, timeZone, date);
    return { start: start.time, end: end.time, startNext: start.next, endNext: end.next, startPrev: start.prev, endPrev: end.prev };
  };
  const band = (lo: Edge, hi: Edge): SunBand => {
    const none: SunBand = { allDay: false, morning: null, evening: null, whole: null };
    const crossesLo = instant(sun, lo.up) !== null && instant(sun, lo.down) !== null;
    const crossesHi = instant(sun, hi.up) !== null && instant(sun, hi.down) !== null;
    if (crossesLo && crossesHi) {
      return { ...none, morning: range(instant(sun, lo.up), instant(sun, hi.up)), evening: range(instant(sun, hi.down), instant(sun, lo.down)) };
    }
    // Rises into the band and goes back down without leaving by the top: one stretch.
    if (crossesLo) return { ...none, whole: range(instant(sun, lo.up), instant(sun, lo.down)) };
    if (crossesHi) {
      // Never leaves by the bottom: the band was running when the day began, since the previous evening's crossing of
      // its top edge, which can fall after midnight on this clock (then the stretch starts then); the evening's runs
      // to the next morning's.
      const before = instant(yesterday, hi.down);
      const started = before && !clock(before, timeZone, date).prev && !clock(before, timeZone, date).next ? before : 'midnight';
      return { ...none, morning: range(started, instant(sun, hi.up)), evening: range(instant(sun, hi.down), instant(tomorrow, hi.up)) };
    }
    // No edge is crossed: the sun stays below the band, above it, or inside it, all day.
    if (highest < lo.angle || lowest > hi.angle) return none;
    return { ...none, allDay: true };
  };

  const rise = instant(sun, 'sunrise');
  const set = instant(sun, 'sunset');
  const state = rise !== null && set !== null ? 'normal' : sun.alwaysUp === true ? 'up' : 'down';
  const sunrise = state === 'normal' && rise ? clock(rise, timeZone, date) : NO_MOMENT;
  const sunset = state === 'normal' && set ? clock(set, timeZone, date) : NO_MOMENT;
  return {
    state,
    sunrise: sunrise.time,
    sunriseNext: sunrise.next,
    sunrisePrev: sunrise.prev,
    sunset: sunset.time,
    sunsetNext: sunset.next,
    sunsetPrev: sunset.prev,
    // Golden: 4 below to 6 above. Blue: 6 below to 4 below.
    golden: band(FOUR_BELOW, SIX_ABOVE),
    blue: band(SIX_BELOW, FOUR_BELOW),
  };
}

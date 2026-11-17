import { formatNumber, getLocale, t, type MessageKey } from '../../../core/i18n';
import type { ShownItem } from '../../../core/model/plan';
import { liveSun, type SunMissing } from '../../../core/model/planSun';
import type { SbdRecord } from '../../../core/model/record';
import { planVector, sunAt, SUN_RADIUS_M, type SunAt, type SunPath } from '../../../core/model/sunPath';
import { sunReadingOf, type SunReadingOf } from '../../../core/model/sunSources';
import { toCanvas } from './planScale';
import type { SunLook, SunTick } from './sunDraw';

// What each sun path on a plan shows (6.6), worked out from the records each time they change, as a camera's and a
// light's are: read live from the setup's frames, their day's date, their location's place and zone and the room's
// north, or the sun path's own place and date (6.5.5): the one reading, sunSources.ts; the maths in sunPath.ts. Never
// stored.

type Records = Readonly<Record<string, SbdRecord>>;

export const MISSING_WORDS: Readonly<Record<SunMissing, MessageKey>> = {
  noFrames: 'plan.sun.noFrames',
  noDay: 'plan.sun.noDay',
  noDate: 'plan.sun.noDate',
  noLocation: 'plan.sun.noLocation',
  noPlace: 'plan.sun.noPlace',
  noNorth: 'plan.sun.noNorth',
  noZone: 'plan.sun.noZone',
};

/** "212°", a whole degree. */
const degrees = (value: number): string => t('plan.degrees', { value: formatNumber(Math.round(value) % 360, 0) });

/**
 * The sun's height as said while it is up, whole degrees and never below 0 (6.6 review): it counts as up down to its
 * rising height (−0.83°, refraction and its half width), where its true height rounds to "-1° high".
 */
export const shownHeight = (altitude: number): number => Math.max(0, Math.round(altitude));

/** "14:30 · 212° · 38° high", or "21:10 · the sun is down". */
export function sunLabel(sun: SunAt): string {
  if (!sun.up) return t('plan.sun.down', { time: sun.time });
  return t('plan.sun.at', { time: sun.time, bearing: degrees(sun.bearing), height: formatNumber(shownHeight(sun.altitude), 0) });
}

/** The day's path and the sun at the item's time, for a reading with everything; null otherwise. */
export interface SunNumbers {
  path: SunPath;
  at: SunAt;
}

/** The day's path from the reading (sunSources.ts) and the sun at `time` (the item's, or one being typed). */
export function sunNumbers(reading: SunReadingOf | null, time: string): SunNumbers | null {
  if (!reading || 'missing' in reading || !reading.path) return null;
  const { date, place, zone } = reading;
  const at = reading.at?.time === time ? reading.at : sunAt(date.date, time, place.latitude, place.longitude, zone.zone);
  return at ? { path: reading.path, at } : null;
}

/** The arc in stretches of one colour, round the middle (canvas units): a stretch starts where the last ended, so they join. */
function segmentsOf(path: SunPath, north: number, radius: number): { golden: boolean; points: number[] }[] {
  const out: { golden: boolean; points: number[] }[] = [];
  let last: { x: number; y: number } | null = null;
  for (const p of path.arc) {
    const v = planVector(p.bearing, north);
    const point = { x: Math.round(v.x * radius * 100) / 100, y: Math.round(v.y * radius * 100) / 100 };
    const current = out.at(-1);
    if (current?.golden === p.golden) current.points.push(point.x, point.y);
    else out.push({ golden: p.golden, points: last ? [last.x, last.y, point.x, point.y] : [point.x, point.y] });
    last = point;
  }
  return out;
}

const tick = (bearing: number, north: number, label: string): SunTick => ({ ...planVector(bearing, north), label });

const looks = new WeakMap<object, Map<string, SunLook>>();
let looksMade = 0;

/** How many sun path looks have been worked out: for tests, which check an edit a sun path doesn't read works none out. */
export const sunLooksMade = (): number => looksMade;

/**
 * One sun path's look. Kept by its reading (6.26 round 2), which is the same object while no record the sun path reads
 * changed (sunSources.ts) and which its time is part of, with whether it is selected and the language its words are in:
 * a light turned on the plan gives the look it had, its arc's stretches not made again.
 */
export function sunLookOf(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>, selected: boolean): SunLook | null {
  const sun = liveSun(records, sunId);
  if (!sun) return null;
  const reading = sunReadingOf(records, sunId, zones);
  if (!reading) return sunLookFrom(reading, sun.fields.time, selected);
  let known = looks.get(reading);
  if (!known) {
    known = new Map();
    looks.set(reading, known);
  }
  const key = `${selected ? 'selected' : 'plain'}|${getLocale()}|${sun.fields.time}`;
  const found = known.get(key);
  if (found) return found;
  const look = sunLookFrom(reading, sun.fields.time, selected);
  known.set(key, look);
  return look;
}

/** A sun path's look from its reading and its time, worked out anew: what sunLookOf keeps. */
export function sunLookFrom(reading: SunReadingOf | null, time: string, selected: boolean): SunLook {
  looksMade += 1;
  // While its zone's lookup is on its way, the icon alone: no "No time zone" for a moment (6.6 review).
  if (reading && 'missing' in reading && reading.pending) return { kind: 'missing', lines: [], selected };
  if (!reading || 'missing' in reading) return { kind: 'missing', lines: [t(MISSING_WORDS[reading?.missing ?? 'noFrames'])], selected };
  const numbers = sunNumbers(reading, time);
  // A date or place SunCalc can't read (an import's): said as no place.
  if (!numbers) return { kind: 'missing', lines: [t(MISSING_WORDS.noPlace)], selected };
  const { north } = reading;
  const radius = toCanvas(SUN_RADIUS_M);
  const { path, at } = numbers;
  return {
    kind: 'drawn',
    radius,
    segments: segmentsOf(path, north, radius),
    // 24-hour, as the call sheet writes its times: "7", "13".
    hours: path.hours.map((h) => tick(h.bearing, north, String(h.hour))),
    rise: path.rise ? tick(path.rise.bearing, north, t('plan.sun.rise', { time: path.rise.time })) : null,
    set: path.set ? tick(path.set.bearing, north, t('plan.sun.set', { time: path.set.time })) : null,
    sun: { ...planVector(at.bearing, north), up: at.up },
    label: sunLabel(at),
    shadows: t('plan.sun.shadows'),
    selected,
  };
}

/** Every shown sun path's look, by id. */
export function sunLooks(records: Records, shown: readonly ShownItem[], zones: ReadonlyMap<string, string | null>, selection: readonly string[]): Map<string, SunLook> {
  const picked = new Set(selection);
  return new Map(
    shown.flatMap((item) => {
      if (item.fields.kind !== 'sun') return [];
      const look = sunLookOf(records, item.record.id, zones, picked.has(item.record.id));
      return look ? [[item.record.id, look] as const] : [];
    }),
  );
}

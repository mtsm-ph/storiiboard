import { formatNumber, t, type MessageKey } from '../../../core/i18n';
import type { ShownItem } from '../../../core/model/plan';
import { liveSun, sunReading, type SunMissing, type SunReading } from '../../../core/model/planSun';
import type { SbdRecord } from '../../../core/model/record';
import { planVector, sunAt, sunPath, SUN_RADIUS_M, type SunAt, type SunPath } from '../../../core/model/sunPath';
import { toCanvas } from './planScale';
import type { SunLook, SunTick } from './sunDraw';

// What each sun path on a plan shows (6.6), worked out from the records each time they change, as a camera's and a
// light's are: read live from the setup's frames, their day's date, their location's place and zone and the room's
// north (planSun.ts), the maths in sunPath.ts. Never stored.

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

/** "14:30 · 212° · 38° high", or "21:10 · the sun is down". */
export function sunLabel(sun: SunAt): string {
  if (!sun.up) return t('plan.sun.down', { time: sun.time });
  return t('plan.sun.at', { time: sun.time, bearing: degrees(sun.bearing), height: formatNumber(Math.round(sun.altitude), 0) });
}

/** The day's path and the sun at the item's time, for a reading with everything; null otherwise. */
export interface SunNumbers {
  path: SunPath;
  at: SunAt;
}

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

export function sunNumbers(reading: SunReading | null, time: string): SunNumbers | null {
  if (!reading || 'missing' in reading) return null;
  const { day, place } = reading.source;
  const path = pathFor(day.fields.date, place.latitude, place.longitude, reading.zone.zone);
  const at = sunAt(day.fields.date, time, place.latitude, place.longitude, reading.zone.zone);
  return path && at ? { path, at } : null;
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

/** One sun path's look. */
export function sunLookOf(records: Records, sunId: string, zones: ReadonlyMap<string, string | null>, selected: boolean): SunLook | null {
  const sun = liveSun(records, sunId);
  if (!sun) return null;
  const reading = sunReading(records, sunId, zones);
  if (!reading || 'missing' in reading) return { kind: 'missing', lines: [t(MISSING_WORDS[reading?.missing ?? 'noFrames'])], selected };
  const numbers = sunNumbers(reading, sun.fields.time);
  // A date or place SunCalc can't read (an import's): said as no place.
  if (!numbers) return { kind: 'missing', lines: [t(MISSING_WORDS.noPlace)], selected };
  const { north } = reading.source;
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

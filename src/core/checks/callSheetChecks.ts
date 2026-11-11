import { callSheet } from '../model/callsheet';
import type { SbdRecord } from '../model/record';
import { checkContext, type CheckContext } from './context';
import { departmentMissing, type DepartmentMissing } from './departmentMissing';
import { exteriorRain, type ExteriorRain, type HeldForecasts } from './exteriorRain';
import { goldenHourMidday, type GoldenHourMidday } from './goldenHourMidday';
import { hmuTooShort, type HmuTooShort } from './hmuTooShort';
import { locationMissing, type LocationMissing } from './locationMissing';

// The call sheet's checks (4.8) for one day. The same function serves the app and, from Phase 7, the MCP check tool.

export type CallSheetFinding = LocationMissing | DepartmentMissing | HmuTooShort | GoldenHourMidday | ExteriorRain;

/** A check that could not run for a location, and why: its time zone isn't known, or no forecast is held for it. */
export interface SkippedCheck {
  kind: 'golden-hour-midday' | 'exterior-rain';
  reason: 'no-zone' | 'no-forecast';
  locationId: string;
}

export interface CallSheetCheckResult {
  findings: CallSheetFinding[];
  /** Checks that had something to look at and could not run, so "no finding" is not "all clear" for them. */
  skipped: SkippedCheck[];
}

const EDGE_OF_DAY = ['DAWN', 'DUSK', 'MAGIC HOUR'];

/** What could not be checked: a scene's light needs the location's zone, its rain needs the zone and a held forecast. */
function skippedOf(ctx: CheckContext, forecasts: HeldForecasts): SkippedCheck[] {
  const { sheet } = ctx;
  const { date, callTime } = sheet.day.fields;
  const found = new Map<string, SkippedCheck>();
  const add = (skip: SkippedCheck) => found.set(`${skip.kind}:${skip.locationId}`, skip);
  for (const { fields, locationIds } of sheet.scenes) {
    for (const id of locationIds) {
      const location = sheet.locations.find((l) => l.record.id === id);
      if (!location || date === '') continue;
      // A place with no zone yet has no sun and no forecast day: neither check can read it.
      const noZone = location.place !== null && location.zone === null;
      if (fields.dayNight !== null && EDGE_OF_DAY.includes(fields.dayNight) && callTime !== '' && noZone) add({ kind: 'golden-hour-midday', reason: 'no-zone', locationId: id });
      if (fields.intExt === 'EXT' || fields.intExt === 'INT/EXT') {
        if (noZone) add({ kind: 'exterior-rain', reason: 'no-zone', locationId: id });
        else if (!forecasts.has(id)) add({ kind: 'exterior-rain', reason: 'no-forecast', locationId: id });
      }
    }
  }
  return [...found.values()];
}

/** Worked out once per records, then per project and day while the zones and forecasts stay the same (as gearNotOnDay does). */
interface Cached {
  zones: ReadonlyMap<string, string | null> | undefined;
  forecasts: HeldForecasts;
  result: CallSheetCheckResult;
}
const cache = new WeakMap<Readonly<Record<string, SbdRecord>>, Map<string, Cached>>();
const NO_FORECASTS: HeldForecasts = new Map();

// The app's zones map is made again on every draw, so it is compared by what it holds, not by identity.
function sameZones(a: ReadonlyMap<string, string | null> | undefined, b: ReadonlyMap<string, string | null> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [id, zone] of a) if (!b.has(id) || b.get(id) !== zone) return false;
  return true;
}

// The app builds its map of held forecasts in each tile; each forecast object is the session's own, so entries are compared by identity.
function sameHeld(a: HeldForecasts, b: HeldForecasts): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, forecast] of a) if (b.get(id) !== forecast) return false;
  return true;
}

/**
 * Every call sheet check for one day, in the order of the strip: locations, departments, HMU, light, rain. `forecasts`
 * are the ones already held, by location id (never fetched here); `zones` are the looked-up time zones callSheet() takes
 * (a location with a place and no zone has no sun, so no light or rain finding, and `skipped` says so). Empty for a day
 * that isn't a live day. The result is shared: don't change it.
 */
export function callSheetChecks(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
  dayId: string,
  forecasts: HeldForecasts = NO_FORECASTS,
  zones?: ReadonlyMap<string, string | null>,
): CallSheetCheckResult {
  let byDay = cache.get(records);
  if (!byDay) {
    byDay = new Map();
    cache.set(records, byDay);
  }
  const key = `${projectId}|${dayId}`;
  const known = byDay.get(key);
  if (known && sameHeld(known.forecasts, forecasts) && sameZones(known.zones, zones)) return known.result;
  const sheet = callSheet(records, projectId, dayId, undefined, zones);
  let result: CallSheetCheckResult = { findings: [], skipped: [] };
  if (sheet) {
    const ctx = checkContext(records, projectId, sheet);
    // The sheet's times are in its first location's zone: while that zone is on its way the hours can't be placed, so
    // neither light nor rain is checked (rain would otherwise show on the whole day and vanish once the zone arrives).
    const first = sheet.locations[0];
    const pending = sheet.timesIn === null && first !== undefined;
    const skipped = skippedOf(ctx, forecasts);
    if (first && pending) {
      for (const kind of ['golden-hour-midday', 'exterior-rain'] as const) {
        if (!skipped.some((s) => s.kind === kind && s.locationId === first.record.id)) skipped.push({ kind, reason: 'no-zone', locationId: first.record.id });
      }
    }
    result = {
      findings: [
        ...locationMissing(ctx),
        ...departmentMissing(ctx),
        ...hmuTooShort(ctx),
        ...(pending ? [] : [...goldenHourMidday(ctx), ...exteriorRain(ctx, forecasts)]),
      ],
      skipped,
    };
  }
  byDay.set(key, { zones, forecasts, result });
  return result;
}

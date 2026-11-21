import { callSheet } from '../model/callsheet';
import type { SbdRecord } from '../model/record';
import { wallInstant } from '../model/sunTimes';
import { dayWeather, precipitationCovers } from '../net/weather';
import { checkContext, type CheckContext } from './context';
import { shiftDate, workingHours } from './hours';
import { departmentMissing, type DepartmentMissing } from './departmentMissing';
import { exteriorRain, type ExteriorRain, type HeldForecasts } from './exteriorRain';
import { goldenHourMidday, type GoldenHourMidday } from './goldenHourMidday';
import { hmuTooShort, type HmuTooShort } from './hmuTooShort';
import { locationMissing, type LocationMissing } from './locationMissing';
import { unavailableOnSheet, type UnavailableOnDay } from './unavailableOnDay';

// The call sheet's checks (4.8) for one day. The same function serves the app and, from Phase 7, the MCP check tool.
// 7.3 adds the people on the day who marked it unavailable, after the HMU check: both are about who is called.

export type CallSheetFinding = LocationMissing | DepartmentMissing | HmuTooShort | UnavailableOnDay | GoldenHourMidday | ExteriorRain;

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

/**
 * What the Checks tile says about a day's light and rain besides its findings and the strip's skips (7.4 round 2),
 * worked out from the very sheet the day's checks read, never a second one.
 */
export interface DayForecastNotes {
  /** Exteriors' locations whose held forecast misses the date, or reaches it but not the working hours, and whose rain wasn't found. */
  gaps: { locationId: string; reason: 'forecast-not-covering' | 'forecast-not-hours' }[];
  /** Locations whose held forecast covers the working hours and was read for an exterior's rain. */
  read: string[];
  /** Locations with no place on the map that a scene's light or rain had to read: neither could be checked there. */
  noPlace: { locationId: string; kinds: ('golden-hour-midday' | 'exterior-rain')[] }[];
}

const NO_NOTES: DayForecastNotes = { gaps: [], read: [], noPlace: [] };

/** Worked out once per records, then per project and day while the zones and forecasts stay the same (as gearNotOnDay does). */
interface Cached {
  zones: ReadonlyMap<string, string | null> | undefined;
  forecasts: HeldForecasts;
  result: CallSheetCheckResult;
  /** The context the checks ran on; null for no sheet, or while the sheet's times wait for their zone. */
  ctx: CheckContext | null;
  /** Made from `ctx` the first time they are asked for. */
  notes?: DayForecastNotes;
}

function notesOf(ctx: CheckContext, forecasts: HeldForecasts, findings: readonly CallSheetFinding[]): DayForecastNotes {
  const { sheet } = ctx;
  const { date, callTime } = sheet.day.fields;
  if (date === '') return NO_NOTES;
  const hours = workingHours(ctx, false);
  const gaps = new Map<string, DayForecastNotes['gaps'][number]>();
  const read = new Set<string>();
  const noPlace = new Map<string, Set<'golden-hour-midday' | 'exterior-rain'>>();
  for (const { record, fields, locationIds } of sheet.scenes) {
    const exterior = fields.intExt === 'EXT' || fields.intExt === 'INT/EXT';
    const edge = fields.dayNight !== null && EDGE_OF_DAY.includes(fields.dayNight) && callTime !== '';
    const rained = findings.some((f) => f.kind === 'exterior-rain' && f.sceneId === record.id);
    for (const id of locationIds) {
      const location = sheet.locations.find((l) => l.record.id === id);
      if (!location) continue;
      if (location.place === null) {
        if (!exterior && !edge) continue;
        const kinds = noPlace.get(id) ?? new Set();
        if (edge) kinds.add('golden-hour-midday');
        if (exterior) kinds.add('exterior-rain');
        noPlace.set(id, kinds);
        continue;
      }
      const forecast = forecasts.get(id);
      if (!exterior || !forecast || !location.zone) continue;
      const zone = location.zone.zone;
      // The hours exteriorRain reads: crew call to wrap, else the whole day where the location is.
      const from = hours ? hours.start : wallInstant(date, 0, 0, zone)?.getTime();
      const to = hours ? hours.end : wallInstant(shiftDate(date, 1), 0, 0, zone)?.getTime();
      if (from === undefined || to === undefined) continue;
      const state = dayWeather(forecast.entries, date, zone, '').state;
      if (state === 'none' || state === 'beyond') {
        if (!rained) gaps.set(id, { locationId: id, reason: 'forecast-not-covering' });
      } else if (!precipitationCovers(forecast.entries, from, to)) {
        if (!rained && !gaps.has(id)) gaps.set(id, { locationId: id, reason: 'forecast-not-hours' });
      } else {
        read.add(id);
      }
    }
  }
  if (gaps.size === 0 && read.size === 0 && noPlace.size === 0) return NO_NOTES;
  // Order: the edge-of-day light first, as the strip lists its skips.
  const order = ['golden-hour-midday', 'exterior-rain'] as const;
  return {
    gaps: [...gaps.values()],
    read: [...read],
    noPlace: [...noPlace].map(([locationId, kinds]) => ({ locationId, kinds: order.filter((k) => kinds.has(k)) })),
  };
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
 * Every call sheet check for one day, in the order of the strip: locations, departments, HMU, unavailable dates (7.3), light, rain. `forecasts`
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
  return dayChecks(records, projectId, dayId, forecasts, zones).result;
}

/**
 * A day's notes on its light and rain for the Checks tile (7.4 round 2), from the same sheet and context its checks
 * ran on (callSheetChecks with the same arguments), kept with them. Empty for a day with no sheet, no date, or whose
 * times are waiting for their zone (the strip's skips say that). Shared: don't change it.
 */
export function dayForecastNotes(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
  dayId: string,
  forecasts: HeldForecasts = NO_FORECASTS,
  zones?: ReadonlyMap<string, string | null>,
): DayForecastNotes {
  const cached = dayChecks(records, projectId, dayId, forecasts, zones);
  if (!cached.notes) cached.notes = cached.ctx ? notesOf(cached.ctx, forecasts, cached.result.findings) : NO_NOTES;
  return cached.notes;
}

function dayChecks(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
  dayId: string,
  forecasts: HeldForecasts,
  zones: ReadonlyMap<string, string | null> | undefined,
): Cached {
  let byDay = cache.get(records);
  if (!byDay) {
    byDay = new Map();
    cache.set(records, byDay);
  }
  const key = `${projectId}|${dayId}`;
  const known = byDay.get(key);
  if (known && sameHeld(known.forecasts, forecasts) && sameZones(known.zones, zones)) return known;
  const sheet = callSheet(records, projectId, dayId, undefined, zones);
  let result: CallSheetCheckResult = { findings: [], skipped: [] };
  let kept: CheckContext | null = null;
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
        ...unavailableOnSheet(ctx),
        ...(pending ? [] : [...goldenHourMidday(ctx), ...exteriorRain(ctx, forecasts)]),
      ],
      skipped,
    };
    if (!pending) kept = ctx;
  }
  const made: Cached = { zones, forecasts, result, ctx: kept };
  byDay.set(key, made);
  return made;
}

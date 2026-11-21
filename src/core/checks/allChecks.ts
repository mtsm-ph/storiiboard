import { cameraFields, gripFields, lightFields } from '../model/plan';
import type { SbdRecord } from '../model/record';
import { keptFor, recordsOfType, unchangedToken } from '../model/recordIndex';
import { frameDayId, projectShootDays } from '../model/shootDay';
import { callSheetChecks, dayForecastNotes, type CallSheetFinding } from './callSheetChecks';
import type { HeldForecasts } from './exteriorRain';
import { gearNotOnDay, type GearNotOnDay } from './gearOnDay';
import { planLensDiffers, type PlanLensDiffers } from './planLens';

// Every check over the whole project (7.4, decision 7): what the Checks tile shows and 7.5's `run_checks` returns, from
// this one function. No check is written here: it runs the project-wide ones (gear, lens) and the call sheet's for each
// live day (callSheetChecks, so a day's findings are exactly its strip's), then gives each finding an id, its day and the
// record to show, sorted by day (undated days after dated ones, findings on no day last), then by check. Nothing here
// reads the page or the network: the forecasts are the ones the caller already holds, and a day's rain that can't be
// checked is said in `skipped`, as the strip says what it skipped.
//
// CLAUDE.md lists seven checks; golden hour and rain share one line there, so the code has eight kinds, all run.

type Records = Readonly<Record<string, SbdRecord>>;

/** The checks in the order the tile lists them (CLAUDE.md's): within a day, findings go by this. */
export const CHECK_KINDS = [
  'unavailable-on-day',
  'gear-not-on-day',
  'golden-hour-midday',
  'exterior-rain',
  'location-missing',
  'department-missing',
  'hmu-too-short',
  'plan-lens-differs',
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export type AnyFinding = CallSheetFinding | GearNotOnDay | PlanLensDiffers;

/** Where a finding is seen or fixed: a frame, items on a setup's plan, a location, or the day's call sheet. */
export type CheckTarget =
  | { kind: 'shot'; shotId: string; sceneId: string }
  | { kind: 'plan'; sceneId: string; setupId: string; itemIds: readonly string[] }
  | { kind: 'location'; locationId: string }
  | { kind: 'sheet'; dayId: string };

export interface CheckFinding {
  /** The same for the same problem from one run to the next: its kind, day and the records it is about. */
  id: string;
  kind: CheckKind;
  /** None of the checks grades its findings: each is something likely wrong before the day. */
  severity: 'warning';
  /** The live day it is on; null for a lens finding whose frame is in no day. */
  dayId: string | null;
  finding: AnyFinding;
  target: CheckTarget;
}

/**
 * A check that had something to look at and could not run. `no-zone`: the location's time zone isn't known yet;
 * `no-place`: the location has no place on the map, so it has no sun and no forecast; `no-forecast`: no forecast is
 * held for an exterior's location; `forecast-not-covering`: the one held doesn't reach the day; `forecast-not-hours`: it
 * reaches the day but not all of its working hours; `no-date`: the day has no date, so who is away, the light and the
 * rain can't be read.
 */
export interface CheckSkip {
  id: string;
  kinds: readonly CheckKind[];
  reason: 'no-zone' | 'no-place' | 'no-forecast' | 'forecast-not-covering' | 'forecast-not-hours' | 'no-date';
  dayId: string;
  locationId: string | null;
}

/** A held forecast past its `Expires` that the rain check read all the same (7.4 round 2): used, and said. */
export interface OldForecast {
  id: string;
  dayId: string;
  locationId: string;
  /** When it was fetched (ISO), when the caller knows; null otherwise. */
  fetchedAt: string | null;
}

export interface AllChecksResult {
  findings: readonly CheckFinding[];
  skipped: readonly CheckSkip[];
  /** Only when the caller passes `now`: forecasts read though they are past their `Expires`. */
  oldForecasts: readonly OldForecast[];
}

/**
 * What the caller already holds: forecasts by location id (never fetched here), when each was fetched, and looked-up
 * zones (callSheet's). With `now` (ms), a forecast read past its `Expires` is said in `oldForecasts`; without it, a
 * forecast's age isn't judged.
 */
export interface HeldForChecks {
  forecasts?: HeldForecasts;
  fetchedAt?: ReadonlyMap<string, string>;
  zones?: ReadonlyMap<string, string | null>;
  now?: number;
}

// What the checks read, so an edit to anything else (a sketch's strokes, a board, a note, a comment, a picture) gives
// back the last result without running one check. Errs wide: a type left out is a result that goes stale.
const CHECK_TYPES: readonly SbdRecord['type'][] = ['project', 'scene', 'shot', 'setup', 'location', 'person', 'department', 'gear_item', 'shoot_day', 'callsheet', 'plan', 'availability', 'character'];

// Of a plan's items, only cameras (the lens check) and lights, flags and diffusion that are gear (the gear check), and of
// those only what the checks read (7.4 round 2): where the item sits, its order and whether it is in the Trash; whether
// it reads as its kind at all; a camera's typed lens, its lens link and its frames; an item's gear. Its place, size and
// turn are left out, so moving a light or a camera on a plan runs no check.
const counted = (record: SbdRecord): boolean => record.props.kind === 'camera' || record.props.gear_id !== undefined;
function itemReading(record: SbdRecord): string {
  const { props } = record;
  const base = [record.id, record.parentId, record.sortKey, record.trashedAt, props.kind ?? null];
  if (props.kind === 'camera') return JSON.stringify([...base, cameraFields(props) !== null, props.lens_mm ?? null, props.lens_id ?? null, props.shot_ids ?? null]);
  return JSON.stringify([...base, (lightFields(props) ?? gripFields(props)) !== null, props.gear_id ?? null]);
}

interface ItemsReading {
  readings: readonly string[];
  token: object;
}
// The last reading, held weakly as recordIndex's tokens are, so a closed project's records are never kept from here.
let lastItems: WeakRef<ItemsReading> | null = null;

/** The same object while the items the checks read read the same, whatever else about them changed. */
function itemsToken(records: Records): object {
  return keptFor(records, 'checks.items', (): ItemsReading => {
    const readings = recordsOfType(records, 'plan_item').filter(counted).map(itemReading);
    const last = lastItems?.deref();
    if (last && last.readings.length === readings.length && last.readings.every((r, i) => r === readings[i])) return last;
    const made: ItemsReading = { readings, token: {} };
    lastItems = new WeakRef(made);
    return made;
  }).token;
}

/** The checks' own result for the records, before a forecast's age is judged (that depends on the time it is read at). */
interface Base {
  findings: CheckFinding[];
  skipped: CheckSkip[];
  /** The forecasts the rain check read, by day: where an old one is said. */
  read: { dayId: string; locationId: string }[];
}

interface Known {
  items: object;
  forecasts: HeldForecasts;
  zones: ReadonlyMap<string, string | null> | undefined;
  base: Base;
  /** The last result handed out from `base`, and what about the forecasts' age it was made for. */
  aged: { key: string; result: AllChecksResult } | null;
}

/** Kept by the token of the records the checks read, while the items, forecasts and zones read the same. */
const kept = new WeakMap<object, Map<string, Known>>();
let made = 0;

/** How many times the checks were run whole: for tests, which check an edit the checks don't read runs none. */
export const allChecksMade = (): number => made;

const NO_FORECASTS: HeldForecasts = new Map();

function sameZones(a: ReadonlyMap<string, string | null> | undefined, b: ReadonlyMap<string, string | null> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [id, zone] of a) if (!b.has(id) || b.get(id) !== zone) return false;
  return true;
}

function sameHeld(a: HeldForecasts, b: HeldForecasts): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, forecast] of a) if (b.get(id) !== forecast) return false;
  return true;
}

/** The id and the target of a call sheet finding. */
function ofSheet(finding: CallSheetFinding): { id: string; target: CheckTarget } {
  const day = finding.dayId;
  switch (finding.kind) {
    case 'location-missing':
      return { id: `${finding.kind}:${day}:${finding.locationId}`, target: { kind: 'location', locationId: finding.locationId } };
    case 'department-missing':
      return { id: `${finding.kind}:${day}:${finding.department}`, target: { kind: 'sheet', dayId: day } };
    case 'hmu-too-short':
      return { id: `${finding.kind}:${day}:${finding.personId}:${finding.problem}`, target: { kind: 'sheet', dayId: day } };
    case 'unavailable-on-day':
      return { id: `${finding.kind}:${day}:${finding.personId}`, target: { kind: 'sheet', dayId: day } };
    case 'golden-hour-midday':
      return { id: `${finding.kind}:${day}:${finding.sceneId}`, target: { kind: 'sheet', dayId: day } };
    case 'exterior-rain':
      return { id: `${finding.kind}:${day}:${finding.sceneId}:${finding.locationId}`, target: { kind: 'sheet', dayId: day } };
  }
}

function run(records: Records, projectId: string, forecasts: HeldForecasts, zones: ReadonlyMap<string, string | null> | undefined): Base {
  made += 1;
  const days = projectShootDays(records, projectId);
  const dayIndex = new Map(days.map((day, i) => [day.record.id, i]));
  const findings: CheckFinding[] = [];
  const skipped: CheckSkip[] = [];
  const read: Base['read'] = [];
  for (const day of days) {
    const dayId = day.record.id;
    const result = callSheetChecks(records, projectId, dayId, forecasts, zones);
    for (const finding of result.findings) findings.push({ ...ofSheet(finding), kind: finding.kind, severity: 'warning', dayId, finding });
    if (day.fields.date === '') {
      skipped.push({ id: `no-date:${dayId}`, kinds: ['unavailable-on-day', 'golden-hour-midday', 'exterior-rain'], reason: 'no-date', dayId, locationId: null });
      continue;
    }
    // The same sheet the day's checks read, never a second one (7.4 round 2).
    const notes = dayForecastNotes(records, projectId, dayId, forecasts, zones);
    const placeless = new Set(notes.noPlace.map((n) => n.locationId));
    for (const skip of result.skipped) {
      // A location with no place can have no forecast: the strip says "no forecast", the tile says why (no place).
      if (skip.reason === 'no-forecast' && placeless.has(skip.locationId)) continue;
      skipped.push({ id: `${skip.kind}:${skip.reason}:${dayId}:${skip.locationId}`, kinds: [skip.kind], reason: skip.reason, dayId, locationId: skip.locationId });
    }
    for (const { locationId, kinds } of notes.noPlace) skipped.push({ id: `no-place:${dayId}:${locationId}`, kinds, reason: 'no-place', dayId, locationId });
    for (const { locationId, reason } of notes.gaps) skipped.push({ id: `exterior-rain:${reason}:${dayId}:${locationId}`, kinds: ['exterior-rain'], reason, dayId, locationId });
    for (const locationId of notes.read) read.push({ dayId, locationId });
  }
  for (const finding of gearNotOnDay(records, projectId)) {
    if (finding.shotId !== null) {
      const sceneId = records[finding.shotId]?.parentId ?? '';
      findings.push({ id: `${finding.kind}:${finding.dayId}:${finding.shotId}`, kind: finding.kind, severity: 'warning', dayId: finding.dayId, finding, target: { kind: 'shot', shotId: finding.shotId, sceneId } });
    } else {
      const setupId = finding.setupId ?? '';
      const sceneId = records[setupId]?.parentId ?? '';
      findings.push({ id: `${finding.kind}:${finding.dayId}:setup:${setupId}`, kind: finding.kind, severity: 'warning', dayId: finding.dayId, finding, target: { kind: 'plan', sceneId, setupId, itemIds: finding.itemIds ?? [] } });
    }
  }
  for (const finding of planLensDiffers(records, projectId)) {
    const shot = records[finding.shotId];
    const dayId = shot ? frameDayId(records, shot) : null;
    findings.push({
      id: `${finding.kind}:${finding.cameraId}:${finding.shotId}`,
      kind: finding.kind,
      severity: 'warning',
      // A frame in a day of another project, or in none, is on no day here.
      dayId: dayId !== null && dayIndex.has(dayId) ? dayId : null,
      finding,
      target: { kind: 'plan', sceneId: finding.sceneId, setupId: finding.setupId, itemIds: [finding.cameraId] },
    });
  }
  const dayOrder = (dayId: string | null) => (dayId === null ? days.length : (dayIndex.get(dayId) ?? days.length));
  const kindOrder = (kind: CheckKind) => CHECK_KINDS.indexOf(kind);
  // A stable sort: within a day and a check, each check's own order (board order, the strip's order) stands.
  findings.sort((a, b) => dayOrder(a.dayId) - dayOrder(b.dayId) || kindOrder(a.kind) - kindOrder(b.kind));
  skipped.sort((a, b) => dayOrder(a.dayId) - dayOrder(b.dayId));
  return { findings, skipped, read };
}

/** The forecasts read past their `Expires` at `now`, said once per day and location, in the days' order. */
function oldOf(base: Base, forecasts: HeldForecasts, fetchedAt: ReadonlyMap<string, string> | undefined, now: number | undefined): OldForecast[] {
  if (now === undefined) return [];
  return base.read.flatMap(({ dayId, locationId }): OldForecast[] => {
    const expires = Date.parse(forecasts.get(locationId)?.expires ?? '');
    if (Number.isNaN(expires) || expires > now) return [];
    return [{ id: `forecast-old:${dayId}:${locationId}`, dayId, locationId, fetchedAt: fetchedAt?.get(locationId) ?? null }];
  });
}

/**
 * Every check over the project's live days, frames, scenes and locations, with what could not be checked and why. The
 * result is shared between callers (it is kept while nothing the checks read changes): don't change it.
 */
export function allChecks(records: Records, projectId: string, held: HeldForChecks = {}): AllChecksResult {
  const forecasts = held.forecasts ?? NO_FORECASTS;
  const { zones } = held;
  const token = unchangedToken(records, `checks.all:${projectId}`, CHECK_TYPES);
  const items = itemsToken(records);
  let byProject = kept.get(token);
  if (!byProject) {
    byProject = new Map();
    kept.set(token, byProject);
  }
  let known = byProject.get(projectId);
  if (!known || known.items !== items || !sameHeld(known.forecasts, forecasts) || !sameZones(known.zones, zones)) {
    known = { items, forecasts, zones, base: run(records, projectId, forecasts, zones), aged: null };
    byProject.set(projectId, known);
  }
  // A forecast's age is read from `now` on every call, but the result stays the same object while what it says does.
  const oldForecasts = oldOf(known.base, forecasts, held.fetchedAt, held.now);
  const key = JSON.stringify(oldForecasts);
  if (known.aged?.key !== key) known.aged = { key, result: { findings: known.base.findings, skipped: known.base.skipped, oldForecasts } };
  return known.aged.result;
}

import { callSheet } from '../model/callsheet';
import type { SbdRecord } from '../model/record';
import { unchangedToken, type RecordsPart } from '../model/recordIndex';
import { frameDayId, projectShootDays } from '../model/shootDay';
import { dayWeather } from '../net/weather';
import { callSheetChecks, type CallSheetFinding } from './callSheetChecks';
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
 * `no-forecast`: no forecast is held for an exterior's location; `forecast-not-covering`: the one held doesn't reach
 * the day; `no-date`: the day has no date, so who is away, the light and the rain can't be read.
 */
export interface CheckSkip {
  id: string;
  kinds: readonly CheckKind[];
  reason: 'no-zone' | 'no-forecast' | 'forecast-not-covering' | 'no-date';
  dayId: string;
  locationId: string | null;
}

export interface AllChecksResult {
  findings: readonly CheckFinding[];
  skipped: readonly CheckSkip[];
}

/** What the caller already holds: forecasts by location id (never fetched here) and looked-up zones (callSheet's). */
export interface HeldForChecks {
  forecasts?: HeldForecasts;
  zones?: ReadonlyMap<string, string | null>;
}

// What the checks read, so an edit to anything else (a sketch's strokes, a board, a note, a comment, a picture) gives
// back the last result without running one check. Errs wide: a type left out is a result that goes stale.
const CHECK_TYPES: readonly SbdRecord['type'][] = ['project', 'scene', 'shot', 'setup', 'location', 'person', 'department', 'gear_item', 'shoot_day', 'callsheet', 'plan', 'availability', 'character'];
// Of a plan's items, only cameras (the lens check) and lights, flags and diffusion that are gear (the gear check).
const CHECK_ITEMS: RecordsPart = { type: 'plan_item', counts: (record) => record.props.kind === 'camera' || record.props.gear_id !== undefined };

/** Kept by the token of the records the checks read, while the forecasts and zones hold the same. */
const kept = new WeakMap<object, Map<string, { forecasts: HeldForecasts; zones: ReadonlyMap<string, string | null> | undefined; result: AllChecksResult }>>();
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

/** A forecast is held for an exterior's location, but it doesn't reach the day: its rain can't be read. */
function notCovering(records: Records, projectId: string, dayId: string, forecasts: HeldForecasts, zones: ReadonlyMap<string, string | null> | undefined, ran: readonly CallSheetFinding[]): CheckSkip[] {
  const sheet = callSheet(records, projectId, dayId, undefined, zones);
  if (!sheet || sheet.day.fields.date === '') return [];
  const date = sheet.day.fields.date;
  const found = new Set<string>();
  for (const { record, fields, locationIds } of sheet.scenes) {
    if (fields.intExt !== 'EXT' && fields.intExt !== 'INT/EXT') continue;
    if (ran.some((f) => f.kind === 'exterior-rain' && f.sceneId === record.id)) continue;
    for (const id of locationIds) {
      const forecast = forecasts.get(id);
      const zone = sheet.locations.find((l) => l.record.id === id)?.zone;
      if (!forecast || !zone) continue;
      const state = dayWeather(forecast.entries, date, zone.zone, '').state;
      if (state === 'none' || state === 'beyond') found.add(id);
    }
  }
  return [...found].map((locationId) => ({ id: `exterior-rain:forecast-not-covering:${dayId}:${locationId}`, kinds: ['exterior-rain'], reason: 'forecast-not-covering', dayId, locationId }));
}

function run(records: Records, projectId: string, forecasts: HeldForecasts, zones: ReadonlyMap<string, string | null> | undefined): AllChecksResult {
  made += 1;
  const days = projectShootDays(records, projectId);
  const dayIndex = new Map(days.map((day, i) => [day.record.id, i]));
  const findings: CheckFinding[] = [];
  const skipped: CheckSkip[] = [];
  for (const day of days) {
    const dayId = day.record.id;
    const result = callSheetChecks(records, projectId, dayId, forecasts, zones);
    for (const finding of result.findings) findings.push({ ...ofSheet(finding), kind: finding.kind, severity: 'warning', dayId, finding });
    if (day.fields.date === '') {
      skipped.push({ id: `no-date:${dayId}`, kinds: ['unavailable-on-day', 'golden-hour-midday', 'exterior-rain'], reason: 'no-date', dayId, locationId: null });
      continue;
    }
    for (const skip of result.skipped) skipped.push({ id: `${skip.kind}:${skip.reason}:${dayId}:${skip.locationId}`, kinds: [skip.kind], reason: skip.reason, dayId, locationId: skip.locationId });
    if (forecasts.size > 0) skipped.push(...notCovering(records, projectId, dayId, forecasts, zones, result.findings));
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
  return { findings, skipped };
}

/**
 * Every check over the project's live days, frames, scenes and locations, with what could not be checked and why. The
 * result is shared between callers (it is kept while nothing the checks read changes): don't change it.
 */
export function allChecks(records: Records, projectId: string, held: HeldForChecks = {}): AllChecksResult {
  const forecasts = held.forecasts ?? NO_FORECASTS;
  const { zones } = held;
  const token = unchangedToken(records, `checks.all:${projectId}`, CHECK_TYPES, CHECK_ITEMS);
  let byProject = kept.get(token);
  if (!byProject) {
    byProject = new Map();
    kept.set(token, byProject);
  }
  const known = byProject.get(projectId);
  if (known && sameHeld(known.forecasts, forecasts) && sameZones(known.zones, zones)) return known.result;
  const result = run(records, projectId, forecasts, zones);
  byProject.set(projectId, { forecasts, zones, result });
  return result;
}

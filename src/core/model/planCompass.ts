import { isSun, shownItems, type ShownItem } from './plan';
import { sceneNorth, type SunMissing } from './planSun';
import type { SbdRecord } from './record';
import { planVector } from './sunPath';
import { ownSunOf, sunReadingOf, sunZonePointOf, type SunReadingOf } from './sunSources';

// The compass at a plan's top-right corner (6.5.5, Kevin Nov 16), as data: the room's north as the room has it, and the
// sun for the plan's date as the sun path's reading gives it (sunSources.ts, the one reading): the arc from sunrise to
// sunset round its rim and the sun's direction at the time the sun path shows, or at solar noon when the sun path has no
// time of its own. Directions are unit vectors on the plan (y down), so the compass turns with the room's north. Pure,
// worked out from the records; never stored, never printed (a printed plan keeps its own north).

type Records = Readonly<Record<string, SbdRecord>>;

export interface CompassPoint {
  x: number;
  y: number;
}

export interface CompassSun {
  /** The sun's path round the rim, sunrise to sunset; none on a day it never rises. */
  arc: CompassPoint[];
  /** Where the sun is at the time shown. */
  at: CompassPoint & { bearing: number; altitude: number; up: boolean; time: string };
  /** The sun path's own time (`item`), or solar noon for one with none of its own. */
  timeFrom: 'item' | 'solarNoon';
}

export interface CompassModel {
  /** The room's north, degrees clockwise from up the plan; null when the room has none (the compass shows "N?"). */
  north: number | null;
  /** North's direction on the plan, or null. */
  northArrow: CompassPoint | null;
  /** The setup's sun path the compass reads (its first in plan order), or null for none. */
  sunId: string | null;
  /** The sun, when the sun path has everything it draws from; else null. */
  sun: CompassSun | null;
  /** What keeps the sun off: no sun path, or the first thing the sun path lacks; null while drawn or while its zone is on its way. */
  missing: SunMissing | 'noSunPath' | null;
  /** The sun path's zone is being looked up: nothing is said about it yet. */
  pending: boolean;
  /** The sun path's reading, for the words round the compass (the sources). */
  reading: SunReadingOf | null;
}

const memos = new WeakMap<Records, Map<string, CompassModel>>();
let made = 0;

/** How many compass models have been worked out: for tests, which check a hover or a pan works none out again. */
export const compassModelsMade = (): number => made;

/**
 * The compass of a plan's view: a scene's (no setup: north only) or a setup's. Kept per records object, view and the one
 * zone answer it reads, so a render that changes none of them (a hover, a pan) works nothing out again.
 */
export function compassModel(records: Records, view: { sceneId: string; setupId: string | null }, zones: ReadonlyMap<string, string | null>): CompassModel {
  const sunItem = view.setupId === null ? undefined : shownItems(records, view.sceneId, view.setupId).find((item) => isSun(item.fields) && item.level === 'setup');
  const point = sunItem ? sunZonePointOf(records, sunItem.record.id) : null;
  const zone = point === null ? '-' : zones.has(point.id) ? `=${String(zones.get(point.id))}` : '?';
  const key = `${view.sceneId}|${view.setupId ?? ''}|${zone}`;
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  const found = known.get(key);
  if (found) return found;
  const model = workedOut(records, view, zones, sunItem);
  known.set(key, model);
  return model;
}

function workedOut(records: Records, view: { sceneId: string }, zones: ReadonlyMap<string, string | null>, sunItem: ShownItem | undefined): CompassModel {
  made += 1;
  const north = sceneNorth(records, view.sceneId);
  const northArrow = north === null ? null : planVector(0, north);
  if (!sunItem) return { north, northArrow, sunId: null, sun: null, missing: 'noSunPath', pending: false, reading: null };
  const sunId = sunItem.record.id;
  const reading = sunReadingOf(records, sunId, zones);
  if (!reading) return { north, northArrow, sunId: null, sun: null, missing: 'noSunPath', pending: false, reading: null };
  if ('missing' in reading) return { north, northArrow, sunId, sun: null, missing: reading.pending ? null : reading.missing, pending: reading.pending === true, reading };
  const own = ownSunOf(sunItem.record.props).ownTime;
  const shown = own ? reading.at : reading.noon;
  if (!reading.path || !shown) return { north, northArrow, sunId, sun: null, missing: 'noPlace', pending: false, reading };
  const turn = reading.north;
  return {
    north,
    northArrow,
    sunId,
    sun: {
      arc: reading.path.arc.map((p) => planVector(p.bearing, turn)),
      at: { ...planVector(shown.bearing, turn), bearing: shown.bearing, altitude: shown.altitude, up: shown.up, time: shown.time },
      timeFrom: own ? 'item' : 'solarNoon',
    },
    missing: null,
    pending: false,
    reading,
  };
}

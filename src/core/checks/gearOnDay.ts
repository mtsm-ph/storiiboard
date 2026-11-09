import { gearIdsOf } from '../model/gear';
import type { SbdRecord } from '../model/record';
import { dayFrames, projectShootDays } from '../model/shootDay';
import { shotFields } from '../model/storyboard';

// The first consistency check (3.9b, CLAUDE.md "MCP server: Checks"): a shot needs gear that is not on its shoot
// day's gear list. Shared by the app (the Shoot days tile and the Inspector say so) and, from Phase 7, the MCP check
// tool. Only live records count: a frame in the Trash, a day in the Trash, or an item in the Trash isn't a mistake.

type Records = Readonly<Record<string, SbdRecord>>;

export interface GearNotOnDay {
  kind: 'gear-not-on-day';
  shotId: string;
  dayId: string;
  /** The live items the frame needs that the day's list doesn't have, in the frame's order. */
  gearIds: string[];
}

const liveGear = (records: Records, id: string): boolean => {
  const item = records[id];
  return item?.type === 'gear_item' && item.trashedAt === null;
};

/** Worked out once per set of records: the Inspector and the day both read it on every draw. */
const cache = new WeakMap<Records, Map<string, GearNotOnDay[]>>();

/**
 * For each live day, each of its frames still to shoot ("Need to shoot", as the day's totals count) needing live gear
 * its list lacks; days by date, frames in board order. A frame marked Have or Source is shot, so it needs nothing more.
 */
export function gearNotOnDay(records: Records, projectId: string): GearNotOnDay[] {
  let byProject = cache.get(records);
  if (!byProject) {
    byProject = new Map<string, GearNotOnDay[]>();
    cache.set(records, byProject);
  }
  const known = byProject.get(projectId);
  if (known) return known;
  const found = projectShootDays(records, projectId).flatMap((day) => {
    const list = new Set(gearIdsOf(day.record.props));
    return dayFrames(records, projectId, day.record.id).flatMap(({ shot }) => {
      if (shotFields(shot.props).status !== 'need') return [];
      const missing = gearIdsOf(shot.props).filter((id) => liveGear(records, id) && !list.has(id));
      return missing.length > 0 ? [{ kind: 'gear-not-on-day' as const, shotId: shot.id, dayId: day.record.id, gearIds: missing }] : [];
    });
  });
  byProject.set(projectId, found);
  return found;
}

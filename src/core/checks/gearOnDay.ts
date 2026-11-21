import { gearIdsOf } from '../model/gear';
import { gripFields, lightFields, setupPlanOf } from '../model/plan';
import { liveGear } from '../model/planLight';
import type { SbdRecord } from '../model/record';
import { recordsOfType } from '../model/recordIndex';
import { frameSetupId } from '../model/setup';
import { dayFrames, projectShootDays } from '../model/shootDay';
import { shotFields } from '../model/storyboard';

// The first consistency check (3.9b, CLAUDE.md "MCP server: Checks"): a shot needs gear that is not on its shoot
// day's gear list. Shared by the app (the Shoot days tile and the Inspector say so) and, from Phase 7, the MCP check
// tool. Only live records count: a frame in the Trash, a day in the Trash, or an item in the Trash isn't a mistake.
//
// From 6.5 the bird's-eye plans count too: a light, flag or diffusion frame on a setup's own plan that is a gear item
// (`gear_id`) needs it on the list of every day a frame of that setup is shot, exactly as a frame's `gear_ids` do. Such
// a finding is the same kind, with no frame (`shotId` null) and the setup whose plan needs it: "on Setup 2's plan". An
// item, a setup or gear in the Trash doesn't count, as their readers say.

type Records = Readonly<Record<string, SbdRecord>>;

export interface GearNotOnDay {
  kind: 'gear-not-on-day';
  /** The frame that needs it; null when the setup's plan does (`setupId`). */
  shotId: string | null;
  dayId: string;
  /** The live items needed that the day's list doesn't have, in the frame's order (a plan's: back to front). */
  gearIds: string[];
  /** From a plan (6.5): the setup whose plan's items need them, and those items. Absent for a frame's. */
  setupId?: string;
  itemIds?: string[];
}

const liveGearId = (records: Records, id: string): boolean => liveGear(records, id) !== null;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Each plan's live items by the plan they sit in, back to front: worked out once per set of records (6.5 review), not
 * by a scan of every record for each setup on each day.
 */
const itemIndex = new WeakMap<Records, Map<string, SbdRecord[]>>();
function liveItemsIn(records: Records, planId: string): readonly SbdRecord[] {
  let index = itemIndex.get(records);
  if (!index) {
    index = new Map<string, SbdRecord[]>();
    // From the type index every reader shares (7.4 round 3), never a pass of its own over every record.
    for (const r of recordsOfType(records, 'plan_item')) {
      if (r.trashedAt !== null || r.parentId === null) continue;
      const here = index.get(r.parentId);
      if (here) here.push(r);
      else index.set(r.parentId, [r]);
    }
    for (const list of index.values()) list.sort(bySortKey);
    itemIndex.set(records, index);
  }
  return index.get(planId) ?? [];
}

/** Each setup's plan gear, once per set of records: a setup shot on several days is read once. */
const planGearKnown = new WeakMap<Records, Map<string, { itemId: string; gearId: string }[]>>();

/** A setup's own plan's live items that are live gear, back to front, with the gear each is. */
function planGear(records: Records, setupId: string): { itemId: string; gearId: string }[] {
  let known = planGearKnown.get(records);
  if (!known) {
    known = new Map();
    planGearKnown.set(records, known);
  }
  const had = known.get(setupId);
  if (had) return had;
  const plan = setupPlanOf(records, setupId);
  const found = plan
    ? liveItemsIn(records, plan.id).flatMap((r) => {
        const gearId = (lightFields(r.props) ?? gripFields(r.props))?.gearId ?? null;
        return gearId !== null && liveGearId(records, gearId) ? [{ itemId: r.id, gearId }] : [];
      })
    : [];
  known.set(setupId, found);
  return found;
}

/** Worked out once per set of records: the Inspector and the day both read it on every draw. */
const cache = new WeakMap<Records, Map<string, GearNotOnDay[]>>();

/**
 * For each live day, each of its frames still to shoot ("Need to shoot", as the day's totals count) needing live gear
 * its list lacks; then each setup with such a frame that day whose plan needs gear the list lacks. Days by date,
 * frames in board order, setups in the order their first frame comes. A frame marked Have or Source is shot, so it
 * needs nothing more, and neither does its setup's plan on its account.
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
    const toShoot = dayFrames(records, projectId, day.record.id).filter(({ shot }) => shotFields(shot.props).status === 'need');
    const frames = toShoot.flatMap(({ shot }) => {
      const missing = gearIdsOf(shot.props).filter((id) => liveGearId(records, id) && !list.has(id));
      return missing.length > 0 ? [{ kind: 'gear-not-on-day' as const, shotId: shot.id, dayId: day.record.id, gearIds: missing }] : [];
    });
    const setups = [...new Set(toShoot.flatMap(({ shot }) => frameSetupId(records, shot) ?? []))];
    const plans = setups.flatMap((setupId): GearNotOnDay[] => {
      const lacking = planGear(records, setupId).filter((g) => !list.has(g.gearId));
      if (lacking.length === 0) return [];
      return [{ kind: 'gear-not-on-day', shotId: null, dayId: day.record.id, gearIds: [...new Set(lacking.map((g) => g.gearId))], setupId, itemIds: lacking.map((g) => g.itemId) }];
    });
    return [...frames, ...plans];
  });
  byProject.set(projectId, found);
  return found;
}

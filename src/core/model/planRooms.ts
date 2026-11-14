import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import {
  lastKeyUnder,
  planFields,
  plansShown,
  roomTitle,
  sceneRoom,
  sceneRoomId,
  scenesUsingRoom,
  setupPlanOf,
  trashPlanChanges,
  type PlanLevel,
} from './plan';
import type { Props, SbdRecord } from './record';
import { sceneSetups, type Setup } from './setup';
import { sceneFields, sceneLabel } from './storyboard';

// Rooms shared and copied, and a setup's state copied (6.2b, docs/PHASE6_DECISIONS.md 2). A room is drawn once and
// scenes point to it, so a moved wall moves in every scene set there; a scene takes its own copy only when asked. A
// new setup can start from another setup's items, copied once and never linked. An item can sit in one setup only.
// Every edit here is one op group, so one ⌘Z.

type Records = Readonly<Record<string, SbdRecord>>;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** A plan's live items of every kind, the ones this version doesn't show too (a copy keeps them), back to front. */
const liveItemsOf = (records: Records, planId: string): SbdRecord[] =>
  Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.parentId === planId && r.trashedAt === null)
    .sort(bySortKey);

export interface RoomChoice {
  id: string;
  name: string;
  /** Its location's name, '' for none. */
  location: string;
  /** How many live scenes are set in it. */
  scenes: number;
  /** At this scene's location. */
  here: boolean;
}

const locationName = (records: Records, id: string | null): string => {
  const location = id ? records[id] : undefined;
  return location?.type === 'location' && location.trashedAt === null && typeof location.props.name === 'string' ? location.props.name.trim() : '';
};

/**
 * "Use a room already drawn": the project's live rooms other than the scene's own, those at its location first, then
 * the rest, each by name, with its location and how many scenes use it.
 */
export function roomChoices(records: Records, sceneId: string): RoomChoice[] {
  const scene = records[sceneId];
  if (scene?.type !== 'scene') return [];
  const own = sceneRoomId(records, scene);
  const at = sceneFields(scene.props).locationId;
  return Object.values(records)
    .filter((r) => r.type === 'plan' && r.trashedAt === null && r.id !== own && planFields(r.props)?.kind === 'room')
    .map((r) => {
      const fields = planFields(r.props);
      return { record: r, choice: { id: r.id, name: roomTitle(fields), location: locationName(records, fields?.locationId ?? null), scenes: scenesUsingRoom(records, r.id).length, here: at !== null && fields?.locationId === at } };
    })
    .sort((a, b) => Number(b.choice.here) - Number(a.choice.here) || a.choice.name.localeCompare(b.choice.name) || bySortKey(a.record, b.record))
    .map(({ choice }) => choice);
}

/** The scene set in a room already drawn: its `room_id`, one op. The room it had is left as it is. */
export function setRoomChanges(records: Records, sceneId: string, roomId: string): Change[] {
  const scene = records[sceneId];
  const room = records[roomId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null || room?.type !== 'plan' || room.trashedAt !== null || planFields(room.props)?.kind !== 'room') return [];
  if (sceneRoomId(records, scene) === roomId) return [];
  return [{ kind: 'update', id: sceneId, set: { room_id: roomId } }];
}

/** The other live scenes set in this scene's room, by their slate labels in order ("SC 02", "SC 07"). */
export function alsoInRoom(records: Records, sceneId: string): string[] {
  const roomId = sceneRoomId(records, records[sceneId]);
  if (roomId === null) return [];
  return scenesUsingRoom(records, roomId)
    .filter((s) => s.id !== sceneId)
    .map((s) => sceneFields(s.props).number)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(sceneLabel);
}

/**
 * A plan's live items copied into another, after its last, each a new record with every prop it had; a door or window
 * whose wall is copied too points to the copy, one whose wall isn't keeps its wall. Pure but for the new ids.
 */
export function copyItemsChanges(records: Records, fromPlanId: string, toPlanId: string, after: string | null = lastKeyUnder(records, toPlanId, 'plan_item')): Change[] {
  const items = liveItemsOf(records, fromPlanId);
  const ids = new Map(items.map((r) => [r.id, crypto.randomUUID()]));
  let previous = after;
  return items.map((r): Change => {
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    const props: Props = { ...r.props };
    const wall = typeof props.wall_id === 'string' ? ids.get(props.wall_id) : undefined;
    if (wall) props.wall_id = wall;
    return { kind: 'create', record: { id: ids.get(r.id) ?? crypto.randomUUID(), type: 'plan_item', parentId: toPlanId, sortKey, props } };
  });
}

/**
 * "Make a separate copy" (6.2b): only for a room another live scene uses too. The room and every live item in it
 * copied, its openings pointing to the copied walls, the copy named "<name> (SC 04)", and this scene pointed at it,
 * all in one group; the other scenes keep the room as it was.
 */
export function separateCopyChanges(records: Records, projectId: string, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  const scene = records[sceneId];
  const room = sceneRoom(records, sceneId);
  if (scene?.type !== 'scene' || !room || alsoInRoom(records, sceneId).length === 0) return [];
  const name = `${roomTitle(planFields(room.props))} (${sceneLabel(sceneFields(scene.props).number)})`;
  return [
    { kind: 'create', record: { id, type: 'plan', parentId: projectId, sortKey: keyBetween(lastKeyUnder(records, projectId, 'plan'), null), props: { ...room.props, name } } },
    ...copyItemsChanges(records, room.id, id, null),
    { kind: 'update', id: sceneId, set: { room_id: id } },
  ];
}

/** "Delete room": only when no other live scene uses it. The room and its items to the Trash; the scene then has none. */
export function deleteRoomChanges(records: Records, sceneId: string): Change[] {
  const room = sceneRoom(records, sceneId);
  if (!room || alsoInRoom(records, sceneId).length > 0) return [];
  return trashPlanChanges(records, room.id);
}

/** Whether a setup has items of its own (any kind, so a later version's are counted too). */
export function setupHasItems(records: Records, setupId: string): boolean {
  const plan = setupPlanOf(records, setupId);
  return plan !== null && liveItemsOf(records, plan.id).length > 0;
}

/** "Start from another setup": the scene's other live setups that have items of their own. */
export function setupCopySources(records: Records, sceneId: string, setupId: string): Setup[] {
  return sceneSetups(records, sceneId).filter((s) => s.record.id !== setupId && setupHasItems(records, s.record.id));
}

/**
 * A setup started from another's state (6.2b): its items copied into this setup's plan (made now if it has none), one
 * group. Only while this setup has no items of its own; nothing links the two afterwards.
 */
export function copySetupChanges(records: Records, fromSetupId: string, toSetupId: string, planId: string = crypto.randomUUID()): Change[] {
  const to = records[toSetupId];
  const from = setupPlanOf(records, fromSetupId);
  if (to?.type !== 'setup' || to.trashedAt !== null || !from || fromSetupId === toSetupId || setupHasItems(records, toSetupId)) return [];
  const existing = setupPlanOf(records, toSetupId);
  if (existing) return copyItemsChanges(records, from.id, existing.id);
  return [
    { kind: 'create', record: { id: planId, type: 'plan', parentId: toSetupId, sortKey: keyBetween(lastKeyUnder(records, toSetupId, 'plan'), null), props: { kind: 'setup', name: '' } } },
    ...copyItemsChanges(records, from.id, planId, null),
  ];
}

/** The level an item of a kind belongs to (decision 2): the room's for the set, the scene's for blocking, else the setup's. */
export function kindHome(kind: unknown): PlanLevel {
  if (kind === 'mark' || kind === 'path') return 'blocking';
  if (kind === 'wall' || kind === 'door' || kind === 'window' || kind === 'set_piece' || kind === 'underlay' || kind === 'north') return 'room';
  return 'setup';
}

/**
 * "This setup only" (6.2b), on: the items moved (`move` ops) from the room or the scene's blocking into the setup's
 * plan (made now if it has none), so other setups and scenes no longer show them; off: back to the level each kind
 * belongs to (the scene's blocking made now if it has none). A wall takes the doors and windows in it that sit where it
 * does. Each lands at the front of its new plan, in the order it was shown. One group; nothing for items already there.
 */
export function setupOnlyChanges(records: Records, sceneId: string, setupId: string, ids: readonly string[], on: boolean, newPlanId: string = crypto.randomUUID()): Change[] {
  const plans = plansShown(records, sceneId, setupId);
  const setup = records[setupId];
  if (setup?.type !== 'setup' || setup.trashedAt !== null || setup.parentId !== sceneId) return [];
  const levelOf = (planId: string | null): PlanLevel | null =>
    planId === null ? null : planId === plans.room?.id ? 'room' : planId === plans.blocking?.id ? 'blocking' : planId === plans.setup?.id ? 'setup' : null;
  const picked = new Set(ids);
  // A wall's openings that sit with it go where it goes.
  for (const id of ids) {
    const wall = records[id];
    if (wall?.type !== 'plan_item' || wall.props.kind !== 'wall') continue;
    for (const r of Object.values(records)) if (r.type === 'plan_item' && r.trashedAt === null && r.props.wall_id === id && r.parentId === wall.parentId) picked.add(r.id);
  }
  const order: PlanLevel[] = ['room', 'blocking', 'setup'];
  const moving = [...picked]
    .flatMap((id) => {
      const r = records[id];
      const level = r?.type === 'plan_item' && r.trashedAt === null ? levelOf(r.parentId) : null;
      if (!r || level === null || (on ? level === 'setup' : level !== 'setup')) return [];
      return [{ record: r, level }];
    })
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || bySortKey(a.record, b.record));
  if (moving.length === 0) return [];
  const changes: Change[] = [];
  const created = new Map<PlanLevel, string>();
  const target = (level: PlanLevel): string | null => {
    const have = plans[level]?.id ?? created.get(level);
    if (have) return have;
    if (level === 'room') return null;
    const parentId = level === 'setup' ? setupId : sceneId;
    const id = level === 'setup' ? newPlanId : crypto.randomUUID();
    changes.push({ kind: 'create', record: { id, type: 'plan', parentId, sortKey: keyBetween(lastKeyUnder(records, parentId, 'plan'), null), props: { kind: level, name: '' } } });
    created.set(level, id);
    return id;
  };
  const lastKeys = new Map<string, string | null>();
  for (const { record } of moving) {
    const level = on ? 'setup' : kindHome(record.props.kind);
    if (level === 'setup' && !on) continue;
    const planId = target(level);
    if (planId === null) continue;
    const previous = lastKeys.has(planId) ? (lastKeys.get(planId) ?? null) : lastKeyUnder(records, planId, 'plan_item');
    const sortKey = keyBetween(previous, null);
    lastKeys.set(planId, sortKey);
    changes.push({ kind: 'move', id: record.id, parentId: planId, sortKey });
  }
  return changes.some((c) => c.kind === 'move') ? changes : [];
}

/** The level an item sits at in a view, or null when the view doesn't show its plan. */
export function itemLevel(records: Records, sceneId: string, setupId: string | null, id: string): PlanLevel | null {
  const plans = plansShown(records, sceneId, setupId);
  const parent = records[id]?.parentId ?? null;
  if (parent === null) return null;
  return parent === plans.room?.id ? 'room' : parent === plans.blocking?.id ? 'blocking' : parent === plans.setup?.id ? 'setup' : null;
}

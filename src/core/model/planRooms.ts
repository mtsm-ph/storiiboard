import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import {
  iconGroup,
  lastKeyUnder,
  newRoomChanges,
  openingFields,
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
import { isSceneNumber, sceneFields, sceneLabel, sceneNumberLabel } from './storyboard';

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
  return leaveRoomFor(records, sceneId, [{ kind: 'update', id: sceneId, set: { room_id: roomId } }]);
}

/** "New room" from the chooser (6.2b): a new room for the scene, leaving the one it had as it is but for its own openings in it. */
export function replaceRoomChanges(records: Records, projectId: string, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  return leaveRoomFor(records, sceneId, newRoomChanges(records, projectId, sceneId, id));
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
 * A plan's live items copied into another, after its last, each a new record with every prop it had and `copied_from`
 * (the item it was copied from: History tells a copy from items put in by hand by it); a door or window whose wall is
 * copied too points to the copy, one whose wall isn't keeps its wall. Pure but for the new ids, which come back too.
 */
function copyItems(records: Records, fromPlanId: string, toPlanId: string, after: string | null): { changes: Change[]; ids: Map<string, string> } {
  const items = liveItemsOf(records, fromPlanId);
  const ids = new Map(items.map((r) => [r.id, crypto.randomUUID()]));
  let previous = after;
  const changes = items.map((r): Change => {
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    const props: Props = { ...r.props, copied_from: r.id };
    const wall = typeof props.wall_id === 'string' ? ids.get(props.wall_id) : undefined;
    if (wall) props.wall_id = wall;
    return { kind: 'create', record: { id: ids.get(r.id) ?? crypto.randomUUID(), type: 'plan_item', parentId: toPlanId, sortKey, props } };
  });
  return { changes, ids };
}

/** A plan's live items copied into another, after its last (see copyItems). */
export function copyItemsChanges(records: Records, fromPlanId: string, toPlanId: string, after: string | null = lastKeyUnder(records, toPlanId, 'plan_item')): Change[] {
  return copyItems(records, fromPlanId, toPlanId, after).changes;
}

/**
 * The plans only this scene's views show besides its room: its blocking, and each setup's own, the setups and plans in
 * the Trash too (6.2b review: a setup restored later shows what it had, pointing at the walls the scene shows then).
 */
function scenesOwnPlans(records: Records, sceneId: string): Set<string> {
  const setups = new Set(Object.values(records).flatMap((r) => (r.type === 'setup' && r.parentId === sceneId ? [r.id] : [])));
  return new Set(
    Object.values(records).flatMap((r) => {
      if (r.type !== 'plan' || r.parentId === null) return [];
      const kind = planFields(r.props)?.kind;
      return (kind === 'blocking' && r.parentId === sceneId) || (kind === 'setup' && setups.has(r.parentId)) ? [r.id] : [];
    }),
  );
}

/**
 * Every item in this scene's own plans (its blocking, a setup's only, the Trash's too) that carries a `wall_id` naming
 * one of the room's walls: its doors and windows, and an item of a kind this version doesn't know that sits in a wall.
 */
function scenesWallItemsIn(records: Records, sceneId: string, roomId: string): SbdRecord[] {
  const own = scenesOwnPlans(records, sceneId);
  return Object.values(records).filter((r) => {
    if (r.type !== 'plan_item' || r.parentId === null || !own.has(r.parentId) || typeof r.props.wall_id !== 'string') return false;
    return records[r.props.wall_id]?.parentId === roomId;
  });
}

/**
 * The doors and windows this scene put in its room's walls at its own level (its blocking, a setup's only): they show
 * only while the scene is in that room. Live ones, in walls that sit in the room, a trashed setup's too.
 */
export function scenesOpeningsIn(records: Records, sceneId: string, roomId: string): SbdRecord[] {
  return scenesWallItemsIn(records, sceneId, roomId).filter((r) => r.trashedAt === null && openingFields(r.props) !== null);
}

/**
 * A scene leaving its room ("Use another room…", "New room", "Delete room"; 6.2b review): the items it put in that
 * room's walls at its own level go to the Trash in the same group, since no view would show them any more and they
 * would still hold those walls in every other scene. Undo brings them back with the room. Those in the Trash already
 * stay as they are.
 */
function leavingRoomChanges(records: Records, sceneId: string): Change[] {
  const roomId = sceneRoomId(records, records[sceneId]);
  if (roomId === null) return [];
  return scenesWallItemsIn(records, sceneId, roomId)
    .filter((r) => r.trashedAt === null)
    .map((r): Change => ({ kind: 'trash', id: r.id }));
}

/** The scene set in a room already drawn, or a new one; leaving its room as it is but for its own openings in it. */
export function leaveRoomFor(records: Records, sceneId: string, changes: readonly Change[]): Change[] {
  return changes.length === 0 ? [] : [...leavingRoomChanges(records, sceneId), ...changes];
}

/**
 * What a copy of a room is called (6.2b review), never in the screen's language: an unnamed room's copy stays unnamed
 * (the screen names it), a named one's is "<name> (SC 04)", an earlier copy's " (SC 02)" replaced, never stacked.
 */
export function copyName(name: string, sceneNumber: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  // "SC" as the slate reads in English whatever the screen shows; an older copy's Spanish "ESC" is replaced too. Only a
  // suffix that is a scene's label exactly as sceneNumberLabel writes it: "Stage (SC 1 pickups)" is a name, kept whole.
  const suffix = /\s+\((?:SC|ESC) ([^()]+)\)$/.exec(trimmed);
  const label = suffix?.[1];
  const ours = label !== undefined && isSceneNumber(label) && sceneNumberLabel(label) === label;
  return `${ours && suffix ? trimmed.slice(0, suffix.index) : trimmed} (SC ${sceneNumberLabel(sceneNumber)})`;
}

/**
 * "Make a separate copy" (6.2b): only for a room another live scene uses too. The room and every live item in it
 * copied, its openings pointing to the copied walls, the copy named "<name> (SC 04)", and this scene pointed at it,
 * all in one group; the other scenes keep the room as it was. The doors and windows this scene put in the room's walls
 * at its own level (its blocking, a setup's only) are pointed at the copied walls in the same group, so they stay in
 * this scene's views and stop holding the shared room's walls.
 */
export function separateCopyChanges(records: Records, projectId: string, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  const scene = records[sceneId];
  const room = sceneRoom(records, sceneId);
  if (scene?.type !== 'scene' || !room || alsoInRoom(records, sceneId).length === 0) return [];
  const props: Props = { ...room.props };
  const name = copyName(typeof room.props.name === 'string' ? room.props.name : '', sceneFields(scene.props).number);
  if (name === '') delete props.name;
  else props.name = name;
  const copied = copyItems(records, room.id, id, null);
  // Every item of this scene's own in a copied wall, the Trash's too (a restore then points at the wall this scene shows).
  const repointed = scenesWallItemsIn(records, sceneId, room.id).flatMap((r): Change[] => {
    const wall = typeof r.props.wall_id === 'string' ? copied.ids.get(r.props.wall_id) : undefined;
    return wall ? [{ kind: 'update', id: r.id, set: { wall_id: wall } }] : [];
  });
  return [
    { kind: 'create', record: { id, type: 'plan', parentId: projectId, sortKey: keyBetween(lastKeyUnder(records, projectId, 'plan'), null), props } },
    ...copied.changes,
    ...repointed,
    { kind: 'update', id: sceneId, set: { room_id: id } },
  ];
}

/**
 * "Delete room": only when no other live scene uses it. The room and its items to the Trash, with the doors and windows
 * this scene put in its walls at its own level; the scene then has none.
 */
export function deleteRoomChanges(records: Records, sceneId: string): Change[] {
  const room = sceneRoom(records, sceneId);
  if (!room || alsoInRoom(records, sceneId).length > 0) return [];
  return [...trashPlanChanges(records, room.id), ...leavingRoomChanges(records, sceneId)];
}

/** A room no live scene uses, deleted from the chooser (6.2b review): it and its items to the Trash, one group. */
export function deleteUnusedRoomChanges(records: Records, roomId: string): Change[] {
  const room = records[roomId];
  if (room?.type !== 'plan' || planFields(room.props)?.kind !== 'room' || scenesUsingRoom(records, roomId).length > 0) return [];
  return trashPlanChanges(records, roomId);
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
  if (kind === 'wall' || kind === 'door' || kind === 'window' || kind === 'underlay' || kind === 'north') return 'room';
  return 'setup';
}

/**
 * The level a library icon belongs to (6.3, decision 2), by its group: a set piece (set-art) the room's, so every scene
 * and setup in the room shows it; a cast icon the scene's blocking; every other the setup's.
 */
export function iconHome(icon: string): PlanLevel {
  const group = iconGroup(icon);
  if (group === 'set-art') return 'room';
  if (group === 'cast') return 'blocking';
  return 'setup';
}

/** The level an item belongs to: an icon's by its group, any other's by its kind. */
export const itemHome = (props: Props): PlanLevel => (props.kind === 'icon' && typeof props.icon === 'string' ? iconHome(props.icon) : kindHome(props.kind));

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
  // A wall other places' doors sit in stays where they all see it (setupOnlyHeld says so).
  if (on && setupOnlyOthers(records, sceneId, setupId, ids).length > 0) return [];
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
      // A door or window in a wall that is this setup's only stays with its wall (it would show nowhere else).
      if (!on && openingOnSetupWall(records, plans.setup?.id ?? null, r) && !picked.has(openingFields(r.props)?.wallId ?? '')) return [];
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
    const level = on ? 'setup' : itemHome(record.props);
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

/** Whether a door or window sits in a wall that is in this setup's own plan. */
function openingOnSetupWall(records: Records, setupPlanId: string | null, r: SbdRecord): boolean {
  const fields = openingFields(r.props);
  return setupPlanId !== null && fields !== null && records[fields.wallId]?.parentId === setupPlanId;
}

/** Where a plan's items show (6.2b review): a scene's slate label, with a setup's number when it is this scene's setup's. */
export interface PlanPlace {
  scene: string;
  /** This scene's live setup's number, or null for the scene as a whole (or another scene's setup). */
  setup: number | null;
}

/**
 * The places whose own doors and windows sit in these walls (6.2b review): other scenes' (by scene), this scene's
 * blocking (the scene) and its other setups' (by setup), never this setup's or the wall's own plan's, nor the picked.
 * Made this setup's only, the walls would take those doors out of every other view, so the switch is held.
 */
export function setupOnlyOthers(records: Records, sceneId: string, setupId: string, ids: readonly string[]): PlanPlace[] {
  const plans = plansShown(records, sceneId, setupId);
  const picked = new Set(ids);
  const places = new Map<string, PlanPlace>();
  const numbers = new Map(sceneSetups(records, sceneId).map((s) => [s.record.id, s.number]));
  for (const id of ids) {
    const wall = records[id];
    if (wall?.type !== 'plan_item' || wall.trashedAt !== null || wall.props.kind !== 'wall' || wall.parentId === null || wall.parentId === plans.setup?.id) continue;
    for (const r of Object.values(records)) {
      if (r.type !== 'plan_item' || r.trashedAt !== null || r.props.wall_id !== id || picked.has(r.id) || r.parentId === null) continue;
      if (r.parentId === wall.parentId || r.parentId === plans.setup?.id) continue;
      const plan = records[r.parentId];
      const kind = plan ? planFields(plan.props)?.kind : undefined;
      const holder = plan?.parentId ? records[plan.parentId] : undefined;
      const scene = kind === 'setup' && holder?.parentId ? records[holder.parentId] : holder;
      if (scene?.type !== 'scene') continue;
      const setup = kind === 'setup' && scene.id === sceneId && holder ? (numbers.get(holder.id) ?? null) : null;
      const label = sceneLabel(sceneFields(scene.props).number);
      places.set(`${label}:${String(setup)}`, { scene: label, setup });
    }
  }
  return [...places.values()].sort((a, b) => a.scene.localeCompare(b.scene, undefined, { numeric: true }) || (a.setup ?? 0) - (b.setup ?? 0));
}

/**
 * Why "This setup only" can't be turned on or off for these items in this view, or null when it can (6.2b review): on,
 * not for a wall other places' doors and windows sit in; off, not with no room to go back to, nor for a door or window
 * alone whose wall is this setup's only.
 */
export function setupOnlyHeld(records: Records, sceneId: string, setupId: string, ids: readonly string[]): 'noRoom' | 'wallOnly' | 'others' | null {
  const plans = plansShown(records, sceneId, setupId);
  const picked = new Set(ids);
  const items = ids.flatMap((id) => (records[id] ? [records[id]] : []));
  if (!items.every((r) => r.parentId !== null && r.parentId === plans.setup?.id)) return setupOnlyOthers(records, sceneId, setupId, ids).length > 0 ? 'others' : null;
  if (items.some((r) => openingOnSetupWall(records, plans.setup?.id ?? null, r) && !picked.has(openingFields(r.props)?.wallId ?? ''))) return 'wallOnly';
  if (plans.room === null && items.some((r) => itemHome(r.props) === 'room')) return 'noRoom';
  return null;
}

/** The other live scenes that stop showing these items when they are made this setup's only: those sharing the room. */
export function scenesLosing(records: Records, sceneId: string, setupId: string, ids: readonly string[]): string[] {
  const plans = plansShown(records, sceneId, setupId);
  if (!plans.room || !ids.some((id) => records[id]?.parentId === plans.room?.id)) return [];
  return alsoInRoom(records, sceneId);
}

/** The level an item sits at in a view, or null when the view doesn't show its plan. */
export function itemLevel(records: Records, sceneId: string, setupId: string | null, id: string): PlanLevel | null {
  const plans = plansShown(records, sceneId, setupId);
  const parent = records[id]?.parentId ?? null;
  if (parent === null) return null;
  return parent === plans.room?.id ? 'room' : parent === plans.blocking?.id ? 'blocking' : parent === plans.setup?.id ? 'setup' : null;
}

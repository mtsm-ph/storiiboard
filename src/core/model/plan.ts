import { t } from '../i18n';
import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import type { JsonValue, Props, SbdRecord } from './record';
import { sceneFields, sceneLabel } from './storyboard';

// The bird's-eye plan's records (6.2a, docs/PHASE6_DECISIONS.md 1 and 2; docs/SBD_FORMAT.md, Schema v14). Three
// levels, each a `plan` record made the first time something needs it, never ahead, and an item's level is the plan it
// sits in: the room (`kind: 'room'`, under the project, pointed to by scenes' `room_id`, so a set in three scenes is one
// room drawn once), the scene's blocking (`kind: 'blocking'`, under its scene) and a setup's own (`kind: 'setup'`, under
// its setup). A setup's plan shows all three, live, back to front: the room, then the blocking, then the setup's own.
//
// Everything here is in metres and degrees, whatever the screen shows. A `plan_item`'s geometry uses `board_item`'s
// names (x, y, width, height, rotation; order by `sort_key`). A wall is one straight segment stored as a rotated
// rectangle: `width` its length, `height` its thickness, `rotation` its direction from its start to its end, so the
// canvas moves, turns and resizes it as it does any box. No `points` for walls.

type Records = Readonly<Record<string, SbdRecord>>;

export const PLAN_KINDS = ['room', 'blocking', 'setup'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export type PlanLevel = PlanKind;

/**
 * Every kind a later milestone writes (SBD_FORMAT.md); this version shows walls, doors, windows and icons and keeps the
 * rest unseen. A set piece is an `icon` whose icon is in the set-art group (6.3), never a kind of its own.
 */
export const PLAN_ITEM_KINDS = ['wall', 'door', 'window', 'icon', 'camera', 'light', 'flag', 'diffusion', 'mark', 'path', 'north', 'sun', 'underlay', 'measure'] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
/** The kinds this version draws: walls (6.2a), the doors and windows in them (6.2b), and the library's icons (6.3). */
export type ShownKind = 'wall' | OpeningKind | 'icon';

/**
 * The plan's departments, the layers of 6.8 (decision 10), as the kit's icon folders name them. An icon's layer is its
 * group, the first part of its id ("set-art/sofa"): worked out, never stored.
 */
export const PLAN_LAYERS = ['camera', 'lighting', 'grip', 'set-art', 'cast', 'sound', 'production'] as const;
export type PlanLayer = (typeof PLAN_LAYERS)[number];

/** An icon id's group ("set-art" for "set-art/sofa"), or null for an id outside every group. */
export function iconGroup(icon: string): PlanLayer | null {
  const group = icon.split('/')[0] ?? '';
  return PLAN_LAYERS.find((layer) => layer === group) ?? null;
}
const SHOWN_KINDS: readonly string[] = ['wall'];
export const OPENING_KINDS = ['door', 'window'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
/** What a new door or window is: a standard interior door's width, a common window's (6.2b). */
export const OPENING_WIDTH: Readonly<Record<OpeningKind, number>> = { door: 0.9, window: 1.2 };

/** A wall's thickness when none is given: a typical interior wall. */
export const WALL_THICKNESS = 0.1;
/** The least a length or thickness reads as: a centimetre. */
export const MIN_PLAN_SIZE = 0.01;

const num = (value: JsonValue | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');
const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

export interface PlanFields {
  kind: PlanKind;
  /** Typed by hand; a room starts named after its scene's location, else the scene. */
  name: string;
  /** A room's `location`, or null. */
  locationId: string | null;
}

/** A plan's props, or null for a kind this version doesn't know. */
export function planFields(props: Props): PlanFields | null {
  const kind = PLAN_KINDS.find((k) => k === props.kind);
  if (!kind) return null;
  const locationId = text(props.location_id);
  return { kind, name: text(props.name).trim(), locationId: locationId === '' ? null : locationId };
}

/**
 * Degrees, 0 up to but not including 360, to a millionth: a hundredth of a degree would put a 20 m wall's far end
 * 3.5 mm off, past the 1 mm that joins two walls' ends, and its corner would no longer mitre.
 */
export const normalDegrees = (degrees: number): number => {
  const d = Math.round((((degrees % 360) + 360) % 360) * 1e6) / 1e6;
  return d >= 360 ? 0 : d;
};

/** A typed rotation: 90, 90°, -45, −45 (a typographic minus), .5, 22,5; null when it isn't one. */
export function parseDegrees(typed: string): number | null {
  const text = typed.trim().replace(/°$/, '').trim().replace(',', '.').replace(/^−/, '-');
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(text) ? normalDegrees(Number(text)) : null;
}

/** A wall's fields (6.2a). */
export interface PlanItemFields {
  kind: 'wall';
  /** The top left corner before rotation, metres. */
  x: number;
  y: number;
  /** A wall's length, metres. */
  width: number;
  /** A wall's thickness, metres. */
  height: number;
  /** Degrees clockwise round the centre: a wall's direction from its start to its end. */
  rotation: number;
  /** A wall's real height, metres, when set: kept, not drawn (decision 11). */
  heightM: number | null;
  name: string;
}

/** A wall's props, or null when the item isn't a wall this version can read (doors and windows: `openingFields`). */
export function planItemFields(props: Props): PlanItemFields | null {
  const kind = typeof props.kind === 'string' && SHOWN_KINDS.includes(props.kind) ? 'wall' : null;
  if (kind === null) return null;
  const x = num(props.x);
  const y = num(props.y);
  const width = num(props.width);
  if (x === null || y === null || width === null || width <= 0) return null;
  const height = num(props.height);
  const heightM = num(props.height_m);
  return {
    kind,
    x,
    y,
    width: Math.max(MIN_PLAN_SIZE, width),
    height: height !== null && height > 0 ? Math.max(MIN_PLAN_SIZE, height) : WALL_THICKNESS,
    rotation: normalDegrees(num(props.rotation) ?? 0),
    heightM: heightM !== null && heightM > 0 ? heightM : null,
    name: text(props.name).trim(),
  };
}

export type Hinge = 'start' | 'end';
export type Swing = 'left' | 'right';

/**
 * A door's or window's fields (6.2b). It has no place of its own: it sits in its wall (`wall_id`) with its middle
 * `along_m` from the wall's start, `width_m` wide, so it moves, turns and stretches with the wall. A door's `hinge` is
 * the end of the opening its leaf turns on (the one nearer the wall's start, or its end) and `swing` the side of the
 * wall it opens to, seen walking from the wall's start to its end.
 */
export interface OpeningFields {
  kind: OpeningKind;
  wallId: string;
  /** Metres from the wall's start to the opening's middle. */
  along: number;
  /** Metres. */
  width: number;
  hinge: Hinge;
  swing: Swing;
  /** Metres, when set: kept, not drawn (decision 11). */
  heightM: number | null;
  name: string;
}

/** A door's or window's props, or null when it isn't one that can be read (no wall, no place along it). */
export function openingFields(props: Props): OpeningFields | null {
  const kind = OPENING_KINDS.find((k) => k === props.kind);
  if (!kind) return null;
  const wallId = text(props.wall_id);
  const along = num(props.along_m);
  if (wallId === '' || along === null || along < 0) return null;
  const width = num(props.width_m);
  const heightM = num(props.height_m);
  return {
    kind,
    wallId,
    along,
    width: width !== null && width > 0 ? Math.max(MIN_PLAN_SIZE, width) : OPENING_WIDTH[kind],
    hinge: props.hinge === 'end' ? 'end' : 'start',
    swing: props.swing === 'right' ? 'right' : 'left',
    heightM: heightM !== null && heightM > 0 ? heightM : null,
    name: text(props.name).trim(),
  };
}

/**
 * A library icon on a plan (6.3): the kit's icon id (`set-art/sofa`), and a box in metres as a wall's, `width` across
 * and `height` its depth, turned round its middle. Its real height (`height_m`) is kept, not drawn (decision 11). An id
 * this version doesn't know is still an icon: drawn as a plain outline, its record untouched.
 */
export interface IconFields {
  kind: 'icon';
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  heightM: number | null;
  name: string;
}

/** An icon's props, or null when it isn't one that can be read (no icon id, no place or size). */
export function iconFields(props: Props): IconFields | null {
  if (props.kind !== 'icon') return null;
  const icon = text(props.icon).trim();
  const x = num(props.x);
  const y = num(props.y);
  const width = num(props.width);
  const height = num(props.height);
  if (icon === '' || x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
  const heightM = num(props.height_m);
  return {
    kind: 'icon',
    icon,
    x,
    y,
    width: Math.max(MIN_PLAN_SIZE, width),
    height: Math.max(MIN_PLAN_SIZE, height),
    rotation: normalDegrees(num(props.rotation) ?? 0),
    heightM: heightM !== null && heightM > 0 ? heightM : null,
    name: text(props.name).trim(),
  };
}

/** Any item this version shows: a wall, a door, a window or an icon. */
export type ShownFields = PlanItemFields | OpeningFields | IconFields;

/** An item's fields, whichever kind it is, or null for one this version keeps unseen. */
export const shownFields = (props: Props): ShownFields | null => planItemFields(props) ?? openingFields(props) ?? iconFields(props);

export const isOpening = (fields: ShownFields): fields is OpeningFields => fields.kind === 'door' || fields.kind === 'window';
export const isIcon = (fields: ShownFields): fields is IconFields => fields.kind === 'icon';
export const isWallFields = (fields: ShownFields): fields is PlanItemFields => fields.kind === 'wall';

/**
 * An item's layer (6.8, decision 10), worked out from what it is, never stored: an icon's group; a wall, door or window
 * the set's (art). Null for a kind this version doesn't show.
 */
export function planItemLayer(props: Props): PlanLayer | null {
  if (props.kind === 'icon') return typeof props.icon === 'string' ? iconGroup(props.icon) : null;
  if (props.kind === 'wall' || props.kind === 'door' || props.kind === 'window') return 'set-art';
  return null;
}

const livePlan = (records: Records, id: unknown, kind: PlanKind): SbdRecord | null => {
  if (typeof id !== 'string' || id === '') return null;
  const plan = records[id];
  return plan?.type === 'plan' && plan.trashedAt === null && planFields(plan.props)?.kind === kind ? plan : null;
};

/**
 * The one reader of a scene's `room_id` (as `frameSetupId` is of a frame's setup): the id of a live room, else null.
 * A room in the Trash, a plan that isn't a room, or an id that names nothing all read as no room; the scene keeps the
 * id, so a restore brings the room back to it.
 */
export function sceneRoomId(records: Records, scene: SbdRecord | undefined): string | null {
  if (scene?.type !== 'scene') return null;
  return livePlan(records, scene.props.room_id, 'room')?.id ?? null;
}

/** The scene's room, or null. */
export const sceneRoom = (records: Records, sceneId: string): SbdRecord | null => {
  const id = sceneRoomId(records, records[sceneId]);
  return id === null ? null : (records[id] ?? null);
};

/** The first live plan of a kind under a parent, or null. */
function planUnder(records: Records, parentId: string, kind: PlanKind): SbdRecord | null {
  return (
    Object.values(records)
      .filter((r) => r.type === 'plan' && r.parentId === parentId && r.trashedAt === null && planFields(r.props)?.kind === kind)
      .sort(bySortKey)[0] ?? null
  );
}

export const blockingPlanOf = (records: Records, sceneId: string): SbdRecord | null => planUnder(records, sceneId, 'blocking');
export const setupPlanOf = (records: Records, setupId: string): SbdRecord | null => planUnder(records, setupId, 'setup');

/** The live setup, when it is one of this scene's. */
function sceneSetup(records: Records, sceneId: string, setupId: string | null): SbdRecord | null {
  if (setupId === null) return null;
  const setup = records[setupId];
  return setup?.type === 'setup' && setup.trashedAt === null && setup.parentId === sceneId ? setup : null;
}

export interface ShownPlans {
  room: SbdRecord | null;
  blocking: SbdRecord | null;
  setup: SbdRecord | null;
}

/** The plans a setup's view combines (a scene with no setup: its room and blocking). */
export function plansShown(records: Records, sceneId: string, setupId: string | null): ShownPlans {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return { room: null, blocking: null, setup: null };
  const setup = sceneSetup(records, sceneId, setupId);
  return { room: sceneRoom(records, sceneId), blocking: blockingPlanOf(records, sceneId), setup: setup ? setupPlanOf(records, setup.id) : null };
}

/** A plan's items, back to front: live ones of kinds this version shows (with `withTrashed`, those in the Trash too). */
export function itemsOfPlan(records: Records, planId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.parentId === planId && (withTrashed || r.trashedAt === null) && shownFields(r.props) !== null)
    .sort(bySortKey);
}

export interface ShownItem {
  record: SbdRecord;
  fields: ShownFields;
  level: PlanLevel;
}

/**
 * What a setup's plan shows, back to front: the scene's room's items, then its blocking's, then the setup's own. A door
 * or window shows only while its wall is one the view shows, wherever either sits (a door made this setup's only, in a
 * wall of the room).
 */
export function shownItems(records: Records, sceneId: string, setupId: string | null): ShownItem[] {
  const plans = plansShown(records, sceneId, setupId);
  const all = (['room', 'blocking', 'setup'] as const).flatMap((level) => {
    const plan = plans[level];
    if (!plan) return [];
    return itemsOfPlan(records, plan.id).flatMap((record) => {
      const fields = shownFields(record.props);
      return fields ? [{ record, fields, level }] : [];
    });
  });
  const walls = new Map(all.flatMap((item) => (item.fields.kind === 'wall' ? [[item.record.id, item.fields.width] as const] : [])));
  return all.flatMap((item): ShownItem[] => {
    if (!isOpening(item.fields)) return [item];
    const length = walls.get(item.fields.wallId);
    return length === undefined ? [] : [{ ...item, fields: keptInWall(item.fields, length) }];
  });
}

/**
 * An opening as it reads in a wall of this length (6.2b review): inside it, half its width from each end, no wider than
 * the wall. No edit shortens a wall past any of its openings (6.2b second review), but one may arrive so otherwise (an
 * import, a History put-back); that opening is read inside the wall, never rewritten and never dropped.
 */
export function keptInWall(o: OpeningFields, wallLength: number): OpeningFields {
  const width = Math.min(o.width, wallLength);
  const along = Math.min(Math.max(o.along, width / 2), wallLength - width / 2);
  return width === o.width && along === o.along ? o : { ...o, width, along };
}

/** The live openings in a wall, wherever they sit. */
export function openingsOf(records: Records, wallId: string): { record: SbdRecord; fields: OpeningFields }[] {
  return Object.values(records).flatMap((record) => {
    if (record.type !== 'plan_item' || record.trashedAt !== null) return [];
    const fields = openingFields(record.props);
    return fields?.wallId === wallId ? [{ record, fields }] : [];
  });
}

/** A plan view: the scene, and the setup when one is picked. */
export interface PlanViewOf {
  sceneId: string;
  setupId: string | null;
}

/**
 * The openings that share a view with a wall (6.2b review): those in the wall's own plan and in the plans the view shows
 * (the scene's room, its blocking, the setup's own), read inside the wall. Where a door goes (put in, nudged, dragged,
 * typed) sees these, exactly what the person sees, never a door that only another scene's setup shows. With no view,
 * every plan's: the wall's least length counts those (6.2b second review), so no door loses its place.
 */
export function openingsInView(records: Records, wallId: string, view?: PlanViewOf | null): { record: SbdRecord; fields: OpeningFields }[] {
  const all = openingsOf(records, wallId);
  const wall = records[wallId];
  const length = wall?.type === 'plan_item' ? planItemFields(wall.props)?.width : undefined;
  const inside = (list: typeof all) => (length === undefined ? list : list.map((o) => ({ record: o.record, fields: keptInWall(o.fields, length) })));
  if (!view) return inside(all);
  const plans = plansShown(records, view.sceneId, view.setupId);
  const ids = new Set([wall?.parentId, plans.room?.id, plans.blocking?.id, plans.setup?.id].filter((id): id is string => typeof id === 'string'));
  return inside(all.filter((o) => o.record.parentId !== null && ids.has(o.record.parentId)));
}

/** The openings that went to the Trash with their wall, in the same group (6.2b): they come back with it. */
export function trashedWithWall(records: Records, wall: SbdRecord): SbdRecord[] {
  if (wall.trashedAt === null) return [];
  return Object.values(records).filter(
    // Any item in the wall (a kind a later version writes too), as a scene leaving its room trashes them all.
    (r) => r.type === 'plan_item' && r.id !== wall.id && r.trashedAt === wall.trashedAt && r.trashedBy === wall.trashedBy && r.props.wall_id === wall.id,
  );
}

/** Whether an opening went to the Trash with its wall: the Trash lists the wall, and the opening comes back with it. */
export function openingTrashedWithWall(records: Records, record: SbdRecord): boolean {
  const fields = record.trashedAt === null ? null : openingFields(record.props);
  const wall = fields ? records[fields.wallId] : undefined;
  return wall !== undefined && wall.trashedAt === record.trashedAt && wall.trashedBy === record.trashedBy;
}

/** The live scenes set in a room, in no particular order. */
export function scenesUsingRoom(records: Records, roomId: string): SbdRecord[] {
  return Object.values(records).filter((r) => r.type === 'scene' && r.trashedAt === null && sceneRoomId(records, r) === roomId);
}

/** What a new room is called: its scene's location's name, else the scene's name, else its slate label ("SC 04"). */
export function defaultRoomName(records: Records, scene: SbdRecord): string {
  const fields = sceneFields(scene.props);
  const location = fields.locationId ? records[fields.locationId] : undefined;
  const place = location?.type === 'location' && location.trashedAt === null ? text(location.props.name).trim() : '';
  if (place !== '') return place;
  return fields.name.trim() !== '' ? fields.name.trim() : sceneLabel(fields.number);
}

/** What a room is called where it shows: its name, or "Room" when it has none. */
export const roomTitle = (fields: PlanFields | null): string => (fields && fields.name !== '' ? fields.name : t('plan.room'));

// The edits. Each is one op group, so one ⌘Z.

/** A plan's items that went to the Trash with it, in the same group. */
export function trashedWithPlan(records: Records, plan: SbdRecord): SbdRecord[] {
  if (plan.trashedAt === null) return [];
  return Object.values(records).filter((r) => r.type === 'plan_item' && r.parentId === plan.id && r.trashedAt === plan.trashedAt && r.trashedBy === plan.trashedBy);
}

/**
 * A plan (a room) and its live items to the Trash, in one group, so a restore brings it back whole (6.2b's Delete room,
 * planRooms.ts). Items deleted before stay where they were. The scenes keep their `room_id`, which reads as no
 * room meanwhile.
 */
export function trashPlanChanges(records: Records, planId: string): Change[] {
  const plan = records[planId];
  if (plan?.type !== 'plan' || plan.trashedAt !== null) return [];
  const items = Object.values(records).filter((r) => r.type === 'plan_item' && r.parentId === planId && r.trashedAt === null);
  return [{ kind: 'trash', id: planId }, ...items.map((r): Change => ({ kind: 'trash', id: r.id }))];
}

/**
 * A trashed plan and the items that went to the Trash with it, brought back; not the ones deleted before it. Each wall
 * it brings back brings the doors and windows that went with that wall, whatever plan they sit in (6.2b review: a
 * scene's own door in a room wall, trashed by Delete room, sits in the scene's setup's plan, not the room's).
 */
export function restorePlanChanges(records: Records, planId: string): Change[] {
  const plan = records[planId];
  if (plan?.type !== 'plan' || plan.trashedAt === null) return [];
  const items = trashedWithPlan(records, plan);
  const ids = new Set([planId, ...items.map((r) => r.id)]);
  const openings: SbdRecord[] = [];
  for (const wall of items) {
    if (wall.props.kind !== 'wall') continue;
    for (const r of trashedWithWall(records, wall)) {
      if (ids.has(r.id)) continue;
      ids.add(r.id);
      openings.push(r);
    }
  }
  return [{ kind: 'restore', id: planId }, ...[...items, ...openings].map((r): Change => ({ kind: 'restore', id: r.id }))];
}

/**
 * "Start the room": a room under the project, named after the scene's place, and the scene's `room_id` set to it, in
 * one group. Nothing when the scene has a live room already, or isn't live.
 */
export function startRoomChanges(records: Records, projectId: string, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null || sceneRoomId(records, scene) !== null) return [];
  return newRoomChanges(records, projectId, sceneId, id);
}

/** The last sort key among a parent's children of a type, the Trash's too, so a new one after it never ties with one coming back. */
export function lastKeyUnder(records: Records, parentId: string, type: SbdRecord['type']): string | null {
  return Object.values(records)
    .filter((r) => r.type === type && r.parentId === parentId)
    .reduce<string | null>((key, r) => (key === null || r.sortKey > key ? r.sortKey : key), null);
}

/**
 * "New room" (6.2b): a room under the project, named after the scene's place and taking its location, and the scene
 * pointed at it, in one group, whether or not the scene had a room (the one it had is left as it is).
 */
export function newRoomChanges(records: Records, projectId: string, sceneId: string, id: string = crypto.randomUUID()): Change[] {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return [];
  const last = lastKeyUnder(records, projectId, 'plan');
  const { locationId } = sceneFields(scene.props);
  const location = locationId ? records[locationId] : undefined;
  const props: Props = { kind: 'room', name: defaultRoomName(records, scene) };
  if (location?.type === 'location' && location.trashedAt === null) props.location_id = location.id;
  return [
    { kind: 'create', record: { id, type: 'plan', parentId: projectId, sortKey: keyBetween(last, null), props } },
    { kind: 'update', id: sceneId, set: { room_id: id } },
  ];
}

/** A room's (or any plan's) name, trimmed. Nothing when it's that already, empty, or the plan isn't live. */
export function renamePlanChanges(records: Records, planId: string, name: string): Change[] {
  const plan = records[planId];
  const fields = plan?.type === 'plan' && plan.trashedAt === null ? planFields(plan.props) : null;
  const next = name.trim();
  if (!fields || next === '' || next === fields.name) return [];
  return [{ kind: 'update', id: planId, set: { name: next } }];
}

export interface Point {
  x: number;
  y: number;
}

export interface PlanGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

const tidy = (m: number): number => Math.round(m * 10000) / 10000;

/** The wall from one point to another (metres), `thickness` across, as its stored box. */
export function wallBetween(a: Point, b: Point, thickness = WALL_THICKNESS): PlanGeometry {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const rotation = normalDegrees((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  return { x: tidy(cx - length / 2), y: tidy(cy - thickness / 2), width: tidy(length), height: thickness, rotation };
}

/** A wall's start and end, along its middle line. */
export function wallEnds(g: PlanGeometry): [Point, Point] {
  const turn = (g.rotation * Math.PI) / 180;
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  const dx = (Math.cos(turn) * g.width) / 2;
  const dy = (Math.sin(turn) * g.width) / 2;
  return [
    { x: cx - dx, y: cy - dy },
    { x: cx + dx, y: cy + dy },
  ];
}

/** The props a new wall is written with. */
export function wallProps(g: PlanGeometry): Props {
  return { kind: 'wall', x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation };
}

/** Walls made at the front of a plan, one per segment of a run of points (metres); segments of no length are left out. */
export function wallsAlong(records: Records, planId: string, points: readonly Point[], thickness = WALL_THICKNESS): { ids: string[]; changes: Change[] } {
  let previous = Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.parentId === planId)
    .reduce<string | null>((key, r) => (key === null || r.sortKey > key ? r.sortKey : key), null);
  const ids: string[] = [];
  const changes: Change[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < MIN_PLAN_SIZE) continue;
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props: wallProps(wallBetween(a, b, thickness)) } });
  }
  return { ids, changes };
}

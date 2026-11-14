import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import { sceneCharacters } from './person';
import {
  blockingPlanOf,
  cameraFields,
  CAST_MARK_ICON,
  lastKeyUnder,
  MARK_ICON,
  markFields,
  NEXT_POSITION_ICON,
  planFields,
  setupPlanOf,
  shownItems,
  type CameraFields,
  type MarkFields,
  type PlanViewOf,
  type Point,
} from './plan';
import { liveCamera } from './planCamera';
import type { Props, SbdRecord } from './record';

// Cast blocking and camera moves on the plan (6.7, docs/PHASE6_DECISIONS.md 2 and 9). A mark is a `plan_item` of kind
// `mark`: a character's (`character_id`, one of the scene's characters) or a plain one (a T-mark on the floor) sits in
// the scene's blocking plan, so every setup of the scene shows it, or in one setup's plan when made "This setup only"
// (a cheated mark); a camera's (`camera_id`, a camera in the same setup's plan) is one of that camera's later
// positions and sits in the setup's plan with it. Nothing about positions is stored: a view's marks of one owner are
// numbered 1, 2, 3 by plan order (their sort keys, blocking and setup-only together), a camera's own item being its
// position 1, and the path between them is worked out each time. A stale link (a character trashed, gone or no longer
// in the scene; a camera trashed, gone or in another plan) reads as none: the mark is a plain mark, kept as it is.
// Every reading is kept per records object (planCamera.ts's pattern); every edit is an op list, one group.

type Records = Readonly<Record<string, SbdRecord>>;

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const memos = new WeakMap<Records, Map<string, unknown>>();

function memo<T>(records: Records, key: string, make: () => T): T {
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  if (known.has(key)) return known.get(key) as T;
  const made = make();
  known.set(key, made);
  return made;
}

let readings = 0;

/** How many views' blocking has been worked out from records: for tests, which check it's once per records and view. */
export const blockingReadingsMade = (): number => readings;

/** Who a mark belongs to, read live: a character of its scene, or a camera of its own plan. */
export type MarkOwner = { kind: 'character'; id: string } | { kind: 'camera'; id: string };

const sameOwner = (a: MarkOwner | null, b: MarkOwner | null): boolean => a?.kind === b?.kind && a?.id === b?.id;

/** A live mark, with its fields. */
export function liveMark(records: Records, id: string): { record: SbdRecord; fields: MarkFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = markFields(record.props);
  return fields ? { record, fields } : null;
}

/** The live scene a plan belongs to: a blocking plan's scene, a setup plan's setup's scene; null for a room's. */
export function planScene(records: Records, planId: string | null): SbdRecord | null {
  const plan = planId ? records[planId] : undefined;
  if (plan?.type !== 'plan' || plan.trashedAt !== null || !plan.parentId) return null;
  const kind = planFields(plan.props)?.kind;
  let scene: SbdRecord | undefined;
  if (kind === 'blocking') scene = records[plan.parentId];
  else if (kind === 'setup') {
    const setup = records[plan.parentId];
    scene = setup?.type === 'setup' && setup.trashedAt === null && setup.parentId ? records[setup.parentId] : undefined;
  }
  return scene?.type === 'scene' && scene.trashedAt === null ? scene : null;
}

/** The ids of a scene's live characters (sceneCharacters, 3.13), in its order, once per records. */
export function sceneCharacterIds(records: Records, sceneId: string): readonly string[] {
  return memo(records, `characters:${sceneId}`, () => {
    const scene = records[sceneId];
    return scene?.type === 'scene' ? sceneCharacters(records, scene).map((c) => c.id) : [];
  });
}

/** Whether a plan is a setup's plan. */
function isSetupPlan(records: Records, planId: string | null): boolean {
  const plan = planId === null ? undefined : records[planId];
  return plan?.type === 'plan' && planFields(plan.props)?.kind === 'setup';
}

/**
 * Who a mark belongs to, read live, or null for a plain mark: its `camera_id` when it names a live camera in the same
 * setup plan as the mark, else its `character_id` when it names a live character that is one of the scene's. Any other
 * link (trashed, gone, another setup's camera, a character no longer in the scene) reads as none, and stays stored.
 */
export function markOwner(records: Records, mark: SbdRecord): MarkOwner | null {
  const fields = markFields(mark.props);
  if (!fields) return null;
  if (fields.cameraId !== null) {
    const camera = liveCamera(records, fields.cameraId);
    if (camera && camera.record.parentId === mark.parentId && isSetupPlan(records, mark.parentId)) return { kind: 'camera', id: camera.record.id };
  }
  if (fields.characterId !== null) {
    const scene = planScene(records, mark.parentId);
    const character = records[fields.characterId];
    if (scene && character?.type === 'character' && character.trashedAt === null && sceneCharacterIds(records, scene.id).includes(character.id)) return { kind: 'character', id: character.id };
  }
  return null;
}

/** Why a mark's stored link reads as none, or null when it reads (or it has none): its character's or its camera's. */
export function staleLink(records: Records, mark: SbdRecord): 'character' | 'camera' | null {
  const fields = markFields(mark.props);
  if (!fields || markOwner(records, mark) !== null) return null;
  if (fields.cameraId !== null) return 'camera';
  return fields.characterId !== null ? 'character' : null;
}

/** One position: a mark, or a camera's own item (its position 1). */
export interface Position {
  record: SbdRecord;
  fields: MarkFields | CameraFields;
  /** Its box's middle, metres. */
  centre: Point;
}

export interface OwnerPositions {
  owner: MarkOwner;
  positions: readonly Position[];
}

/** A shown item's place among its owner's positions. */
export interface PositionOf {
  owner: MarkOwner;
  /** 1, 2, 3, in plan order. */
  number: number;
  count: number;
}

export interface ViewBlocking {
  /** The characters with marks in the view, in the scene's order, each with its positions in plan order. */
  characters: readonly OwnerPositions[];
  /** The cameras in the view with later positions, in plan order: the camera's own item first. */
  cameras: readonly OwnerPositions[];
  /** Each shown mark's (and each moving camera's) number among its owner's positions. */
  numbers: ReadonlyMap<string, PositionOf>;
}

const centreOf = (f: { x: number; y: number; width: number; height: number }): Point => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 });

/**
 * A view's blocking (the one reader): each character's positions and each camera's, numbered, from the marks the view
 * shows (the scene's blocking and the setup's own plan, as shownItems reads them). Kept per records and view.
 */
export function viewBlocking(records: Records, sceneId: string, setupId: string | null): ViewBlocking {
  return memo(records, `blocking:${sceneId}:${String(setupId)}`, (): ViewBlocking => {
    readings += 1;
    const shown = shownItems(records, sceneId, setupId);
    const byCharacter = new Map<string, Position[]>();
    const byCamera = new Map<string, Position[]>();
    for (const item of shown) {
      if (item.fields.kind !== 'mark') continue;
      const owner = markOwner(records, item.record);
      if (!owner) continue;
      const list = owner.kind === 'character' ? byCharacter : byCamera;
      list.set(owner.id, [...(list.get(owner.id) ?? []), { record: item.record, fields: item.fields, centre: centreOf(item.fields) }]);
    }
    const sorted = (list: Position[]) => [...list].sort((a, b) => bySortKey(a.record, b.record));
    const order = sceneCharacterIds(records, sceneId);
    const characters = [...byCharacter]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([id, list]): OwnerPositions => ({ owner: { kind: 'character', id }, positions: sorted(list) }));
    const cameras = shown.flatMap((item): OwnerPositions[] => {
      const marks = byCamera.get(item.record.id);
      const fields = item.fields.kind === 'camera' ? cameraFields(item.record.props) : null;
      if (!marks || !fields) return [];
      return [{ owner: { kind: 'camera', id: item.record.id }, positions: [{ record: item.record, fields, centre: centreOf(fields) }, ...sorted(marks)] }];
    });
    const numbers = new Map<string, PositionOf>();
    for (const { owner, positions } of [...characters, ...cameras]) positions.forEach((p, i) => numbers.set(p.record.id, { owner, number: i + 1, count: positions.length }));
    return { characters, cameras, numbers };
  });
}

/** A run of positions' length, metres: centre to centre, in order. */
export function moveLength(positions: readonly { centre: Point }[]): number {
  let length = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const a = positions[i - 1];
    const b = positions[i];
    if (a && b) length += Math.hypot(b.centre.x - a.centre.x, b.centre.y - a.centre.y);
  }
  return length;
}

/** A camera's positions in a view: its own item, then its later positions; just its own when it has none. */
export function cameraPositions(records: Records, view: PlanViewOf, cameraId: string): readonly Position[] {
  const moving = viewBlocking(records, view.sceneId, view.setupId).cameras.find((c) => c.owner.id === cameraId);
  if (moving) return moving.positions;
  const camera = liveCamera(records, cameraId);
  return camera ? [{ record: camera.record, fields: camera.fields, centre: centreOf(camera.fields) }] : [];
}

/** A camera's live marks (any it names in its own plan, whether or not they read), back to front. */
export function cameraMarks(records: Records, cameraId: string): SbdRecord[] {
  const camera = records[cameraId];
  if (!camera) return [];
  return Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.trashedAt === null && r.parentId === camera.parentId && r.props.kind === 'mark' && r.props.camera_id === cameraId)
    .sort(bySortKey);
}

/** The marks that went to the Trash with their camera, in the same group: they come back with it. */
export function trashedWithCamera(records: Records, camera: SbdRecord): SbdRecord[] {
  if (camera.trashedAt === null || camera.props.kind !== 'camera') return [];
  return Object.values(records).filter(
    (r) => r.type === 'plan_item' && r.id !== camera.id && r.props.kind === 'mark' && r.props.camera_id === camera.id && r.trashedAt === camera.trashedAt && r.trashedBy === camera.trashedBy,
  );
}

/** Whether a mark went to the Trash with its camera: the Trash lists the camera, and the mark comes back with it. */
export function markTrashedWithCamera(records: Records, mark: SbdRecord): boolean {
  if (mark.trashedAt === null || mark.props.kind !== 'mark' || typeof mark.props.camera_id !== 'string') return false;
  const camera = records[mark.props.camera_id];
  return camera?.type === 'plan_item' && camera.trashedAt === mark.trashedAt && camera.trashedBy === mark.trashedBy;
}

/**
 * A copy's `camera_id` (6.7): pointed at the camera's copy when it was copied too (`ids`, original to copy), else taken
 * off, so the copy is a plain mark: a copy never names a camera it doesn't sit with.
 */
export function repointCamera(props: Props, ids: ReadonlyMap<string, string>): Props {
  if (props.kind !== 'mark' || typeof props.camera_id !== 'string') return props;
  const own: Props = { ...props };
  const copy = ids.get(props.camera_id);
  if (copy) own.camera_id = copy;
  else delete own.camera_id;
  return own;
}

// The edits.

/** A size in metres, as iconSizes.ts gives each icon's. */
export interface MarkSize {
  width: number;
  depth: number;
}

const tidy = (m: number): number => Math.round(m * 10000) / 10000;

const boxAt = (centre: Point, size: { width: number; depth: number }) => ({ x: tidy(centre.x - size.width / 2), y: tidy(centre.y - size.depth / 2), width: size.width, height: size.depth });

/** The live scene of a view, or null. */
function viewScene(records: Records, view: PlanViewOf): SbdRecord | null {
  const scene = records[view.sceneId];
  return scene?.type === 'scene' && scene.trashedAt === null ? scene : null;
}

/** The scene's blocking plan's id, made in the same group when it has none (`changes` takes the create). */
function blockingFor(records: Records, sceneId: string, newPlanId: string, changes: Change[]): string {
  const have = blockingPlanOf(records, sceneId);
  if (have) return have.id;
  changes.push({ kind: 'create', record: { id: newPlanId, type: 'plan', parentId: sceneId, sortKey: keyBetween(lastKeyUnder(records, sceneId, 'plan'), null), props: { kind: 'blocking', name: '' } } });
  return newPlanId;
}

/** The later of two keys (null for none). */
const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

/**
 * A mark placed in a view, its middle at `centre` (metres), at the front of the scene's blocking plan (made now when it
 * has none, in the same group): a plain mark, or a character's when `characterId` names one of the scene's characters
 * (after that character's last position, so it is its next). Nothing for a scene that isn't live, or a character that
 * isn't one of its.
 */
export function placeMarkChanges(
  records: Records,
  view: PlanViewOf,
  centre: Point,
  size: MarkSize,
  characterId: string | null = null,
  id: string = crypto.randomUUID(),
  newPlanId: string = crypto.randomUUID(),
): Change[] {
  if (!viewScene(records, view)) return [];
  if (characterId !== null && !sceneCharacterIds(records, view.sceneId).includes(characterId)) return [];
  const changes: Change[] = [];
  const planId = blockingFor(records, view.sceneId, newPlanId, changes);
  const last = characterId === null ? null : (viewBlocking(records, view.sceneId, view.setupId).characters.find((c) => c.owner.id === characterId)?.positions.at(-1) ?? null);
  const sortKey = keyBetween(later(changes.length > 0 ? null : lastKeyUnder(records, planId, 'plan_item'), last?.record.sortKey ?? null), null);
  const props: Props = { kind: 'mark', icon: characterId === null ? MARK_ICON : CAST_MARK_ICON, ...boxAt(centre, size), rotation: 0 };
  if (characterId !== null) props.character_id = characterId;
  changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } });
  return changes;
}

/**
 * Whose positions an item in a view is part of: a camera of the setup shown is its own (its position 1); a mark its
 * owner; null for a plain mark or anything else.
 */
export function ownerIn(records: Records, view: PlanViewOf, id: string): MarkOwner | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  if (record.props.kind === 'camera') {
    const own = view.setupId === null ? null : setupPlanOf(records, view.setupId);
    return liveCamera(records, id) && own !== null && record.parentId === own.id ? { kind: 'camera', id } : null;
  }
  return liveMark(records, id) ? markOwner(records, record) : null;
}

/**
 * "Next position" (6.7): a new mark after the last position of the owner of `fromId` (a character's mark, a camera or
 * one of its marks), 1 m to the right of that last position, or at `at` when given (a drop): a character's in the scene's
 * blocking plan (made now when it has none) at `size`; a camera's in the camera's plan, the camera's size, pointing
 * where its last position points. Nothing for a plain mark (it has no positions to follow) or anything else.
 */
export function nextPositionChanges(
  records: Records,
  view: PlanViewOf,
  fromId: string,
  size: MarkSize,
  at: Point | null = null,
  id: string = crypto.randomUUID(),
  newPlanId: string = crypto.randomUUID(),
): Change[] {
  if (!viewScene(records, view)) return [];
  const owner = ownerIn(records, view, fromId);
  if (!owner) return [];
  const blocking = viewBlocking(records, view.sceneId, view.setupId);
  const changes: Change[] = [];
  if (owner.kind === 'character') {
    const last = blocking.characters.find((c) => c.owner.id === owner.id)?.positions.at(-1);
    if (!last) return [];
    const planId = blockingFor(records, view.sceneId, newPlanId, changes);
    const centre = at ?? { x: last.centre.x + 1, y: last.centre.y };
    const sortKey = keyBetween(later(changes.length > 0 ? null : lastKeyUnder(records, planId, 'plan_item'), last.record.sortKey), null);
    const props: Props = { kind: 'mark', icon: NEXT_POSITION_ICON, ...boxAt(centre, size), rotation: 0, character_id: owner.id };
    return [...changes, { kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } }];
  }
  const camera = liveCamera(records, owner.id);
  const planId = camera?.record.parentId ?? null;
  const last = cameraPositions(records, view, owner.id).at(-1);
  if (!camera || planId === null || !last) return [];
  const centre = at ?? { x: last.centre.x + 1, y: last.centre.y };
  const sortKey = keyBetween(later(lastKeyUnder(records, planId, 'plan_item'), last.record.sortKey), null);
  const props: Props = { kind: 'mark', icon: NEXT_POSITION_ICON, ...boxAt(centre, { width: camera.fields.width, depth: camera.fields.height }), rotation: last.fields.rotation, camera_id: owner.id };
  return [{ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } }];
}

/** Who the Selection tile gives a mark to: no one (a plain mark), one of the scene's characters, or one of the setup's cameras. */
export type OwnerChoice = { kind: 'plain' } | MarkOwner;

/**
 * Marks given to a character, a camera or no one (6.7), one group. A character must be one of the scene's; a camera
 * one of the setup shown's, and a mark given to it moves into its plan (a `move`, keeping its sort key, so it keeps its
 * place in plan order) and takes the camera's size about its middle; a camera's mark given to a character or no one
 * goes back to the scene's blocking (made now when it has none). A mark that becomes a character's from a plain one,
 * or plain from a character's, takes that kind's size (`sizes`, iconSizes.ts's), about its middle, as it is drawn as
 * that kind's drawing. Nothing for a mark that is that already.
 */
export function markOwnerChanges(
  records: Records,
  view: PlanViewOf,
  ids: readonly string[],
  choice: OwnerChoice,
  sizes: { character: MarkSize; plain: MarkSize },
  newPlanId: string = crypto.randomUUID(),
): Change[] {
  if (!viewScene(records, view)) return [];
  if (choice.kind === 'character' && !sceneCharacterIds(records, view.sceneId).includes(choice.id)) return [];
  const setupPlan = view.setupId === null ? null : setupPlanOf(records, view.setupId);
  const camera = choice.kind === 'camera' ? liveCamera(records, choice.id) : null;
  if (choice.kind === 'camera' && (!camera || setupPlan === null || camera.record.parentId !== setupPlan.id)) return [];
  const changes: Change[] = [];
  // The blocking plan, once: made at most once for all the marks.
  let blocking: string | null = null;
  for (const id of ids) {
    const mark = liveMark(records, id);
    if (!mark) continue;
    const owner = markOwner(records, mark.record);
    const wanted: MarkOwner | null = choice.kind === 'plain' ? null : choice;
    const storedSame =
      (choice.kind === 'plain' && mark.fields.characterId === null && mark.fields.cameraId === null) ||
      (choice.kind === 'character' && mark.fields.characterId === choice.id && mark.fields.cameraId === null) ||
      (choice.kind === 'camera' && mark.fields.cameraId === choice.id);
    if (storedSame && sameOwner(owner, wanted)) continue;
    const set: Props = {};
    const unset: string[] = [];
    if (choice.kind === 'camera') {
      set.camera_id = choice.id;
      if (mark.fields.characterId !== null) unset.push('character_id');
    } else {
      if (mark.fields.cameraId !== null) unset.push('camera_id');
      if (choice.kind === 'character') set.character_id = choice.id;
      else if (mark.fields.characterId !== null) unset.push('character_id');
    }
    const centre = centreOf(mark.fields);
    // Onto a camera: the camera's size and turn, in its plan.
    if (camera && owner?.kind !== 'camera') {
      Object.assign(set, boxAt(centre, { width: camera.fields.width, depth: camera.fields.height }), { rotation: camera.fields.rotation });
      changes.push({ kind: 'update', id, set, ...(unset.length > 0 ? { unset } : {}) });
      if (mark.record.parentId !== camera.record.parentId) changes.push({ kind: 'move', id, parentId: camera.record.parentId, sortKey: mark.record.sortKey });
      continue;
    }
    if (choice.kind === 'camera') {
      changes.push({ kind: 'update', id, set, ...(unset.length > 0 ? { unset } : {}) });
      continue;
    }
    const size = sizes[choice.kind];
    // Off a camera: back to the scene's blocking, at a mark's size.
    if (owner?.kind === 'camera') {
      Object.assign(set, boxAt(centre, size), { rotation: 0 });
      changes.push({ kind: 'update', id, set, ...(unset.length > 0 ? { unset } : {}) });
      blocking ??= blockingFor(records, view.sceneId, newPlanId, changes);
      changes.push({ kind: 'move', id, parentId: blocking, sortKey: mark.record.sortKey });
      continue;
    }
    // Plain to a character's, or a character's to plain: drawn as the other kind's drawing, at its size.
    if ((owner === null) !== (choice.kind === 'plain')) Object.assign(set, boxAt(centre, size));
    changes.push({ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) });
  }
  return changes;
}

/**
 * A position moved earlier (-1) or later (1) among its owner's positions only (6.7): its sort key set between its
 * new neighbours', in the plan it sits in, so nothing else moves. A camera's own item is always its position 1: its
 * position 2 never goes earlier. Nothing at either end, or for a plain mark.
 */
export function movePositionChanges(records: Records, view: PlanViewOf, id: string, by: -1 | 1): Change[] {
  const mark = liveMark(records, id);
  const owner = mark ? markOwner(records, mark.record) : null;
  if (!mark || !owner) return [];
  const blocking = viewBlocking(records, view.sceneId, view.setupId);
  const all = (owner.kind === 'character' ? blocking.characters : blocking.cameras).find((o) => o.owner.id === owner.id)?.positions ?? [];
  // A camera's own item never moves: only its marks are reordered.
  const list = owner.kind === 'camera' ? all.slice(1) : all;
  const i = list.findIndex((p) => p.record.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const lo = by < 0 ? (list[j - 1]?.record.sortKey ?? null) : (list[j]?.record.sortKey ?? null);
  const hi = by < 0 ? (list[j]?.record.sortKey ?? null) : (list[j + 1]?.record.sortKey ?? null);
  // Two positions with one key (an imported file's) can't be told apart by a key between them.
  if (lo !== null && hi !== null && lo >= hi) return [];
  return [{ kind: 'move', id, parentId: mark.record.parentId, sortKey: keyBetween(lo, hi) }];
}

/** "Plain mark": the marks' character or camera taken off (markOwnerChanges with no one). */
export const unlinkMarkChanges = (records: Records, view: PlanViewOf, ids: readonly string[], sizes: { character: MarkSize; plain: MarkSize }): Change[] =>
  markOwnerChanges(records, view, ids, { kind: 'plain' }, sizes);

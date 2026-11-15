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
  planItemLayer,
  setupPlanOf,
  shownItems,
  type CameraFields,
  type MarkFields,
  type PlanLayer,
  type PlanViewOf,
  type Point,
} from './plan';
import { liveCamera } from './planCamera';
import type { Props, SbdRecord } from './record';
import { childrenOf, recordsOfType } from './recordIndex';

// Cast blocking and camera moves on the plan (6.7, docs/PHASE6_DECISIONS.md 2 and 9). A mark is a `plan_item` of kind
// `mark`: a character's (`character_id`, one of the scene's characters) or a plain one (a T-mark on the floor) sits in
// the scene's blocking plan, so every setup of the scene shows it, or in one setup's plan when made "This setup only"
// (a cheated mark); a camera's (`camera_id`, a camera in the same setup's plan) is one of that camera's later
// positions and sits in the setup's plan with it. A mark's place among its owner's positions is its own `order` (6.7
// review), never its sort key: sort keys are drawing order, made per plan, so they collide between plans and change
// with Bring to front; an `order` is made once over all of that owner's marks in the scene, so it is unique and moves
// with the mark wherever it goes. A view's marks of one owner are numbered 1, 2, 3 by `order`, a camera's own item
// being its position 1, and the path between them is worked out each time. A stale link (a character trashed, gone or
// no longer in the scene; a camera trashed, gone or in another plan) reads as none: the mark is a plain mark, kept as
// it is. Every reading is kept per records object (planCamera.ts's pattern); every edit is an op list, one group.

type Records = Readonly<Record<string, SbdRecord>>;

const orderOf = (record: SbdRecord): string | null => markFields(record.props)?.order ?? null;

/**
 * Positions in order (6.7 review): by `order`; one without (an import's, or written by 6.7's first build) after those
 * with one; ties then by when each was made, then by id. Never by sort key, so drawing order never renumbers anything.
 */
export function byPositionOrder(a: SbdRecord, b: SbdRecord): number {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  if (oa !== null && ob !== null && oa !== ob) return oa < ob ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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

/**
 * A mark's layer (6.7 review, L1), the one reading the plan, the legend and the level rule share: the camera
 * department's only while its camera link reads (markOwner), cast blocking's otherwise, so a mark drawn as a tape mark
 * (its camera in the Trash, or an imported link) is never on the camera layer.
 */
export const markLayer = (records: Records, record: SbdRecord): PlanLayer => (markOwner(records, record)?.kind === 'camera' ? 'camera' : 'cast');

/** Any plan item's layer: a mark's by markLayer, any other's by what it is (planItemLayer). */
export const itemLayer = (records: Records, record: SbdRecord): PlanLayer | null =>
  record.props.kind === 'mark' ? markLayer(records, record) : planItemLayer(record.props);

/** Every plan of a scene's own, the Trash's too: its blocking plans and each of its setups' plans. Once per records. */
function scenePlanIds(records: Records, sceneId: string): ReadonlySet<string> {
  return memo(records, `plans:${sceneId}`, () => {
    // From the records by type (6.21), never a pass over all of them.
    const setups = new Set(childrenOf(records, sceneId, 'setup').map((r) => r.id));
    return new Set(
      recordsOfType(records, 'plan').flatMap((r) => {
        if (r.parentId === null) return [];
        const kind = planFields(r.props)?.kind;
        return (kind === 'blocking' && r.parentId === sceneId) || (kind === 'setup' && setups.has(r.parentId)) ? [r.id] : [];
      }),
    );
  });
}

/**
 * Every plan item that is a mark, the Trash's too, by the id its `character_id` and its `camera_id` name, each list in
 * Object.values order: once per records object (6.21), so a mark's owner and a camera's positions read no other record.
 */
function marksByOwner(records: Records): { character_id: ReadonlyMap<string, readonly SbdRecord[]>; camera_id: ReadonlyMap<string, readonly SbdRecord[]> } {
  return memo(records, 'marksByOwner', () => {
    const character_id = new Map<string, SbdRecord[]>();
    const camera_id = new Map<string, SbdRecord[]>();
    for (const r of recordsOfType(records, 'plan_item')) {
      if (r.props.kind !== 'mark') continue;
      for (const [map, value] of [
        [character_id, r.props.character_id],
        [camera_id, r.props.camera_id],
      ] as const) {
        if (typeof value !== 'string') continue;
        const list = map.get(value);
        if (list) list.push(r);
        else map.set(value, [r]);
      }
    }
    return { character_id, camera_id };
  });
}

/**
 * Every mark that names an owner in a scene's plans (6.7 review): the blocking and every setup's plan, the Trash's too,
 * whether or not the link reads. A new position's `order` comes after all of theirs, so two setups never make the same.
 */
export function ownerMarks(records: Records, sceneId: string, owner: MarkOwner): SbdRecord[] {
  const plans = scenePlanIds(records, sceneId);
  const prop = owner.kind === 'character' ? 'character_id' : 'camera_id';
  return (marksByOwner(records)[prop].get(owner.id) ?? []).filter((r) => r.parentId !== null && plans.has(r.parentId));
}

/** An owner's marks in a scene with every `order` sound (soundOrders). */
export interface SoundOrders {
  /** The updates that give each mark without a sound `order` its fresh one: the same group as the edit that needs them. */
  changes: Change[];
  /** Each of the owner's marks' `order` once they apply. */
  orders: ReadonlyMap<string, string>;
  /** The last of them, or null when the owner has no marks. */
  last: string | null;
}

/**
 * The one way to an owner's sound `order`s (6.7 second review), used by every edit that writes one: a mark's `order`
 * is unique among its owner's marks across the whole scene, Trash included, always. Marks without one (6.7's first
 * build, an import) or sharing one (the first of a tie, in byPositionOrder, keeps it) take a fresh one after the last
 * sound one, in byPositionOrder, so their numbers stay as they read; the edit then writes its own after that.
 */
export function soundOrders(records: Records, sceneId: string, owner: MarkOwner): SoundOrders {
  const marks = ownerMarks(records, sceneId, owner).sort(byPositionOrder);
  const orders = new Map<string, string>();
  const seen = new Set<string>();
  const unsound: SbdRecord[] = [];
  let last: string | null = null;
  for (const r of marks) {
    const own = orderOf(r);
    if (own === null || seen.has(own)) {
      unsound.push(r);
      continue;
    }
    seen.add(own);
    orders.set(r.id, own);
    if (last === null || own > last) last = own;
  }
  const changes: Change[] = [];
  for (const r of unsound) {
    last = keyBetween(last, null);
    orders.set(r.id, last);
    changes.push({ kind: 'update', id: r.id, set: { order: last } });
  }
  return { changes, orders, last };
}

/** A new position after an owner's last in the scene: the updates that make the owner's orders sound, and its `order`. */
export function orderAfterLast(records: Records, sceneId: string, owner: MarkOwner): { changes: Change[]; order: string } {
  const sound = soundOrders(records, sceneId, owner);
  return { changes: sound.changes, order: keyBetween(sound.last, null) };
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
  /** 1, 2, 3, by `order`. */
  number: number;
  count: number;
}

export interface ViewBlocking {
  /** The characters with marks in the view, in the scene's order, each with its positions by `order`. */
  characters: readonly OwnerPositions[];
  /** The cameras in the view with later positions, in plan order, each with its positions: the camera's own item first, then its marks by `order`. */
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
    // By each mark's own `order`, never drawing order (6.7 review).
    const sorted = (list: Position[]) => [...list].sort((a, b) => byPositionOrder(a.record, b.record));
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
  // From the marks by camera (6.21); a fresh list each call.
  return (marksByOwner(records).camera_id.get(cameraId) ?? []).filter((r) => r.trashedAt === null && r.parentId === camera.parentId).sort(byPositionOrder);
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

/** A size in metres, as iconSizes.ts gives each icon's. */
export interface MarkSize {
  width: number;
  depth: number;
}

/** A plain mark's size, as iconSizes.ts gives `cast/tape-mark` (the core can't read the feature's table: a test holds them equal). */
export const PLAIN_MARK_SIZE: MarkSize = { width: 0.3, depth: 0.28 };

const tidy = (m: number): number => Math.round(m * 10000) / 10000;

/**
 * A copy's `camera_id` (6.7): pointed at the camera's copy when it was copied too (`ids`, original to copy), its `order`
 * kept (its camera's positions come with it, numbered as they were); else taken off, so the copy is a plain mark (a copy
 * never names a camera it doesn't sit with): no `order`, and a tape mark's size about its middle, unturned (6.7 review,
 * L2), as giving a mark to no one makes it, so a dolly track's position never lands as a 1 × 3 m tape mark.
 */
export function repointCamera(props: Props, ids: ReadonlyMap<string, string>, plain: MarkSize = PLAIN_MARK_SIZE): Props {
  if (props.kind !== 'mark' || typeof props.camera_id !== 'string') return props;
  const own: Props = { ...props };
  const copy = ids.get(props.camera_id);
  if (copy) {
    own.camera_id = copy;
    return own;
  }
  delete own.camera_id;
  delete own.order;
  const fields = markFields(props);
  if (fields && typeof props.character_id !== 'string') Object.assign(own, boxAt(centreOf(fields), plain), { rotation: 0 });
  return own;
}

// The edits.

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

/** A new item's sort key at the front of a plan: the plan's last (the Trash's too), or the first in a plan made in this group. */
const frontKey = (records: Records, planId: string, madeNow: boolean): string => keyBetween(madeNow ? null : lastKeyUnder(records, planId, 'plan_item'), null);

/**
 * A mark placed in a view, its middle at `centre` (metres), at the front of the scene's blocking plan (made now when it
 * has none, in the same group): a plain mark, or a character's when `characterId` names one of the scene's characters
 * (its `order` after that character's last in the scene, so it is its next). Nothing for a scene that isn't live, or a
 * character that isn't one of its.
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
  const sortKey = frontKey(records, planId, changes.length > 0);
  const props: Props = { kind: 'mark', icon: characterId === null ? MARK_ICON : CAST_MARK_ICON, ...boxAt(centre, size), rotation: 0 };
  const sound: Change[] = [];
  if (characterId !== null) {
    props.character_id = characterId;
    const next = orderAfterLast(records, view.sceneId, { kind: 'character', id: characterId });
    props.order = next.order;
    sound.push(...next.changes);
  }
  changes.push(...sound, { kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } });
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
    const next = orderAfterLast(records, view.sceneId, owner);
    const props: Props = { kind: 'mark', icon: NEXT_POSITION_ICON, ...boxAt(centre, size), rotation: 0, character_id: owner.id, order: next.order };
    return [...changes, ...next.changes, { kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey: frontKey(records, planId, changes.length > 0), props } }];
  }
  const camera = liveCamera(records, owner.id);
  const planId = camera?.record.parentId ?? null;
  const last = cameraPositions(records, view, owner.id).at(-1);
  if (!camera || planId === null || !last) return [];
  const centre = at ?? { x: last.centre.x + 1, y: last.centre.y };
  const next = orderAfterLast(records, view.sceneId, owner);
  const props: Props = {
    kind: 'mark',
    icon: NEXT_POSITION_ICON,
    ...boxAt(centre, { width: camera.fields.width, depth: camera.fields.height }),
    rotation: last.fields.rotation,
    camera_id: owner.id,
    order: next.order,
  };
  return [...next.changes, { kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey: frontKey(records, planId, false), props } }];
}

/** Who the Selection tile gives a mark to: no one (a plain mark), one of the scene's characters, or one of the setup's cameras. */
export type OwnerChoice = { kind: 'plain' } | MarkOwner;

/**
 * Marks given to a character, a camera or no one (6.7), one group. A character must be one of the scene's; a camera
 * one of the setup shown's, and a mark given to it moves into its plan (a `move`, at the front of that plan: sort keys
 * are drawing order, made per plan) and takes the camera's size about its middle; a camera's mark given to a character
 * or no one goes back to the scene's blocking (made now when it has none), at its front. A mark given to an owner is
 * that owner's last position (6.7 review: its `order` after the owner's last in the scene; several in the order they
 * had); one made plain loses its `order`. A mark that becomes a character's from a plain one, or plain from a
 * character's, takes that kind's size (`sizes`, iconSizes.ts's), about its middle, as it is drawn as that kind's
 * drawing. Nothing for a mark that is that already.
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
  let blockingMadeNow = false;
  // The owner's last `order` (its marks' made sound first, in the same group) and each target plan's last sort key, as
  // the marks given so far leave them.
  const sound = choice.kind === 'plain' ? null : soundOrders(records, view.sceneId, choice);
  let lastOrder = sound?.last ?? null;
  // The marks given a new `order` here: their own update writes it, so none of the sound ones is needed for them.
  const reordered = new Set<string>();
  const lastKeys = new Map<string, string>();
  const moveTo = (id: string, planId: string, madeNow: boolean) => {
    const sortKey = keyBetween(lastKeys.get(planId) ?? (madeNow ? null : lastKeyUnder(records, planId, 'plan_item')), null);
    lastKeys.set(planId, sortKey);
    changes.push({ kind: 'move', id, parentId: planId, sortKey });
  };
  const marks = ids.flatMap((id) => {
    const mark = liveMark(records, id);
    return mark ? [mark] : [];
  });
  for (const mark of [...marks].sort((a, b) => byPositionOrder(a.record, b.record))) {
    const id = mark.record.id;
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
    if (choice.kind === 'plain') {
      if ('order' in mark.record.props) unset.push('order');
    } else {
      lastOrder = keyBetween(lastOrder, null);
      set.order = lastOrder;
      reordered.add(id);
    }
    const update = (): Change => ({ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) });
    const centre = centreOf(mark.fields);
    // Onto a camera: the camera's size and turn, in its plan.
    if (camera && owner?.kind !== 'camera') {
      Object.assign(set, boxAt(centre, { width: camera.fields.width, depth: camera.fields.height }), { rotation: camera.fields.rotation });
      changes.push(update());
      const planId = camera.record.parentId;
      if (planId !== null && mark.record.parentId !== planId) moveTo(id, planId, false);
      continue;
    }
    if (choice.kind === 'camera') {
      changes.push(update());
      continue;
    }
    const size = sizes[choice.kind];
    // Off a camera: back to the scene's blocking, at a mark's size.
    if (owner?.kind === 'camera') {
      Object.assign(set, boxAt(centre, size), { rotation: 0 });
      changes.push(update());
      if (blocking === null) {
        const before = changes.length;
        blocking = blockingFor(records, view.sceneId, newPlanId, changes);
        blockingMadeNow = changes.length > before;
      }
      moveTo(id, blocking, blockingMadeNow);
      continue;
    }
    // Plain to a character's, or a character's to plain: drawn as the other kind's drawing, at its size.
    if ((owner === null) !== (choice.kind === 'plain')) Object.assign(set, boxAt(centre, size));
    changes.push(update());
  }
  if (changes.length === 0 || !sound) return changes;
  return [...sound.changes.filter((c) => c.kind !== 'update' || !reordered.has(c.id)), ...changes];
}

/**
 * A position moved earlier (-1) or later (1) among its owner's positions the view shows (6.7): its `order` set between
 * its new neighbours' (6.7 review: never its sort key, so drawing order is untouched). Any other of that owner's in the
 * scene between them (a cheated mark of another setup, one in the Trash) is passed as little as it can be (6.7 second
 * review, L2): Later lands just after the mark it stepped over, Earlier just before it, so a hidden mark keeps its
 * place but for that one step. The owner's orders are made sound first (soundOrders, in the same group), so this is
 * always one key between two neighbours, and no other view is renumbered but for the mark moved. A camera's own item
 * is always its position 1: its position 2 never goes earlier. Nothing at either end, or for a plain mark.
 */
export function movePositionChanges(records: Records, view: PlanViewOf, id: string, by: -1 | 1): Change[] {
  const mark = liveMark(records, id);
  const owner = mark ? markOwner(records, mark.record) : null;
  if (!mark || !owner) return [];
  const blocking = viewBlocking(records, view.sceneId, view.setupId);
  const all = (owner.kind === 'character' ? blocking.characters : blocking.cameras).find((o) => o.owner.id === owner.id)?.positions ?? [];
  // A camera's own item never moves: only its marks are reordered.
  const list = (owner.kind === 'camera' ? all.slice(1) : all).map((p) => p.record);
  const i = list.findIndex((r) => r.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const moved = [...list];
  moved.splice(i, 1);
  moved.splice(j, 0, mark.record);
  const sound = soundOrders(records, view.sceneId, owner);
  const orderIn = (r: SbdRecord | undefined): string | null => (r ? (sound.orders.get(r.id) ?? null) : null);
  let lo = orderIn(moved[j - 1]);
  let hi = orderIn(moved[j + 1]);
  // The owner's other marks the view doesn't show, between the two: passed as few as can be.
  for (const [other, own] of sound.orders) {
    if (other === id || (lo !== null && own <= lo) || (hi !== null && own >= hi)) continue;
    if (by === 1 && (hi === null || own < hi)) hi = own;
    if (by === -1 && (lo === null || own > lo)) lo = own;
  }
  return [...sound.changes, { kind: 'update', id, set: { order: keyBetween(lo, hi) } }];
}

/** What the Selection tile notes about a mark (6.7): a link that no longer reads, and a scene with no characters to give it. */
export interface MarkNotes {
  stale: 'character' | 'camera' | null;
  /** The scene has no characters yet, and the mark is nobody's. */
  noCharacters: boolean;
}

export function markNotes(records: Records, view: PlanViewOf, mark: SbdRecord): MarkNotes {
  return { stale: staleLink(records, mark), noCharacters: sceneCharacterIds(records, view.sceneId).length === 0 && markOwner(records, mark) === null };
}

/** Who the Library's "Cast mark" is placed for (castMarkFor). */
export type CastMarkTarget = { kind: 'next'; fromId: string } | { kind: 'first'; characterId: string };

/**
 * Who the Library's "Cast mark" lands as (6.7 review, L3), so the figure dragged is the one that lands: the next
 * position of the character whose mark is the one selected; else the first position of the scene's one character with
 * no position in the view yet; null when neither tells (it lands as a plain mark, to be given its character).
 */
export function castMarkFor(records: Records, view: PlanViewOf, selection: readonly string[]): CastMarkTarget | null {
  const [only] = selection;
  if (selection.length === 1 && only !== undefined && ownerIn(records, view, only)?.kind === 'character') return { kind: 'next', fromId: only };
  const placed = new Set(viewBlocking(records, view.sceneId, view.setupId).characters.map((c) => c.owner.id));
  const without = sceneCharacterIds(records, view.sceneId).filter((id) => !placed.has(id));
  const [one] = without;
  return without.length === 1 && one !== undefined ? { kind: 'first', characterId: one } : null;
}

/** "Plain mark": the marks' character or camera taken off (markOwnerChanges with no one). */
export const unlinkMarkChanges = (records: Records, view: PlanViewOf, ids: readonly string[], sizes: { character: MarkSize; plain: MarkSize }): Change[] =>
  markOwnerChanges(records, view, ids, { kind: 'plain' }, sizes);

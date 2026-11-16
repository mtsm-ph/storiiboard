import type { Change } from '../ops/ops';
import { OPENING_KINDS, openingFields, openingsOf, planFields, sceneRoomId, storedHeight, windowGlassHeight, type OpeningKind } from './plan';
import type { Props, SbdRecord } from './record';
import { childrenOf, recordsOfType } from './recordIndex';

// Heights for the 3D set later (6.5.6, Kevin Nov 16): a room's ceiling, a window's sill and top, a door's height. All
// optional, in metres in the file (docs/SBD_FORMAT.md, Schema v15), typed in the Selection tile in either unit. They draw
// nothing on the plan and print nothing: they are data that the MCP's `get_plan` and Phase 10's 3D scene read, through
// the readers here (roomHeights, openingHeights, planHeights). A missing prop means "not set".
//
// - The room (`plan` of kind `room`): `ceiling_height_m`, floor to ceiling.
// - A window: `sill_height_m`, floor to the bottom of the glass; `top_height_m`, floor to its top. With both set, its
//   height is top − sill (round 2): its own `height_m` stays in the file, unread, until either is cleared.
// - A door: `height_m`, the prop doors already carried since 6.2b (a height that's set is labelled on the plan and listed
//   in the legend, decision 11), so it is not a second prop.
//
// An edit is checked: each value above 0, a window's top above its sill, no sill, top or door's height above the ceiling
// of its room while one is set, and no ceiling under any of them. A refused edit writes nothing. The file can still hold
// a value past these (an undo, History's Put back, an import): readers read it as stored, and the Selection tile shows it
// with the line that says what's wrong.

type Records = Readonly<Record<string, SbdRecord>>;

/** A room's heights (6.5.6). */
export interface RoomHeights {
  /** `ceiling_height_m`: floor to ceiling, metres, or null when not set. */
  ceilingM: number | null;
}

/** A room's heights, from its `plan` props. */
export const roomHeights = (props: Props): RoomHeights => ({ ceilingM: storedHeight(props.ceiling_height_m) });

/** A door's or window's heights (6.5.6), metres, each null when not set. */
export interface OpeningHeights {
  kind: OpeningKind;
  /**
   * Its height: a window with both its sill and top set is top − sill (`heightFromGlass`); else its `height_m` (a door's
   * height, 6.2b; a window's as it has always been kept).
   */
  heightM: number | null;
  /** Whether `heightM` is a window's top − sill, not a stored `height_m`. */
  heightFromGlass: boolean;
  /** A window's `sill_height_m`: floor to the bottom of the glass. Always null for a door. */
  sillM: number | null;
  /** A window's `top_height_m`: floor to the top of the glass. Always null for a door. */
  topM: number | null;
}

/** A door's or window's heights, from its props; null for anything else. */
export function openingHeights(props: Props): OpeningHeights | null {
  const kind = OPENING_KINDS.find((k) => k === props.kind);
  if (!kind) return null;
  const window = kind === 'window';
  const glass = window ? windowGlassHeight(props) : null;
  return {
    kind,
    heightM: glass ?? storedHeight(props.height_m),
    heightFromGlass: glass !== null,
    sillM: window ? storedHeight(props.sill_height_m) : null,
    topM: window ? storedHeight(props.top_height_m) : null,
  };
}

/** A live room plan, or null. */
function liveRoom(records: Records, roomId: string | null): SbdRecord | null {
  if (roomId === null) return null;
  const room = records[roomId];
  return room?.type === 'plan' && room.trashedAt === null && planFields(room.props)?.kind === 'room' ? room : null;
}

/**
 * The room a door or window is in: its wall's plan when that is a room; for a wall in a scene's blocking or a setup's own
 * plan (one setup's only), that scene's room. Null when there is none.
 */
export function openingRoomId(records: Records, openingId: string): string | null {
  const opening = records[openingId];
  const fields = opening?.type === 'plan_item' ? openingFields(opening.props) : null;
  const wall = fields ? records[fields.wallId] : undefined;
  let plan = wall?.parentId ? records[wall.parentId] : undefined;
  for (let i = 0; plan && i < 4; i += 1) {
    if (plan.type === 'plan' && planFields(plan.props)?.kind === 'room') return liveRoom(records, plan.id)?.id ?? null;
    if (plan.type === 'scene') return sceneRoomId(records, plan);
    plan = plan.parentId ? records[plan.parentId] : undefined;
  }
  return null;
}

/** The ceiling over a door or window, metres, or null when its room has none set. */
export const ceilingOver = (records: Records, openingId: string): number | null => {
  const room = liveRoom(records, openingRoomId(records, openingId));
  return room ? roomHeights(room.props).ceilingM : null;
};

/** Why a height is refused: not above 0, a window's top not above its sill, above the ceiling, or a ceiling under an opening. */
export type HeightRefusal = 'notPositive' | 'topNotAboveSill' | 'aboveCeiling' | 'ceilingBelowWindow' | 'ceilingBelowDoor';

/** A refusal and the door or window it is for. */
export interface Refused {
  refused: HeightRefusal;
  id: string;
}

/** What the Selection tile changes on windows; a field left out stays as it is, null takes it off. */
export interface WindowHeightsPatch {
  sillM?: number | null;
  topM?: number | null;
}

/** Whether a window's sill and top, as they would be, are sound under a ceiling (null for none); null when they are. */
export function windowHeightsRefusal(sillM: number | null, topM: number | null, ceilingM: number | null): HeightRefusal | null {
  if ((sillM !== null && !(sillM > 0)) || (topM !== null && !(topM > 0))) return 'notPositive';
  if (sillM !== null && topM !== null && topM <= sillM) return 'topNotAboveSill';
  if (ceilingM !== null && ((sillM !== null && sillM > ceilingM) || (topM !== null && topM > ceilingM))) return 'aboveCeiling';
  return null;
}

/** What is wrong with a door's or window's heights as stored (an undo, a Put back, an import can leave them so), or null. */
export function storedHeightsRefusal(records: Records, openingId: string): HeightRefusal | null {
  const heights = openingHeights(records[openingId]?.props ?? {});
  if (!heights) return null;
  const ceiling = ceilingOver(records, openingId);
  if (heights.kind === 'door') return ceiling !== null && heights.heightM !== null && heights.heightM > ceiling ? 'aboveCeiling' : null;
  return windowHeightsRefusal(heights.sillM, heights.topM, ceiling);
}

const tidy = (m: number): number => Math.round(m * 10000) / 10000;

/**
 * A window's sill or top set or taken off on every selected window: one update each, one op group; a refusal (and nothing
 * written) when any of them would not be sound, naming that window. Doors and other items in the selection are left as
 * they are.
 */
export function windowHeightsChanges(records: Records, ids: readonly string[], patch: WindowHeightsPatch): { changes: Change[] } | Refused {
  const changes: Change[] = [];
  for (const id of ids) {
    const record = records[id];
    if (record?.type !== 'plan_item' || record.trashedAt !== null) continue;
    const now = openingHeights(record.props);
    if (now?.kind !== 'window') continue;
    const sillM = patch.sillM === undefined ? now.sillM : patch.sillM === null ? null : tidy(patch.sillM);
    const topM = patch.topM === undefined ? now.topM : patch.topM === null ? null : tidy(patch.topM);
    const refused = windowHeightsRefusal(sillM, topM, ceilingOver(records, id));
    if (refused) return { refused, id };
    const set: Props = {};
    const unset: string[] = [];
    for (const [prop, was, next] of [
      ['sill_height_m', now.sillM, sillM],
      ['top_height_m', now.topM, topM],
    ] as const) {
      if (next === was && (next !== null || !(prop in record.props))) continue;
      if (next === null) unset.push(prop);
      else set[prop] = next;
    }
    if (Object.keys(set).length === 0 && unset.length === 0) continue;
    changes.push({ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) });
  }
  return { changes };
}

/**
 * Whether a height typed on the selected doors (their `height_m`) goes above the ceiling of a door's room: the first such
 * door, or null. Windows and other items are not checked here (a window's height_m is not the glass's while its sill and
 * top are set; on its own it is kept as before).
 */
export function doorHeightRefusal(records: Records, ids: readonly string[], heightM: number | null): Refused | null {
  if (heightM === null) return null;
  for (const id of ids) {
    const record = records[id];
    if (record?.type !== 'plan_item' || record.trashedAt !== null || record.props.kind !== 'door') continue;
    const ceiling = ceilingOver(records, id);
    if (ceiling !== null && heightM > ceiling) return { refused: 'aboveCeiling', id };
  }
  return null;
}

/**
 * Every live door and window whose room this is (openingRoomId): in the room's own walls, and in walls a scene set there
 * keeps in its blocking or a setup's own plan. Read from the plan items alone, only when a ceiling is edited.
 */
function openingsUnder(records: Records, roomId: string): { id: string; heights: OpeningHeights }[] {
  return recordsOfType(records, 'plan_item').flatMap((record) => {
    if (record.trashedAt !== null || (record.props.kind !== 'door' && record.props.kind !== 'window')) return [];
    const heights = openingHeights(record.props);
    return heights && openingRoomId(records, record.id) === roomId ? [{ id: record.id, heights }] : [];
  });
}

/**
 * A room's ceiling set or taken off (null), one op; a refusal when it is not above 0, or would be under a window's sill or
 * top or a door's height in the room (openingsUnder), naming the first; nothing when it reads so already or the room isn't
 * live.
 */
export function ceilingHeightChanges(records: Records, roomId: string, ceilingM: number | null): { changes: Change[] } | { refused: HeightRefusal; id?: string } {
  const room = liveRoom(records, roomId);
  if (!room) return { changes: [] };
  if (ceilingM === null) return { changes: 'ceiling_height_m' in room.props ? [{ kind: 'update', id: roomId, unset: ['ceiling_height_m'] }] : [] };
  if (!(ceilingM > 0)) return { refused: 'notPositive' };
  const next = tidy(ceilingM);
  for (const { id, heights } of openingsUnder(records, roomId)) {
    if (heights.kind === 'window' && ((heights.sillM ?? 0) > next || (heights.topM ?? 0) > next)) return { refused: 'ceilingBelowWindow', id };
    if (heights.kind === 'door' && (heights.heightM ?? 0) > next) return { refused: 'ceilingBelowDoor', id };
  }
  if (room.props.ceiling_height_m === next) return { changes: [] };
  return { changes: [{ kind: 'update', id: roomId, set: { ceiling_height_m: next } }] };
}

/** Whether a room's ceiling as stored sits under one of its openings (an undo can leave it so): the first, or null. */
export function storedCeilingRefusal(records: Records, roomId: string): Refused | null {
  const room = liveRoom(records, roomId);
  const ceiling = room ? roomHeights(room.props).ceilingM : null;
  if (ceiling === null) return null;
  for (const { id, heights } of openingsUnder(records, roomId)) {
    if (heights.kind === 'window' && ((heights.sillM ?? 0) > ceiling || (heights.topM ?? 0) > ceiling)) return { refused: 'ceilingBelowWindow', id };
    if (heights.kind === 'door' && (heights.heightM ?? 0) > ceiling) return { refused: 'ceilingBelowDoor', id };
  }
  return null;
}

/**
 * A room's heights for the MCP's `get_plan` and Phase 10's 3D set (6.5.6): its ceiling, and every live door and window in
 * its own walls with theirs, metres, each null when not set; a window with both sill and top is as high as top − sill.
 * Computed from the records, never stored.
 */
export interface PlanHeights {
  roomId: string;
  ceilingM: number | null;
  openings: (OpeningHeights & { id: string; wallId: string })[];
}

/** A room's heights (PlanHeights), or null when it isn't a live room. */
export function planHeights(records: Records, roomId: string): PlanHeights | null {
  const room = liveRoom(records, roomId);
  if (!room) return null;
  const openings = childrenOf(records, roomId, 'plan_item')
    .filter((wall) => wall.trashedAt === null && wall.props.kind === 'wall')
    .flatMap((wall) =>
      openingsOf(records, wall.id).flatMap((o) => {
        const heights = openingHeights(o.record.props);
        return heights ? [{ id: o.record.id, wallId: wall.id, ...heights }] : [];
      }),
    );
  return { roomId, ceilingM: roomHeights(room.props).ceilingM, openings };
}

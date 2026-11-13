import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { MIN_SIZE, pasted, tidy } from '../../ui/canvas/placement';
import { endPoint, sideNormal, type Anchor } from '../../ui/canvas/routing';
import type { CanvasLink, ConnectDrop, Geometry, Head, LinkEnd, Point, Route, Side } from '../../ui/canvas/types';
import { isAttached } from '../../ui/canvas/types';
import {
  attachedItems,
  cleanWidth,
  connectorFields,
  DEFAULT_CONNECTOR_WIDTH,
  endProps,
  HEADS,
  isConnector,
  ROUTES,
  type ConnectorFields,
} from './connectorFields';
import { announcedAs, createItems, keepTop, estimateTextHeight, isTextKind, itemFields, itemsOf, seedWithText, type ItemSeed, type MeasureText } from './items';

// Connectors on a board (5.2, docs/SBD_FORMAT.md, Boards): which show, what the canvas is given, and the edits that make,
// change, copy and paste them. An end that is attached follows its item live, so moving, resizing or turning an item never
// writes to its connectors. A connector with a trashed or missing end is hidden until the item is back.

type Records = Readonly<Record<string, SbdRecord>>;

const byKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Whether an item is there to be joined: a live item of this board that this version shows. */
function liveItem(records: Records, boardId: string, id: string): boolean {
  const r = records[id];
  return r?.type === 'board_item' && r.parentId === boardId && r.trashedAt === null && itemFields(r.props) !== null;
}

/** The board's connectors back to front. Live ones whose ends are all live by default; with `withTrashed`, every one. */
export function connectorsOf(records: Records, boardId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => {
      if (!isConnector(r) || r.parentId !== boardId) return false;
      const fields = connectorFields(r.props);
      if (!fields) return false;
      if (withTrashed) return true;
      return r.trashedAt === null && attachedItems(fields).every((id) => liveItem(records, boardId, id));
    })
    .sort(byKey);
}

/** What a screen reader hears for one end: the item by its own name, or "a point". */
function endName(records: Records, end: LinkEnd): string {
  if (!isAttached(end)) return t('moodboard.connector.point');
  const fields = itemFields(records[end.item]?.props ?? {});
  return fields ? announcedAs(records, end.item, fields) : t('moodboard.connector.point');
}

/** What the canvas draws for connectors, back to front. */
export function canvasLinks(records: Records, boardId: string): CanvasLink[] {
  return connectorsOf(records, boardId).flatMap((record) => {
    const f = connectorFields(record.props);
    if (!f) return [];
    return [
      {
        id: record.id,
        label: t('moodboard.announce.connector', { from: endName(records, f.from), to: endName(records, f.to) }),
        from: f.from,
        to: f.to,
        route: f.route,
        startHead: f.startHead,
        endHead: f.endHead,
        color: f.color,
        width: f.width,
        text: f.label,
      },
    ];
  });
}

/** Whether a connector went to the Trash in the same op group as one of its items (so the Trash lists the item, not it). */
export function trashedWithItem(records: Records, connector: SbdRecord): boolean {
  if (connector.trashedAt === null) return false;
  const fields = connectorFields(connector.props);
  return (
    fields !== null &&
    attachedItems(fields).some((id) => {
      const item = records[id];
      return item !== undefined && item.trashedAt === connector.trashedAt && item.trashedBy === connector.trashedBy;
    })
  );
}

/**
 * The connectors that come back with an item restored: the ones trashed with it (the same op group), even when their other
 * end is still in the Trash: such a connector stays hidden until that item is back, and is never listed on its own.
 */
export function connectorsToRestore(records: Records, itemId: string): string[] {
  const item = records[itemId];
  if (!item) return [];
  return Object.values(records)
    .filter((r) => {
      if (!isConnector(r) || r.trashedAt === null || r.trashedAt !== item.trashedAt || r.trashedBy !== item.trashedBy) return false;
      const fields = connectorFields(r.props);
      return fields !== null && attachedItems(fields).includes(itemId);
    })
    .map((r) => r.id);
}

const firstKey = (records: Records, boardId: string): string | null =>
  Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .reduce<string | null>((first, r) => (first === null || r.sortKey < first ? r.sortKey : first), null);

/** What a new connector is written with: its kind's own props, nothing it doesn't use. */
export function connectorProps(fields: Partial<ConnectorFields> & { from: LinkEnd; to: LinkEnd }): Record<string, string | number | boolean | Record<string, string | number>> {
  const props: Record<string, string | number | boolean | Record<string, string | number>> = {
    kind: 'connector',
    from: endProps(fields.from) as Record<string, string | number>,
    to: endProps(fields.to) as Record<string, string | number>,
    route: fields.route ?? 'straight',
    start_head: fields.startHead ?? 'none',
    end_head: fields.endHead ?? 'arrow',
    width: fields.width ?? DEFAULT_CONNECTOR_WIDTH,
  };
  if (fields.color) props.color = fields.color;
  if (fields.label) props.label = fields.label;
  return props;
}

/** Connectors made at the back of the board, in order, so they draw under the items they join. */
export function createConnectors(records: Records, boardId: string, made: readonly (Partial<ConnectorFields> & { from: LinkEnd; to: LinkEnd })[]): { ids: string[]; changes: Change[] } {
  const first = firstKey(records, boardId);
  let previous: string | null = null;
  const ids: string[] = [];
  const changes: Change[] = [];
  for (const fields of made) {
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, first);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey, props: connectorProps(fields) } });
  }
  return { ids, changes };
}

const sameEnd = (a: LinkEnd, b: LinkEnd) => JSON.stringify(endProps(a)) === JSON.stringify(endProps(b));

/** Whether an end can be written: an attached end names a live item of the board. */
const endOk = (records: Records, boardId: string, end: LinkEnd) => !isAttached(end) || liveItem(records, boardId, end.item);

/**
 * A finished drag of a connector: a new one at the back of the board's order, or one end of an existing one moved. Nothing
 * for a connector joined to the same item at both ends, for an end whose item has gone, or for an end that didn't change.
 */
export function connectChanges(records: Records, boardId: string, drop: ConnectDrop): { id: string | null; changes: Change[] } {
  const { from, to } = drop;
  if (!endOk(records, boardId, from) || !endOk(records, boardId, to)) return { id: null, changes: [] };
  if (isAttached(from) && isAttached(to) && from.item === to.item) return { id: null, changes: [] };
  if (drop.id === null) {
    // Two free ends on the same point are a click, not a line.
    if (!isAttached(from) && !isAttached(to) && from.x === to.x && from.y === to.y) return { id: null, changes: [] };
    const made = createConnectors(records, boardId, [{ from, to }]);
    return { id: made.ids[0] ?? null, changes: made.changes };
  }
  const record = records[drop.id];
  const now = isConnector(record) && record.trashedAt === null ? connectorFields(record.props) : null;
  if (!record || !now) return { id: null, changes: [] };
  const set: Record<string, ReturnType<typeof endProps>> = {};
  if (!sameEnd(now.from, from)) set.from = endProps(from);
  if (!sameEnd(now.to, to)) set.to = endProps(to);
  if (Object.keys(set).length === 0) return { id: drop.id, changes: [] };
  return { id: drop.id, changes: [{ kind: 'update', id: drop.id, set }] };
}

/** A change from the properties strip for a connector. */
export interface ConnectorPatch {
  route?: Route;
  startHead?: Head;
  endHead?: Head;
  color?: string;
  width?: number;
  label?: string;
}

/** A connector's look changed on several at once: one update per connector that has something to change. */
export function connectorStyleChanges(records: Records, ids: readonly string[], patch: ConnectorPatch): Change[] {
  return ids.flatMap((id): Change[] => {
    const record = records[id];
    const now = isConnector(record) && record.trashedAt === null ? connectorFields(record.props) : null;
    if (!now) return [];
    const set: Record<string, string | number> = {};
    const unset: string[] = [];
    if (patch.route !== undefined && ROUTES.includes(patch.route) && patch.route !== now.route) set.route = patch.route;
    if (patch.startHead !== undefined && HEADS.includes(patch.startHead) && patch.startHead !== now.startHead) set.start_head = patch.startHead;
    if (patch.endHead !== undefined && HEADS.includes(patch.endHead) && patch.endHead !== now.endHead) set.end_head = patch.endHead;
    if (patch.color !== undefined && patch.color !== now.color) set.color = patch.color;
    if (patch.width !== undefined) {
      const width = cleanWidth(patch.width);
      if (width !== now.width) set.width = width;
    }
    if (patch.label !== undefined && patch.label !== now.label) {
      if (patch.label === '') unset.push('label');
      else set.label = patch.label;
    }
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/** A connector's label after editing in place ended on it. */
export const labelChanges = (records: Records, id: string, text: string): Change[] => connectorStyleChanges(records, [id], { label: text });

// ---- Quick-create ----------------------------------------------------------------------------------------------------

export const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** How far apart the two boxes' edges are in a quick-created copy. */
export const QUICK_GAP = 80;

/**
 * The copy a quick-create makes of a sticky, shape or text box: its kind and style with no text, beyond one of its sides by
 * 80 units between the edges, aligned to it and turned as it is. A text box's height is the one line an empty box takes.
 * Null for a picture, a video card, a link or an item that isn't there.
 */
export function quickSeedOf(records: Records, boardId: string, itemId: string, side: Side, measure: MeasureText = estimateTextHeight): ItemSeed | null {
  const record = records[itemId];
  const fields = record?.type === 'board_item' && record.parentId === boardId && record.trashedAt === null ? itemFields(record.props) : null;
  if (!fields || fields.kind === 'picture' || fields.kind === 'video' || fields.kind === 'link') return null;
  let seed: ItemSeed = { ...fields, text: '' };
  if (fields.kind === 'text') seed = seedWithText(seed, '', measure);
  const height = Math.max(MIN_SIZE, seed.height);
  const away = sideNormal(fields, side);
  // Between the middles: half the original, the gap, half the copy, along the side's own axis.
  const sideways = side === 'left' || side === 'right';
  const reach = (sideways ? fields.width : fields.height) / 2 + QUICK_GAP + (sideways ? seed.width : height) / 2;
  const middle = { x: fields.x + fields.width / 2 + away.x * reach, y: fields.y + fields.height / 2 + away.y * reach };
  return { ...seed, x: tidy(middle.x - seed.width / 2), y: tidy(middle.y - height / 2), height };
}

/**
 * A quick-created text box after its words made it taller: it grows away from the item it came from, so the gap stays 80.
 * Above (side top) its bottom edge stays, below its top edge stays, and to the sides it stays centred on the original.
 */
export function grownQuickSeed(before: ItemSeed, after: ItemSeed, side: Side): ItemSeed {
  const grow = after.height - before.height;
  if (grow === 0 || side === 'bottom') return { ...after, ...(side === 'bottom' ? keepTop(before, after.height) : {}) };
  // Left and right keep the middle; top moves it up by half the growth, along the box's own turned axis.
  const shift = side === 'top' ? -grow / 2 : 0;
  const turn = (before.rotation * Math.PI) / 180;
  const cx = before.x + before.width / 2 - Math.sin(turn) * shift;
  const cy = before.y + before.height / 2 + Math.cos(turn) * shift;
  return { ...after, x: tidy(cx - after.width / 2), y: tidy(cy - after.height / 2) };
}

/**
 * A copy of a sticky or shape beyond one of an item's sides, and a connector from the side to the copy's facing side:
 * item and connector in one group. (A text box is typed into before it exists: see `quickCreate` in boardActions.)
 */
export function quickCreateChanges(
  records: Records,
  boardId: string,
  itemId: string,
  side: Side,
  measure: MeasureText = estimateTextHeight,
): { itemId: string; connectorId: string; changes: Change[]; edit: boolean } | null {
  const seed = quickSeedOf(records, boardId, itemId, side, measure);
  if (!seed) return null;
  const made = createItems(records, boardId, [seed]);
  const newId = made.ids[0] as string;
  const joined = createConnectors(records, boardId, [{ from: { item: itemId, side }, to: { item: newId, side: OPPOSITE[side] } }]);
  return { itemId: newId, connectorId: joined.ids[0] as string, changes: [...made.changes, ...joined.changes], edit: isTextKind(seed.kind) };
}

// ---- Copy and paste ---------------------------------------------------------------------------------------------------

/**
 * An end in a copy: attached to the item that is the n-th of the copied ones (`at` is where it was, kept if that item isn't
 * pasted), or free. A free end that was an item's, copied without it, stays where it was (`moves: false`); one that
 * was free moves with what is pasted.
 */
export type ClipEnd = { item: number; side: Side | 'auto'; at: Point } | { x: number; y: number; moves: boolean };

export interface ClipConnector extends Omit<ConnectorFields, 'from' | 'to'> {
  from: ClipEnd;
  to: ClipEnd;
}

const anchorFor = (records: Records, end: LinkEnd): Anchor | null => {
  if (!isAttached(end)) return { point: { x: end.x, y: end.y } };
  const fields = itemFields(records[end.item]?.props ?? {});
  return fields ? { box: fields, side: end.side } : null;
};

/** What Copy keeps of the selected connectors, given which items are copied with them (their ids, in the copy's order). */
export function clipConnectorsOf(records: Records, boardId: string, selected: readonly string[]): ClipConnector[] {
  const copied = itemsOf(records, boardId)
    .filter((r) => selected.includes(r.id))
    .map((r) => r.id);
  return connectorsOf(records, boardId)
    .filter((r) => selected.includes(r.id))
    .flatMap((record): ClipConnector[] => {
      const f = connectorFields(record.props);
      const a = f ? anchorFor(records, f.from) : null;
      const b = f ? anchorFor(records, f.to) : null;
      if (!f || !a || !b) return [];
      const clipEnd = (end: LinkEnd, mine: Anchor, other: Anchor): ClipEnd => {
        if (!isAttached(end)) return { x: end.x, y: end.y, moves: true };
        const index = copied.indexOf(end.item);
        const at = endPoint(mine, other);
        // An item not copied with it: the end stays where it is.
        return index >= 0 ? { item: index, side: end.side, at } : { x: at.x, y: at.y, moves: false };
      };
      return [{ route: f.route, startHead: f.startHead, endHead: f.endHead, color: f.color, width: f.width, label: f.label, from: clipEnd(f.from, a, b), to: clipEnd(f.to, b, a) }];
    });
}

/**
 * Pasted connectors: an end on a pasted item is attached to its copy; one whose item was left out of the paste is free
 * where it was; a free end that was free moves with the paste by `delta`. `newIds[n]` is the copy of the n-th copied item,
 * or null where it was left out.
 */
export function pasteConnectorChanges(
  records: Records,
  boardId: string,
  connectors: readonly ClipConnector[],
  newIds: readonly (string | null)[],
  delta: Point,
): { ids: string[]; changes: Change[] } {
  // Connectors pasted without any item: every end is free, and all of them move, or the copy would sit on the original.
  const alone = newIds.every((id) => id === null);
  const end = (e: ClipEnd): LinkEnd => {
    if ('item' in e) {
      const id = newIds[e.item];
      if (id) return { item: id, side: e.side };
      return alone ? { x: tidy(e.at.x + delta.x), y: tidy(e.at.y + delta.y) } : { x: e.at.x, y: e.at.y };
    }
    return e.moves || alone ? { x: tidy(e.x + delta.x), y: tidy(e.y + delta.y) } : { x: e.x, y: e.y };
  };
  return createConnectors(
    records,
    boardId,
    connectors.map((c) => ({ from: end(c.from), to: end(c.to), route: c.route, startHead: c.startHead, endHead: c.endHead, color: c.color, width: c.width, label: c.label })),
  );
}

/** How far a paste moves what it pastes: from the first pasted item, else from where the free ends are. */
export function pasteDelta(items: readonly Geometry[], connectors: readonly ClipConnector[], at: Point | null): Point {
  if (items.length > 0) {
    const [moved] = pasted(items, at);
    const [first] = items;
    return moved && first ? { x: moved.x - first.x, y: moved.y - first.y } : { x: 0, y: 0 };
  }
  // Without items every end moves, so every end counts for where the group is.
  const points = connectors.flatMap((c) => [c.from, c.to]).map((e) => ({ x: 'item' in e ? e.at.x : e.x, y: 'item' in e ? e.at.y : e.y, width: 0, height: 0, rotation: 0 }));
  const [moved] = pasted(points, at);
  const [first] = points;
  return moved && first ? { x: moved.x - first.x, y: moved.y - first.y } : { x: 0, y: 0 };
}

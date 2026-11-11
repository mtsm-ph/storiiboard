import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { atLeastMinimum, pasted, tidy } from '../../ui/canvas/placement';
import type { CanvasItem, Geometry, GeometryChange, ReorderMode } from '../../ui/canvas/types';
import { reordered, sortKeysFor } from '../../ui/canvas/zOrder';

// A board's items (5.0, docs/SBD_FORMAT.md, Boards): `board_item` records under their board. 5.0 has one kind, a
// rectangle. Z order is the sibling order: the first is at the back, and bringing to the front is a `move` to the last key.

type Records = Readonly<Record<string, SbdRecord>>;

export type ItemKind = 'rect';

export interface ItemFields extends Geometry {
  kind: ItemKind;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** An item's props, or null when they aren't an item this version knows (a kind from a later version stays in the file, unseen). */
export function itemFields(props: SbdRecord['props']): ItemFields | null {
  if (props.kind !== 'rect') return null;
  const x = num(props.x);
  const y = num(props.y);
  const width = num(props.width);
  const height = num(props.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { kind: 'rect', x, y, width: atLeastMinimum(width), height: atLeastMinimum(height), rotation: num(props.rotation) ?? 0 };
}

/** The board's live items, back to front. */
export function itemsOf(records: Records, boardId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId && (withTrashed || r.trashedAt === null) && itemFields(r.props) !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

export const KIND_LABEL: Readonly<Record<ItemKind, () => string>> = { rect: () => t('moodboard.item.rect') };

/** What the canvas draws, back to front. */
export function canvasItems(records: Records, boardId: string): CanvasItem[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = itemFields(record.props);
    return fields ? [{ id: record.id, x: fields.x, y: fields.y, width: fields.width, height: fields.height, rotation: fields.rotation, label: KIND_LABEL[fields.kind]() }] : [];
  });
}

const geometryProps = (g: Geometry) => ({ x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation });

const lastKey = (records: Records, boardId: string): string | null => itemsOf(records, boardId, true).at(-1)?.sortKey ?? null;

/** Rectangles made at the front, in order, each after the last. */
export function createRects(records: Records, boardId: string, geometries: readonly Geometry[]): { ids: string[]; changes: Change[] } {
  let previous = lastKey(records, boardId);
  const ids: string[] = [];
  const changes: Change[] = [];
  for (const g of geometries) {
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'board_item', parentId: boardId, sortKey, props: { kind: 'rect', ...geometryProps(g) } } });
  }
  return { ids, changes };
}

/**
 * A finished move, resize or rotate: one update per item that changed, all one op group. An item whose props already
 * equal the new ones is left out, so the canvas never writes an empty step.
 */
export function geometryChanges(records: Records, changes: readonly GeometryChange[]): Change[] {
  return changes.flatMap((c): Change[] => {
    const record = records[c.id];
    if (record?.type !== 'board_item' || record.trashedAt !== null) return [];
    const set = geometryProps(c);
    // Against the item as it reads (a missing rotation is 0), so a drag back to where it began writes nothing.
    const now = itemFields(record.props);
    if (now && Object.entries(set).every(([key, value]) => now[key as keyof typeof now] === value)) return [];
    return [{ kind: 'update', id: c.id, set }];
  });
}

/**
 * A nudge: a distance, added to each item as it is when the edit is written, so two quick presses make 2 units, not the
 * same 1 twice.
 */
export function nudgeChanges(records: Records, ids: readonly string[], dx: number, dy: number): Change[] {
  return ids.flatMap((id): Change[] => {
    const fields = records[id]?.type === 'board_item' && records[id].trashedAt === null ? itemFields(records[id].props) : null;
    if (!fields) return [];
    return geometryChanges(records, [{ id, ...fields, x: tidy(fields.x + dx), y: tidy(fields.y + dy) }]);
  });
}

/** A reorder of the selected items: `move`s for them alone, to keys that give the new order. */
export function reorderChanges(records: Records, boardId: string, selected: readonly string[], mode: ReorderMode): Change[] {
  const live = itemsOf(records, boardId);
  const liveIds = live.map((r) => r.id);
  const chosen = new Set(selected.filter((id) => liveIds.includes(id)));
  const nextLive = reordered(liveIds, chosen, mode);
  // Already where it was asked to go among the items that show: nothing to write, whatever the Trash holds.
  if (nextLive.every((id, i) => id === liveIds[i])) return [];
  // Every sibling holds a key, the Trash's and the kinds this version doesn't show too: they never move, and a new key
  // is made between them, or it could equal one of theirs and tie when they come back.
  const all = Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((r) => r.id);
  const fixed = all.filter((id) => !chosen.has(id));
  let after: string[];
  if (mode === 'front') after = [...fixed, ...nextLive.filter((id) => chosen.has(id))];
  else if (mode === 'back') after = [...nextLive.filter((id) => chosen.has(id)), ...fixed];
  else {
    after = [...fixed];
    // Each moved item goes right after the item before it in the new live order.
    nextLive.forEach((id, i) => {
      if (!chosen.has(id)) return;
      const before = nextLive[i - 1];
      after.splice(before === undefined ? 0 : after.indexOf(before) + 1, 0, id);
    });
  }
  const keys = sortKeysFor(all, after, new Map(all.map((id) => [id, records[id]?.sortKey ?? ''])), chosen);
  return [...keys].map(([id, sortKey]): Change => ({ kind: 'move', id, parentId: boardId, sortKey }));
}

/** The items to the Trash, in one group. */
export function trashItemsChanges(records: Records, ids: readonly string[]): Change[] {
  return ids.filter((id) => records[id]?.type === 'board_item' && records[id].trashedAt === null).map((id): Change => ({ kind: 'trash', id }));
}

/** What Copy keeps: the selected items' kind and geometry, back to front. */
export interface ClipItem extends Geometry {
  kind: ItemKind;
}

export function clipOf(records: Records, boardId: string, selected: readonly string[]): ClipItem[] {
  return itemsOf(records, boardId).flatMap((record) => {
    const fields = selected.includes(record.id) ? itemFields(record.props) : null;
    return fields ? [fields] : [];
  });
}

/** Pasted at the pointer or offset 16 units from the originals, at the front. */
export function pasteChanges(records: Records, boardId: string, clip: readonly ClipItem[], at: { x: number; y: number } | null): { ids: string[]; changes: Change[] } {
  return createRects(records, boardId, pasted(clip, at));
}

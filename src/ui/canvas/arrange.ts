import { boundsOf } from './hitTest';
import { tidy } from './placement';
import type { AlignMode, Axis, Geometry, GeometryChange, Rect, TidyMode } from './types';
import { unionBounds } from './viewport';

// Align, distribute and Tidy up (5.3) as pure functions of boxes: they know nothing of boards. Each item counts by the
// upright rectangle round it (boundsOf, rotation included), and moving an item by some distance moves that rectangle by
// the same distance, so a turned item aligns by what is seen. Each returns the finished geometry of the items that move.

type Boxed = Geometry & { id: string };

/** How far apart Tidy up puts items, in world units. */
export const TIDY_GAP = 24;

/** The change that moves an item by a distance; null when that is no move at all (after rounding to two decimals). */
function moveBy(item: Boxed, dx: number, dy: number): GeometryChange | null {
  const x = tidy(item.x + dx);
  const y = tidy(item.y + dy);
  return x === item.x && y === item.y ? null : { id: item.id, x, y, width: item.width, height: item.height, rotation: item.rotation };
}

/** Moves each item so its rectangle's top left corner is at the given place. */
const placeAt = (item: Boxed, bounds: Rect, x: number, y: number): GeometryChange | null => moveBy(item, x - bounds.x, y - bounds.y);

const present = (changes: readonly (GeometryChange | null)[]): GeometryChange[] => changes.filter((c): c is GeometryChange => c !== null);

/** Aligns two or more items to the selection's bounds: their left, centre or right edges, or their top, middle or bottom. */
export function alignItems(items: readonly Boxed[], mode: AlignMode): GeometryChange[] {
  if (items.length < 2) return [];
  const boxes = items.map((item) => ({ item, b: boundsOf(item) }));
  const all = unionBounds(boxes.map((box) => box.b));
  if (!all) return [];
  return present(
    boxes.map(({ item, b }) => {
      switch (mode) {
        case 'left':
          return moveBy(item, all.x - b.x, 0);
        case 'center':
          return moveBy(item, all.x + all.width / 2 - (b.x + b.width / 2), 0);
        case 'right':
          return moveBy(item, all.x + all.width - (b.x + b.width), 0);
        case 'top':
          return moveBy(item, 0, all.y - b.y);
        case 'middle':
          return moveBy(item, 0, all.y + all.height / 2 - (b.y + b.height / 2));
        case 'bottom':
          return moveBy(item, 0, all.y + all.height - (b.y + b.height));
      }
    }),
  );
}

/**
 * Three or more items with equal gaps between neighbours along an axis, the outermost two staying put. They are taken in
 * the order of their middles; the room left between the outer two, once the items are laid end to end, is shared out
 * equally (a negative share, for items that overlap, is shared out the same way).
 */
export function distributeItems(items: readonly Boxed[], axis: Axis): GeometryChange[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'horizontal';
  const boxes = items
    .map((item) => ({ item, b: boundsOf(item) }))
    .sort((p, q) => (horizontal ? p.b.x + p.b.width / 2 - (q.b.x + q.b.width / 2) : p.b.y + p.b.height / 2 - (q.b.y + q.b.height / 2)));
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (!first || !last) return [];
  const start = horizontal ? first.b.x : first.b.y;
  const end = horizontal ? last.b.x + last.b.width : last.b.y + last.b.height;
  const total = boxes.reduce((sum, { b }) => sum + (horizontal ? b.width : b.height), 0);
  const gap = (end - start - total) / (boxes.length - 1);
  let cursor = start;
  return present(
    boxes.map(({ item, b }) => {
      const at = cursor;
      cursor += (horizontal ? b.width : b.height) + gap;
      return horizontal ? moveBy(item, at - b.x, 0) : moveBy(item, 0, at - b.y);
    }),
  );
}

/**
 * Reading order: by top, then left, with the items that share a row (their vertical extents overlap the row's) grouped
 * and taken left to right. A row ends where the next item starts below everything in it.
 */
export function readingOrder<T extends Boxed>(items: readonly T[]): T[] {
  const sorted = items.map((item) => ({ item, b: boundsOf(item) })).sort((p, q) => p.b.y - q.b.y || p.b.x - q.b.x);
  const rows: { bottom: number; members: { item: T; b: Rect }[] }[] = [];
  for (const entry of sorted) {
    const row = rows[rows.length - 1];
    if (row && entry.b.y < row.bottom) {
      row.members.push(entry);
      row.bottom = Math.max(row.bottom, entry.b.y + entry.b.height);
    } else {
      rows.push({ bottom: entry.b.y + entry.b.height, members: [entry] });
    }
  }
  return rows.flatMap((row) => row.members.sort((p, q) => p.b.x - q.b.x).map((m) => m.item));
}

/** How many columns a grid of n items has. */
export const gridColumns = (n: number): number => Math.ceil(Math.sqrt(n));

/**
 * Two or more items as a row, a column or a grid, in reading order, 24 units apart, the selection's top left corner
 * kept. A grid's cells are as wide as the widest item and as tall as the tallest; an item sits at the top left of its cell.
 */
export function tidyItems(items: readonly Boxed[], mode: TidyMode): GeometryChange[] {
  if (items.length < 2) return [];
  const origin = unionBounds(items.map(boundsOf));
  if (!origin) return [];
  const ordered = readingOrder(items).map((item) => ({ item, b: boundsOf(item) }));
  if (mode === 'row' || mode === 'column') {
    let cursor = mode === 'row' ? origin.x : origin.y;
    return present(
      ordered.map(({ item, b }) => {
        const at = cursor;
        cursor += (mode === 'row' ? b.width : b.height) + TIDY_GAP;
        return mode === 'row' ? placeAt(item, b, at, origin.y) : placeAt(item, b, origin.x, at);
      }),
    );
  }
  const columns = gridColumns(ordered.length);
  const cellWidth = Math.max(...ordered.map(({ b }) => b.width));
  const cellHeight = Math.max(...ordered.map(({ b }) => b.height));
  return present(
    ordered.map(({ item, b }, i) =>
      placeAt(item, b, origin.x + (i % columns) * (cellWidth + TIDY_GAP), origin.y + Math.floor(i / columns) * (cellHeight + TIDY_GAP)),
    ),
  );
}

import { describe, expect, it } from 'vitest';
import { alignItems, distributeItems, gridColumns, readingOrder, TIDY_GAP, tidyItems } from './arrange';
import { boundsOf } from './hitTest';
import type { Geometry, GeometryChange, Rect } from './types';

// Align, distribute and Tidy up (5.3): pure functions of boxes, each item counted by the upright rectangle round it.

const box = (id: string, x: number, y: number, width: number, height: number, rotation = 0): Geometry & { id: string } => ({ id, x, y, width, height, rotation });

/** The items after the changes are applied. */
const applied = <T extends Geometry & { id: string }>(items: readonly T[], changes: readonly GeometryChange[]): T[] =>
  items.map((item) => ({ ...item, ...(changes.find((c) => c.id === item.id) ?? {}) }));

const edges = (items: readonly (Geometry & { id: string })[]) => items.map((item) => boundsOf(item));
const close = (a: number, b: number) => Math.abs(a - b) < 0.02;

describe('align', () => {
  const items = [box('a', 10, 100, 40, 20), box('b', 80, 20, 100, 60), box('c', 200, 300, 20, 50)];

  it('left, centre and right bring the rectangles’ edges or middles to the selection’s', () => {
    const left = edges(applied(items, alignItems(items, 'left')));
    expect(left.map((b) => b.x)).toEqual([10, 10, 10]);
    const right = edges(applied(items, alignItems(items, 'right')));
    expect(right.map((b) => b.x + b.width)).toEqual([220, 220, 220]);
    const centre = edges(applied(items, alignItems(items, 'center')));
    expect(centre.map((b) => b.x + b.width / 2)).toEqual([115, 115, 115]);
  });

  it('top, middle and bottom do the same down the page', () => {
    expect(edges(applied(items, alignItems(items, 'top'))).map((b) => b.y)).toEqual([20, 20, 20]);
    expect(edges(applied(items, alignItems(items, 'bottom'))).map((b) => b.y + b.height)).toEqual([350, 350, 350]);
    expect(edges(applied(items, alignItems(items, 'middle'))).map((b) => b.y + b.height / 2)).toEqual([185, 185, 185]);
  });

  it('moves only the items that are not there already, and changes only their place', () => {
    const changes = alignItems(items, 'left');
    expect(changes.map((c) => c.id)).toEqual(['b', 'c']);
    expect(changes[0]).toMatchObject({ x: 10, y: 20, width: 100, height: 60, rotation: 0 });
  });

  it('counts a turned item by the rectangle round it', () => {
    // 100 x 20 turned 90 degrees stands 20 wide and 100 tall about its middle: its left edge is 40 to the right of x.
    const turned = [box('t', 0, 0, 100, 20, 90), box('s', 300, 0, 50, 50)];
    const rectangle = boundsOf(turned[0] as Geometry);
    expect(rectangle.width).toBeCloseTo(20);
    expect(rectangle.height).toBeCloseTo(100);
    const after = applied(turned, alignItems(turned, 'left'));
    expect(boundsOf(after[1] as Geometry).x).toBeCloseTo(rectangle.x);
    // Aligning the bottoms puts the turned item’s lower edge, not its box’s, on the line.
    const [one, two] = edges(applied(turned, alignItems(turned, 'bottom'))) as [Rect, Rect];
    expect(close(one.y + one.height, two.y + two.height)).toBe(true);
  });

  it('does nothing for fewer than two items or items already aligned', () => {
    expect(alignItems([box('a', 0, 0, 10, 10)], 'left')).toEqual([]);
    expect(alignItems([box('a', 5, 0, 10, 10), box('b', 5, 40, 30, 10)], 'left')).toEqual([]);
  });
});

describe('distribute', () => {
  it('shares the room between three or more items as equal gaps, the outermost staying put', () => {
    const items = [box('a', 0, 0, 100, 20), box('b', 130, 50, 60, 20), box('c', 500, 10, 40, 20), box('d', 260, 90, 20, 20)];
    const after = applied(items, distributeItems(items, 'horizontal'));
    const rects = edges(after).sort((p, q) => p.x - q.x);
    // 540 across, 220 of items: 320 shared by three gaps.
    expect(rects[0]?.x).toBe(0);
    expect(rects[3]?.x).toBe(500);
    const gaps = [1, 2, 3].map((i) => (rects[i] as { x: number }).x - ((rects[i - 1] as { x: number; width: number }).x + (rects[i - 1] as { width: number }).width));
    for (const gap of gaps) expect(gap).toBeCloseTo(320 / 3, 1);
    // The outer two are not in the changes at all.
    expect(distributeItems(items, 'horizontal').map((c) => c.id).sort()).toEqual(['b', 'd']);
  });

  it('distributes vertically, in the order of the middles, with mixed sizes', () => {
    const items = [box('a', 0, 0, 10, 50), box('b', 20, 400, 10, 10), box('c', 40, 90, 10, 100)];
    const after = applied(items, distributeItems(items, 'vertical'));
    const rects = edges(after).sort((p, q) => p.y - q.y);
    // 410 tall, 160 of items: 250 in two gaps.
    expect(rects[1]?.y).toBeCloseTo(50 + 125, 1);
    expect((rects[2] as { y: number }).y).toBe(400);
  });

  it('counts turned items by their rectangles', () => {
    const items = [box('a', 0, 0, 20, 20), box('t', 100, 100, 100, 20, 90), box('c', 300, 0, 20, 20)];
    const after = applied(items, distributeItems(items, 'horizontal'));
    const rects = edges(after);
    const gapA = (rects[1] as { x: number }).x - 20;
    const gapB = 300 - ((rects[1] as { x: number }).x + (rects[1] as { width: number }).width);
    expect(gapA).toBeCloseTo(gapB, 1);
  });

  it('needs three items', () => {
    expect(distributeItems([box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10)], 'horizontal')).toEqual([]);
  });
});

describe('Tidy up', () => {
  it('puts the items in reading order, rows grouped by overlap and each row left to right', () => {
    const items = [box('d', 10, 120, 50, 40), box('b', 200, 8, 50, 40), box('a', 10, 0, 50, 40), box('c', 100, 30, 50, 40)];
    // a, b and c share a row (their vertical extents overlap); d sits below.
    expect(readingOrder(items).map((i) => i.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('makes a row 24 apart from the selection’s top left corner', () => {
    const items = [box('a', 100, 50, 40, 30), box('b', 300, 70, 80, 60), box('c', 20, 200, 10, 10)];
    const after = applied(items, tidyItems(items, 'row'));
    const order = readingOrder(items).map((i) => after.find((a) => a.id === i.id) as Geometry & { id: string });
    // Reading order: a (top 50), b (top 70, overlaps a), c.
    expect(readingOrder(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    // The union's top left was (20, 50).
    expect(order.map((o) => [o.x, o.y])).toEqual([
      [20, 50],
      [20 + 40 + TIDY_GAP, 50],
      [20 + 40 + TIDY_GAP + 80 + TIDY_GAP, 50],
    ]);
  });

  it('makes a column the same way', () => {
    const items = [box('a', 100, 50, 40, 30), box('b', 300, 70, 80, 60)];
    const after = applied(items, tidyItems(items, 'column'));
    expect(after.map((o) => [o.x, o.y])).toEqual([
      [100, 50],
      [100, 50 + 30 + TIDY_GAP],
    ]);
  });

  it('makes a grid of ceil(sqrt n) columns, cells as wide as the widest and as tall as the tallest, items at their cell’s top left', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 4]);
    const items = Array.from({ length: 6 }, (_, i) => box(`i${String(i)}`, i * 500, 0, i === 3 ? 90 : 30 + i, i === 1 ? 70 : 20));
    const after = applied(items, tidyItems(items, 'grid'));
    // Six items, three columns, two rows; cells 90 wide and 70 tall, 24 apart; the corner stays at 0, 0.
    expect(after.map((o) => [o.x, o.y])).toEqual([
      [0, 0],
      [114, 0],
      [228, 0],
      [0, 94],
      [114, 94],
      [228, 94],
    ]);
  });

  it('keeps the top left corner of the selection and counts turned items by their rectangles', () => {
    const items = [box('a', 40, 40, 100, 20, 90), box('b', 400, 300, 50, 50)];
    const start = boundsOf(items[0] as Geometry);
    const after = applied(items, tidyItems(items, 'row'));
    const first = boundsOf(after[0] as Geometry);
    const second = boundsOf(after[1] as Geometry);
    expect(first.x).toBeCloseTo(start.x);
    expect(first.y).toBeCloseTo(start.y);
    expect(second.x).toBeCloseTo(start.x + 20 + TIDY_GAP);
    expect(second.y).toBeCloseTo(start.y);
  });

  it('does nothing for a single item, and writes nothing for items that are tidy already', () => {
    expect(tidyItems([box('a', 0, 0, 10, 10)], 'grid')).toEqual([]);
    const tidy = [box('a', 0, 0, 10, 10), box('b', 10 + TIDY_GAP, 0, 10, 10)];
    expect(tidyItems(tidy, 'row')).toEqual([]);
  });
});

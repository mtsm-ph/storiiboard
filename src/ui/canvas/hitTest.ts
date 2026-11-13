import type { Geometry, Point, Rect } from './types';

// Hit tests against rectangles that may be rotated (clockwise, round their centre), in world units.

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export const centreOf = (g: Geometry): Point => ({ x: g.x + g.width / 2, y: g.y + g.height / 2 });

/** The four corners in order from the top-left, after rotation. */
export function cornersOf(g: Geometry): [Point, Point, Point, Point] {
  const c = centreOf(g);
  const cos = Math.cos(radians(g.rotation));
  const sin = Math.sin(radians(g.rotation));
  const at = (dx: number, dy: number): Point => ({ x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos });
  const hw = g.width / 2;
  const hh = g.height / 2;
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/** The upright rectangle round an item, rotation included. */
export function boundsOf(g: Geometry): Rect {
  const corners = cornersOf(g);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const known = new WeakMap<object, { key: string; bounds: Rect }>();

/**
 * `boundsOf` for an item the canvas keeps (5.7): worked out once per item and place, however many frames ask. An item that
 * moves is a new object in the canvas's list, and one edited in place is told by its numbers, so nothing here goes stale.
 */
export function boundsFor(g: Geometry): Rect {
  const key = `${String(g.x)} ${String(g.y)} ${String(g.width)} ${String(g.height)} ${String(g.rotation)}`;
  const have = known.get(g);
  if (have?.key === key) return have.bounds;
  const bounds = boundsOf(g);
  known.set(g, { key, bounds });
  return bounds;
}

/** Whether a point is inside the item: the point is turned back by the item's rotation and tested against the box. */
export function hitsPoint(g: Geometry, point: Point): boolean {
  const c = centreOf(g);
  const cos = Math.cos(radians(-g.rotation));
  const sin = Math.sin(radians(-g.rotation));
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const local = { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  return Math.abs(local.x) <= g.width / 2 && Math.abs(local.y) <= g.height / 2;
}

/** The topmost item at a point; `inOrder` runs back to front, as the items are drawn. */
export function topmostAt<T extends Geometry>(inOrder: readonly T[], point: Point): T | undefined {
  for (let i = inOrder.length - 1; i >= 0; i -= 1) {
    const item = inOrder[i];
    if (item && hitsPoint(item, point)) return item;
  }
  return undefined;
}

type Poly = readonly Point[];

function projectOnto(poly: Poly, axis: Point): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    low = Math.min(low, d);
    high = Math.max(high, d);
  }
  return [low, high];
}

/** Separating-axis test between two convex rectangles. */
function polygonsMeet(a: Poly, b: Poly): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (!p || !q) continue;
      const axis = { x: q.y - p.y, y: p.x - q.x };
      const [aLow, aHigh] = projectOnto(a, axis);
      const [bLow, bHigh] = projectOnto(b, axis);
      if (aHigh < bLow || bHigh < aLow) return false;
    }
  }
  return true;
}

const polygonOf = (r: Rect): Poly => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];

/** Whether a marquee touches the item at all: a corner, an edge or the whole of it inside. */
export function marqueeTouches(g: Geometry, marquee: Rect): boolean {
  return polygonsMeet(cornersOf(g), polygonOf(marquee));
}

/** Whether the marquee holds the whole item. */
export function marqueeHolds(g: Geometry, marquee: Rect): boolean {
  return cornersOf(g).every((p) => p.x >= marquee.x && p.x <= marquee.x + marquee.width && p.y >= marquee.y && p.y <= marquee.y + marquee.height);
}

/** The rectangle two corners of a drag make, whichever way it was dragged. */
export function rectFromCorners(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

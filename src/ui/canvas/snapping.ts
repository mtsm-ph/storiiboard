import type { Point, Rect } from './types';
import { rectsMeet } from './viewport';

// Snap guides (5.3): while a selection is moved, its left, centre and right and its top, middle and bottom snap to the same
// lines of other items within 6 screen pixels, and the lines it aligns to are drawn until the gesture ends. Pure, over
// the upright rectangles of the items; which items count (not the ones being moved, not what a section carries) is the
// caller's to say.

/** How near (screen pixels) a line must be to take hold. */
export const SNAP_PIXELS = 6;
/** Lines this close (world units) are the same line. */
const SAME = 0.005;

/** A guide: a line at `at` across the x or y axis, from one end of what it joins to the other. */
export interface Guide {
  /** `x` is a vertical line at that x; `y` a horizontal line at that y. */
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** How far the moving rectangle is pulled, in world units. */
  dx: number;
  dy: number;
  guides: Guide[];
}

const lines = (r: Rect, axis: 'x' | 'y'): [number, number, number] =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];

/** The pull on one axis: the smallest distance, within the threshold, from any of the rectangle's lines to any target's. */
function pull(moving: Rect, targets: readonly Rect[], axis: 'x' | 'y', reach: number): number {
  const own = lines(moving, axis);
  let best = 0;
  let found = false;
  for (const target of targets) {
    for (const there of lines(target, axis)) {
      for (const here of own) {
        const d = there - here;
        if (Math.abs(d) <= reach && (!found || Math.abs(d) < Math.abs(best))) {
          best = d;
          found = true;
        }
      }
    }
  }
  return found ? best : 0;
}

/** The guides for a rectangle that is where it ends up: one per line it shares with a target, across all it joins. */
function guidesFor(moving: Rect, targets: readonly Rect[]): Guide[] {
  const guides: Guide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const across = axis === 'x' ? 'y' : 'x';
    const extent = (r: Rect): [number, number] => (across === 'x' ? [r.x, r.x + r.width] : [r.y, r.y + r.height]);
    const found = new Map<number, { from: number; to: number }>();
    for (const here of lines(moving, axis)) {
      for (const target of targets) {
        if (!lines(target, axis).some((there) => Math.abs(there - here) <= SAME)) continue;
        const [a, b] = extent(target);
        const [c, d] = extent(moving);
        const key = Math.round(here * 100);
        const old = found.get(key);
        found.set(key, { from: Math.min(old?.from ?? Infinity, a, c), to: Math.max(old?.to ?? -Infinity, b, d) });
      }
    }
    for (const [key, span] of found) guides.push({ axis, at: key / 100, from: span.from, to: span.to });
  }
  return guides;
}

/**
 * Where a moving rectangle snaps: each axis on its own, to the nearest line of the targets within 6 screen pixels at this
 * zoom. Targets out of `view` (when given) are left out, so the search stays quick with hundreds of items.
 */
export function snapRect(moving: Rect, targets: readonly Rect[], zoom: number, view?: Rect): SnapResult {
  const near = view ? targets.filter((target) => rectsMeet(target, view)) : targets;
  const reach = SNAP_PIXELS / zoom;
  const dx = pull(moving, near, 'x', reach);
  const dy = pull(moving, near, 'y', reach);
  const placed = { ...moving, x: moving.x + dx, y: moving.y + dy };
  return { dx, dy, guides: guidesFor(placed, near) };
}

/** A point snapped to the lines of the targets (a corner being drawn); the same rule as a rectangle with no size. */
export function snapPoint(point: Point, targets: readonly Rect[], zoom: number, view?: Rect): { point: Point; guides: Guide[] } {
  const result = snapRect({ x: point.x, y: point.y, width: 0, height: 0 }, targets, zoom, view);
  return { point: { x: point.x + result.dx, y: point.y + result.dy }, guides: result.guides };
}

/**
 * A move's distance after snapping: `bounds` is the moving selection's rectangle with the distance (dx, dy) already
 * applied. With `off` (Ctrl, or ⌘ on a Mac, held) nothing snaps and no guide shows.
 */
export function snapMove(bounds: Rect | null, dx: number, dy: number, targets: readonly Rect[], zoom: number, off: boolean): SnapResult {
  if (off || !bounds) return { dx, dy, guides: [] };
  const snap = snapRect(bounds, targets, zoom);
  return { dx: dx + snap.dx, dy: dy + snap.dy, guides: snap.guides };
}

/** Guides on the same line merged into one, widened to cover them all (two corners may both snap to one line). */
export function mergeGuides(guides: readonly Guide[]): Guide[] {
  const merged = new Map<string, Guide>();
  for (const g of guides) {
    const key = `${g.axis}${String(Math.round(g.at * 100))}`;
    const old = merged.get(key);
    merged.set(key, old ? { ...old, from: Math.min(old.from, g.from), to: Math.max(old.to, g.to) } : { ...g });
  }
  return [...merged.values()];
}

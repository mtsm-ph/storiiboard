import type { CanvasScale, GridSpec, Point, Rect, Size, Viewport } from './types';
import { SNAP_PIXELS } from './snapping';
import { visibleWorld } from './viewport';

// A canvas given a real scale (6.2a, a plan): its grid, rulers, scale bar and grid snapping, as pure functions of the
// view, so they're tested without a browser. World units stay abstract here: the host's `CanvasScale` says what they
// are (a plan's are centimetres) and how a length reads. A board passes no scale and none of this is drawn.

/** Grid lines closer than this many screen pixels are not drawn. */
export const GRID_MIN_PIXELS = 8;

export interface GridShown {
  /** The step drawn, world units: every step, every major step, or none (0) when even those would be too close. */
  step: number;
  /** Every how many drawn steps a line is the stronger one (1 when only the strong lines show). */
  major: number;
}

/** Which of a grid's lines show at a zoom: every step, only the strong ones, or none. */
export function gridShown(zoom: number, grid: GridSpec): GridShown {
  if (grid.step * zoom >= GRID_MIN_PIXELS) return { step: grid.step, major: grid.major };
  if (grid.step * grid.major * zoom >= GRID_MIN_PIXELS) return { step: grid.step * grid.major, major: 1 };
  return { step: 0, major: 1 };
}

export interface GridLine {
  axis: 'x' | 'y';
  /** World position of the line. */
  at: number;
  strong: boolean;
}

/** The grid lines in view, each strong or light. */
export function gridLines(view: Viewport, size: Size, grid: GridSpec): GridLine[] {
  const shown = gridShown(view.zoom, grid);
  if (shown.step <= 0) return [];
  const world = visibleWorld(view, size);
  const lines: GridLine[] = [];
  for (const axis of ['x', 'y'] as const) {
    const from = axis === 'x' ? world.x : world.y;
    const to = from + (axis === 'x' ? world.width : world.height);
    const first = Math.ceil(from / shown.step);
    const last = Math.floor(to / shown.step);
    for (let i = first; i <= last; i += 1) lines.push({ axis, at: i * shown.step, strong: shown.major === 1 || i % shown.major === 0 });
  }
  return lines;
}

/** The scale bar is at most this many screen pixels long. */
export const SCALE_BAR_PIXELS = 120;

/** The round length the scale bar shows at a zoom: the longest of `rounds` (smallest first) that fits, else the shortest. */
export function scaleBarLength(zoom: number, rounds: readonly number[], most = SCALE_BAR_PIXELS): number {
  const fitting = rounds.filter((r) => r * zoom <= most);
  return fitting.at(-1) ?? rounds[0] ?? 1;
}

/** A ruler's labels are this far apart at least, in screen pixels. */
const RULER_LABEL_PIXELS = 64;

export interface RulerTick {
  /** World position. */
  at: number;
  /** Screen position along the ruler. */
  screen: number;
  label: string;
}

/** The labelled ticks along the top (x) or left (y) ruler: the round lengths spaced at least 64 px apart. */
export function rulerTicks(view: Viewport, size: Size, scale: Pick<CanvasScale, 'rounds' | 'label'>, axis: 'x' | 'y'): RulerTick[] {
  const step = scale.rounds.find((r) => r * view.zoom >= RULER_LABEL_PIXELS) ?? scale.rounds.at(-1);
  if (step === undefined || step <= 0) return [];
  const world = visibleWorld(view, size);
  const from = axis === 'x' ? world.x : world.y;
  const span = axis === 'x' ? world.width : world.height;
  const middle = axis === 'x' ? view.cx : view.cy;
  const half = (axis === 'x' ? size.width : size.height) / 2;
  const ticks: RulerTick[] = [];
  for (let i = Math.ceil(from / step); i * step <= from + span; i += 1) {
    const at = i * step;
    // "-0" never shows.
    ticks.push({ at, screen: (at - middle) * view.zoom + half, label: scale.label(at === 0 ? 0 : at) });
  }
  return ticks;
}

/** How a point snaps to the grid: to the nearest line within reach, to the fine step whatever the distance, or not at all. */
export type GridSnap = 'magnet' | 'fine' | 'off';

/** A value pulled onto the nearest multiple of `step` when it's within `reach`. */
const magnet = (value: number, step: number, reach: number): number => {
  const nearest = Math.round(value / step) * step;
  return Math.abs(nearest - value) <= reach ? nearest : value;
};

/** A point snapped to the grid lines showing at this zoom (or to the fine step, Alt held). */
export function snapToGrid(point: Point, grid: GridSpec, zoom: number, mode: GridSnap): Point {
  if (mode === 'off') return point;
  if (mode === 'fine') return { x: Math.round(point.x / grid.fine) * grid.fine, y: Math.round(point.y / grid.fine) * grid.fine };
  const shown = gridShown(zoom, grid);
  if (shown.step <= 0) return point;
  const reach = SNAP_PIXELS / zoom;
  return { x: magnet(point.x, shown.step, reach), y: magnet(point.y, shown.step, reach) };
}

/**
 * How far a moving rectangle is pulled onto the grid: each axis on its own, its nearer edge to the nearest line within
 * reach (Alt: its left and top edges to the fine step). The caller adds this only on an axis no item line took.
 */
export function gridPull(rect: Rect, grid: GridSpec, zoom: number, mode: GridSnap): { dx: number; dy: number } {
  if (mode === 'off') return { dx: 0, dy: 0 };
  if (mode === 'fine') return { dx: Math.round(rect.x / grid.fine) * grid.fine - rect.x, dy: Math.round(rect.y / grid.fine) * grid.fine - rect.y };
  const shown = gridShown(zoom, grid);
  if (shown.step <= 0) return { dx: 0, dy: 0 };
  const reach = SNAP_PIXELS / zoom;
  const pull = (low: number, high: number): number => {
    const options = [low, high].map((edge) => Math.round(edge / shown.step) * shown.step - edge).filter((d) => Math.abs(d) <= reach);
    return options.reduce<number | null>((best, d) => (best === null || Math.abs(d) < Math.abs(best) ? d : best), null) ?? 0;
  };
  return { dx: pull(rect.x, rect.x + rect.width), dy: pull(rect.y, rect.y + rect.height) };
}

/**
 * How far moving points (world units, where the move has put them) are pulled onto the grid: each axis on its own, the
 * nearest of their coordinates to a line within reach (Alt: the first point to the fine step). An item's own snap
 * points (a wall's middle line ends) take the place of its box's edges, so a wall's face never lands on the line.
 */
export function gridPullPoints(points: readonly Point[], grid: GridSpec, zoom: number, mode: GridSnap): { dx: number; dy: number } {
  const [first] = points;
  if (mode === 'off' || !first) return { dx: 0, dy: 0 };
  if (mode === 'fine') return { dx: Math.round(first.x / grid.fine) * grid.fine - first.x, dy: Math.round(first.y / grid.fine) * grid.fine - first.y };
  const shown = gridShown(zoom, grid);
  if (shown.step <= 0) return { dx: 0, dy: 0 };
  const reach = SNAP_PIXELS / zoom;
  const pull = (values: readonly number[]): number =>
    values
      .map((v) => Math.round(v / shown.step) * shown.step - v)
      .filter((d) => Math.abs(d) <= reach)
      .reduce<number | null>((best, d) => (best === null || Math.abs(d) < Math.abs(best) ? d : best), null) ?? 0;
  return { dx: pull(points.map((p) => p.x)), dy: pull(points.map((p) => p.y)) };
}

/**
 * A move of items that give their own snap points (6.2a): `points` are theirs where they started, moved by dx and dy.
 * One near another item's point (within `reach`, world units) joins it on both axes; else each axis is pulled onto the
 * grid by the points, never by the box. Snapping off, the move is as the pointer made it.
 */
export function snapMoveByPoints(
  points: readonly Point[],
  dx: number,
  dy: number,
  targets: readonly Point[],
  grid: GridSpec | undefined,
  zoom: number,
  mode: GridSnap,
  reach: number,
): { dx: number; dy: number } {
  if (mode === 'off' || points.length === 0) return { dx, dy };
  const moved = points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  let best: { x: number; y: number; d: number } | null = null;
  for (const p of moved) {
    const target = nearestPoint(p, targets, reach);
    if (!target) continue;
    const d = Math.hypot(target.x - p.x, target.y - p.y);
    if (!best || d < best.d) best = { x: target.x - p.x, y: target.y - p.y, d };
  }
  if (best) return { dx: dx + best.x, dy: dy + best.y };
  if (!grid) return { dx, dy };
  const pulled = gridPullPoints(moved, grid, zoom, mode);
  return { dx: dx + pulled.dx, dy: dy + pulled.dy };
}

/** The point at `to`'s distance from `from`, turned to the nearest `stepDegrees` (Shift held: 15° steps). */
export function constrainAngle(from: Point, to: Point, stepDegrees = 15): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return to;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** The nearest of `targets` within `reach` of a point, or null. */
export function nearestPoint(point: Point, targets: readonly Point[], reach: number): Point | null {
  let best: Point | null = null;
  let bestDistance = reach;
  for (const target of targets) {
    const d = Math.hypot(target.x - point.x, target.y - point.y);
    if (d <= bestDistance) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}

/** The point `length` from `from` in the direction of `angle` (radians). */
export const pointAlong = (from: Point, angle: number, length: number): Point => ({ x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length });

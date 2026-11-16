import { SNAP_PIXELS, type Guide } from './snapping';
import type { Point, Rect, Size, Viewport } from './types';
import { visibleWorld } from './viewport';

// A board's dot grid (6.5.7a, Kevin, Nov 16), as pure functions of the view, so they're tested without a browser. A
// plan passes none of this: it has its own scale and grid (scale.ts). The dots are a view on this computer, never part
// of the board: nothing here is stored, printed or exported.
//
// The spacing follows the zoom by levels: 20 board units, times 5 to the power of whichever whole number keeps the dots
// 12 to 60 screen pixels apart (…, 4, 20, 100, 500, …). Every level's dots are every fifth of the finer level's, so a
// dot never moves sideways as the zoom changes level: only the dots between drop out.

/** The base spacing, board units. */
export const DOT_BASE = 20;
/** How many times finer or coarser each level is than the next. */
export const DOT_FACTOR = 5;
/** The dots are at least this many screen pixels apart… */
export const DOT_MIN_PIXELS = 12;
/** …and at most this many. */
export const DOT_MAX_PIXELS = 60;
/** A dot's size on screen, CSS pixels, before it is rounded to the screen's own pixels. */
export const DOT_SIZE = 1.5;

/** The level for a zoom: the power of 5 the base spacing is multiplied by. */
export function dotLevel(zoom: number): number {
  // The finest level whose dots are DOT_MIN_PIXELS apart or more; a hair under it counts, so a zoom exactly on a level's
  // edge never jumps to the next through rounding.
  return Math.ceil(Math.log(DOT_MIN_PIXELS / (DOT_BASE * zoom)) / Math.log(DOT_FACTOR) - 1e-9);
}

/** The spacing drawn and snapped to at a zoom, board units. */
export function dotSpacing(zoom: number): number {
  // Rounded to 6 significant digits, so 20 × 5⁻² reads 0.8, never 0.8000000000000002.
  return Number((DOT_BASE * DOT_FACTOR ** dotLevel(zoom)).toPrecision(6));
}

/** The spacing a drag or resize snaps to now: the one shown, only while the grid shows and snap is on; else none. */
export const dotSnapSpacing = (grid: { on: boolean; snap: boolean } | undefined, zoom: number): number | null =>
  grid?.on === true && grid.snap ? dotSpacing(zoom) : null;

/** The spacing as the label by the Grid switch shows it. */
export const dotSpacingLabel = (spacing: number): string => String(spacing);

/** The screen positions, along one axis, of the dots in view. */
function along(from: number, length: number, spacing: number, toScreen: (world: number) => number): number[] {
  const out: number[] = [];
  for (let i = Math.ceil(from / spacing); i * spacing <= from + length; i += 1) out.push(toScreen(i * spacing));
  return out;
}

/**
 * The dots in view as screen positions (CSS pixels from the canvas's corner): a column for each x and a row for each y,
 * every dot where one meets the other. Drawn as one shape, never a node per dot.
 */
export function dotsInView(view: Viewport, size: Size, spacing: number): { columns: number[]; rows: number[] } {
  const world = visibleWorld(view, size);
  return {
    columns: along(world.x, world.width, spacing, (x) => (x - view.cx) * view.zoom + size.width / 2),
    rows: along(world.y, world.height, spacing, (y) => (y - view.cy) * view.zoom + size.height / 2),
  };
}

/**
 * Where a dot of `size` CSS pixels starts so it covers whole screen pixels (`ratio`, the screen's pixels per CSS pixel):
 * its side in screen pixels is 1.5 CSS pixels rounded (2 at 1×, 3 at 2×), and it starts on a screen pixel. The pixel
 * under the dot's own point is always wholly the dot's colour.
 */
export function dotBox(centre: number, ratio: number, size = DOT_SIZE): { at: number; side: number } {
  const device = Math.max(1, Math.round(size * ratio));
  return { at: Math.round(centre * ratio - device / 2) / ratio, side: device / ratio };
}

/** The pull onto the nearest multiple of `spacing`, when it is within `reach`; 0 otherwise. */
const pullTo = (value: number, spacing: number, reach: number): number => {
  const d = Math.round(value / spacing) * spacing - value;
  return Math.abs(d) <= reach ? d : 0;
};

/**
 * How far a moving selection is pulled onto the dots (snap on): its top-left corner to the nearest dot, each axis on its
 * own, within the canvas core's snap distance (6 screen pixels). `rect` is the selection where the item snapping put it
 * and `guides` the item lines it took: an axis an item line took stays on that line, so another item's edge or centre in
 * reach always wins over a dot, however near the dot is (a tie included).
 */
export function dotMove(rect: Rect, guides: readonly Guide[], spacing: number, zoom: number): { dx: number; dy: number } {
  const reach = SNAP_PIXELS / zoom;
  return {
    dx: guides.some((g) => g.axis === 'x') ? 0 : pullTo(rect.x, spacing, reach),
    dy: guides.some((g) => g.axis === 'y') ? 0 : pullTo(rect.y, spacing, reach),
  };
}

/** Which axes a resize handle moves: a corner both, a side's middle one; the rotate handle none. */
export function handleAxes(anchor: string): { x: boolean; y: boolean } {
  const x = anchor.endsWith('left') || anchor.endsWith('right');
  const y = anchor.startsWith('top') || anchor.startsWith('bottom');
  return { x, y };
}

/**
 * A corner dragged on something that keeps its proportions (a picture, a video or live card, a group of mixed turns,
 * Shift held): `moving` is the corner where the drag has it (world units, its proportions already kept), `fixed` the
 * opposite corner, `ratio` width over height. The axis whose dot is nearer, within the snap distance, takes the dot;
 * the other follows from the ratio, so the size keeps it exactly. Neither in reach: as it was.
 */
export function dotCornerKeepingRatio(fixed: Point, moving: Point, ratio: number, spacing: number, zoom: number): Point {
  const reach = SNAP_PIXELS / zoom;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return moving;
  const dx = Math.round(moving.x / spacing) * spacing - moving.x;
  const dy = Math.round(moving.y / spacing) * spacing - moving.y;
  const xNear = Math.abs(dx) <= reach;
  const yNear = Math.abs(dy) <= reach;
  if (!xNear && !yNear) return moving;
  const sx = Math.sign(moving.x - fixed.x) || 1;
  const sy = Math.sign(moving.y - fixed.y) || 1;
  // On a tie the x axis takes the dot: a width on the grid reads as the size people type.
  if (xNear && (!yNear || Math.abs(dx) <= Math.abs(dy))) {
    const x = moving.x + dx;
    return { x, y: fixed.y + (sy * Math.abs(x - fixed.x)) / ratio };
  }
  const y = moving.y + dy;
  return { x: fixed.x + sx * Math.abs(y - fixed.y) * ratio, y };
}

/** A resize handle's point (world units) pulled onto the nearest dot on the axes it moves, within the snap distance. */
export function dotHandle(point: Point, anchor: string, spacing: number, zoom: number): Point {
  const axes = handleAxes(anchor);
  const reach = SNAP_PIXELS / zoom;
  return { x: axes.x ? point.x + pullTo(point.x, spacing, reach) : point.x, y: axes.y ? point.y + pullTo(point.y, spacing, reach) : point.y };
}

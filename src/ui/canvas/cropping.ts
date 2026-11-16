import { tidy } from './placement';
import type { CanvasItem, DrawContext, Geometry, Point } from './types';

// Cropping an item's own picture on the canvas (6.5.7b): what part of the picture an item keeps, as fractions of the
// picture, and the box that part takes on the board. A crop never touches the picture: the item's box is the kept part,
// and the picture is drawn at the size it has on the board, the part outside the box cut away. Pure, so the maths is
// tested without a screen; the canvas core calls it only for a host that passes `onCrop` (a board), never a plan.

/** The kept part of a picture, as fractions of it: each 0 to 1, x + width and y + height at most 1. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole picture: what an item with no crop keeps. */
export const WHOLE: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** The least a crop keeps of the picture on each axis (round 2): 1%. A stored crop keeping less reads as uncropped. */
export const MIN_KEPT = 0.01;

/** Whether a crop keeps the whole picture. */
export const isWhole = (crop: CropRect): boolean => crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;

/** The fractions stored: six decimals, never past the picture's edge; near enough to the whole picture, the whole. */
const fraction = (value: number): number => Math.round(value * 1e6) / 1e6;

export function cleanCrop(crop: CropRect): CropRect {
  const x = Math.min(1, Math.max(0, fraction(crop.x)));
  const y = Math.min(1, Math.max(0, fraction(crop.y)));
  const out = { x, y, width: fraction(Math.min(1 - x, Math.max(0, crop.width))), height: fraction(Math.min(1 - y, Math.max(0, crop.height))) };
  const near = (a: number, b: number) => Math.abs(a - b) < 2e-6;
  return near(out.x, 0) && near(out.y, 0) && near(out.width, 1) && near(out.height, 1) ? WHOLE : out;
}

/** Where the whole picture lies in the item's own box (0, 0 its top-left corner, before its turn), in board units. */
export function wholePicture(width: number, height: number, crop: CropRect): { x: number; y: number; width: number; height: number } {
  const w = width / crop.width;
  const h = height / crop.height;
  return { x: -crop.x * w, y: -crop.y * h, width: w, height: h };
}

/** The item's edges in its own box, as they now are (left, top, right, bottom), turned back into its place on the board. */
function placed(origin: Geometry, left: number, top: number, right: number, bottom: number): Geometry {
  const turn = (origin.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // The new box's middle, from the old box's middle, along the item's own axes.
  const along = (left + right) / 2 - origin.width / 2;
  const down = (top + bottom) / 2 - origin.height / 2;
  const cx = origin.x + origin.width / 2 + cos * along - sin * down;
  const cy = origin.y + origin.height / 2 + sin * along + cos * down;
  const width = right - left;
  const height = bottom - top;
  return { x: tidy(cx - width / 2), y: tidy(cy - height / 2), width: tidy(width), height: tidy(height), rotation: origin.rotation };
}

/** The crop that keeps the part between these edges (the item's own box) of the picture placed as `whole` says. */
function cropBetween(whole: ReturnType<typeof wholePicture>, left: number, top: number, right: number, bottom: number): CropRect {
  return cleanCrop({ x: (left - whole.x) / whole.width, y: (top - whole.y) / whole.height, width: (right - left) / whole.width, height: (bottom - top) / whole.height });
}

/**
 * The box a new crop takes with the picture left where it is on the board (its pixels the same size, in the same
 * place): typed crop fields, and Reset crop, whose box (WHOLE) is the uncropped picture's, so the part that showed stays
 * exactly where it was.
 */
export function boxForCrop(origin: Geometry, crop: CropRect, next: CropRect): Geometry {
  const whole = wholePicture(origin.width, origin.height, crop);
  const left = whole.x + next.x * whole.width;
  const top = whole.y + next.y * whole.height;
  return placed(origin, left, top, left + next.width * whole.width, top + next.height * whole.height);
}

/** The anchors a handle can be: Konva's names. */
export const HANDLE_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left'] as const;

/**
 * A crop drag (Ctrl, or ⌘ on a Mac, held as a handle's drag starts): the dragged edge or corner moves by `delta` (world
 * units, from where the press was) along the item's own axes, the opposite side stays, and the picture stays put. Inward
 * it cuts; outward it shows what was cut, up to the picture's own edge. No side is made less than `min` (one already
 * less only grows). With `keepRatio` (Shift), the kept part keeps its proportions: a corner by the axis that moved
 * further, an edge with the other axis growing or shrinking about its middle.
 */
export function cropDrag(origin: Geometry, crop: CropRect, anchor: string, delta: Point, { min, keepRatio }: { min: number; keepRatio: boolean }): { geometry: Geometry; crop: CropRect } {
  const turn = (origin.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // The drag along the item's own axes.
  const dx = cos * delta.x + sin * delta.y;
  const dy = -sin * delta.x + cos * delta.y;
  const { width: w, height: h } = origin;
  const whole = wholePicture(w, h, crop);
  const x0 = whole.x;
  const x1 = whole.x + whole.width;
  const y0 = whole.y;
  const y1 = whole.y + whole.height;
  const left = anchor.endsWith('left');
  const right = anchor.endsWith('right');
  const top = anchor.startsWith('top');
  const bottom = anchor.startsWith('bottom');
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  // Never less than the least size, nor than 1% of the picture on either axis (what a stored crop may keep).
  const minX = Math.max(min, MIN_KEPT * whole.width);
  const minY = Math.max(min, MIN_KEPT * whole.height);
  let l = 0;
  let r = w;
  let t = 0;
  let b = h;
  if (keepRatio) {
    const sx = left || right ? (right ? w + dx : w - dx) / w : null;
    const sy = top || bottom ? (bottom ? h + dy : h - dy) / h : null;
    let scale = sx !== null && sy !== null ? Math.max(sx, sy) : (sx ?? sy ?? 1);
    // How far each axis can grow: to the picture's edge on the side that moves, or on both sides of the middle.
    const room = (from: boolean, to: boolean, extent: number, lo: number, hi: number) => (to ? hi / extent : from ? (extent - lo) / extent : (2 * Math.min(extent / 2 - lo, hi - extent / 2)) / extent);
    const most = Math.min(room(left, right, w, x0, x1), room(top, bottom, h, y0, y1));
    const least = Math.min(1, Math.max(minX / w, minY / h));
    scale = clamp(scale, least, most);
    const span = (from: boolean, to: boolean, extent: number): [number, number] => (to ? [0, extent * scale] : from ? [extent - extent * scale, extent] : [extent / 2 - (extent * scale) / 2, extent / 2 + (extent * scale) / 2]);
    [l, r] = span(left, right, w);
    [t, b] = span(top, bottom, h);
  } else {
    if (right) r = clamp(w + dx, Math.min(minX, w), x1);
    if (left) l = clamp(dx, x0, Math.max(w - minX, 0));
    if (bottom) b = clamp(h + dy, Math.min(minY, h), y1);
    if (top) t = clamp(dy, y0, Math.max(h - minY, 0));
  }
  return { geometry: placed(origin, l, t, r, b), crop: cropBetween(whole, l, t, r, b) };
}

/** The box Konva's handles hand their bound function: the stage's pixels, its rotation in radians. */
export interface HandleBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * A plain drag of a middle handle on an item that keeps its proportions (6.5.7b: a picture, which shows them so it can
 * be cropped): the other side grows or shrinks with it about its middle, so the picture never stretches.
 */
export function sideKeepingRatio(was: HandleBox, next: HandleBox, anchor: string | null): HandleBox {
  if (was.width <= 0 || was.height <= 0) return next;
  if (anchor === 'middle-left' || anchor === 'middle-right') {
    const height = next.width * (was.height / was.width);
    const shift = (next.height - height) / 2;
    return { ...next, x: next.x - Math.sin(next.rotation) * shift, y: next.y + Math.cos(next.rotation) * shift, height };
  }
  if (anchor === 'top-center' || anchor === 'bottom-center') {
    const width = next.height * (was.width / was.height);
    const shift = (next.width - width) / 2;
    return { ...next, x: next.x + Math.cos(next.rotation) * shift, y: next.y + Math.sin(next.rotation) * shift, width };
  }
  return next;
}

/** A crop drag under way (or its write on its way): the item's live box and crop, and whether the cut part shows dimmed. */
export interface CropLive {
  id: string;
  geometry: Geometry;
  crop: CropRect;
  active: boolean;
}

/** Where the whole picture of a box and its crop reaches on the board, upright bounds round its turned corners. */
export function wholeBounds(g: Geometry, crop: CropRect): { x: number; y: number; width: number; height: number } {
  const whole = wholePicture(g.width, g.height, crop);
  const turn = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  const corners = [
    [whole.x, whole.y],
    [whole.x + whole.width, whole.y],
    [whole.x, whole.y + whole.height],
    [whole.x + whole.width, whole.y + whole.height],
  ].map(([lx = 0, ly = 0]) => ({ x: cx + cos * (lx - g.width / 2) - sin * (ly - g.height / 2), y: cy + sin * (lx - g.width / 2) + cos * (ly - g.height / 2) }));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * The items as drawn while a crop drag is under way: the one cropped at its live box, drawn with its live crop. While the
 * drag lasts, the part being cut is drawn dimmed past the box (`beyond`, drawn with `cutAway`), in a group of its own
 * that the handles never hold, so they frame the kept part alone.
 */
export function withCropLive(items: readonly CanvasItem[], live: CropLive | null): readonly CanvasItem[] {
  if (!live) return items;
  return items.map((item) => {
    if (item.id !== live.id) return item;
    const own = item.draw;
    if (!own) return { ...item, ...live.geometry, crop: live.crop };
    return {
      ...item,
      ...live.geometry,
      crop: live.crop,
      draw: (context: DrawContext) => own({ ...context, crop: live.crop }),
      ...(live.active ? { beyond: { bounds: wholeBounds(live.geometry, live.crop), draw: (context: DrawContext) => own({ ...context, crop: live.crop, cutAway: true }) } } : {}),
    };
  });
}

/**
 * The one item a crop acts on (round 2): the selection is that item alone (a connector beside it counts), it has a
 * picture of its own, and it is neither locked nor moved only. The 8 handles and the gesture read it the same.
 */
export function soleCropItem(selection: readonly string[], items: readonly CanvasItem[]): CanvasItem | undefined {
  if (selection.length !== 1) return undefined;
  const item = items.find((each) => each.id === selection[0]);
  return item?.crop !== undefined && item.locked !== true && item.moveOnly !== true ? item : undefined;
}

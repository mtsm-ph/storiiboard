import type { Point, Rect, Size, Viewport, ZoomLimits } from './types';

// Screen and world, as pure functions of the view (decision 11). The view is the world point at the middle of the
// canvas and a zoom, so a resize keeps what the person was looking at.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_VIEWPORT: Viewport = { cx: 0, cy: 0, zoom: 1 };
/** Screen pixels of air round everything when fitting. */
export const FIT_PADDING = 48;

/** A board's limits: 10% to 800%, and a fit never zooms in past 100%. A host with a real scale gives its own (6.2a). */
export const BOARD_ZOOM: ZoomLimits = { min: MIN_ZOOM, max: MAX_ZOOM, fitMax: 1 };

export const clampZoom = (zoom: number, limits: Pick<ZoomLimits, 'min' | 'max'> = BOARD_ZOOM): number => Math.min(limits.max, Math.max(limits.min, zoom));

export function toWorld(view: Viewport, size: Size, screen: Point): Point {
  return { x: view.cx + (screen.x - size.width / 2) / view.zoom, y: view.cy + (screen.y - size.height / 2) / view.zoom };
}

export function toScreen(view: Viewport, size: Size, world: Point): Point {
  return { x: (world.x - view.cx) * view.zoom + size.width / 2, y: (world.y - view.cy) * view.zoom + size.height / 2 };
}

/** The part of the world the canvas shows. */
export function visibleWorld(view: Viewport, size: Size): Rect {
  const width = size.width / view.zoom;
  const height = size.height / view.zoom;
  return { x: view.cx - width / 2, y: view.cy - height / 2, width, height };
}

/** The view at a new zoom (clamped to 10%–800%, or the limits given) with the world point under `screen` staying under it. */
export function zoomAround(view: Viewport, size: Size, zoom: number, screen: Point, limits?: Pick<ZoomLimits, 'min' | 'max'>): Viewport {
  const next = clampZoom(zoom, limits);
  const under = toWorld(view, size, screen);
  return {
    zoom: next,
    cx: under.x - (screen.x - size.width / 2) / next,
    cy: under.y - (screen.y - size.height / 2) / next,
  };
}

/** The view moved by screen pixels, as a two-finger scroll or a drag with the Hand does. */
export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, cx: view.cx - dx / view.zoom, cy: view.cy - dy / view.zoom };
}

/** The view centred on a world point. */
export function centreOn(view: Viewport, world: Point): Viewport {
  return { ...view, cx: world.x, cy: world.y };
}

/**
 * The view that shows `bounds` whole with `padding` screen pixels round it, never zoomed in past `maxZoom` (a lone
 * small item isn't blown up to fill the canvas). Nothing to fit, or no room: the default view.
 */
export function fitBounds(bounds: Rect | null, size: Size, padding = FIT_PADDING, maxZoom = 1, limits?: Pick<ZoomLimits, 'min' | 'max'>): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return DEFAULT_VIEWPORT;
  const room = { width: Math.max(1, size.width - padding * 2), height: Math.max(1, size.height - padding * 2) };
  const zoom = clampZoom(Math.min(maxZoom, room.width / Math.max(bounds.width, 1e-6), room.height / Math.max(bounds.height, 1e-6)), limits);
  return { zoom, cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 };
}

/**
 * `fitBounds` beside a strip `left` screen pixels wide along the canvas's left edge (6.5.2 round 2, the tools' strip):
 * the bounds fitted into the part of the canvas right of it, and centred there, so nothing fitted lies under the strip.
 */
export function fitBeside(bounds: Rect | null, size: Size, left: number, padding = FIT_PADDING, maxZoom = 1, limits?: Pick<ZoomLimits, 'min' | 'max'>): Viewport {
  // Nothing to fit, a size not measured yet, or no strip: as fitBounds (the default view for the first two).
  if (left <= 0 || !bounds || size.width <= 0 || size.height <= 0) return fitBounds(bounds, size, padding, maxZoom, limits);
  const fitted = fitBounds(bounds, { width: Math.max(1, size.width - left), height: size.height }, padding, maxZoom, limits);
  return { ...fitted, cx: fitted.cx - left / 2 / fitted.zoom };
}

/**
 * A strip's inset as a host gives it to the three functions around this one: the next even number of pixels (6.28).
 * They all move the view by half the inset, and half of an odd one (a board's 51, a plan's 69) is half a pixel: at 100%
 * the world's whole units then fell between the screen's pixels, so a pointer, which is on whole pixels wherever the
 * engine or the mouse reports only those, could no longer reach a whole unit (a click read back half a centimetre off
 * on a plan), and the 1.5 px rules were drawn blurred. Rounded up, never down, so nothing fitted lies under the strip.
 * With an even inset the view is a whole number of pixels from where it is without a strip, whatever the zoom.
 */
export const evenInset = (left: number): number => 2 * Math.ceil(left / 2);

/** The world point in the middle of what the canvas shows beside a strip `left` screen pixels wide. */
export const middleBeside = (view: Viewport, left: number): Point => ({ x: view.cx + left / 2 / view.zoom, y: view.cy });

/** A canvas's first view beside a strip `left` screen pixels wide: 100%, the world's origin in the middle of what is seen. */
export const firstViewBeside = (left: number): Viewport => ({ cx: -left / 2, cy: 0, zoom: 1 });

/** The smallest rectangle round some rectangles, or null for none. */
export function unionBounds(rects: readonly Rect[]): Rect | null {
  const [first, ...rest] = rects;
  if (!first) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const r of rest) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const rectsMeet = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

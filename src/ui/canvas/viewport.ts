import type { Point, Rect, Size, Viewport } from './types';

// Screen and world, as pure functions of the view (decision 11). The view is the world point at the middle of the
// canvas and a zoom, so a resize keeps what the person was looking at.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_VIEWPORT: Viewport = { cx: 0, cy: 0, zoom: 1 };
/** Screen pixels of air round everything when fitting. */
export const FIT_PADDING = 48;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

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

/** The view at a new zoom (clamped to 10%–800%) with the world point under `screen` staying under it. */
export function zoomAround(view: Viewport, size: Size, zoom: number, screen: Point): Viewport {
  const next = clampZoom(zoom);
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
export function fitBounds(bounds: Rect | null, size: Size, padding = FIT_PADDING, maxZoom = 1): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return DEFAULT_VIEWPORT;
  const room = { width: Math.max(1, size.width - padding * 2), height: Math.max(1, size.height - padding * 2) };
  const zoom = clampZoom(Math.min(maxZoom, room.width / Math.max(bounds.width, 1e-6), room.height / Math.max(bounds.height, 1e-6)));
  return { zoom, cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 };
}

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

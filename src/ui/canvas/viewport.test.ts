import { describe, expect, it } from 'vitest';
import type { Rect, Size, Viewport } from './types';
import { DEFAULT_VIEWPORT, FIT_PADDING, MAX_ZOOM, MIN_ZOOM, centreOn, clampZoom, fitBounds, panBy, toScreen, toWorld, unionBounds, visibleWorld, zoomAround } from './viewport';

const size: Size = { width: 800, height: 600 };

describe('the canvas viewport', () => {
  it('turns screen points into world points and back', () => {
    const view: Viewport = { cx: 100, cy: -50, zoom: 2 };
    expect(toWorld(view, size, { x: 400, y: 300 })).toEqual({ x: 100, y: -50 });
    const world = toWorld(view, size, { x: 123, y: 456 });
    const back = toScreen(view, size, world);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
  });

  it('shows the part of the world the view covers', () => {
    expect(visibleWorld({ cx: 0, cy: 0, zoom: 2 }, size)).toEqual({ x: -200, y: -150, width: 400, height: 300 });
  });

  it('zooms around a point and keeps the world point under it fixed', () => {
    const view: Viewport = { cx: 30, cy: 40, zoom: 1.5 };
    const screen = { x: 650, y: 120 };
    const before = toWorld(view, size, screen);
    for (const zoom of [0.4, 3, 7.9]) {
      const next = zoomAround(view, size, zoom, screen);
      expect(next.zoom).toBe(zoom);
      const after = toWorld(next, size, screen);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('holds the zoom between 10% and 800%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(MAX_ZOOM);
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(8);
    expect(zoomAround(DEFAULT_VIEWPORT, size, 100, { x: 10, y: 10 }).zoom).toBe(8);
    expect(zoomAround(DEFAULT_VIEWPORT, size, 0, { x: 10, y: 10 }).zoom).toBe(0.1);
    // At the limit the point under the pointer still doesn't move.
    const at = { cx: 5, cy: 5, zoom: 8 };
    const stuck = zoomAround(at, size, 9, { x: 100, y: 100 });
    expect(stuck.zoom).toBe(8);
    expect(toWorld(stuck, size, { x: 100, y: 100 }).x).toBeCloseTo(toWorld(at, size, { x: 100, y: 100 }).x);
  });

  it('pans by screen pixels, whatever the zoom', () => {
    expect(panBy({ cx: 0, cy: 0, zoom: 2 }, 100, -40)).toEqual({ cx: -50, cy: 20, zoom: 2 });
    expect(centreOn({ cx: 0, cy: 0, zoom: 3 }, { x: 9, y: 8 })).toEqual({ cx: 9, cy: 8, zoom: 3 });
  });

  it('fits bounds with air round them, never past 100% for a small one', () => {
    const wide: Rect = { x: 0, y: 0, width: 2000, height: 500 };
    const fit = fitBounds(wide, size);
    expect(fit.zoom).toBeCloseTo((800 - FIT_PADDING * 2) / 2000);
    expect(fit.cx).toBe(1000);
    expect(fit.cy).toBe(250);
    // The bounds sit inside the view.
    const seen = visibleWorld(fit, size);
    expect(seen.x).toBeLessThan(0);
    expect(seen.x + seen.width).toBeGreaterThan(2000);
    expect(fitBounds({ x: 10, y: 10, width: 20, height: 20 }, size).zoom).toBe(1);
    // A huge world stops at 10%.
    expect(fitBounds({ x: 0, y: 0, width: 1e6, height: 1e6 }, size).zoom).toBe(0.1);
  });

  it('fits an empty board to the default view', () => {
    expect(fitBounds(null, size)).toEqual(DEFAULT_VIEWPORT);
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual(DEFAULT_VIEWPORT);
  });

  it('unions rectangles', () => {
    expect(unionBounds([])).toBeNull();
    expect(unionBounds([{ x: 0, y: 0, width: 10, height: 10 }, { x: -5, y: 20, width: 5, height: 5 }])).toEqual({ x: -5, y: 0, width: 15, height: 25 });
  });
});

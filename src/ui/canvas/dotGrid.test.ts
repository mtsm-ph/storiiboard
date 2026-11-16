import { describe, expect, it } from 'vitest';
import { dotBox, dotCornerKeepingRatio, dotHandle, dotLevel, dotMove, dotSnapSpacing, dotSpacing, dotSpacingLabel, dotsInView, DOT_MAX_PIXELS, DOT_MIN_PIXELS, handleAxes } from './dotGrid';
import { snapRect, SNAP_PIXELS } from './snapping';

// A board's dot grid (6.5.7a): the spacing by the zoom's level, the dots in view, and snap to them for a move and each
// resize handle, with another item's line winning over a dot in reach.

const ZOOMS = [0.05, 0.075, 0.1, 0.12, 0.125, 0.2, 0.25, 0.3, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

describe('the dot grid’s spacing', () => {
  it('is 20 × 5^k, the level keeping the dots 12 to 60 screen pixels apart, at every zoom from 5% to 800%', () => {
    for (const zoom of ZOOMS) {
      const spacing = dotSpacing(zoom);
      const pixels = spacing * zoom;
      expect(pixels, `zoom ${String(zoom)}`).toBeGreaterThanOrEqual(DOT_MIN_PIXELS - 1e-9);
      expect(pixels, `zoom ${String(zoom)}`).toBeLessThanOrEqual(DOT_MAX_PIXELS + 1e-9);
      expect(spacing, `zoom ${String(zoom)}`).toBeCloseTo(20 * 5 ** dotLevel(zoom), 9);
    }
  });

  it('reads the levels a board sees: 500 at 5%, 100 at 25%, 20 at 100%, 4 at 800%', () => {
    expect([0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8].map(dotSpacing)).toEqual([500, 500, 100, 100, 20, 20, 4, 4]);
    // Just past a level's edge either way: the finer level whose dots stay 12 px apart or more.
    expect(dotSpacing(0.6)).toBe(20);
    expect(dotSpacing(0.59)).toBe(100);
    expect(dotSpacing(3)).toBe(4);
    expect(dotSpacing(2.99)).toBe(20);
    expect(dotSpacingLabel(dotSpacing(1))).toBe('20');
    expect(dotSpacingLabel(dotSpacing(0.25))).toBe('100');
  });

  it('makes every coarser level’s dots a subset of the finer one’s, so nothing moves sideways as the zoom changes level', () => {
    const levels = [...new Set(ZOOMS.map(dotSpacing))].sort((a, b) => a - b);
    expect(levels).toEqual([4, 20, 100, 500]);
    for (let i = 1; i < levels.length; i += 1) {
      const fine = levels[i - 1] ?? 0;
      const coarse = levels[i] ?? 0;
      // Every coarse dot is on a fine one: the coarse spacing is a whole number of fine spacings.
      expect(coarse / fine).toBe(5);
      for (const n of [-3, -1, 0, 1, 7]) expect(Number.isInteger((n * coarse) / fine)).toBe(true);
    }
  });
});

describe('the dots in view', () => {
  it('are a column for each multiple of the spacing across the view and a row for each down it, in screen pixels', () => {
    const view = { cx: 0, cy: 0, zoom: 1 };
    const { columns, rows } = dotsInView(view, { width: 100, height: 60 }, 20);
    expect(columns).toEqual([10, 30, 50, 70, 90]);
    expect(rows).toEqual([10, 30, 50]);
  });

  it('are as few as the spacing allows at any zoom: never more than the view’s pixels over 12, plus one, a side', () => {
    const size = { width: 1600, height: 1000 };
    for (const zoom of ZOOMS) {
      const { columns, rows } = dotsInView({ cx: 137, cy: -42, zoom }, size, dotSpacing(zoom));
      expect(columns.length).toBeLessThanOrEqual(Math.ceil(size.width / DOT_MIN_PIXELS) + 1);
      expect(rows.length).toBeLessThanOrEqual(Math.ceil(size.height / DOT_MIN_PIXELS) + 1);
    }
  });

  it('are drawn on whole screen pixels about 1.5 CSS pixels wide, covering the pixel under the dot’s own point', () => {
    expect(dotBox(10, 1)).toEqual({ at: 9, side: 2 });
    expect(dotBox(10.5, 1)).toEqual({ at: 10, side: 2 });
    expect(dotBox(10, 2)).toEqual({ at: 9.5, side: 1.5 });
    for (const centre of [3, 3.25, 3.5, 3.75]) {
      const box = dotBox(centre, 1);
      const pixel = Math.round(centre);
      expect(box.at).toBeLessThanOrEqual(pixel);
      expect(box.at + box.side).toBeGreaterThanOrEqual(pixel + 1);
    }
  });
});

describe('snap to the dots', () => {
  it('acts only while the grid shows and snap is on, at the spacing shown', () => {
    expect(dotSnapSpacing({ on: true, snap: true }, 1)).toBe(20);
    expect(dotSnapSpacing({ on: true, snap: true }, 0.25)).toBe(100);
    // Snap off, the grid off (snap kept on but asleep), or no grid at all (a plan): no snapping to dots.
    expect(dotSnapSpacing({ on: true, snap: false }, 1)).toBeNull();
    expect(dotSnapSpacing({ on: false, snap: true }, 1)).toBeNull();
    expect(dotSnapSpacing(undefined, 1)).toBeNull();
  });

  it('pulls a move’s top-left corner onto the nearest dot, each axis within the snap distance on its own', () => {
    expect(dotMove({ x: 103, y: 37, width: 50, height: 50 }, [], 20, 1)).toEqual({ dx: -3, dy: 3 });
    // 9 from the nearest dot on x is out of reach at 100% (6 px); y is in.
    expect(dotMove({ x: 109, y: 41, width: 50, height: 50 }, [], 20, 1)).toEqual({ dx: 0, dy: -1 });
    // The reach is in screen pixels: at 50% the same 9 units are 4.5 px, in reach.
    expect(dotMove({ x: 109, y: 41, width: 50, height: 50 }, [], 100, 0.5)).toEqual({ dx: -9, dy: 0 });
    expect(SNAP_PIXELS).toBe(6);
  });

  it('lets another item’s line in reach win over a dot on that axis, even a nearer dot or an equal one', () => {
    // The moving item's left edge at 101: a dot at 100 is 1 away, another item's right edge at 104 is 3 away. The item's
    // snapping takes x to 104; the dots leave that axis alone and still take y.
    const moving = { x: 101, y: 57, width: 40, height: 40 };
    const other = { x: 54, y: 300, width: 50, height: 20 };
    const items = snapRect(moving, [other], 1);
    expect(items.dx).toBe(3);
    const placed = { ...moving, x: moving.x + items.dx, y: moving.y + items.dy };
    expect(dotMove(placed, items.guides, 20, 1)).toEqual({ dx: 0, dy: 3 });
    // A tie: the item's line and the dot both 2 away, either side. The item's line wins.
    const tie = { x: 102, y: 60, width: 40, height: 40 };
    const beside = snapRect(tie, [{ x: 4, y: 300, width: 100, height: 20 }], 1);
    expect(beside.dx).toBe(2);
    expect(dotMove({ ...tie, x: tie.x + beside.dx }, beside.guides, 20, 1)).toEqual({ dx: 0, dy: 0 });
  });

  it('snaps a 300 × 200 picture’s corner by the axis whose dot is nearer, the other from its ratio, the ratio exact', () => {
    // Fixed at its top-left (100, 100); its bottom-right dragged out along the diagonal to (403, 302): x is 3 from the dot
    // at 400, y 2 from the one at 300. y is nearer: it takes the dot, and x follows at 1.5 × 200 = 300 from the left.
    const fixed = { x: 100, y: 100 };
    const near = dotCornerKeepingRatio(fixed, { x: 403, y: 302 }, 1.5, 20, 1);
    expect(near).toEqual({ x: 400, y: 300 });
    // x in reach (1 off at 419) while y at 312.67 is 7.33 from its nearest dot, out of reach: x takes the dot at 420.
    const byX = dotCornerKeepingRatio(fixed, { x: 419, y: 100 + 319 / 1.5 }, 1.5, 20, 1);
    expect(byX.x).toBe(420);
    expect((byX.x - fixed.x) / (byX.y - fixed.y)).toBeCloseTo(1.5, 10);
    // y alone in reach (x is 8.5 off), dragged up and left from a bottom-right that stays: the top-left corner moves.
    const corner = { x: 400, y: 300 };
    const up = dotCornerKeepingRatio(corner, { x: 400 - 1.5 * 179, y: 121 }, 1.5, 20, 1);
    expect(up.y).toBe(120);
    expect(up.x).toBeCloseTo(400 - 1.5 * 180, 10);
    expect((corner.x - up.x) / (corner.y - up.y)).toBeCloseTo(1.5, 10);
    // A tie: x takes the dot.
    const tie = dotCornerKeepingRatio({ x: 0, y: 0 }, { x: 202, y: 102 }, 2, 20, 1);
    expect(tie).toEqual({ x: 200, y: 100 });
    // Neither in reach: as it was.
    expect(dotCornerKeepingRatio(fixed, { x: 410, y: 310 }, 1.5, 20, 1)).toEqual({ x: 410, y: 310 });
  });

  it('pulls a resize handle onto the nearest dot on the axes it moves: a corner both, a side one, the rotate handle none', () => {
    const point = { x: 203, y: 98 };
    expect(dotHandle(point, 'top-left', 20, 1)).toEqual({ x: 200, y: 100 });
    expect(dotHandle(point, 'top-right', 20, 1)).toEqual({ x: 200, y: 100 });
    expect(dotHandle(point, 'bottom-left', 20, 1)).toEqual({ x: 200, y: 100 });
    expect(dotHandle(point, 'bottom-right', 20, 1)).toEqual({ x: 200, y: 100 });
    expect(dotHandle(point, 'middle-left', 20, 1)).toEqual({ x: 200, y: 98 });
    expect(dotHandle(point, 'middle-right', 20, 1)).toEqual({ x: 200, y: 98 });
    expect(dotHandle(point, 'top-center', 20, 1)).toEqual({ x: 203, y: 100 });
    expect(dotHandle(point, 'bottom-center', 20, 1)).toEqual({ x: 203, y: 100 });
    expect(dotHandle(point, 'rotater', 20, 1)).toEqual(point);
    expect(handleAxes('rotater')).toEqual({ x: false, y: false });
    // Out of reach, it stays where the pointer has it.
    expect(dotHandle({ x: 210, y: 90 }, 'bottom-right', 20, 1)).toEqual({ x: 210, y: 90 });
  });
});

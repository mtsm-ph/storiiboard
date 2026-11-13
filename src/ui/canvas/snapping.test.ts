import { describe, expect, it } from 'vitest';
import { mergeGuides, snapMove, snapPoint, snapRect, SNAP_PIXELS } from './snapping';
import type { Rect } from './types';

// Snap guides (5.3): the moving rectangle's left, centre and right and top, middle and bottom snap to the same lines of
// the targets within 6 screen pixels.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('snapping', () => {
  const target = rect(100, 100, 80, 60);

  it('snaps each kind of line: left, centre and right, top, middle and bottom', () => {
    // Left to left (97 to 100), then right to right (183 to 180).
    expect(snapRect(rect(97, 300, 30, 20), [target], 1)).toMatchObject({ dx: 3, dy: 0 });
    expect(snapRect(rect(143, 300, 37, 20), [target], 1).dx).toBe(0);
    expect(snapRect(rect(145, 300, 38, 20), [target], 1).dx).toBe(-3);
    // The moving rectangle's centre to the target's centre (140): 116 + 22 = 138.
    expect(snapRect(rect(116, 300, 44, 20), [target], 1).dx).toBe(2);
    // Top to top, middle to middle, bottom to bottom.
    expect(snapRect(rect(400, 104, 20, 20), [target], 1).dy).toBe(-4);
    expect(snapRect(rect(400, 125, 20, 20), [target], 1).dy).toBe(5);
    expect(snapRect(rect(400, 143, 20, 20), [target], 1).dy).toBe(-3);
  });

  it('takes the nearest line when several are in reach, and each axis on its own', () => {
    const near = [rect(100, 0, 4, 10), rect(110, 500, 4, 10)];
    // Lines 106, 107.5 and 109: the closest is 109 to 110.
    expect(snapRect(rect(106, 200, 3, 6), near, 1).dx).toBe(1);
    expect(snapRect(rect(103, 94, 10, 4), [target], 1)).toMatchObject({ dx: -3, dy: 2 });
  });

  it('holds back beyond 6 screen pixels, and the reach scales with zoom', () => {
    expect(snapRect(rect(94, 300, 40, 20), [target], 1).dx).toBe(6);
    expect(snapRect(rect(93, 300, 40, 20), [target], 1).dx).toBe(0);
    // At 200% six pixels are 3 world units; at 50% they are 12.
    expect(snapRect(rect(96, 300, 40, 20), [target], 2).dx).toBe(0);
    expect(snapRect(rect(97.5, 300, 40, 20), [target], 2).dx).toBe(2.5);
    expect(snapRect(rect(80, 300, 10, 20), [target], 0.5).dx).toBe(10);
    expect(snapRect(rect(80, 300, 10, 20), [target], 1).dx).toBe(0);
    expect(SNAP_PIXELS).toBe(6);
  });

  it('draws guides across the items a line joins, only for lines that are shared once snapped', () => {
    const result = snapRect(rect(97, 300, 30, 20), [target], 1);
    // The left edge, now at 100: a vertical line from the target's top to the moving rectangle's bottom.
    expect(result.guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 320 }]);
    // Aligned on both axes: a vertical and a horizontal guide.
    const corner = snapRect(rect(98, 98, 30, 30), [target], 1);
    expect(new Set(corner.guides.map((g) => g.axis))).toEqual(new Set(['x', 'y']));
  });

  it('has nothing to snap to without targets, or when the targets are out of view', () => {
    expect(snapRect(rect(1, 1, 5, 5), [], 1)).toEqual({ dx: 0, dy: 0, guides: [] });
    const far = rect(1000, 1000, 10, 10);
    expect(snapRect(rect(998, 0, 5, 5), [far], 1, rect(0, 0, 500, 500)).dx).toBe(0);
    expect(snapRect(rect(998, 0, 5, 5), [far], 1).dx).not.toBe(0);
  });

  it('snaps a point (a corner being drawn) to the lines', () => {
    const snapped = snapPoint({ x: 103, y: 157 }, [target], 1);
    expect(snapped.point).toEqual({ x: 100, y: 160 });
    expect(snapped.guides.length).toBeGreaterThan(0);
  });
});

describe('turning snapping off', () => {
  const target = rect(100, 100, 80, 60);
  it('leaves a move where the pointer put it, with no guide, when Ctrl (⌘) is held, and snaps it otherwise', () => {
    const moving = rect(97, 300, 30, 20);
    expect(snapMove(moving, 7, 9, [target], 1, true)).toEqual({ dx: 7, dy: 9, guides: [] });
    const on = snapMove(moving, 7, 9, [target], 1, false);
    expect(on.dx).toBe(10);
    expect(on.guides.length).toBeGreaterThan(0);
    expect(snapMove(null, 1, 2, [target], 1, false)).toEqual({ dx: 1, dy: 2, guides: [] });
  });

  it('merges guides on one line, widened, so two corners snapping to it draw it once', () => {
    expect(
      mergeGuides([
        { axis: 'x', at: 100, from: 0, to: 50 },
        { axis: 'x', at: 100, from: 20, to: 90 },
        { axis: 'y', at: 100, from: 0, to: 5 },
      ]),
    ).toEqual([
      { axis: 'x', at: 100, from: 0, to: 90 },
      { axis: 'y', at: 100, from: 0, to: 5 },
    ]);
  });
});

describe('the cost of snapping', () => {
  it('stays well under a frame with 500 items, in view or not', () => {
    const targets = Array.from({ length: 500 }, (_, i) => rect((i % 25) * 90 + 3, Math.floor(i / 25) * 70 + 5, 80, 60));
    const moving = rect(1203, 405, 80, 60);
    const view = rect(0, 0, 2400, 1500);
    snapRect(moving, targets, 1, view);
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) snapRect({ ...moving, x: moving.x + (i % 7) }, targets, 1, view);
    const each = (performance.now() - start) / 200;
    console.info(`snapping 500 items, mean per call: ${each.toFixed(3)} ms`);
    expect(each).toBeLessThan(4);
  });
});

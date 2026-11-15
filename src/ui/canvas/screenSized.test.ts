import type Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { fitScreenSized, scaledAt, screenScale, screenSizedCount, screenSizedRef } from './screenSized';

// Drawings sized on screen (6.11): while a zoom is on its way, a node drawn for another zoom is scaled about its anchor,
// so a plan's label keeps its size and its gap on screen and nothing is drawn again; at rest it is exactly where React
// put it. Konva's nodes stand in as plain objects with the few methods the canvas calls.

interface FakeNode {
  stage: unknown;
  sx: number;
  sy: number;
  px: number;
  py: number;
}

function fake(stage: unknown, at: { x: number; y: number }): { node: Konva.Node; state: FakeNode } {
  const state: FakeNode = { stage, sx: 1, sy: 1, px: at.x, py: at.y };
  const node = {
    getStage: () => state.stage,
    scaleX: () => state.sx,
    scaleY: () => state.sy,
    x: () => state.px,
    y: () => state.py,
    scale: (s: { x: number; y: number }) => {
      state.sx = s.x;
      state.sy = s.y;
    },
    position: (p: { x: number; y: number }) => {
      state.px = p.x;
      state.py = p.y;
    },
  } as unknown as Konva.Node;
  return { node, state };
}

describe('drawings sized on screen (6.11)', () => {
  it('scales by the zoom drawn for over the view’s, and by 1 at rest or for a zoom that can’t be read', () => {
    expect(screenScale(0.2, 4)).toBeCloseTo(0.05, 12);
    expect(screenScale(4, 0.2)).toBeCloseTo(20, 12);
    expect(screenScale(1, 1)).toBe(1);
    expect(screenScale(0, 1)).toBe(1);
    expect(screenScale(Number.NaN, 1)).toBe(1);
  });

  it('keeps the anchor where it is and scales the offset from it', () => {
    const sized = { zoom: 0.5, at: { x: 10, y: 30 }, anchor: { x: 10, y: 20 } };
    expect(scaledAt(sized, 1)).toEqual({ x: 10, y: 30 });
    expect(scaledAt(sized, 0.25)).toEqual({ x: 10, y: 22.5 });
  });

  it('scales and places the nodes of its own stage only, puts them back at rest, and forgets those no longer drawn', () => {
    const stage = {} as Konva.Stage;
    const elsewhere = {};
    const label = fake(stage, { x: 10, y: 30 });
    const print = fake(elsewhere, { x: 0, y: 0 });
    const gone = fake(stage, { x: 0, y: 0 });
    const before = screenSizedCount();
    screenSizedRef(0.5, { x: 10, y: 30 }, { x: 10, y: 20 })(label.node);
    screenSizedRef(0.5, { x: 0, y: 0 }, { x: 0, y: 0 })(print.node);
    screenSizedRef(0.5, { x: 0, y: 0 }, { x: 0, y: 0 })(gone.node);
    screenSizedRef(0.5, { x: 0, y: 0 }, { x: 0, y: 0 })(null);
    expect(screenSizedCount() - before).toBe(3);
    // Zoomed in to 2 while drawn for 0.5: a quarter of its drawn size, its gap a quarter of what it was.
    expect(fitScreenSized(stage, 2)).toBe(true);
    expect(label.state).toMatchObject({ sx: 0.25, sy: 0.25, px: 10, py: 22.5 });
    expect(print.state).toMatchObject({ sx: 1, sy: 1 });
    // Nothing changed since: nothing to draw.
    expect(fitScreenSized(stage, 2)).toBe(false);
    // At rest at the zoom it was drawn for: exactly where React put it.
    gone.state.stage = null;
    expect(fitScreenSized(stage, 0.5)).toBe(true);
    expect(label.state).toMatchObject({ sx: 1, sy: 1, px: 10, py: 30 });
    expect(screenSizedCount() - before).toBe(2);
  });
});

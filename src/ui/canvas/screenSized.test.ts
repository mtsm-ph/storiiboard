import type Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { fitScreenSized, holdScreenSized, releaseScreenSized, scaledAt, screenScale, screenSizedCount, screenSizedRef } from './screenSized';

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

describe('drawings sized on screen, after the 6.11 review', () => {
  /** A fake node that can be shown or hidden and sits in a parent. */
  function shown(stage: unknown, at: { x: number; y: number }, parent: Konva.Node | null = null) {
    const made = fake(stage, at);
    let visible = true;
    Object.assign(made.node, {
      visible: (to?: boolean) => {
        if (to !== undefined) visible = to;
        return visible;
      },
      getParent: () => parent,
    });
    return { ...made, isVisible: () => visible };
  }

  it('puts a node at rest exactly where React put it, to the last bit (L3)', () => {
    // Numbers for which anchor + 1 × (at − anchor) is not at.
    const anchor = { x: 5 / 7.3, y: 5 / 7.3 };
    const at = { x: 5 / 3.1 + 0.123, y: 5 / 3.1 + 0.123 };
    expect(anchor.x + 1 * (at.x - anchor.x)).not.toBe(at.x);
    expect(scaledAt({ zoom: 1, at, anchor }, 1)).toEqual(at);
    const stage = {} as Konva.Stage;
    const label = fake(stage, at);
    const zoom = 1 + 212 / 1013;
    screenSizedRef(zoom, at, anchor)(label.node);
    fitScreenSized(stage, zoom * 2);
    fitScreenSized(stage, zoom);
    expect(label.state).toEqual({ stage, sx: 1, sy: 1, px: at.x, py: at.y });
  });

  it('forgets a node as soon as React lets it go, without waiting for a canvas to draw (L4)', () => {
    const stage = {} as Konva.Stage;
    const label = fake(stage, { x: 0, y: 0 });
    const before = screenSizedCount();
    const ref = screenSizedRef(1, { x: 0, y: 0 }, { x: 0, y: 0 });
    ref(label.node);
    expect(screenSizedCount() - before).toBe(1);
    ref(null);
    expect(screenSizedCount() - before).toBe(0);
    // A new ref for the same node (a render), the old one let go first, as React does: still known, once.
    const next = screenSizedRef(1, { x: 0, y: 0 }, { x: 0, y: 0 });
    next(label.node);
    const again = screenSizedRef(2, { x: 0, y: 0 }, { x: 0, y: 0 });
    next(null);
    again(label.node);
    expect(screenSizedCount() - before).toBe(1);
    again(null);
  });

  it('hides a node during a zoom below its least zoom, and always shows it at rest (L1)', () => {
    const stage = {} as Konva.Stage;
    const word = shown(stage, { x: 4, y: 4 });
    const ref = screenSizedRef(2, { x: 4, y: 4 }, { x: 0, y: 0 }, 1.5);
    ref(word.node);
    fitScreenSized(stage, 1.6);
    expect(word.isVisible()).toBe(true);
    expect(fitScreenSized(stage, 1.2)).toBe(true);
    expect(word.isVisible()).toBe(false);
    fitScreenSized(stage, 2);
    expect(word.isVisible()).toBe(true);
    ref(null);
  });

  it('keeps a label scaled for the live zoom after the settle until its item is made again, then puts it at scale 1 (6.11)', () => {
    const stage = {} as Konva.Stage;
    const waiting = shown(stage, { x: 10, y: 30 });
    const ready = shown(stage, { x: 10, y: 30 });
    const old = [screenSizedRef(0.5, { x: 10, y: 30 }, { x: 10, y: 20 }), screenSizedRef(0.5, { x: 10, y: 30 }, { x: 10, y: 20 })];
    old[0]?.(waiting.node);
    old[1]?.(ready.node);
    // Zoomed in to 2 and settled there: both still drawn for 0.5, both a quarter of their drawn size.
    fitScreenSized(stage, 2);
    // The catch-up makes the second again for 2 (React lets the old ref go and gives the new one the same node, its scale
    // untouched); the canvas fits after that render.
    old[1]?.(null);
    const made = screenSizedRef(2, { x: 10, y: 22.5 }, { x: 10, y: 20 });
    made(ready.node);
    ready.state.px = 10;
    ready.state.py = 22.5;
    expect(fitScreenSized(stage, 2)).toBe(true);
    expect(ready.state).toMatchObject({ sx: 1, sy: 1, px: 10, py: 22.5 });
    // The one still waiting stays scaled for the live zoom, at every fit, until its turn.
    expect(waiting.state).toMatchObject({ sx: 0.25, sy: 0.25, px: 10, py: 22.5 });
    expect(fitScreenSized(stage, 2)).toBe(false);
    expect(waiting.state).toMatchObject({ sx: 0.25 });
    old[0]?.(null);
    made(null);
  });

  it('keeps a sun path’s word hidden after the settle while its item waits, below the zoom its arc goes wordless (6.11)', () => {
    const stage = {} as Konva.Stage;
    const word = shown(stage, { x: 4, y: 4 });
    const ref = screenSizedRef(2, { x: 4, y: 4 }, { x: 0, y: 0 }, 1.5);
    ref(word.node);
    // Settled at 1, below 1.5: hidden though the view is at rest, since the word is still the one drawn for 2.
    fitScreenSized(stage, 1);
    expect(word.isVisible()).toBe(false);
    expect(fitScreenSized(stage, 1)).toBe(false);
    expect(word.isVisible()).toBe(false);
    // Made again for 1 (the arc wordless there drops it; one kept is shown, as at rest).
    ref(null);
    const again = screenSizedRef(1, { x: 4, y: 4 }, { x: 0, y: 0 }, 1.5);
    again(word.node);
    fitScreenSized(stage, 1);
    expect(word.isVisible()).toBe(true);
    again(null);
  });

  it('holds what is in the items the handles hold at scale 1 until they let go (L2)', () => {
    const stage = {} as Konva.Stage;
    const item = shown(stage, { x: 0, y: 0 });
    const inside = shown(stage, { x: 20, y: 40 }, item.node);
    const other = shown(stage, { x: 20, y: 40 });
    const refs = [screenSizedRef(0.5, { x: 20, y: 40 }, { x: 20, y: 30 }), screenSizedRef(0.5, { x: 20, y: 40 }, { x: 20, y: 30 })];
    refs[0]?.(inside.node);
    refs[1]?.(other.node);
    // A zoom not yet settled: both scaled.
    fitScreenSized(stage, 2);
    expect(inside.state).toMatchObject({ sx: 0.25, py: 32.5 });
    holdScreenSized([item.node]);
    expect(inside.state).toMatchObject({ sx: 1, sy: 1, px: 20, py: 40 });
    fitScreenSized(stage, 2);
    expect(inside.state).toMatchObject({ sx: 1, py: 40 });
    expect(other.state).toMatchObject({ sx: 0.25, py: 32.5 });
    releaseScreenSized();
    fitScreenSized(stage, 2);
    expect(inside.state).toMatchObject({ sx: 0.25, py: 32.5 });
    for (const ref of refs) ref(null);
  });
});

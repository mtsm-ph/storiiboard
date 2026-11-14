import { describe, expect, it } from 'vitest';
import { hostToolForKey, toolForKey, type KeyLike } from './keys';
import { marqueePicks, pickable, pickOrder } from './picking';
import { placedAt, PLACED_SIZE } from './placement';
import { constrainAngle, gridLines, gridPull, gridShown, nearestPoint, rulerTicks, scaleBarLength, snapToGrid } from './scale';
import { topmostAt } from './hitTest';
import type { CanvasItem, GridSpec, ToolSpec } from './types';
import { BOARD_ZOOM, fitBounds, zoomAround } from './viewport';

// The canvas core's options for a host with a real scale (6.2a): the grid's step and when it hides, the scale bar's
// round length at several zooms, grid snapping, the zoom limits, locked items left out of every pick, and a host's own
// tools. A board passes none of these, and its own tests stay as they were.

// A plan's: 1 unit is 1 cm, a line every 50 (0.5 m), strong every 2 (1 m), Alt to 5.
const GRID: GridSpec = { step: 50, major: 2, fine: 5 };
const ROUNDS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const size = { width: 800, height: 600 };

describe('the grid', () => {
  it('shows every step up close, only the strong lines further out, and none when they’d be closer than 8 px', () => {
    expect(gridShown(1, GRID)).toEqual({ step: 50, major: 2 });
    expect(gridShown(0.16, GRID)).toEqual({ step: 50, major: 2 });
    expect(gridShown(0.1, GRID)).toEqual({ step: 100, major: 1 });
    expect(gridShown(0.05, GRID)).toEqual({ step: 0, major: 1 });
  });

  it('lists the lines in view, each light or strong', () => {
    const lines = gridLines({ cx: 0, cy: 0, zoom: 1 }, { width: 200, height: 100 }, GRID);
    expect(lines.filter((l) => l.axis === 'x').map((l) => [l.at, l.strong])).toEqual([
      [-100, true],
      [-50, false],
      [0, true],
      [50, false],
      [100, true],
    ]);
    expect(gridLines({ cx: 0, cy: 0, zoom: 0.01 }, size, GRID)).toEqual([]);
  });
});

describe('the scale bar and rulers', () => {
  it('always shows a round length, the longest that fits in 120 px', () => {
    expect(scaleBarLength(1, ROUNDS)).toBe(100);
    expect(scaleBarLength(0.5, ROUNDS)).toBe(200);
    expect(scaleBarLength(0.1, ROUNDS)).toBe(1000);
    expect(scaleBarLength(4, ROUNDS)).toBe(20);
    expect(scaleBarLength(0.02, ROUNDS)).toBe(5000);
    // Closer than the shortest fits: the shortest.
    expect(scaleBarLength(50, ROUNDS)).toBe(10);
  });

  it('labels the rulers at round lengths at least 64 px apart', () => {
    const ticks = rulerTicks({ cx: 0, cy: 0, zoom: 1 }, { width: 400, height: 300 }, { rounds: ROUNDS, label: (u) => `${String(u / 100)} m` }, 'x');
    expect(ticks.map((tick) => tick.label)).toEqual(['-2 m', '-1 m', '0 m', '1 m', '2 m']);
    expect(ticks.map((tick) => tick.screen)).toEqual([0, 100, 200, 300, 400]);
  });
});

describe('grid snapping', () => {
  it('pulls a point onto a line within 6 screen px, snaps to the fine step with Alt, and not at all when off', () => {
    expect(snapToGrid({ x: 53, y: 120 }, GRID, 1, 'magnet')).toEqual({ x: 50, y: 120 });
    expect(snapToGrid({ x: 53, y: 147 }, GRID, 1, 'fine')).toEqual({ x: 55, y: 145 });
    expect(snapToGrid({ x: 53, y: 147 }, GRID, 1, 'off')).toEqual({ x: 53, y: 147 });
    // Further out, the reach is wider in the world.
    expect(snapToGrid({ x: 60, y: 0 }, GRID, 0.5, 'magnet')).toEqual({ x: 50, y: 0 });
  });

  it('pulls a moving box by its nearer edge', () => {
    expect(gridPull({ x: 47, y: 10, width: 100, height: 10 }, GRID, 1, 'magnet')).toEqual({ dx: 3, dy: 0 });
    expect(gridPull({ x: 10, y: 10, width: 42, height: 10 }, GRID, 1, 'magnet')).toEqual({ dx: -2, dy: 0 });
    expect(gridPull({ x: 47, y: 10, width: 100, height: 10 }, GRID, 1, 'off')).toEqual({ dx: 0, dy: 0 });
  });

  it('holds a direction to 15° steps, and joins a nearby end', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(p.x).toBeCloseTo(Math.hypot(100, 10), 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(nearestPoint({ x: 3, y: 4 }, [{ x: 0, y: 0 }, { x: 50, y: 0 }], 10)).toEqual({ x: 0, y: 0 });
    expect(nearestPoint({ x: 30, y: 4 }, [{ x: 0, y: 0 }], 10)).toBeNull();
  });
});

describe('zoom limits', () => {
  it('keeps a board’s 10% to 800%, and a fit at no more than 100%', () => {
    expect(zoomAround({ cx: 0, cy: 0, zoom: 1 }, size, 100, { x: 0, y: 0 }).zoom).toBe(8);
    expect(fitBounds({ x: 0, y: 0, width: 10, height: 10 }, size, 48, BOARD_ZOOM.fitMax).zoom).toBe(1);
  });

  it('lets a plan fit past 100% and zoom out to a 60 m stage', () => {
    const plan = { min: 0.02, max: 20, fitMax: 4 };
    // A 2 m prop table fitted fills the view: 200 units in 704 px is 352%.
    expect(fitBounds({ x: 0, y: 0, width: 200, height: 100 }, size, 48, plan.fitMax, plan).zoom).toBeCloseTo(3.52, 2);
    expect(zoomAround({ cx: 0, cy: 0, zoom: 1 }, size, 0.001, { x: 0, y: 0 }, plan).zoom).toBe(0.02);
    expect(fitBounds({ x: 0, y: 0, width: 6000, height: 3000 }, size, 48, plan.fitMax, plan).zoom).toBeGreaterThan(0.02);
  });
});

const item = (id: string, x: number, extra: Partial<CanvasItem> = {}): CanvasItem => ({ id, x, y: 0, width: 100, height: 100, rotation: 0, label: id, ...extra });

describe('locked items', () => {
  const items = [item('a', 0), item('b', 50, { locked: true }), item('c', 300, { dim: true })];

  it('are never picked by a click, a marquee, Tab or Select all, but are still there to draw', () => {
    // b is on top of a where they overlap: the click picks a beneath it.
    expect(topmostAt(pickable(items), { x: 75, y: 50 })?.id).toBe('a');
    expect(marqueePicks(items, { x: -10, y: -10, width: 500, height: 200 })).toEqual(['a', 'c']);
    expect(pickOrder([], ['link'], items)).toEqual(['link', 'a', 'c']);
    expect(pickOrder([item('s', 0, { section: { tab: { x: 0, y: -24, width: 72, height: 24 } }, locked: true })], [], [])).toEqual([]);
    expect(items).toHaveLength(3);
  });
});

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra });

describe('a host’s own tools', () => {
  const tools: ToolSpec[] = [
    { id: 'select', key: 'V', label: () => 'Select' },
    { id: 'host:wall', key: 'W', label: () => 'Wall', pointToPoint: true },
    { id: 'host:mark', key: '⇧M', label: () => 'Mark', size: { width: 40, height: 40 } },
  ];

  it('pick their tools by their letters, and only theirs', () => {
    expect(hostToolForKey(key('w'), tools)).toBe('host:wall');
    expect(hostToolForKey(key('W', { shiftKey: true }), tools)).toBeNull();
    expect(hostToolForKey(key('M', { shiftKey: true }), tools)).toBe('host:mark');
    // A board's letters are not a plan's.
    expect(hostToolForKey(key('r'), tools)).toBeNull();
    expect(hostToolForKey(key('w', { ctrlKey: true }), tools)).toBeNull();
    // And a board keeps its own.
    expect(toolForKey(key('r'))).toBe('rect');
    expect(toolForKey(key('w'))).toBeNull();
  });

  it('place what their size says, a board’s tools their own', () => {
    expect(placedAt({ x: 0, y: 0 }, 'rect', { width: 40, height: 40 })).toEqual({ x: -20, y: -20, width: 40, height: 40, rotation: 0 });
    expect(placedAt({ x: 0, y: 0 }, 'sticky').width).toBe(PLACED_SIZE.sticky.width);
  });
});

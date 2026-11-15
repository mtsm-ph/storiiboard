import { describe, expect, it } from 'vitest';
import { drawnItems, drawReach, mountedItems } from './culling';
import type { CanvasItem } from './types';

// What a canvas draws (5.7, 6.4): items whose drawing meets the view and the selected ones; what an item draws past its
// box (a camera's cone) counts, so the cone stays drawn while its camera is off screen. Boards set none, and read as before.

const item = (id: string, x: number, y: number, extra: Partial<CanvasItem> = {}): CanvasItem => ({ id, label: id, x, y, width: 40, height: 40, rotation: 0, ...extra });
const view = { x: 0, y: 0, width: 400, height: 300 };

describe('drawing past the box', () => {
  it('keeps an item drawn while only its cone meets the view, and picks nothing new', () => {
    const cone = { bounds: { x: -700, y: 0, width: 760, height: 100 }, draw: () => null };
    const camera = item('cam', -500, 20, { beyond: cone });
    const plain = item('box', -500, 20);
    expect(drawReach(camera)).toEqual({ x: -700, y: 0, width: 760, height: 100 });
    expect(drawnItems([camera, plain], new Set(), view).map((i) => i.id)).toEqual(['cam']);
    // Its cone out of view too: not drawn, unless it is selected.
    const far = item('far', -2000, 20, { beyond: { bounds: { x: -2600, y: 0, width: 640, height: 40 }, draw: () => null } });
    expect(drawnItems([far], new Set(), view)).toEqual([]);
    expect(drawnItems([far], new Set(['far']), view).map((i) => i.id)).toEqual(['far']);
  });

  it('leaves an item with nothing past its box as its box', () => {
    const plain = item('box', 10, 10);
    expect(drawReach(plain)).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(drawnItems([plain], new Set(), view)).toEqual([plain]);
  });
});

describe('a section’s name tab (boards, unchanged by 6.4)', () => {
  it('keeps a section drawn while only its tab meets the view, and culls it when neither does', () => {
    // The tab sits above the box's top left corner, as a board draws it.
    const section = item('sec', 10, 330, { section: { tab: { x: 0, y: -40, width: 120, height: 24 } } });
    expect(drawReach(section)).toEqual({ x: 10, y: 290, width: 120, height: 80 });
    expect(drawnItems([section], new Set(), view).map((i) => i.id)).toEqual(['sec']);
    const below = item('low', 10, 400, { section: { tab: { x: 0, y: -40, width: 120, height: 24 } } });
    expect(drawnItems([below], new Set(), view)).toEqual([]);
    expect(drawnItems([below], new Set(['low']), view).map((i) => i.id)).toEqual(['low']);
  });
});

describe('an item’s reach, once per item (6.11)', () => {
  it('works out an item’s reach once and gives back the same box for it on every frame after', () => {
    const cone = { bounds: { x: -700, y: 0, width: 760, height: 100 }, draw: () => null };
    const camera = item('cam', -500, 20, { beyond: cone });
    const first = drawReach(camera);
    expect(drawReach(camera)).toBe(first);
    // A moved item is a new object, with a reach of its own.
    const moved = { ...camera, x: -400, beyond: { ...cone, bounds: { ...cone.bounds, x: -600 } } };
    expect(drawReach(moved)).not.toBe(first);
    expect(drawReach(moved).x).toBe(-600);
  });

  it('works out the reach again for the same object edited in place, as boundsFor does (6.11 review, L5)', () => {
    const plain = item('box', 10, 10);
    const first = drawReach(plain);
    expect(drawReach(plain)).toBe(first);
    plain.x = 200;
    plain.rotation = 45;
    const again = drawReach(plain);
    expect(again).not.toBe(first);
    expect(again.x).toBeCloseTo(200 + 20 - 20 * Math.SQRT2, 9);
    expect(drawReach(plain)).toBe(again);
  });
});

describe('what a view mounts (6.11)', () => {
  it('keeps a plan’s item mounted, hidden, while it is out of view, and mounts a board’s only while it is drawn', () => {
    const planIn = item('in', 10, 10, { sameInAndOut: true });
    const planOut = item('out', -900, 10, { sameInAndOut: true });
    const boardIn = item('board', 60, 10);
    const boardOut = item('gone', -900, 60);
    const all = [planOut, boardIn, planIn, boardOut];
    const mounted = mountedItems(all, drawnItems(all, new Set(), view));
    expect(mounted.items.map((i) => i.id)).toEqual(['out', 'board', 'in']);
    expect([...mounted.hidden]).toEqual(['out']);
    // Everything in view: none hidden, the same items in their order.
    const near = [item('a', 0, 0, { sameInAndOut: true }), item('b', 50, 0)];
    expect(mountedItems(near, drawnItems(near, new Set(), view))).toEqual({ items: near, hidden: new Set() });
  });
});

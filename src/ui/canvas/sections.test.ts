import { describe, expect, it } from 'vitest';
import { drawOrder, EDGE_BAND_PIXELS, sectionContents, sectionHit, tabRect, topmostSectionAt } from './sections';
import type { CanvasItem } from './types';

// Sections (5.3): what one holds is worked out from where things are, and it is picked only by its name or its edge band.

const item = (id: string, x: number, y: number, width: number, height: number, rotation = 0): CanvasItem => ({ id, label: id, x, y, width, height, rotation });
const section = (id: string, x: number, y: number, width: number, height: number): CanvasItem => ({
  ...item(id, x, y, width, height),
  section: { tab: { x: 0, y: -24, width: 90, height: 24 } },
});

describe('what a section holds', () => {
  const big = section('s', 0, 0, 400, 300);

  it('is the items wholly inside its box, not those that cross an edge or lie outside', () => {
    const all = [big, item('in', 20, 20, 100, 100), item('edge', 350, 50, 100, 50), item('out', 500, 500, 10, 10), item('exact', 0, 0, 400, 300)];
    expect(sectionContents(big, all)).toEqual(['in', 'exact']);
  });

  it('counts a turned item by the rectangle round it', () => {
    // 200 x 20 turned 90 degrees is 20 wide and 200 tall about its middle: it needs 200 of height.
    const tall = item('tall', 100, 140, 200, 20, 90);
    expect(sectionContents(big, [big, tall])).toEqual(['tall']);
    expect(sectionContents(section('short', 0, 0, 400, 150), [tall])).toEqual([]);
  });

  it('holds other sections, and what they hold, and never itself', () => {
    const inner = section('inner', 40, 60, 200, 150);
    const deep = item('deep', 60, 80, 20, 20);
    expect(sectionContents(big, [big, inner, deep])).toEqual(['inner', 'deep']);
    expect(sectionContents(inner, [big, inner, deep])).toEqual(['deep']);
  });
});

describe('picking a section', () => {
  const s = section('s', 100, 100, 400, 300);

  it('is by its name tab, above the corner', () => {
    expect(tabRect(s)).toEqual({ x: 100, y: 76, width: 90, height: 24 });
    expect(sectionHit(s, { x: 120, y: 88 }, 1)).toBe(true);
    expect(sectionHit(s, { x: 200, y: 88 }, 1)).toBe(false);
  });

  it('is by the 8 screen pixel band along its edges, wider in world units when zoomed out', () => {
    expect(EDGE_BAND_PIXELS).toBe(8);
    expect(sectionHit(s, { x: 300, y: 105 }, 1)).toBe(true);
    expect(sectionHit(s, { x: 300, y: 109 }, 1)).toBe(false);
    expect(sectionHit(s, { x: 494, y: 250 }, 1)).toBe(true);
    expect(sectionHit(s, { x: 300, y: 392 }, 1)).toBe(true);
    // At 50% eight pixels are 16 world units; at 200% they are 4.
    expect(sectionHit(s, { x: 300, y: 114 }, 0.5)).toBe(true);
    expect(sectionHit(s, { x: 300, y: 105 }, 2)).toBe(false);
  });

  it('is not by its empty middle, where a click starts a marquee, nor from outside', () => {
    expect(sectionHit(s, { x: 300, y: 250 }, 1)).toBe(false);
    expect(sectionHit(s, { x: 20, y: 250 }, 1)).toBe(false);
  });

  it('picks the topmost of the sections the point is on', () => {
    const over = section('over', 100, 100, 300, 200);
    expect(topmostSectionAt([s, over], { x: 300, y: 102 }, 1)?.id).toBe('over');
    expect(topmostSectionAt([s, over], { x: 495, y: 250 }, 1)?.id).toBe('s');
    expect(topmostSectionAt([s, over], { x: 300, y: 250 }, 1)).toBeUndefined();
  });
});

describe('the order sections are drawn in', () => {
  it('draws a section wholly inside a larger one above it, whatever the sibling order, and otherwise keeps the order', () => {
    const outer = section('outer', 0, 0, 1000, 800);
    const inner = section('inner', 100, 100, 200, 200);
    const beside = section('beside', 2000, 0, 100, 100);
    expect(drawOrder([inner, beside, outer]).map((s) => s.id)).toEqual(['beside', 'outer', 'inner']);
    expect(drawOrder([outer, inner, beside]).map((s) => s.id)).toEqual(['outer', 'inner', 'beside']);
    // Two of one size hold each other and keep their order.
    expect(drawOrder([section('a', 0, 0, 100, 100), section('b', 0, 0, 100, 100)]).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

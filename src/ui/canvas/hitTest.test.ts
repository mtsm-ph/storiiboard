import { describe, expect, it } from 'vitest';
import { boundsOf, cornersOf, hitsPoint, marqueeHolds, marqueeTouches, rectFromCorners, topmostAt } from './hitTest';
import type { Geometry } from './types';

const box = (rotation = 0): Geometry => ({ x: 0, y: 0, width: 100, height: 20, rotation });

describe('hit tests on rotated rectangles', () => {
  it('finds a point inside an upright rectangle, edges included', () => {
    expect(hitsPoint(box(), { x: 50, y: 10 })).toBe(true);
    expect(hitsPoint(box(), { x: 100, y: 20 })).toBe(true);
    expect(hitsPoint(box(), { x: 101, y: 10 })).toBe(false);
    expect(hitsPoint(box(), { x: 50, y: 21 })).toBe(false);
  });

  it('turns the rectangle round its centre, clockwise', () => {
    // Turned 90 degrees clockwise, the 100 x 20 box stands up round (50, 10): it now spans x 40–60 and y -40–60.
    const turned = box(90);
    expect(hitsPoint(turned, { x: 50, y: -35 })).toBe(true);
    expect(hitsPoint(turned, { x: 50, y: 55 })).toBe(true);
    expect(hitsPoint(turned, { x: 5, y: 10 })).toBe(false);
    expect(hitsPoint(turned, { x: 95, y: 10 })).toBe(false);
    const [topLeft] = cornersOf(turned);
    expect(topLeft.x).toBeCloseTo(60);
    expect(topLeft.y).toBeCloseTo(-40);
  });

  it('a 45 degree box misses the corner of its own upright bounds', () => {
    const square: Geometry = { x: 0, y: 0, width: 100, height: 100, rotation: 45 };
    expect(boundsOf(square).width).toBeCloseTo(141.42, 1);
    expect(hitsPoint(square, { x: 1, y: 1 })).toBe(false);
    expect(hitsPoint(square, { x: 50, y: 1 })).toBe(true);
  });

  it('picks the topmost of overlapping items', () => {
    const items = [
      { id: 'back', ...box() },
      { id: 'front', ...box() },
    ];
    expect(topmostAt(items, { x: 10, y: 10 })?.id).toBe('front');
    expect(topmostAt(items, { x: 500, y: 500 })).toBeUndefined();
  });

  it('a marquee touches an item it crosses, misses one it does not reach, and one inside it', () => {
    expect(marqueeTouches(box(), { x: 90, y: 10, width: 50, height: 50 })).toBe(true);
    expect(marqueeTouches(box(), { x: 0, y: 30, width: 100, height: 20 })).toBe(false);
    // The marquee wholly inside the item touches it too.
    expect(marqueeTouches(box(), { x: 40, y: 5, width: 10, height: 5 })).toBe(true);
    // The item wholly inside the marquee.
    expect(marqueeTouches(box(), { x: -10, y: -10, width: 200, height: 200 })).toBe(true);
    expect(marqueeHolds(box(), { x: -10, y: -10, width: 200, height: 200 })).toBe(true);
    expect(marqueeHolds(box(), { x: 90, y: 10, width: 50, height: 50 })).toBe(false);
  });

  it('a marquee tests the rotated shape, not its upright bounds', () => {
    const diamond: Geometry = { x: 0, y: 0, width: 100, height: 100, rotation: 45 };
    // The upright bounds reach the corner at (0, 0); the diamond does not.
    expect(marqueeTouches(diamond, { x: -10, y: -10, width: 15, height: 15 })).toBe(false);
    expect(marqueeTouches(diamond, { x: 40, y: -10, width: 20, height: 15 })).toBe(true);
  });

  it('makes a rectangle from two corners dragged any way', () => {
    expect(rectFromCorners({ x: 10, y: 50 }, { x: 4, y: 20 })).toEqual({ x: 4, y: 20, width: 6, height: 30 });
  });
});

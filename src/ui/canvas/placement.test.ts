import { describe, expect, it } from 'vitest';
import { MIN_SIZE, NEW_HEIGHT, NEW_WIDTH, PASTE_OFFSET, atLeastMinimum, moved, normalisedRotation, nudgeFor, pasted, placedAt } from './placement';
import type { Geometry } from './types';

const g = (x: number, y: number, rotation = 0): Geometry => ({ x, y, width: 100, height: 50, rotation });

describe('nudges, pastes and placements', () => {
  it('nudges 1 unit, Shift 10, and ignores other keys', () => {
    expect(nudgeFor('ArrowLeft', false)).toEqual({ x: -1, y: 0 });
    expect(nudgeFor('ArrowDown', true)).toEqual({ x: 0, y: 10 });
    expect(nudgeFor('a', false)).toBeNull();
    expect(moved(g(5, 5), -1, 0).x).toBe(4);
  });

  it('pastes 16 units from the originals with no point', () => {
    expect(pasted([g(0, 0), g(200, 100)], null).map((p) => [p.x, p.y])).toEqual([
      [PASTE_OFFSET, PASTE_OFFSET],
      [200 + PASTE_OFFSET, 100 + PASTE_OFFSET],
    ]);
  });

  it('pastes with the group middle on the pointer, keeping the places of the items to each other', () => {
    const out = pasted([g(0, 0), g(200, 0)], { x: 1000, y: 500 });
    // The group spans 0–300 by 0–50; its middle is (150, 25).
    expect(out[0]).toMatchObject({ x: 850, y: 475 });
    expect(out[1]).toMatchObject({ x: 1050, y: 475 });
  });

  it('places the standard rectangle round a point', () => {
    expect(placedAt({ x: 0, y: 0 })).toEqual({ x: -NEW_WIDTH / 2, y: -NEW_HEIGHT / 2, width: 200, height: 120, rotation: 0 });
  });

  it('holds a size at 8 and a rotation in 0–360', () => {
    expect(atLeastMinimum(2)).toBe(MIN_SIZE);
    expect(atLeastMinimum(30)).toBe(30);
    expect(normalisedRotation(-90)).toBe(270);
    expect(normalisedRotation(450)).toBe(90);
    expect(normalisedRotation(359.999)).toBe(0);
  });
});

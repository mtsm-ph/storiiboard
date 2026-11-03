import { describe, expect, it } from 'vitest';
import { verticalNeighbour, type ItemBox } from './gridKeys';

// Two scene groups, as they lay out: 4 frames per row; scene 4 has 6 frames (+ Frame), scene 5 has 2 (+ Frame).
const box = (col: number, top: number): ItemBox => ({ left: col * 200, top, width: 180 });
const items = [
  box(0, 0), box(1, 0), box(2, 0), box(3, 0),
  box(0, 150), box(1, 150), box(2, 150),
  box(0, 400), box(1, 400), box(2, 400),
];

describe('Up and Down on the board', () => {
  it('go to the nearest item in the row above or below, across scene groups', () => {
    expect(verticalNeighbour(items, 1, 1)).toBe(5);
    expect(verticalNeighbour(items, 3, 1)).toBe(6);
    expect(verticalNeighbour(items, 5, 1)).toBe(8);
    expect(verticalNeighbour(items, 8, -1)).toBe(5);
    expect(verticalNeighbour(items, 4, -1)).toBe(0);
  });

  it('stop at the top and the bottom', () => {
    expect(verticalNeighbour(items, 2, -1)).toBeNull();
    expect(verticalNeighbour(items, 9, 1)).toBeNull();
  });
});

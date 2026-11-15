import { describe, expect, it } from 'vitest';
import { alongRange, centreOfBox, fitAlong, fitsAt, onStep, openingFrame, projectOnWall, wallNeeds, wallUnder } from './openings';
import { openingFields, planItemFields, wallBetween, wallProps, type OpeningFields, type PlanItemFields } from './plan';

// Doors and windows in their walls (6.2b): a place worked out from the wall every time (so moved, turned, stretched or
// flipped, the opening goes with it), the box a door's swing adds to, the limits along a wall, and no overlaps.

const wall = (a: { x: number; y: number }, b: { x: number; y: number }): PlanItemFields => {
  const fields = planItemFields(wallProps(wallBetween(a, b)));
  if (!fields) throw new Error('no wall');
  return fields;
};
const door = (along: number, extra: Partial<OpeningFields> = {}): OpeningFields => ({ kind: 'door', wallId: 'w', along, width: 0.9, hinge: 'start', swing: 'left', heightM: null, name: '', ...extra });
const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe('an opening’s place', () => {
  const straight = wall({ x: 0, y: 0 }, { x: 4, y: 0 });

  it('is its distance along the wall from the wall’s start', () => {
    near(openingFrame(straight, door(1)).centre, 1, 0);
  });

  it('moves, turns, stretches and flips with its wall', () => {
    near(openingFrame(wall({ x: 2, y: 3 }, { x: 6, y: 3 }), door(1)).centre, 3, 3);
    near(openingFrame(wall({ x: 0, y: 0 }, { x: 0, y: 4 }), door(1)).centre, 0, 1);
    // Stretched from its end: the opening stays the same distance from the start.
    near(openingFrame(wall({ x: 0, y: 0 }, { x: 8, y: 0 }), door(1)).centre, 1, 0);
    // Flipped end for end: it is measured from the new start.
    near(openingFrame(wall({ x: 4, y: 0 }, { x: 0, y: 0 }), door(1)).centre, 3, 0);
    expect(openingFrame(wall({ x: 0, y: 0 }, { x: 0, y: 4 }), door(1)).box.rotation).toBe(90);
  });

  it('has a box as wide as it is, across the wall plus a door’s swing on the side it opens to', () => {
    const left = openingFrame(straight, door(1)).box;
    expect(left.width).toBeCloseTo(0.9, 6);
    expect(left.height).toBeCloseTo(1, 6);
    // Left of a wall drawn left to right is up the screen.
    expect(left.y).toBeCloseTo(-0.95, 6);
    const right = openingFrame(straight, door(1, { swing: 'right' })).box;
    expect(right.y).toBeCloseTo(-0.05, 6);
    const window = openingFrame(straight, { ...door(1), kind: 'window', width: 1.2 }).box;
    expect([window.width, window.height]).toEqual([1.2, 0.1]);
  });

  it('comes back from its box: a drag moves the box, and the middle follows', () => {
    for (const swing of ['left', 'right'] as const) {
      const turned = wall({ x: 1, y: 1 }, { x: 4, y: 5 });
      const frame = openingFrame(turned, door(2, { swing }));
      const back = centreOfBox(frame.box, door(2, { swing }));
      near(back, frame.centre.x, frame.centre.y);
    }
  });

  it('finds the wall under a point, and where along it the point is', () => {
    const walls = [
      { id: 'a', fields: straight },
      { id: 'b', fields: wall({ x: 4, y: 0 }, { x: 4, y: 3 }) },
    ];
    expect(wallUnder(walls, { x: 1, y: 0.04 }, 0)?.id).toBe('a');
    expect(wallUnder(walls, { x: 4.02, y: 2 }, 0)).toMatchObject({ id: 'b' });
    expect(wallUnder(walls, { x: 1, y: 1 }, 0.15)).toBeNull();
    const projected = projectOnWall(straight, { x: 2.5, y: 0.3 });
    expect(projected.along).toBeCloseTo(2.5, 6);
    expect(projected.distance).toBeCloseTo(0.3, 6);
  });
});

describe('the limits along a wall', () => {
  it('keep an opening half its width in from each end', () => {
    expect(alongRange(4, 0.9)).toEqual([0.45, 3.55]);
    expect(alongRange(0.5, 0.9)).toBeNull();
    expect(fitAlong(4, 0.9, 0.2, [])).toBe(0.45);
    expect(fitAlong(4, 0.9, 3.9, [])).toBe(3.55);
    expect(fitAlong(0.5, 0.9, 0.25, [])).toBeNull();
  });

  it('never let two openings overlap: one stops against the other, or takes the nearest gap', () => {
    const other = { along: 2, width: 1.2 };
    expect(fitsAt(4, { along: 2.5, width: 0.9 }, [other])).toBe(false);
    // Touching is allowed.
    expect(fitsAt(4, { along: 3.05, width: 0.9 }, [other])).toBe(true);
    expect(fitAlong(4, 0.9, 2.9, [other])).toBe(3.05);
    expect(fitAlong(4, 0.9, 1.4, [other])).toBe(0.95);
    // No room anywhere.
    expect(fitAlong(2.1, 0.9, 1, [{ along: 1.05, width: 2.1 }])).toBeNull();
  });

  it('hold a wall at the length its openings need', () => {
    expect(wallNeeds([door(1), { ...door(3), width: 1.2 }])).toBeCloseTo(3.6, 6);
    expect(wallNeeds([])).toBe(0);
  });

  it('snap a place to the grid’s step along the wall', () => {
    expect(onStep(1.26, 0.5)).toBe(1.5);
    expect(onStep(1.26, 0)).toBe(1.26);
  });
});

describe('an opening’s fields', () => {
  it('read with defaults, and refuse one with no wall or place', () => {
    expect(openingFields({ kind: 'door', wall_id: 'w', along_m: 1 })).toEqual(door(1));
    expect(openingFields({ kind: 'window', wall_id: 'w', along_m: 1 })).toMatchObject({ width: 1.2, hinge: 'start', swing: 'left' });
    expect(openingFields({ kind: 'door', wall_id: 'w', along_m: 1, hinge: 'end', swing: 'right', width_m: 0.8 })).toMatchObject({ hinge: 'end', swing: 'right', width: 0.8 });
    expect(openingFields({ kind: 'door', along_m: 1 })).toBeNull();
    expect(openingFields({ kind: 'door', wall_id: 'w', along_m: -1 })).toBeNull();
    expect(openingFields({ kind: 'wall', wall_id: 'w', along_m: 1 })).toBeNull();
  });
});

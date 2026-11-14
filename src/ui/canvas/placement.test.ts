import { describe, expect, it } from 'vitest';
import { PLACED_SIZE, MIN_SIZE, NEW_HEIGHT, NEW_WIDTH, PASTE_OFFSET, atLeastMinimum, moved, normalisedRotation, nudgeFor, pasted, placedAt, withDraft } from './placement';
import type { Geometry } from './types';

const g = (x: number, y: number, rotation = 0): Geometry => ({ x, y, width: 100, height: 50, rotation });

describe('what each tool places', () => {
  it('puts a sticky note down square and a text box wide, each centred on the click', () => {
    expect(placedAt({ x: 0, y: 0 }, 'sticky')).toMatchObject({ x: -100, y: -100, width: 200, height: 200 });
    expect(placedAt({ x: 0, y: 0 }, 'text').width).toBe(PLACED_SIZE.text.width);
    expect(placedAt({ x: 0, y: 0 })).toMatchObject({ width: NEW_WIDTH, height: NEW_HEIGHT });
    expect(placedAt({ x: 0, y: 0 }, 'ellipse')).toMatchObject({ width: NEW_WIDTH, height: NEW_HEIGHT });
  });
});

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

// An item where a gesture's draft has it (6.2a review): a move takes its snap points along, so a run's click joins the
// ends where a wall is drawn mid-drag; a resize or a turn keeps the item's own; an item without them gets none.

describe('an item under a draft', () => {
  const wall = { id: 'w', x: 0, y: -5, width: 350, height: 10, rotation: 0, snapPoints: [{ x: 0, y: 0 }, { x: 350, y: 0 }] };

  it('takes its snap points along with a move', () => {
    expect(withDraft(wall, { x: 100, y: 45, width: 350, height: 10, rotation: 0 })).toMatchObject({
      x: 100,
      y: 45,
      snapPoints: [{ x: 100, y: 50 }, { x: 450, y: 50 }],
    });
  });

  it('keeps them for a resize or a turn, and adds none to an item without', () => {
    expect(withDraft(wall, { x: 0, y: -5, width: 500, height: 10, rotation: 0 }).snapPoints).toBe(wall.snapPoints);
    expect(withDraft(wall, { x: 0, y: -5, width: 350, height: 10, rotation: 90 }).snapPoints).toBe(wall.snapPoints);
    const box = { id: 'b', x: 0, y: 0, width: 10, height: 10, rotation: 0 };
    expect(withDraft(box, { x: 5, y: 5, width: 10, height: 10, rotation: 0 })).toEqual({ id: 'b', x: 5, y: 5, width: 10, height: 10, rotation: 0 });
  });
});

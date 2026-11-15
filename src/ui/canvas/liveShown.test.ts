import { describe, expect, it } from 'vitest';
import { remadeFor, shownWith } from './liveShown';
import type { CanvasItem, Geometry, LiveBy } from './types';

// What the canvas draws during a gesture (6.18 second review, item 3): a board, which never sets liveItems, draws the very
// items it was given when nothing moves; so does a plan whose host remakes nothing.

const item = (id: string, x: number): CanvasItem => ({ id, label: id, x, y: 0, width: 10, height: 10, rotation: 0 });

describe('the items drawn during a gesture', () => {
  const items = [item('a', 0), item('b', 20)];

  it('with liveItems unset, are the very items given while nothing moves, and a drag moves only its own', () => {
    expect(remadeFor(undefined, null, null)).toBeNull();
    expect(shownWith(items, null, remadeFor(undefined, null, null))).toBe(items);
    const draft = new Map<string, Geometry>([['b', { x: 30, y: 0, width: 10, height: 10, rotation: 0 }]]);
    const shown = shownWith(items, draft, remadeFor(undefined, draft, null));
    expect(shown).not.toBe(items);
    expect(shown[0]).toBe(items[0]);
    expect(shown[1]?.x).toBe(30);
  });

  it('with liveItems set but remaking nothing, are the very items given', () => {
    const asked: [ReadonlyMap<string, Geometry> | null, LiveBy][] = [];
    const none = (live: ReadonlyMap<string, Geometry> | null, by: LiveBy): ReadonlyMap<string, CanvasItem> => {
      asked.push([live, by]);
      return new Map();
    };
    expect(shownWith(items, null, remadeFor(none, null, null))).toBe(items);
    // The handles' live boxes are asked for as the handles', a draft as a drag's.
    const boxes = new Map<string, Geometry>([['a', { x: 0, y: 0, width: 10, height: 10, rotation: 15 }]]);
    expect(shownWith(items, null, remadeFor(none, null, boxes))).toBe(items);
    remadeFor(none, boxes, null);
    expect(asked.map(([live, by]) => [live === null ? null : [...live.keys()], by])).toEqual([
      [null, 'handles'],
      [['a'], 'handles'],
      [['a'], 'drag'],
    ]);
  });

  it('with an item remade, draws it in place of its own, at the drag’s place', () => {
    const remade = new Map<string, CanvasItem>([['a', { ...item('a', 0), label: 'remade' }]]);
    const draft = new Map<string, Geometry>([['a', { x: 5, y: 0, width: 10, height: 10, rotation: 0 }]]);
    const shown = shownWith(items, draft, remade);
    expect(shown[0]).toMatchObject({ label: 'remade', x: 5 });
    expect(shown[1]).toBe(items[1]);
  });
});

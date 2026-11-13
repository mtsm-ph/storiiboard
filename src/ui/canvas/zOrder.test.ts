import { describe, expect, it } from 'vitest';
import { reordered, sortKeysFor } from './zOrder';

const order = ['a', 'b', 'c', 'd', 'e'];
const set = (...ids: string[]) => new Set(ids);

describe('z order', () => {
  it('brings one item forward past its neighbour', () => {
    expect(reordered(order, set('b'), 'forward')).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('sends one item backward', () => {
    expect(reordered(order, set('d'), 'backward')).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('brings to the front and sends to the back, several items keeping their order', () => {
    expect(reordered(order, set('b', 'd'), 'front')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(reordered(order, set('b', 'd'), 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('moves several one step each, never over each other', () => {
    expect(reordered(order, set('a', 'b'), 'forward')).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(reordered(order, set('d', 'e'), 'backward')).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('leaves what is already at the end where it is', () => {
    expect(reordered(order, set('e'), 'forward')).toEqual(order);
    expect(reordered(order, set('a'), 'backward')).toEqual(order);
    expect(reordered(order, set('e'), 'front')).toEqual(order);
    expect(reordered(order, set(), 'front')).toEqual(order);
  });

  const keys = new Map([['a', 'D'], ['b', 'H'], ['c', 'M'], ['d', 'R'], ['e', 'W']]);
  const sorted = (final: Map<string, string>) => [...final].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([id]) => id);

  it('writes a key for the moved items only, and the order sorts by key', () => {
    const next = reordered(order, set('b'), 'front');
    const written = sortKeysFor(order, next, keys, set('b'));
    expect([...written.keys()]).toEqual(['b']);
    expect(sorted(new Map([...keys, ...written]))).toEqual(next);
  });

  it('keeps several moved items in order between their neighbours', () => {
    for (const mode of ['forward', 'backward', 'front', 'back'] as const) {
      const moved = set('b', 'd');
      const next = reordered(order, moved, mode);
      const written = sortKeysFor(order, next, keys, moved);
      expect(sorted(new Map([...keys, ...written]))).toEqual(next);
      // Nothing outside the moved items is rewritten.
      expect([...written.keys()].every((id) => moved.has(id))).toBe(true);
    }
  });

  it('writes nothing when the order did not change', () => {
    expect(sortKeysFor(order, order, keys, set('e')).size).toBe(0);
  });
});

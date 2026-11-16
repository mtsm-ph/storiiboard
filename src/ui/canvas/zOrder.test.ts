import { describe, expect, it } from 'vitest';
import { keyBetween } from '../../core/ops/order';
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

  // 6.7 second review, L1: an item tied with the one before it never lowers the bound below a key just written.
  it('never writes two moved items the same key around a tie already in the data', () => {
    const tied = new Map([['a', 'D'], ['x', 'M'], ['y', 'M'], ['z', 'W'], ['b', 'A'], ['c', 'Z']]);
    const before = ['b', 'a', 'x', 'y', 'z', 'c'];
    const after = ['a', 'x', 'b', 'y', 'c', 'z'];
    const written = sortKeysFor(before, after, tied, set('b', 'c'));
    const b = written.get('b') ?? '';
    const c = written.get('c') ?? '';
    expect(b > 'M' && b < 'W').toBe(true);
    expect(c > b && c < 'W').toBe(true);
  });

  it('writes the same keys as before with distinct keys', () => {
    expect([...sortKeysFor(order, reordered(order, set('b'), 'front'), keys, set('b'))]).toEqual([['b', 'l']]);
    const bd = (mode: 'forward' | 'backward' | 'front' | 'back') => [...sortKeysFor(order, reordered(order, set('b', 'd'), mode), keys, set('b', 'd'))];
    expect(bd('forward')).toEqual([['b', 'R'], ['d', 'l']]);
    expect(bd('backward')).toEqual([['b', '7'], ['d', 'I']]);
    expect(bd('front')).toEqual([['b', 'l'], ['d', 't']]);
    expect(bd('back')).toEqual([['b', '7'], ['d', 'A']]);
  });
});

// 6.23 (Kevin: an unreadable sort key from an odd imported file never makes the app throw): a key keyBetween can't
// read, or two out of order, has the whole list written afresh in the order asked for.
describe('z order past a key that can’t be read (6.23)', () => {
  // Back to front as their keys sort: "!" before every digit, "~" after.
  const odd = new Map([['c', '!'], ['a', 'D'], ['b', 'H'], ['d', 'R'], ['e', '~']]);
  const shown = [...odd.keys()];
  const keys = new Map([['a', 'D'], ['b', 'H'], ['c', 'M'], ['d', 'R'], ['e', 'W']]);
  const sorted = (base: Map<string, string>, final: Map<string, string>) =>
    [...new Map([...base, ...final])].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([id]) => id);

  it('gives the order asked for in every mode, never throwing', () => {
    for (const mode of ['forward', 'backward', 'front', 'back'] as const) {
      for (const moved of [set('b'), set('e'), set('c'), set('a', 'd')]) {
        const next = reordered(shown, moved, mode);
        let written = new Map<string, string>();
        expect(() => (written = sortKeysFor(shown, next, odd, moved))).not.toThrow();
        expect(sorted(odd, written)).toEqual(next);
        expect(new Set(shown.map((id) => written.get(id) ?? odd.get(id))).size).toBe(shown.length);
      }
    }
  });

  it('Bring to front past an odd last key, and Send to back past an odd first key', () => {
    const front = reordered(shown, set('b'), 'front');
    expect(sorted(odd, sortKeysFor(shown, front, odd, set('b')))).toEqual(['c', 'a', 'd', 'e', 'b']);
    const back = reordered(shown, set('d'), 'back');
    expect(sorted(odd, sortKeysFor(shown, back, odd, set('d')))).toEqual(['d', 'c', 'a', 'b', 'e']);
  });

  it('a sound list’s keys are keyBetween’s, as before', () => {
    const front = sortKeysFor(order, reordered(order, set('b'), 'front'), keys, set('b'));
    expect([...front]).toEqual([['b', keyBetween('W', null)]]);
    const back = sortKeysFor(order, reordered(order, set('d'), 'back'), keys, set('d'));
    expect([...back]).toEqual([['d', keyBetween(null, 'D')]]);
  });
});

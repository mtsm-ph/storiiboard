import { describe, expect, it } from 'vitest';
import { freshKeys, keyAfter, keyAfterKeys, keyAfterStored, keyBetween, keyBetweenOrNull, keyBetweenStored, lastReadableKey, placeAmong, sequenceKeys } from './order';

// The guarded helpers every caller uses when it hands keyBetween a key read from the records (6.23, Kevin: an unreadable
// sort key from an odd imported file never makes the app throw). keyBetween itself keeps its contract (order.test.ts).

/** A key keyBetween can't read: it sorts after every base-62 digit, as an imported file's might (6.22's tests). */
const ODD = '~';

describe('keys read from the records (6.23)', () => {
  it('keyBetweenOrNull: keyBetween’s key for two it can read in order, else null', () => {
    expect(keyBetweenOrNull('b', 'c')).toBe(keyBetween('b', 'c'));
    expect(keyBetweenOrNull(null, null)).toBe(keyBetween(null, null));
    expect(keyBetweenOrNull('e', null)).toBe(keyBetween('e', null));
    expect(keyBetweenOrNull(ODD, null)).toBeNull();
    expect(keyBetweenOrNull(null, '!')).toBeNull();
    expect(keyBetweenOrNull('c', 'b')).toBeNull();
    expect(keyBetweenOrNull('b', 'b')).toBeNull();
    // keyBetween makes a key that isn't between these two without throwing: never handed on.
    expect(() => keyBetween(null, '')).not.toThrow();
    expect(keyBetweenOrNull(null, '')).toBeNull();
  });

  it('keyAfter and lastReadableKey', () => {
    expect(keyAfter('e')).toBe(keyBetween('e', null));
    expect(keyAfter(null)).toBe(keyBetween(null, null));
    expect(keyAfter(ODD)).toBeNull();
    expect(lastReadableKey(['b', ODD, 'e', '!'])).toBe('e');
    expect(lastReadableKey([ODD, '!'])).toBeNull();
    expect(lastReadableKey([])).toBeNull();
  });

  it('after the last: keyBetween’s for a sound list; after the last readable one past an odd key; the first with none readable', () => {
    expect(keyAfterKeys(['b', 'e', 'c'])).toBe(keyBetween('e', null));
    expect(keyAfterKeys([])).toBe(keyBetween(null, null));
    expect(keyAfterKeys(['b', ODD, 'e'])).toBe(keyBetween('e', null));
    expect(keyAfterKeys([ODD, `${ODD}${ODD}`])).toBe(keyBetween(null, null));
    // The readable key is asked for only when the last can't be read.
    let asked = 0;
    const readable = () => {
      asked += 1;
      return 'b';
    };
    expect(keyAfterStored('e', readable)).toBe(keyBetween('e', null));
    expect(asked).toBe(0);
    expect(keyAfterStored(ODD, readable)).toBe(keyBetween('b', null));
    expect(asked).toBe(1);
    expect(keyAfterStored(ODD, () => null)).toBe(keyBetween(null, null));
  });

  it('keyBetweenStored keeps 6.22’s behaviour from its new home', () => {
    expect(keyBetweenStored('b', 'c', 'e')).toBe(keyBetween('b', 'c'));
    expect(keyBetweenStored(ODD, 'c', 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored('c', 'b', 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored(ODD, null, ODD)).toBe(keyBetween(null, null));
  });

  it('fresh keys: in order, distinct, never ending in "0", room between them, the first of one keyBetween’s', () => {
    expect(freshKeys(0)).toEqual([]);
    expect(freshKeys(1)).toEqual([keyBetween(null, null)]);
    for (const count of [2, 30, 61, 62, 500, 4000]) {
      const keys = freshKeys(count);
      expect(keys).toHaveLength(count);
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(count);
      expect(keys.every((key) => key !== '' && !key.endsWith('0'))).toBe(true);
      for (let i = 1; i < keys.length; i += 1) expect(() => keyBetween(keys[i - 1] ?? null, keys[i] ?? null)).not.toThrow();
      expect(() => keyBetween(null, keys[0] ?? null)).not.toThrow();
      expect(() => keyBetween(keys.at(-1) ?? null, null)).not.toThrow();
    }
    // Short at any size: 4000 keys fit in three digits.
    expect(Math.max(...freshKeys(4000).map((key) => key.length))).toBeLessThanOrEqual(3);
  });

  it('sequenceKeys writes the list afresh in the order given, only the keys that change', () => {
    const list = [
      { id: 'c', sortKey: ODD },
      { id: 'a', sortKey: 'b' },
      { id: 'b', sortKey: 'b' },
    ];
    const keys = sequenceKeys(list);
    const final = list.map((r) => ({ id: r.id, key: keys.get(r.id) ?? r.sortKey }));
    expect([...final].sort((x, y) => (x.key < y.key ? -1 : 1)).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(new Set(final.map((r) => r.key)).size).toBe(3);
    // A key already the fresh one isn't written again.
    expect(sequenceKeys([{ id: 'v', sortKey: keyBetween(null, null) }]).size).toBe(0);
  });

  it('placeAmong: keyBetween’s chain and no moves in a sound list; past an odd or out-of-order key, the whole list in order', () => {
    const sound = [
      { id: 'a', sortKey: 'b' },
      { id: 'b', sortKey: 'd' },
    ];
    expect(placeAmong(sound, 1, 1)).toEqual({ keys: [keyBetween('b', 'd')], moves: new Map() });
    const two = placeAmong(sound, 2, 2);
    expect(two.keys).toEqual([keyBetween('d', null), keyBetween(keyBetween('d', null), null)]);
    expect(two.moves.size).toBe(0);
    expect(placeAmong([], 0, 1).keys).toEqual([keyBetween(null, null)]);

    const cases = [
      { name: 'an odd key after', list: [{ id: 'a', sortKey: 'b' }, { id: 'x', sortKey: ODD }], at: 1 },
      { name: 'an odd key before', list: [{ id: 'x', sortKey: ODD }, { id: 'a', sortKey: 'b' }], at: 1 },
      { name: 'two out of order', list: [{ id: 'a', sortKey: 'c' }, { id: 'b', sortKey: 'b' }], at: 1 },
      { name: 'a tie', list: [{ id: 'a', sortKey: 'b' }, { id: 'b', sortKey: 'b' }], at: 1 },
      { name: 'all unreadable', list: [{ id: 'x', sortKey: ODD }, { id: 'y', sortKey: '!' }], at: 2 },
    ];
    for (const { name, list, at } of cases) {
      for (const count of [1, 3]) {
        const placed = placeAmong(list, at, count);
        expect(placed.keys, name).toHaveLength(count);
        const ids = [...list.slice(0, at).map((r) => r.id), ...placed.keys.map((_, i) => `new${String(i)}`), ...list.slice(at).map((r) => r.id)];
        const keyOf = new Map([...list.map((r) => [r.id, placed.moves.get(r.id) ?? r.sortKey] as const), ...placed.keys.map((key, i) => [`new${String(i)}`, key] as const)]);
        const sorted = [...ids].sort((x, y) => ((keyOf.get(x) ?? '') < (keyOf.get(y) ?? '') ? -1 : 1));
        expect(sorted, name).toEqual(ids);
        expect(new Set(keyOf.values()).size, name).toBe(ids.length);
      }
    }
  });
});

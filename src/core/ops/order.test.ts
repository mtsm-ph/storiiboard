import { describe, expect, it } from 'vitest';
import { keyBetween } from './order';

describe('sort keys', () => {
  it('makes a key for an empty list, the start, the end and a gap', () => {
    const first = keyBetween(null, null);
    const before = keyBetween(null, first);
    const after = keyBetween(first, null);
    const between = keyBetween(before, first);
    expect([before, between, first, after]).toEqual([before, between, first, after].sort());
    expect(new Set([before, between, first, after]).size).toBe(4);
  });

  it('keeps finding room after many inserts in the same gap', () => {
    // Dropping frame after frame just after 4A, the worst case for key length.
    let low = keyBetween(null, null);
    const high = keyBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const key = keyBetween(low, high);
      expect(low < key && key < high).toBe(true);
      low = key;
    }
    // Each insert halves the gap, so keys grow about one digit per five inserts there; anywhere else they stay short.
    expect(low.length).toBeLessThanOrEqual(200 / 4);
  });

  it('stays sorted under random inserts anywhere in the list', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const keys: string[] = [];
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      keys.splice(at, 0, keyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => !key.endsWith('0'))).toBe(true);
  });

  it('refuses a gap that runs backwards', () => {
    expect(() => keyBetween('b', 'a')).toThrow();
  });
});

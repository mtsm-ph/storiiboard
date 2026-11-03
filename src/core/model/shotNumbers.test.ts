import { describe, expect, it } from 'vitest';
import { letterFor, letterIndex, lettersOf, sceneNumberBetween, shotNumbers, type NumberedShot } from './shotNumbers';

const skip = { skipIO: true };
const all = { skipIO: false };

describe('shot letters', () => {
  it('skip I and O, as most slates do, unless the project allows them', () => {
    const first = (n: number, options: typeof skip) => Array.from({ length: n }, (_, i) => letterFor(i, options)).join('');
    expect(first(24, skip)).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(first(26, all)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('go on AA, AB after Z, and read back to the same place', () => {
    expect(letterFor(23, skip)).toBe('Z');
    expect(letterFor(24, skip)).toBe('AA');
    expect(letterFor(25, skip)).toBe('AB');
    expect(letterFor(26, all)).toBe('AA');
    for (const i of [0, 7, 23, 24, 100, 600]) expect(letterIndex(letterFor(i, skip), skip)).toBe(i);
    expect(letterIndex('I', skip)).toBeNull();
    expect(letterIndex('I', all)).toBe(8);
  });

  it('come off the scene number, even for an A-scene', () => {
    expect(lettersOf('4B', '4')).toBe('B');
    expect(lettersOf('4AB', '4A')).toBe('B');
    expect(lettersOf('5B', '4')).toBeNull();
    expect(lettersOf('4', '4')).toBeNull();
  });
});

const shot = (id: string, number = '', trashed = false): NumberedShot => ({ id, number, trashed });

describe('numbering a scene', () => {
  it('follows board order while unlocked, changing only what moved', () => {
    const changed = shotNumbers('4', [shot('a', '4A'), shot('new'), shot('b', '4B')], { locked: false, ...skip });
    expect(Object.fromEntries(changed)).toEqual({ new: '4B', b: '4C' });
  });

  it('closes up the letters when an unlocked shot goes to the Trash', () => {
    const changed = shotNumbers('4', [shot('a', '4A'), shot('b', '4B', true), shot('c', '4C')], { locked: false, ...skip });
    expect(Object.fromEntries(changed)).toEqual({ c: '4B' });
  });

  it('keeps every number once locked; a new shot takes the next free letter, never a trashed one', () => {
    const shots = [shot('a', '4A'), shot('new'), shot('c', '4C'), shot('d', '4D', true)];
    expect(Object.fromEntries(shotNumbers('4', shots, { locked: true, ...skip }))).toEqual({ new: '4E' });
  });

  it('keeps a locked scene’s numbers even after the scene itself is renumbered', () => {
    const shots = [shot('a', '4A'), shot('b', '4B'), shot('new')];
    expect(Object.fromEntries(shotNumbers('7', shots, { locked: true, ...skip }))).toEqual({ new: '7A' });
  });

  it('renumbers every shot when the scene’s own number changes', () => {
    const changed = shotNumbers('7', [shot('a', '4A'), shot('b', '4B')], { locked: false, ...skip });
    expect(Object.fromEntries(changed)).toEqual({ a: '7A', b: '7B' });
  });

  it('lets a project allow I and O', () => {
    const shots = Array.from({ length: 9 }, (_, i) => shot(`s${String(i)}`));
    expect(shotNumbers('2', shots, { locked: false, ...all }).get('s8')).toBe('2I');
    expect(shotNumbers('2', shots, { locked: false, ...skip }).get('s8')).toBe('2J');
  });
});

describe('scene numbers', () => {
  it('count on at the end, insert as A-scenes between, and go before the first as A1', () => {
    expect(sceneNumberBetween('12', null, ['1', '4', '12'])).toBe('13');
    expect(sceneNumberBetween(null, null, [])).toBe('1');
    expect(sceneNumberBetween('4', '5', ['4', '5'])).toBe('4A');
    expect(sceneNumberBetween('4A', '5', ['4', '4A', '5'])).toBe('4B');
    expect(sceneNumberBetween('4', '4A', ['4', '4A', '5'])).toBe('4B');
    expect(sceneNumberBetween(null, '1', ['1'])).toBe('A1');
  });
});

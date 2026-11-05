import { describe, expect, it } from 'vitest';
import {
  emptyPalette,
  movedColor,
  normalHex,
  paletteChange,
  paletteOf,
  regenerated,
  removedColor,
  toggledLock,
  withColor,
  withLock,
  withMoved,
  withoutColor,
  withSize,
  type Palette,
} from './palette';

const hexes = (p: Palette | null) => p?.colors.map((c) => (c.locked ? `${c.hex}*` : c.hex));
const always = () => true;
const of = (...colors: string[]): Palette => ({ size: colors.length, colors: colors.map((hex) => ({ hex, locked: false, raw: {} })), raw: {}, unread: [] });

describe('scene palettes (polish PP)', () => {
  it('reads a stored palette, keeping only real colours, and none for a scene without one', () => {
    expect(paletteOf({})).toBeNull();
    const read = paletteOf({ palette: { size: 40, colors: [{ hex: '#a35139', locked: true }, { hex: 'nope' }, { hex: '1F2F4D', note: 'sky' }] } });
    expect(read?.size).toBe(16);
    expect(hexes(read)).toEqual(['#A35139*', '#1F2F4D']);
    expect(normalHex(' #ffb162 ')).toBe('#FFB162');
    expect(normalHex('#fff')).toBeNull();
  });

  it('stores only what it reads, keeping what a newer version added, and its count with no colours left', () => {
    const read = paletteOf({ palette: { size: 2, grade: 'warm', colors: [{ hex: '#A35139', note: 'brick' }] } });
    if (!read) throw new Error('no palette');
    expect(paletteChange(withLock(read, 0, true))).toEqual({
      set: { palette: { size: 2, grade: 'warm', colors: [{ note: 'brick', hex: '#A35139', locked: true }] } },
    });
    expect(paletteChange(withoutColor(read, 0))).toEqual({ set: { palette: { size: 2, grade: 'warm', colors: [] } } });
    expect(paletteChange(null)).toEqual({ unset: ['palette'] });
  });

  it('moves, deletes and adds colours, never the same one twice and never past 16', () => {
    const p = of('#111111', '#222222', '#333333');
    expect(hexes(withMoved(p, 0, 2))).toEqual(['#222222', '#333333', '#111111']);
    expect(hexes(withMoved(p, 2, 0))).toEqual(['#333333', '#111111', '#222222']);
    expect(hexes(withoutColor(p, 1))).toEqual(['#111111', '#333333']);
    expect(hexes(withColor(p, '#222222'))).toEqual(hexes(p));
    expect(hexes(withColor(p, 'abcdef'))).toEqual(['#111111', '#222222', '#333333', '#ABCDEF']);
    let full = emptyPalette(16);
    for (let i = 0; i < 20; i += 1) full = withColor(full, `#0000${String(i).padStart(2, '0')}`);
    expect(full.colors).toHaveLength(16);
  });

  it('acts on the colour named, however quickly the presses come', () => {
    const p = of('#AAAAAA', '#BBBBBB', '#CCCCCC', '#DDDDDD');
    // Delete on B, then (the neighbour picked) on C, both before either lands: B and C go, never D.
    expect(hexes(removedColor(removedColor(p, '#BBBBBB'), '#CCCCCC'))).toEqual(['#AAAAAA', '#DDDDDD']);
    // The same colour twice: the second finds it gone and changes nothing.
    expect(hexes(removedColor(removedColor(p, '#BBBBBB'), '#BBBBBB'))).toEqual(['#AAAAAA', '#CCCCCC', '#DDDDDD']);
    // A held ⌘→ slides the colour along, one place a press, and stops at the end.
    let moved = p;
    for (let i = 0; i < 5; i += 1) moved = movedColor(moved, '#AAAAAA', 1);
    expect(hexes(moved)).toEqual(['#BBBBBB', '#CCCCCC', '#DDDDDD', '#AAAAAA']);
    // L twice locks and unlocks again.
    expect(hexes(toggledLock(p, '#CCCCCC'))).toEqual(['#AAAAAA', '#BBBBBB', '#CCCCCC*', '#DDDDDD']);
    expect(hexes(toggledLock(toggledLock(p, '#CCCCCC'), '#CCCCCC'))).toEqual(hexes(p));
  });

  it('changes only how many Generate makes, never taking a colour out', () => {
    const p = of('#111111', '#222222', '#333333', '#444444');
    expect(hexes(withSize(p, 2))).toEqual(hexes(p));
    expect(withSize(p, 2).size).toBe(2);
    expect(withSize(p, 40).size).toBe(16);
    // Regenerate then makes that many, locked ones first in their places.
    expect(hexes(regenerated(withLock(withSize(p, 2), 3, true), ['#AAAAAA', '#BBBBBB'], always))).toEqual(['#AAAAAA', '#444444*']);
  });

  it('keeps a colour it can’t read, and lists each colour once', () => {
    const read = paletteOf({ palette: { size: 8, colors: [{ hex: '#A35139' }, { oklch: [0.6, 0.2, 30] }, { hex: '#a35139' }] } });
    expect(hexes(read)).toEqual(['#A35139']);
    if (!read) throw new Error('no palette');
    expect(paletteChange(withColor(read, '#1F2F4D'))).toEqual({
      set: { palette: { size: 8, colors: [{ hex: '#A35139' }, { hex: '#1F2F4D' }, { oklch: [0.6, 0.2, 30] }] } },
    });
  });

  it('generates the rest again around the locked colours, which keep their places', () => {
    const p = withLock(of('#111111', '#222222', '#333333'), 1, true);
    expect(hexes(regenerated(p, ['#AAAAAA', '#BBBBBB', '#CCCCCC'], always))).toEqual(['#AAAAAA', '#222222*', '#BBBBBB']);
    // A candidate too close to one already there is skipped.
    const near = (a: string, b: string) => a.slice(0, 2) !== b.slice(0, 2);
    expect(hexes(regenerated(p, ['#2AAAAA', '#BBBBBB', '#CCCCCC'], near))).toEqual(['#BBBBBB', '#222222*', '#CCCCCC']);
    // A first palette fills every place; a bigger count adds places at the end.
    expect(hexes(regenerated(emptyPalette(2), ['#AAAAAA', '#BBBBBB', '#CCCCCC'], always))).toEqual(['#AAAAAA', '#BBBBBB']);
    expect(hexes(regenerated({ ...p, size: 4 }, ['#AAAAAA', '#BBBBBB', '#CCCCCC'], always))).toEqual(['#AAAAAA', '#222222*', '#BBBBBB', '#CCCCCC']);
    // Fewer candidates than places: what there is.
    expect(hexes(regenerated(p, ['#AAAAAA'], always))).toEqual(['#AAAAAA', '#222222*']);
  });
});

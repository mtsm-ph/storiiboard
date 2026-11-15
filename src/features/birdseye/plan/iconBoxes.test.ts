import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { iconBox, iconBoxes, iconBoxesSource, pathPoints } from '../../../../scripts/planIconBoxes';
import { ICON_BOXES } from './iconBoxes';

// The box each plan icon is cut to (6.3 review): a committed table, the same in every engine and without a page,
// written by scripts/planIconBoxes.ts; this checks it covers the kit, sits inside the grid, and is up to date.

const svgs = Object.fromEntries(PLAN_ICONS.map((icon) => [icon.id, icon.svg]));

describe('the icon box table', () => {
  it('covers exactly the kit’s 68 icons, each box inside the 32 px grid and not empty', () => {
    expect(Object.keys(ICON_BOXES).sort()).toEqual(PLAN_ICONS.map((icon) => icon.id).sort());
    expect(Object.keys(ICON_BOXES)).toHaveLength(68);
    for (const [id, box] of Object.entries(ICON_BOXES)) {
      expect(box.width, id).toBeGreaterThan(0);
      expect(box.height, id).toBeGreaterThan(0);
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.y, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(32 + 1e-9);
      expect(box.y + box.height, id).toBeLessThanOrEqual(32 + 1e-9);
    }
  });

  it('is what the script writes from the kit as it is now', () => {
    const now = iconBoxes(svgs);
    expect(ICON_BOXES).toEqual(now);
    expect(readFileSync('src/features/birdseye/plan/iconBoxes.ts', 'utf8').replace(/\r\n/g, '\n')).toBe(iconBoxesSource(now));
  });

  it('pads by half the widest stroke, so a thick line is never clipped', () => {
    // Tape mark: 3.5 px strokes from (8, 9) to (24, 24).
    expect(ICON_BOXES['cast/tape-mark']).toEqual({ x: 6.25, y: 7.25, width: 19.5, height: 18.5 });
    // Wall: a 5 px bar along y = 16.
    expect(ICON_BOXES['set-art/wall']).toEqual({ x: 0.5, y: 13.5, width: 31, height: 5 });
  });

  it('reads every path command, absolute and relative, curves and arcs', () => {
    const box = (d: string) => iconBox(`<svg xmlns="http://www.w3.org/2000/svg" stroke-width="2"><path d="${d}"/></svg>`);
    expect(box('M10 10h4v4H10z')).toEqual({ x: 9, y: 9, width: 6, height: 6 });
    expect(box('m10 10l4 0l0 4V10')).toEqual({ x: 9, y: 9, width: 6, height: 6 });
    // A half circle of radius 5 from (10, 20) to (20, 20): over the top with the sweep flag set, under without.
    expect(box('M10 20A5 5 0 0 1 20 20')).toEqual({ x: 9, y: 14, width: 12, height: 7 });
    expect(box('M10 20a5 5 0 0 0 10 0')).toEqual({ x: 9, y: 19, width: 12, height: 7 });
    // A cubic bulging to y = 7.5 (three quarters of the way to its controls).
    const cubic = box('M10 20C10 10 20 10 20 20');
    expect(cubic.y).toBeCloseTo(11.5, 1);
    expect(box('M10 20c0-10 10-10 10 0s10 10 10 0').height).toBeCloseTo(17, 0);
    expect(box('M10 20Q15 10 20 20T30 20').y).toBeCloseTo(14, 1);
    expect(pathPoints('M1 2L3 4Z').at(-1)).toEqual({ x: 1, y: 2 });
  });

  it('reads a shape’s rotation, and a text as a nominal box', () => {
    const turned = iconBox('<svg stroke-width="0"><rect x="0" y="10" width="20" height="0" transform="rotate(90 10 10)"/></svg>');
    // A flat bar from (0, 10) to (20, 10) turned upright about (10, 10): from (10, 0) to (10, 20), cut at the grid's top.
    expect(turned).toEqual({ x: 9.5, y: 0, width: 1, height: 20.5 });
    const text = iconBox('<svg stroke-width="0"><text x="16" y="20" text-anchor="middle" font-size="10">AB</text></svg>');
    expect(text).toEqual({ x: 9.5, y: 11.5, width: 13, height: 11 });
  });
});

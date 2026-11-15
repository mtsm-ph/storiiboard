import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_ICONS } from '../../../ui/icons/plan/planIcons';
import { iconBox, iconBoxes, iconBoxesSource, iconDrawing, iconDrawings, pathPoints } from '../../../../scripts/planIconBoxes';
import { ICON_BOXES, ICON_SHAPES } from './iconBoxes';

// What each plan icon draws (6.3 review; vectors in the third round): a committed table of its shapes and the bare box
// of its geometry, the same in every engine and without a page, written by scripts/planIconBoxes.ts; this checks it
// covers the kit, sits inside the grid, is up to date, and that the script throws on what it can't draw exactly.

const svgs = Object.fromEntries(PLAN_ICONS.map((icon) => [icon.id, icon.svg]));

describe('the icon box table', () => {
  it('covers exactly the kit’s 68 icons, each box inside the 32 px grid and not empty', () => {
    expect(Object.keys(ICON_BOXES).sort()).toEqual(PLAN_ICONS.map((icon) => icon.id).sort());
    expect(Object.keys(ICON_BOXES)).toHaveLength(68);
    expect(Object.keys(ICON_SHAPES).sort()).toEqual(Object.keys(ICON_BOXES).sort());
    for (const [id, box] of Object.entries(ICON_BOXES)) {
      // A line (the wall's bar) has no depth; nothing has neither width nor depth.
      expect(box.width + box.height, id).toBeGreaterThan(0);
      expect(box.width, id).toBeGreaterThanOrEqual(0);
      expect(box.height, id).toBeGreaterThanOrEqual(0);
      expect(ICON_SHAPES[id]?.length, id).toBeGreaterThan(0);
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.y, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(32 + 1e-9);
      expect(box.y + box.height, id).toBeLessThanOrEqual(32 + 1e-9);
    }
  });

  it('is what the script writes from the kit as it is now', () => {
    const now = iconBoxes(svgs);
    expect(ICON_BOXES).toEqual(now);
    const drawings = iconDrawings(svgs);
    expect(ICON_SHAPES).toEqual(Object.fromEntries(Object.entries(drawings).map(([id, d]) => [id, d.shapes])));
    expect(readFileSync('src/features/birdseye/plan/iconBoxes.ts', 'utf8').replace(/\r\n/g, '\n')).toBe(iconBoxesSource(drawings));
  });

  it('is the bare geometry of the ink, no stroke padding, checked against three boxes worked out by hand', () => {
    // Tape mark: M8 9h16 and M16 9v15, 3.5 px butt-capped strokes: the geometry runs x 8 to 24 and y 9 to 24. (Its top
    // stroke's ink reaches up to 9 - 3.5 / 2 = 7.25, but no stroke counts: the plan draws strokes in screen pixels.)
    expect(ICON_BOXES['cast/tape-mark']).toEqual({ x: 8, y: 9, width: 16, height: 15 });
    // Neg fill: a 24 by 6 rect at (4, 13), its middle (16, 16), turned -25°. Its corners from the middle are (±12, ±3);
    // turned, x = 12 cos 25° + 3 sin 25° = 10.8757 + 1.2679 = 12.1435 and y = 12 sin 25° + 3 cos 25° = 5.0714 + 2.7189 =
    // 7.7903 at the farthest: x 3.8565 to 28.1435, y 8.2097 to 23.7903, outward to a hundredth: 3.85 to 28.15 (24.3 wide),
    // 8.2 to 23.8 (15.6 deep).
    expect(ICON_BOXES['grip/neg-fill']).toEqual({ x: 3.85, y: 8.2, width: 24.3, height: 15.6 });
    // Boom: the pole M5 27L23 9; the mic, an 8 by 5 rect at (21, 3) turned 45° round its own middle (25, 5.5), its
    // corners from the middle (±4, ±2.5) reaching (4 + 2.5) × 0.7071 = 4.5962 each way: x 20.4038 to 29.5962, y 0.9038 to
    // 10.0962; the circle at (5, 27), r 3: x 2 to 8, y 24 to 30. Together x 2 to 29.6 (27.6), y 0.9 to 30 (29.1).
    expect(ICON_BOXES['sound/boom']).toEqual({ x: 2, y: 0.9, width: 27.6, height: 29.1 });
    // Wall: a 5 px bar along y = 16 from x 3 to 29: no depth at all.
    expect(ICON_BOXES['set-art/wall']).toEqual({ x: 3, y: 16, width: 26, height: 0 });
  });

  it('reads every path command, absolute and relative, curves and arcs', () => {
    const box = (d: string) => iconBox(`<svg xmlns="http://www.w3.org/2000/svg" stroke-width="2"><path d="${d}"/></svg>`);
    expect(box('M10 10h4v4H10z')).toEqual({ x: 10, y: 10, width: 4, height: 4 });
    expect(box('m10 10l4 0l0 4V10')).toEqual({ x: 10, y: 10, width: 4, height: 4 });
    // A half circle of radius 5 from (10, 20) to (20, 20): over the top with the sweep flag set, under without.
    expect(box('M10 20A5 5 0 0 1 20 20')).toEqual({ x: 10, y: 15, width: 10, height: 5 });
    expect(box('M10 20a5 5 0 0 0 10 0')).toEqual({ x: 10, y: 20, width: 10, height: 5 });
    // A cubic bulging to y = 12.5 (three quarters of the way to its controls).
    const cubic = box('M10 20C10 10 20 10 20 20');
    expect(cubic.y).toBeCloseTo(12.5, 1);
    expect(box('M10 20c0-10 10-10 10 0s10 10 10 0').height).toBeCloseTo(15, 0);
    expect(box('M10 20Q15 10 20 20T30 20').y).toBeCloseTo(15, 1);
    expect(pathPoints('M1 2L3 4Z').at(-1)).toEqual({ x: 1, y: 2 });
  });

  it('reads a shape’s rotation, and a text as a nominal box', () => {
    const turned = iconBox('<svg stroke-width="0"><line x1="0" y1="10" x2="20" y2="10" transform="rotate(90 10 10)"/></svg>');
    // A flat line from (0, 10) to (20, 10) turned upright about (10, 10): from (10, 0) to (10, 20).
    expect(turned).toEqual({ x: 10, y: 0, width: 0, height: 20 });
    const text = iconBox('<svg stroke-width="0"><text x="16" y="20" text-anchor="middle" font-size="10" font-family="JetBrains Mono">AB</text></svg>');
    expect(text).toEqual({ x: 10, y: 12, width: 12, height: 10 });
  });
});

describe('the shapes the script writes', () => {
  const svg = (body: string, root = 'fill="none" stroke="#16150F" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" ${root}><title>T</title>${body}</svg>`;

  it('turns every primitive into path data, the root’s paint inherited, a style winning over an attribute', () => {
    const { shapes } = iconDrawing(
      svg(
        '<rect fill="#8FA38E" x="3" y="12" width="26" height="12"/><rect x="9" y="2" width="14" height="28" rx="4"/><circle cx="16" cy="16" r="10" stroke-dasharray="3 2"/>' +
          '<ellipse cx="16" cy="16" rx="4" ry="2"/><line x1="1" y1="2" x2="3" y2="4"/><polyline points="1,1 2,2 3,1"/><polygon points="1 1 2 2 3 1" style="fill: #E0612B; fill-opacity: .25"/>' +
          '<path d="M12 12v12" stroke-opacity=".45" stroke-width="3" stroke-linecap="butt"/>',
      ),
    );
    expect(shapes.map((s) => (s.kind === 'path' ? s.d : s.text))).toEqual([
      'M3 12L29 12L29 24L3 24Z',
      'M13 2L19 2A4 4 0 0 1 23 6L23 26A4 4 0 0 1 19 30L13 30A4 4 0 0 1 9 26L9 6A4 4 0 0 1 13 2Z',
      'M26 16A10 10 0 0 1 6 16A10 10 0 0 1 26 16Z',
      'M20 16A4 2 0 0 1 12 16A4 2 0 0 1 20 16Z',
      'M1 2L3 4',
      'M1 1L2 2L3 1',
      'M1 1L2 2L3 1Z',
      'M12 12L12 24',
    ]);
    expect(shapes[0]).toEqual({ kind: 'path', d: 'M3 12L29 12L29 24L3 24Z', fill: '#8FA38E', fillOpacity: 1, stroke: '#16150F', strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 });
    expect(shapes[2]).toMatchObject({ fill: null, dash: [3, 2] });
    // A line is never filled; a style's fill and fill-opacity win.
    expect(shapes[4]).toMatchObject({ fill: null });
    expect(shapes[6]).toMatchObject({ fill: '#E0612B', fillOpacity: 0.25 });
    expect(shapes[7]).toMatchObject({ strokeOpacity: 0.45, strokeWidth: 3, lineCap: 'butt', lineJoin: 'round' });
  });

  it('applies a transform to the path itself, an arc’s axes turned with it', () => {
    const { shapes } = iconDrawing(svg('<rect x="21" y="3" width="8" height="5" transform="rotate(45 25 5.5)"/><ellipse cx="0" cy="0" rx="4" ry="2" transform="translate(16 16) rotate(90)"/>'));
    expect(shapes[0]).toMatchObject({ d: 'M23.9393 0.9038L29.5962 6.5607L26.0607 10.0962L20.4038 4.4393Z' });
    expect(shapes[1]).toMatchObject({ d: 'M16 20A4 2 90 0 1 16 12A4 2 90 0 1 16 20Z' });
  });

  it('keeps a text as its string, place, size, anchor and fill, in a bundled face', () => {
    const parking = ICON_SHAPES['production/parking'];
    expect(parking?.[1]).toEqual({ kind: 'text', text: 'P', x: 16, y: 21, size: 13, anchor: 'middle', family: 'JetBrains Mono', weight: 700, fill: '#16150F', fillOpacity: 1, opacity: 1 });
  });

  it('throws, naming the file, on anything it can’t draw exactly, never a silent zero', () => {
    const bad: [string, RegExp][] = [
      [svg('<g><rect x="1" y="1" width="2" height="2"/></g>'), /element <g> can't be read/],
      [svg('<defs/>'), /element <defs> can't be read/],
      [svg('<use href="#a"/>'), /element <use> can't be read/],
      [svg('<image x="1" y="1" width="2" height="2"/>'), /element <image> can't be read/],
      [svg('<rect x="1px" y="1" width="2" height="2"/>'), /x "1px" isn't a plain number/],
      [svg('<rect x="1" y="1" width="50%" height="2"/>'), /width "50%" isn't a plain number/],
      [svg('<rect x="1" y="1" width="2" height="2" stroke-width="2pt"/>'), /stroke-width "2pt" isn't a plain number/],
      [svg(`<rect x='1' y="1" width="2" height="2"/>`), /single-quoted attribute x/],
      [svg('<path d="M1 1A5 5 0 2 1 9 9"/>'), /arc flag "2" that isn't 0 or 1/],
      [svg('<path d="M1 1a5 5 0 105 5"/>'), /arc flag "105" that isn't 0 or 1/],
      [svg('<path d="M1 1A5 5 0 0 1 1 1"/>'), /zero-length arc/],
      [svg('<rect x="1" y="1" width="2" height="2" transform="scale(2)"/>'), /transform scale\(2\) can't be read/],
      [svg('<rect x="1" y="1" width="2" height="2" filter="url(#f)"/>'), /attribute filter can't be read/],
      [svg('<rect x="1" y="1" width="2" height="2" fill="currentColor"/>'), /fill "currentColor" isn't a hex colour/],
      [svg('<text x="1" y="1" font-size="8" font-family="Comic Sans" fill="#16150F" stroke="none">A</text>'), /isn't a bundled face/],
      [svg('<path d="M1 1L1e999 1"/>'), /isn't a number|box isn’t a number/],
      [svg(''), /nothing drawn/],
    ];
    for (const [text, message] of bad) {
      expect(() => iconDrawings({ 'grip/odd': text }), text).toThrow(message);
      expect(() => iconDrawings({ 'grip/odd': text }), text).toThrow(/src\/ui\/icons\/plan\/grip\/odd\.svg: /);
    }
    // A NaN box is never written as a zero: a box worked out from no number throws.
    expect(() => iconDrawing(svg('<path d="M1 1L1e999 1"/>'))).toThrow();
  });
});

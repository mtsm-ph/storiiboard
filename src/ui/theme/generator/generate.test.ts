import { describe, expect, it } from 'vitest';
import { contrast, hex, lchToRgb, parseHex, rgbToLch } from './color';
import { FAMILIES, PAPER, type Surfaces } from './families';
import { accentCandidates, DEFAULT_ACCENT, familyFor, themeFor, type ModeTokens } from './generate';

/** An RGBA image drawn by a function of x and y. */
function image(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const data: number[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.push(...pixel(x, y));
  return { data, width, height };
}
const ratio = (a: string, b: string) => contrast(parseHex(a), parseHex(b));

/** The pairs DESIGN.md puts together: text and muted text on paper and tiles, text on wells, inverse on an ink fill. */
function expectReadable(s: Surfaces, where: string) {
  for (const on of [s.bg, s.surface]) {
    expect(ratio(s.text, on), `${where}: text`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(s.textMuted, on), `${where}: muted`).toBeGreaterThanOrEqual(4.5);
  }
  expect(ratio(s.text, s.surfaceRaised), `${where}: text on a well`).toBeGreaterThanOrEqual(4.5);
  expect(ratio(s.textInverse, s.text), `${where}: inverse on ink`).toBeGreaterThanOrEqual(4.5);
}

function expectAccentReadable(t: ModeTokens, where: string) {
  expect(ratio(t.accent, t.bg), `${where}: accent on paper`).toBeGreaterThanOrEqual(3);
  expect(ratio(t.accent, t.surface), `${where}: accent on a tile`).toBeGreaterThanOrEqual(3);
  expect(ratio(t.accentContrast, t.accent), `${where}: text on the accent`).toBeGreaterThanOrEqual(4.5);
}

describe('the 12 families', () => {
  it('are all readable, light and dark, and Paper is the kit itself', () => {
    expect(FAMILIES.map((f) => f.name)).toEqual(['Paper', 'Rose', 'Clay', 'Ochre', 'Sand', 'Olive', 'Sage', 'Teal', 'Slate', 'Navy', 'Violet', 'Plum']);
    for (const family of FAMILIES) {
      expectReadable(family.light, `${family.name} light`);
      expectReadable(family.dark, `${family.name} dark`);
    }
    expect(FAMILIES.map((f) => f.id)).toEqual(FAMILIES.map((f) => f.name.toLowerCase()));
    expect(PAPER.light.bg).toBe('#EEE9DF');
    expect(PAPER.dark.bg).toBe('#1B2632');
  });
});

describe('an accent fitted to AA', () => {
  it('passes on every family it snaps to, for every hue at three strengths, in both modes', () => {
    for (let h = 0; h < 360; h += 10) {
      for (const c of [0.06, 0.15, 0.3]) {
        const accent = hex(lchToRgb({ l: 0.65, c, h }));
        const theme = themeFor(accent);
        expectAccentReadable(theme.light, `${accent} light`);
        expectAccentReadable(theme.dark, `${accent} dark`);
      }
    }
  });

  it('keeps the accent’s hue, moving only its lightness as far as it must', () => {
    const blue = themeFor('#1E6BD6');
    expect(blue.family).toBe('navy');
    for (const t of [blue.light, blue.dark]) expect(Math.abs(rgbToLch(parseHex(t.accent)).h - rgbToLch(parseHex('#1E6BD6')).h)).toBeLessThan(6);
    // Ink on the accent whenever ink passes, as in the kit.
    expect(blue.light.accentContrast).toBe(blue.light.text);
  });

  it('gives the default theme exactly the kit, with its orange', () => {
    const theme = themeFor(null);
    expect(theme.family).toBe('paper');
    expect(theme.light).toMatchObject({ ...PAPER.light, accent: DEFAULT_ACCENT, accentContrast: '#16150F' });
    expect(theme.dark.accent).toBe(DEFAULT_ACCENT);
  });

  it('snaps accents to families by hue; a greyish one takes Slate', () => {
    expect(familyFor('#DF5E27').name).toBe('Paper');
    expect(familyFor('#2E8B57').name).toBe('Sage');
    expect(familyFor('#7A3FB5').name).toBe('Violet');
    expect(familyFor('#8C8F94').name).toBe('Slate');
    expect(familyFor(null).name).toBe('Paper');
  });
});

describe('accents from an image', () => {
  it('reads a logo’s mark and not its flat background', () => {
    const logo = image(48, 48, (x, y) => (Math.hypot(x - 24, y - 24) < 12 ? [200, 30, 40, 255] : [255, 255, 255, 255]));
    const [accent] = accentCandidates(logo.data, logo.width, logo.height);
    expect(rgbToLch(parseHex(accent ?? '#000000')).h).toBeLessThan(35);
  });

  it('reads a mark that reaches the edge of a transparent logo', () => {
    const logo = image(48, 48, (x) => (x < 24 ? [20, 90, 200, 255] : [0, 0, 0, 0]));
    expect(accentCandidates(logo.data, logo.width, logo.height)).toHaveLength(1);
  });

  it('offers nothing for a grey or near-white image, which keeps the kit', () => {
    const grey = image(48, 48, (x) => [x * 5, x * 5, x * 5, 255]);
    expect(accentCandidates(grey.data, grey.width, grey.height)).toEqual([]);
    const pale = image(48, 48, (x, y) => (x > 10 && x < 30 && y > 10 && y < 30 ? [248, 244, 238, 255] : [255, 255, 255, 255]));
    expect(accentCandidates(pale.data, pale.width, pale.height)).toEqual([]);
  });

  it('offers up to four distinct accents from a photo, the same ones on every run', () => {
    const photo = image(64, 48, (x, y) => [Math.round(120 + 100 * Math.sin(x / 5)), Math.round(80 + 60 * Math.cos(y / 7)), Math.round(40 + x * 2), 255]);
    const first = accentCandidates(photo.data, photo.width, photo.height);
    expect(first.length).toBeGreaterThan(1);
    expect(first.length).toBeLessThanOrEqual(4);
    expect(accentCandidates(photo.data, photo.width, photo.height)).toEqual(first);
    // Most saturated first.
    const chroma = first.map((h) => rgbToLch(parseHex(h)).c);
    expect([...chroma].sort((a, b) => b - a)).toEqual(chroma);
  });

  it('finds a neon colour and fits it for both modes', () => {
    const neon = image(32, 32, (x) => (x < 16 ? [57, 255, 20, 255] : [10, 10, 10, 255]));
    const [accent] = accentCandidates(neon.data, neon.width, neon.height);
    const theme = themeFor(accent ?? null);
    expect(theme.family).toBe('sage');
    expectAccentReadable(theme.light, 'neon light');
    expectAccentReadable(theme.dark, 'neon dark');
  });
});

import { describe, expect, it } from 'vitest';
import { contrast, hex, lchToRgb, parseHex, rgbToLch } from './color';
import { FAMILIES, PAPER, type Surfaces } from './families';
import { accentCandidates, DEFAULT_ACCENT, familyFor, isBlend, themeFor, type ModeTokens } from './generate';

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

/** The accent stands 3:1 on paper and tiles, and the text on it is the family's ink at 4.5:1 (CLAUDE.md, Design). */
function expectAccentReadable(t: ModeTokens, ink: string, where: string) {
  expect(ratio(t.accent, t.text), `${where}: accent apart from the text`).toBeGreaterThanOrEqual(1.5);
  expect(ratio(t.accent, t.bg), `${where}: accent on paper`).toBeGreaterThanOrEqual(3);
  expect(ratio(t.accent, t.surface), `${where}: accent on a tile`).toBeGreaterThanOrEqual(3);
  expect(t.accentContrast, `${where}: ink on the accent`).toBe(ink);
  expect(ratio(t.accentContrast, t.accent), `${where}: text on the accent`).toBeGreaterThanOrEqual(4.5);
}

function expectThemeReadable(accent: string | null, where = accent ?? 'the kit') {
  const theme = themeFor(accent);
  const ink = familyFor(accent).light.text;
  expectAccentReadable(theme.light, ink, `${where} light`);
  expectAccentReadable(theme.dark, ink, `${where} dark`);
}

/** Truffle, the fixed warning colour: it never changes with a theme, so it has to read on every family. */
const TRUFFLE = '#A35139';

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

  it('keep the fixed warning colour readable as text on paper and tiles, and paper readable on it', () => {
    // Warning text is a light-mode use (dark mode sets it in the text colour), and never sits on oatmeal.
    for (const family of FAMILIES) {
      for (const on of [family.light.bg, family.light.surface]) expect(ratio(TRUFFLE, on), family.name).toBeGreaterThanOrEqual(4.5);
      expect(ratio(family.light.bg, TRUFFLE), `${family.name}: paper on Truffle`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('an accent fitted to AA', () => {
  it('passes with ink on it on every family it snaps to: every hue, three strengths, near black to near white', () => {
    for (let h = 0; h < 360; h += 10) {
      for (const c of [0.06, 0.15, 0.3]) {
        for (let l = 0.05; l < 0.96; l += 0.1) expectThemeReadable(hex(lchToRgb({ l, c, h })));
      }
    }
    // The ends, where a short search used to give up.
    for (const accent of ['#000000', '#FFFFFF', '#000017', '#FFFF00', '#0000FF', '#808080']) expectThemeReadable(accent);
    expectThemeReadable(null);
  });

  it('reads #RGB and lowercase as well as #RRGGBB', () => {
    expect(parseHex('#F60')).toEqual([255, 102, 0]);
    expect(parseHex('1e6bd6')).toEqual(parseHex('#1E6BD6'));
    expect(themeFor('#f60').source).toBe('#f60');
    expect(() => parseHex('#F600')).toThrow();
  });

  it('keeps the accent’s hue, moving only its lightness as far as it must', () => {
    const blue = themeFor('#1E6BD6');
    expect(blue.family).toBe('navy');
    for (const t of [blue.light, blue.dark]) expect(Math.abs(rgbToLch(parseHex(t.accent)).h - rgbToLch(parseHex('#1E6BD6')).h)).toBeLessThan(6);
    // Ink on the accent whenever ink passes, as in the kit.
    expect(blue.light.accentContrast).toBe(blue.light.text);
    // A near-black accent is lifted until ink reads on it; it never becomes ink itself.
    const black = themeFor('#000000');
    expect(black.light.accent).not.toBe(black.light.text);
    expect(black.dark.accent).not.toBe(DEFAULT_ACCENT);
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
    expect(familyFor('#2E6A8A').name).toBe('Slate');
    expect(familyFor(null).name).toBe('Paper');
  });
});

describe('accents from an image', () => {
  it('reads a logo’s mark and not its flat background', () => {
    const logo = image(48, 48, (x, y) => (Math.hypot(x - 24, y - 24) < 12 ? [200, 30, 40, 255] : [255, 255, 255, 255]));
    const [accent] = accentCandidates(logo.data, logo.width, logo.height);
    expect(rgbToLch(parseHex(accent ?? '#000000')).h).toBeLessThan(35);
  });

  it('leaves out the soft rim between a mark and its background, which is only a mix of the two', () => {
    // A red dot on white with an anti-aliased rim, as a shrunk logo has.
    const [red, white] = [
      [200, 30, 40],
      [255, 255, 255],
    ] as const;
    const mix = (t: number) => red.map((c, i) => Math.round(c * t + (white[i] ?? 0) * (1 - t)));
    const logo = image(48, 48, (x, y) => {
      const d = Math.hypot(x - 24, y - 24);
      if (d < 10) return [...red, 255];
      if (d < 15) return [...mix(1 - (d - 10) / 5), 255] as [number, number, number, number];
      return [...white, 255];
    });
    expect(accentCandidates(logo.data, logo.width, logo.height)).toHaveLength(1);
    expect(isBlend([228, 144, 149], [200, 30, 40], [255, 255, 255])).toBe(true);
    // A colour of its own, not on the way from red to white.
    expect(isBlend([30, 90, 200], [200, 30, 40], [255, 255, 255])).toBe(false);
  });

  it('takes a pale or barely tinted ground for paper, and reads a rim against a coloured one', () => {
    const cream: [number, number, number, number] = [255, 253, 208, 255];
    const wordmark = image(48, 48, (x, y) => (y > 20 && y < 28 && x > 8 && x < 40 ? [20, 20, 20, 255] : cream));
    expect(accentCandidates(wordmark.data, wordmark.width, wordmark.height)).toEqual([]);
    const dot = (ground: [number, number, number]) =>
      image(48, 48, (x, y) => {
        const d = Math.hypot(x - 24, y - 24);
        const red = [200, 30, 40];
        if (d < 10) return [200, 30, 40, 255];
        const t = 1 - (d - 10) / 5;
        if (d < 15) return [...red.map((c, i) => Math.round(c * t + (ground[i] ?? 0) * (1 - t))), 255] as [number, number, number, number];
        return [...ground, 255];
      });
    const onCream = dot([255, 253, 208]);
    expect(accentCandidates(onCream.data, onCream.width, onCream.height)).toHaveLength(1);
    // A navy ground is a colour of the logo, offered after the red; the rim between them isn't.
    const onNavy = dot([30, 58, 138]);
    const accents = accentCandidates(onNavy.data, onNavy.width, onNavy.height);
    expect(accents).toHaveLength(2);
    expect(accents.map((a) => familyFor(a).name).sort()).toEqual(['Clay', 'Navy']);
  });

  it('reads a mark that reaches the edge of a transparent logo', () => {
    const logo = image(48, 48, (x) => (x < 24 ? [20, 90, 200, 255] : [0, 0, 0, 0]));
    expect(accentCandidates(logo.data, logo.width, logo.height)).toHaveLength(1);
  });

  it('offers the colour of a one-colour image, or of a coloured square behind a white mark', () => {
    const red: [number, number, number, number] = [200, 30, 40, 255];
    for (const [width, height] of [
      [1, 1],
      [48, 48],
    ] as const) {
      const solid = image(width, height, () => red);
      expect(accentCandidates(solid.data, solid.width, solid.height), `${String(width)}px`).toHaveLength(1);
    }
    const icon = image(48, 48, (x, y) => (Math.abs(x - 24) < 8 && Math.abs(y - 24) < 8 ? [255, 255, 255, 255] : red));
    const [accent] = accentCandidates(icon.data, icon.width, icon.height);
    expect(rgbToLch(parseHex(accent ?? '#000000')).h).toBeLessThan(35);
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
    // Judged as stored: every accent offered is a colour, never one a family would read as grey.
    for (const c of chroma) expect(c).toBeGreaterThanOrEqual(0.05);
  });

  it('finds a neon colour and fits it for both modes', () => {
    const neon = image(32, 32, (x) => (x < 16 ? [57, 255, 20, 255] : [10, 10, 10, 255]));
    const [accent] = accentCandidates(neon.data, neon.width, neon.height);
    expect(themeFor(accent ?? null).family).toBe('sage');
    expectThemeReadable(accent ?? null, 'neon');
  });
});

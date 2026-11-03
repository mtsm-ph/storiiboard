import { contrast, deltaE, fitChroma, hex, labToLch, lchToRgb, parseHex, rgbToLab, rgbToLch, type Lab, type Lch, type Rgb } from './color';
import { FAMILIES, PAPER, type Family, type Surfaces } from './families';

// A project's theme from its logo or key image (1.14, docs/PLAN.md A), worked out on the device with no network:
// the image's colours are clustered in OKLab, the most colourful clusters are offered as accents, and the chosen
// accent picks a family of surfaces by its hue and is moved only as far as AA needs. The same image always gives the
// same theme: the clustering starts from a fixed seed.

/** The tokens a theme sets for one mode: the family's surfaces, plus the accent and the text on it. */
export interface ModeTokens extends Surfaces {
  accent: string;
  accentContrast: string;
}

export interface Theme {
  /** The family's id, as the project stores it. */
  family: string;
  /** The accent as it came from the image (or the kit's orange), before it was fitted to each mode. */
  source: string;
  light: ModeTokens;
  dark: ModeTokens;
}

/** The kit's default accent (decided Nov 2). */
export const DEFAULT_ACCENT = '#DF5E27';

/** Chroma below this reads as grey: a black-and-white logo offers no accent. */
const MIN_CHROMA = 0.05;
/** A cluster smaller than this share of the picture is a speck, not a colour of it. */
const MIN_SHARE = 0.015;
/** Candidates at least this far apart in OKLab, so the choices look different. */
const APART = 0.09;
const CLUSTERS = 8;

/** A small seeded random number generator (mulberry32), so k-means starts the same way every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-means in OKLab, seeded k-means++ start, a fixed number of rounds. Returns centres with their share of pixels. */
export function clusters(points: readonly Lab[], k: number, seed = 1): { center: Lab; share: number }[] {
  if (points.length === 0) return [];
  const random = seeded(seed);
  const centers: Lab[] = [points[Math.floor(random() * points.length)] ?? [0, 0, 0]];
  while (centers.length < Math.min(k, points.length)) {
    const distances = points.map((p) => Math.min(...centers.map((c) => deltaE(p, c) ** 2)));
    const total = distances.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let pick = random() * total;
    let index = 0;
    for (; index < distances.length - 1; index += 1) {
      pick -= distances[index] ?? 0;
      if (pick <= 0) break;
    }
    centers.push(points[index] ?? [0, 0, 0]);
  }
  const owner = new Array<number>(points.length).fill(0);
  for (let round = 0; round < 12; round += 1) {
    points.forEach((p, i) => {
      let best = 0;
      let bestDistance = Infinity;
      centers.forEach((c, j) => {
        const d = deltaE(p, c);
        if (d < bestDistance) {
          best = j;
          bestDistance = d;
        }
      });
      owner[i] = best;
    });
    centers.forEach((_, j) => {
      const mine = points.filter((_, i) => owner[i] === j);
      if (mine.length === 0) return;
      centers[j] = [0, 1, 2].map((axis) => mine.reduce((sum, p) => sum + (p[axis] ?? 0), 0) / mine.length) as unknown as Lab;
    });
  }
  return centers.map((center, j) => ({ center, share: owner.filter((o) => o === j).length / points.length }));
}

/**
 * The pixels worth reading from an RGBA image: opaque ones, without a logo's flat background. A colour that fills
 * most of the edge is taken for the background and left out, so a red mark on white offers red, not white.
 */
export function colourPixels(rgba: Uint8ClampedArray | readonly number[], width: number, height: number): Lab[] {
  const at = (x: number, y: number): Rgb | null => {
    const i = (y * width + x) * 4;
    if ((rgba[i + 3] ?? 0) < 128) return null;
    return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
  };
  // Every place along the edge, see-through ones included: a mark that reaches the edge of a transparent logo isn't
  // its background.
  const edge: Lab[] = [];
  let places = 0;
  const look = (x: number, y: number) => {
    places += 1;
    const p = at(x, y);
    if (p) edge.push(rgbToLab(p));
  };
  for (let x = 0; x < width; x += 1) {
    look(x, 0);
    if (height > 1) look(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    look(0, y);
    if (width > 1) look(width - 1, y);
  }
  const background = edge.find((candidate) => edge.filter((p) => deltaE(p, candidate) < 0.03).length > places * 0.6) ?? null;
  const out: Lab[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = at(x, y);
      if (!p) continue;
      const lab = rgbToLab(p);
      if (background && deltaE(lab, background) < 0.03) continue;
      out.push(lab);
    }
  }
  return out;
}

/**
 * Up to four accents an image offers, most saturated first: clusters with enough colour to read as colour, ranked by
 * chroma and share, and kept visibly apart. Empty for a grey image, which keeps the kit's orange.
 */
export function accentCandidates(rgba: Uint8ClampedArray | readonly number[], width: number, height: number): string[] {
  const found = clusters(colourPixels(rgba, width, height), CLUSTERS)
    .map(({ center, share }) => ({ center, share, lch: labToLch(center) }))
    .filter((c) => c.lch.c >= MIN_CHROMA && c.share >= MIN_SHARE)
    .sort((a, b) => b.lch.c * Math.sqrt(b.share) - a.lch.c * Math.sqrt(a.share));
  const kept: typeof found = [];
  for (const candidate of found) {
    if (kept.every((k) => deltaE(k.center, candidate.center) >= APART)) kept.push(candidate);
    if (kept.length === 4) break;
  }
  // The default is the most saturated; the rest follow in rank.
  kept.sort((a, b) => b.lch.c - a.lch.c);
  return kept.map((c) => hex(lchToRgb(c.lch)));
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** The family an accent belongs to, by its hue; a greyish one takes Slate, and none takes Paper. */
export function familyFor(accent: string | null): Family {
  if (!accent) return PAPER;
  const lch = rgbToLch(parseHex(accent));
  if (lch.c < MIN_CHROMA) return FAMILIES.find((f) => f.name === 'Slate') ?? PAPER;
  return FAMILIES.reduce((best, f) => (hueDistance(f.hue, lch.h) < hueDistance(best.hue, lch.h) ? f : best), PAPER);
}

/**
 * The accent as close to the one picked as AA allows on this mode's surfaces: its hue kept, its lightness moved (and
 * its chroma lowered, if lightness alone isn't enough) until it stands 3:1 against the background and the tiles, with
 * 4.5:1 for the text on it. That text is ink, as in the kit, whenever ink passes; otherwise paper.
 */
export function fitAccent(accent: string, surfaces: Surfaces, ink: string, paper: string): { accent: string; accentContrast: string } {
  const start = rgbToLch(parseHex(accent));
  const [bg, surface] = [parseHex(surfaces.bg), parseHex(surfaces.surface)];
  const passes = (rgb: Rgb, text: Rgb) => contrast(rgb, bg) >= 3 && contrast(rgb, surface) >= 3 && contrast(rgb, text) >= 4.5;
  for (const textHex of [ink, paper]) {
    const text = parseHex(textHex);
    for (const chroma of [1, 0.8, 0.6, 0.4, 0.2]) {
      // Outward from the accent's own lightness, so the nearest passing one wins.
      for (let step = 0; step <= 200; step += 1) {
        for (const sign of step === 0 ? [1] : [-1, 1]) {
          const l = start.l + sign * step * 0.0025;
          if (l <= 0.05 || l >= 0.97) continue;
          const lch: Lch = fitChroma({ l, c: start.c * chroma, h: start.h });
          const rgb = lchToRgb(lch);
          if (passes(rgb, text)) return { accent: hex(rgb), accentContrast: textHex };
        }
      }
    }
  }
  return { accent: DEFAULT_ACCENT, accentContrast: ink };
}

/** A whole theme for an accent from the image, or the default for none. */
export function themeFor(accent: string | null): Theme {
  const family = familyFor(accent);
  const source = accent ?? DEFAULT_ACCENT;
  // The text on the accent is the light mode's ink in both modes, as the kit's is.
  const ink = family.light.text;
  const paper = family.light.bg;
  const mode = (surfaces: Surfaces): ModeTokens => {
    // The kit's own orange on the kit's own surfaces stays exactly as decided, even where it misses 3:1 on oatmeal.
    if (!accent && family === PAPER) return { ...surfaces, accent: DEFAULT_ACCENT, accentContrast: ink };
    return { ...surfaces, ...fitAccent(source, surfaces, ink, paper) };
  };
  return { family: family.id, source, light: mode(family.light), dark: mode(family.dark) };
}

/** The CSS variables a mode's tokens set (src/ui/theme.css reads them); applied on <html>, they theme the whole UI. */
export function cssVariables(tokens: ModeTokens): Record<string, string> {
  return {
    '--bg': tokens.bg,
    '--surface': tokens.surface,
    '--surface-raised': tokens.surfaceRaised,
    '--border': tokens.border,
    '--border-top': tokens.borderTop,
    '--text': tokens.text,
    '--text-muted': tokens.textMuted,
    '--text-inverse': tokens.textInverse,
    '--accent': tokens.accent,
    '--accent-contrast': tokens.accentContrast,
  };
}

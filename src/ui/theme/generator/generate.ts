import { contrast, deltaE, fitChroma, hex, labToLch, labToRgb, lchToRgb, parseHex, rgbToLab, rgbToLch, type Lab, type Lch, type Rgb } from './color';
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
/** A ground with less chroma than this (or very light) is paper, not a colour: a logo on cream offers its mark. */
const GROUND_CHROMA = 0.08;
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
 * The pixels worth reading from an RGBA image: opaque ones, without a logo's flat ground. A colour that fills most of
 * the edge is the ground; a quiet one (grey, white, cream, any pale or barely tinted colour) is left out, so a red mark
 * on white or on cream offers red, not the paper. A clearly coloured ground stays: a white mark on a red square, or a
 * solid red image, offers red. The ground found comes back either way, for telling a mark's soft rim from a colour.
 */
export function colourPixels(
  rgba: Uint8ClampedArray | readonly number[],
  width: number,
  height: number,
): { pixels: Lab[]; ground: Lab | null } {
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
  const ground = edge.find((candidate) => edge.filter((p) => deltaE(p, candidate) < 0.03).length > places * 0.6) ?? null;
  const quiet = ground ? labToLch(ground) : null;
  const background = ground && quiet && (quiet.c < GROUND_CHROMA || quiet.l > 0.9) ? ground : null;
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
  return { pixels: out, ground };
}

/** How far, per sRGB channel, a colour may sit off the straight mix of two and still count as their mix. */
const BLEND_TOLERANCE = 16;

/**
 * Whether a colour is only the soft edge between an accent and the background: a mix of the two in sRGB, as
 * anti-aliasing and shrinking make them. A red dot on white offers red, not the pink of its rim.
 */
export function isBlend(colour: Rgb, accent: Rgb, background: Rgb): boolean {
  const channels = [0, 1, 2] as const;
  // How much of the accent is in the mix, read on the channel where the two differ most.
  const axis = channels.reduce((best, i) => (Math.abs(accent[i] - background[i]) > Math.abs(accent[best] - background[best]) ? i : best), 0);
  const span = accent[axis] - background[axis];
  if (Math.abs(span) < 1) return false;
  const t = (colour[axis] - background[axis]) / span;
  if (t <= 0 || t >= 1) return false;
  return channels.every((i) => Math.abs(background[i] + t * (accent[i] - background[i]) - colour[i]) <= BLEND_TOLERANCE);
}

/**
 * Up to four accents an image offers, most saturated first: clusters with enough colour to read as colour, ranked by
 * chroma and share, and kept visibly apart. Empty for a grey image, which keeps the kit's orange.
 */
export function accentCandidates(rgba: Uint8ClampedArray | readonly number[], width: number, height: number): string[] {
  // Judged as the hex it will be stored as, so an accent offered is never one the family table reads as grey.
  const sampled = colourPixels(rgba, width, height);
  // Kept or left out, the ground is what a mark's rim fades into.
  const ground = sampled.ground ? labToRgb(sampled.ground) : null;
  const found = clusters(sampled.pixels, CLUSTERS)
    .map(({ center, share }) => {
      const value = hex(lchToRgb(labToLch(center)));
      return { center, share, value, lch: rgbToLch(parseHex(value)) };
    })
    .filter((c) => c.lch.c >= MIN_CHROMA && c.share >= MIN_SHARE)
    .sort((a, b) => b.lch.c * Math.sqrt(b.share) - a.lch.c * Math.sqrt(a.share));
  const kept: typeof found = [];
  for (const candidate of found) {
    const apart = kept.every((k) => deltaE(k.center, candidate.center) >= APART);
    const rim = ground !== null && kept.some((k) => isBlend(parseHex(candidate.value), parseHex(k.value), ground));
    if (apart && !rim) kept.push(candidate);
    if (kept.length === 4) break;
  }
  // The default is the most saturated; the rest follow in rank.
  kept.sort((a, b) => b.lch.c - a.lch.c);
  return kept.map((c) => c.value);
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
 * 4.5:1 for the ink on it. The text on the accent is always ink, as in the kit (CLAUDE.md, Design). Every family
 * leaves room for that at some lightness, so the search covers the whole range, from near black to near white.
 */
export function fitAccent(accent: string, surfaces: Surfaces, ink: string): { accent: string; accentContrast: string } {
  const start = rgbToLch(parseHex(accent));
  const [bg, surface, text, modeText] = [parseHex(surfaces.bg), parseHex(surfaces.surface), parseHex(ink), parseHex(surfaces.text)];
  // Apart from the mode's own text too, so a white typed in never comes out as dark mode's paper text.
  const passes = (rgb: Rgb) =>
    contrast(rgb, bg) >= 3 && contrast(rgb, surface) >= 3 && contrast(rgb, text) >= 4.5 && contrast(rgb, modeText) >= 1.5;
  // Down to no chroma at all, a grey of the right lightness, which always passes.
  for (const chroma of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
    // Outward from the accent's own lightness, so the nearest passing one wins.
    for (let step = 0; step <= 400; step += 1) {
      for (const sign of step === 0 ? [1] : [-1, 1]) {
        const l = start.l + sign * step * 0.0025;
        if (l <= 0.05 || l >= 0.97) continue;
        const lch: Lch = fitChroma({ l, c: start.c * chroma, h: start.h });
        const rgb = lchToRgb(lch);
        if (passes(rgb)) return { accent: hex(rgb), accentContrast: ink };
      }
    }
  }
  // Unreachable for the families in families.ts (generate.test.ts sweeps them); a new family that broke it fails there.
  throw new Error(`No accent near ${accent} passes AA on ${surfaces.bg}.`);
}

/** A whole theme for an accent from the image, or the default for none. */
export function themeFor(accent: string | null): Theme {
  const family = familyFor(accent);
  const source = accent ?? DEFAULT_ACCENT;
  // The text on the accent is the light mode's ink in both modes, as the kit's is.
  const ink = family.light.text;
  const mode = (surfaces: Surfaces): ModeTokens => {
    // The kit's own orange on the kit's own surfaces stays exactly as decided, even where it misses 3:1 on oatmeal.
    if (!accent && family === PAPER) return { ...surfaces, accent: DEFAULT_ACCENT, accentContrast: ink };
    return { ...surfaces, ...fitAccent(source, surfaces, ink) };
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

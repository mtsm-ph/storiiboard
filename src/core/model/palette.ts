import type { JsonValue, Props } from './record';

// Scene colour palettes (polish PP, Kevin Nov 5): up to 16 colours per scene, from its frames' pictures, kept in the
// scene's `palette` prop (docs/SBD_FORMAT.md, Storyboard props). Every change is an edit, so ⌘Z takes it back. A palette
// is the scene's look, for the DP and the art department: it never touches the app's theme.
//
//   { "size": 8, "colors": [{ "hex": "#A35139", "locked": true }, { "hex": "#1F2F4D" }] }
//
// `size` is how many colours Generate makes; `colors` are the palette as it is now, in its order. A locked colour
// stays where it is when the rest are generated again. Older files have no palette: a scene starts with none.

export const MAX_PALETTE = 16;
export const DEFAULT_PALETTE_SIZE = 8;

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface Swatch {
  /** sRGB, as "#A35139": what a person copies into another app. */
  hex: string;
  locked: boolean;
  /** As stored, so a field a newer version keeps on a colour is never dropped. */
  raw: Readonly<JsonObject>;
}

export interface Palette {
  /** How many colours Generate makes, 1 to 16. */
  size: number;
  colors: Swatch[];
  raw: Readonly<JsonObject>;
  /** Colours this version can't read (a newer one's), kept at the end as they are. */
  unread: readonly JsonValue[];
}

/** "#a35139" or "a35139" as "#A35139"; null for anything that isn't a six-digit hex colour. */
export function normalHex(text: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return match?.[1] ? `#${match[1].toUpperCase()}` : null;
}

const clampSize = (n: number) => Math.min(MAX_PALETTE, Math.max(1, Math.round(n)));

/** A scene's palette, or null when it has none (every scene in a file from before palettes). */
export function paletteOf(props: Props): Palette | null {
  const stored = props.palette;
  if (!isObject(stored)) return null;
  const colors: Swatch[] = [];
  const unread: JsonValue[] = [];
  for (const value of Array.isArray(stored.colors) ? stored.colors : []) {
    const hex = isObject(value) && typeof value.hex === 'string' ? normalHex(value.hex) : null;
    // One colour once: a file edited elsewhere could list it twice.
    if (hex && isObject(value) && !colors.some((c) => c.hex === hex)) colors.push({ hex, locked: value.locked === true, raw: value });
    else if (!hex) unread.push(value);
  }
  const size = typeof stored.size === 'number' && Number.isFinite(stored.size) ? clampSize(stored.size) : DEFAULT_PALETTE_SIZE;
  return { size, colors, raw: stored, unread };
}

/** A new, empty palette that makes `size` colours. */
export const emptyPalette = (size = DEFAULT_PALETTE_SIZE): Palette => ({ size: clampSize(size), colors: [], raw: {}, unread: [] });

function storedSwatch(swatch: Swatch): JsonObject {
  // What a newer version keeps on the colour stays; hex and locked are this version's to write.
  const rest = Object.fromEntries(Object.entries(swatch.raw).filter(([key]) => key !== 'locked' && key !== 'hex'));
  return { ...rest, hex: swatch.hex, ...(swatch.locked ? { locked: true } : {}) };
}

/**
 * The edit that stores a palette. One with no colours keeps its count, so a count picked before Generate stays; the
 * scene reads as having no palette until it has a colour.
 */
export function paletteChange(palette: Palette | null): { set?: Props; unset?: string[] } {
  if (!palette) return { unset: ['palette'] };
  return { set: { palette: { ...palette.raw, size: palette.size, colors: [...palette.colors.map(storedSwatch), ...palette.unread] } } };
}

const swatch = (hex: string): Swatch => ({ hex, locked: false, raw: {} });

export function withLock(palette: Palette, index: number, locked: boolean): Palette {
  return { ...palette, colors: palette.colors.map((c, i) => (i === index ? { ...c, locked } : c)) };
}

/** The colour at `from` moved to `to`, the rest closing up around it. */
export function withMoved(palette: Palette, from: number, to: number): Palette {
  const colors = [...palette.colors];
  const [moved] = colors.splice(from, 1);
  if (!moved) return palette;
  colors.splice(Math.max(0, Math.min(colors.length, to)), 0, moved);
  return { ...palette, colors };
}

export function withoutColor(palette: Palette, index: number): Palette {
  return { ...palette, colors: palette.colors.filter((_, i) => i !== index) };
}

// The editor's edits name a colour by its hex, worked out on the palette as it is when the edit lands: two quick
// presses (a held key, Delete twice) each act on the colour the person meant, never on whatever sits at an old index.

/** The colour `hex` moved `step` places (−1 left, +1 right); unchanged at an end or once it's gone. */
export function movedColor(palette: Palette, hex: string, step: number): Palette {
  const from = palette.colors.findIndex((c) => c.hex === hex);
  const to = from + step;
  return from < 0 || to < 0 || to >= palette.colors.length ? palette : withMoved(palette, from, to);
}

/** The palette without the colour `hex`; unchanged once it's gone. */
export function removedColor(palette: Palette, hex: string): Palette {
  return { ...palette, colors: palette.colors.filter((c) => c.hex !== hex) };
}

/** The colour `hex` locked if it wasn't, unlocked if it was. */
export function toggledLock(palette: Palette, hex: string): Palette {
  return { ...palette, colors: palette.colors.map((c) => (c.hex === hex ? { ...c, locked: !c.locked } : c)) };
}

/** A colour added at the end (the eyedropper, polish PPb); none past 16, and never the same colour twice. */
export function withColor(palette: Palette, hex: string): Palette {
  const normal = normalHex(hex);
  if (!normal || palette.colors.length >= MAX_PALETTE || palette.colors.some((c) => c.hex === normal)) return palette;
  return { ...palette, colors: [...palette.colors, swatch(normal)] };
}

/**
 * How many colours Generate and Regenerate make. It never takes a colour out by itself: stepping the count down and
 * up again (arrowing through the list) leaves the palette as it was; the next Regenerate makes that many.
 */
export function withSize(palette: Palette, size: number): Palette {
  return { ...palette, size: clampSize(size) };
}

/**
 * The palette generated again from `candidates` (most telling first): locked colours keep their places, and the other
 * places fill with candidates in order, `size` colours in all. `distinct` says whether a candidate is far enough from
 * a colour already there to be worth a place.
 */
export function regenerated(palette: Palette, candidates: readonly string[], distinct: (a: string, b: string) => boolean): Palette {
  const kept = palette.colors.filter((c) => c.locked);
  const fresh: string[] = [];
  for (const candidate of candidates) {
    const hex = normalHex(candidate);
    if (!hex) continue;
    if (kept.length + fresh.length >= palette.size) break;
    if ([...kept.map((c) => c.hex), ...fresh].every((other) => distinct(hex, other))) fresh.push(hex);
  }
  // Walk the places in order: a locked colour stays in its own; every other place takes the next fresh colour.
  // Each place passed adds one colour until all are placed, so the walk ends.
  const colors: Swatch[] = [];
  const queue = [...fresh];
  for (let i = 0; colors.length < kept.length + fresh.length; i += 1) {
    const here = palette.colors[i];
    const fill = here?.locked ? here : queue.length > 0 ? swatch(queue.shift() ?? '') : null;
    if (fill) colors.push(fill);
  }
  return { ...palette, colors };
}

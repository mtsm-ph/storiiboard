import { clusters } from '../../../ui/theme/generator/generate';
import { deltaE, hex, labToRgb, parseHex, rgbToLab, type Lab } from '../../../ui/theme/generator/color';

// A scene's colours from its frames' pictures (polish PP): each frame read as it's framed (its crop), letterbox and
// pillarbox bars left out, every frame weighing the same however big its picture, then clustered in OKLab like a
// project theme's accents (src/ui/theme/generator). Pure functions here; reading the pictures is in read.ts.

/** Below this, a row or column is a bar: near black and near even. Matte black in a shot is darker than few bars. */
const BAR_LUMA = 26;
const BAR_SPREAD = 14;
/** Bars never take more than this share of a side (a wide picture in a tall frame comes close). */
const MAX_BAR = 0.45;
/** Two bars match when they differ by no more than this share of the side, or two rows, whichever is more. */
const BAR_MATCH = 0.04;
/** Never used: a frame's points are indexed within it. */
const NOWHERE: Lab = [0, 0, 0];
/** Pixels read from each frame at most. */
const PER_FRAME = 700;
/** Points clustered at most, however many frames: a 40-frame scene clusters about as quickly as a short one. */
const MAX_POINTS = 6000;
/** Clusters asked for at most. */
const MAX_CLUSTERS = 24;
/** How far apart two palette colours must be, in OKLab: about three just-visible steps. */
export const DISTINCT = 0.06;

export interface Pixels {
  data: Uint8ClampedArray | readonly number[];
  width: number;
  height: number;
}

const lumaAt = (rgba: Pixels['data'], i: number) => 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);

/** The part of a frame inside any letterbox (top and bottom) or pillarbox (sides) bars: x and y from, to (exclusive). */
export function insideBars({ data, width, height }: Pixels): { x0: number; y0: number; x1: number; y1: number } {
  const isBar = (indices: number[]) => {
    const lumas = indices.map((i) => lumaAt(data, i));
    return Math.max(...lumas) < BAR_LUMA && Math.max(...lumas) - Math.min(...lumas) < BAR_SPREAD;
  };
  const row = (y: number) => Array.from({ length: width }, (_, x) => (y * width + x) * 4);
  const column = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 }, (_, k) => ((y0 + k) * width + x) * 4);
  // Bars come in matching pairs, top and bottom or left and right: dark sky over a night exterior, or dark ground
  // under it, is one-sided, and stays in the picture.
  const pair = (side: number, first: (k: number) => boolean, last: (k: number) => boolean): [number, number] => {
    let a = 0;
    let b = 0;
    while (a < side * MAX_BAR && first(a)) a += 1;
    while (b < side * MAX_BAR && last(b)) b += 1;
    const matched = a > 0 && b > 0 && a < side * MAX_BAR && b < side * MAX_BAR && Math.abs(a - b) <= Math.max(2, side * BAR_MATCH);
    return matched ? [a, b] : [0, 0];
  };
  const [top, bottom] = pair(height, (k) => isBar(row(k)), (k) => isBar(row(height - 1 - k)));
  const y0 = top;
  const y1 = height - bottom;
  const [left, right] = pair(width, (k) => isBar(column(k, y0, y1)), (k) => isBar(column(width - 1 - k, y0, y1)));
  return { x0: left, y0, x1: width - right, y1 };
}

/** A frame's pixels inside its bars, opaque ones, as OKLab, evenly thinned to at most PER_FRAME. */
export function framePixels(pixels: Pixels): Lab[] {
  const { data, width } = pixels;
  const { x0, y0, x1, y1 } = insideBars(pixels);
  const out: Lab[] = [];
  const count = (x1 - x0) * (y1 - y0);
  const step = Math.max(1, Math.ceil(count / PER_FRAME));
  for (let k = 0; k < count; k += step) {
    const x = x0 + (k % (x1 - x0));
    const y = y0 + Math.floor(k / (x1 - x0));
    const i = (y * width + x) * 4;
    if ((data[i + 3] ?? 0) < 128) continue;
    out.push(rgbToLab([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]));
  }
  return out;
}

/**
 * Up to `count` colours for a scene from its frames' pixels, the ones covering most of the scene first, no two
 * closer than DISTINCT. Asks the clustering for more than it needs, so a near-duplicate can give way to the next.
 */
export function paletteFromFrames(frames: readonly Lab[][], count: number, seed = 1): string[] {
  // The same number of points from each frame, a small picture's repeated, so each frame counts once.
  const filled = frames.filter((f) => f.length > 0);
  const each = Math.min(PER_FRAME, Math.max(0, ...filled.map((f) => f.length)), Math.max(40, Math.floor(MAX_POINTS / Math.max(1, filled.length))));
  const points = filled.flatMap((f) => Array.from({ length: each }, (_, k) => f[Math.floor((k * f.length) / each)] ?? NOWHERE));
  if (points.length === 0 || count <= 0) return [];
  const found = clusters(points, Math.min(MAX_CLUSTERS, count * 2 + 4), seed).sort((a, b) => b.share - a.share);
  const picked: Lab[] = [];
  for (const { center } of found) {
    if (picked.length >= count) break;
    if (picked.every((other) => deltaE(center, other) >= DISTINCT)) picked.push(center);
  }
  return picked.map((lab) => hex(labToRgb(lab)));
}

/** Whether two hex colours are far enough apart to both have a place (Regenerate, around locked colours). */
export function distinctHex(a: string, b: string): boolean {
  return deltaE(rgbToLab(parseHex(a)), rgbToLab(parseHex(b))) >= DISTINCT;
}

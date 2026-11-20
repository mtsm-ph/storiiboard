// The HEIC test pictures' sources (Kevin, Nov 19): three PNGs drawn here, each with a Display P3 profile this script
// builds itself, which the Mac runner turns into HEICs with sips (.github/workflows/measure-heic.yml). The repo holds no
// one else's pictures, so every value the HEIC measurements print comes from these drawings.
//
//   node scripts/heicFixtures.ts --out <folder>
//
// writes heic-proof.png (1024 × 768: flat patches, three of them outside sRGB, and a grey gradient), heic-12mp.png
// (4032 × 3024) and heic-48mp.png (8064 × 6048), the last two a seeded photo-like detail that gives an encoder real
// work, and heic-proof-regions.json: where to measure each patch and the mean the drawing has there. It prints only the
// files it wrote and their SHA-256s.
//
// Running it twice writes the same bytes: every random value comes from a seed, and nothing reads the clock (the
// profile's date is fixed). The PNG is written here, by hand, so no canvas or colour management touches the pixels:
// the code values in the file are exactly the ones drawn, and the profile says they are Display P3's.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import type { Colourants } from './fixturePhotos';

// Node runs this file as is, so the import needs its `.ts`, which the project's TypeScript settings refuse in a static
// import; a dynamic one by URL works for both, its type taken from the module itself.
const { rgbProfile } = (await import(new URL('./fixturePhotos.ts', import.meta.url).href)) as typeof import('./fixturePhotos');

export type Rgb = [number, number, number];

// ---- The Display P3 profile -----------------------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number, number, number, number];

const multiply = (a: Matrix, b: Matrix): Matrix => {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += (a[r * 3 + k] ?? 0) * (b[k * 3 + c] ?? 0);
      out[r * 3 + c] = sum;
    }
  }
  return out as Matrix;
};

const apply = (m: Matrix, v: number[]): number[] =>
  [0, 1, 2].map((r) => (m[r * 3] ?? 0) * (v[0] ?? 0) + (m[r * 3 + 1] ?? 0) * (v[1] ?? 0) + (m[r * 3 + 2] ?? 0) * (v[2] ?? 0));

export function invert([a, b, c, d, e, f, g, h, i]: Matrix): Matrix {
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

const fromXy = ([x, y]: [number, number]): number[] => [x / y, 1, (1 - x - y) / y];

/** ICC's PCS white, as fixturePhotos.ts writes it. */
export const D50 = [0.9642, 1.0, 0.8249];
const BRADFORD: Matrix = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** Bradford's adaptation from one white to another, as an ICC display profile adapts its colourants to D50. */
export function bradford(from: number[], to: number[]): Matrix {
  const cone = (white: number[]) => apply(BRADFORD, white);
  const a = cone(from);
  const b = cone(to);
  const scale: Matrix = [(b[0] ?? 1) / (a[0] ?? 1), 0, 0, 0, (b[1] ?? 1) / (a[1] ?? 1), 0, 0, 0, (b[2] ?? 1) / (a[2] ?? 1)];
  return multiply(invert(BRADFORD), multiply(scale, BRADFORD));
}

/** Display P3 (SMPTE EG 432-1): DCI-P3's primaries with the D65 white point, and sRGB's curve. */
export const P3_PRIMARIES = { red: [0.68, 0.32], green: [0.265, 0.69], blue: [0.15, 0.06], white: [0.3127, 0.329] } as const;

/** The colourants of an RGB space with these chromaticities, adapted to D50. */
export function colourantsD50(primaries: typeof P3_PRIMARIES): Colourants {
  const red = fromXy([...primaries.red]);
  const green = fromXy([...primaries.green]);
  const blue = fromXy([...primaries.blue]);
  const white = fromXy([...primaries.white]);
  // Each primary's luminance so that the three add up to the white.
  const columns: Matrix = [red[0] ?? 0, green[0] ?? 0, blue[0] ?? 0, 1, 1, 1, red[2] ?? 0, green[2] ?? 0, blue[2] ?? 0];
  const [sr = 0, sg = 0, sb = 0] = apply(invert(columns), white);
  const adapt = bradford(white, D50);
  return {
    white: D50,
    red: apply(adapt, red.map((v) => v * sr)),
    green: apply(adapt, green.map((v) => v * sg)),
    blue: apply(adapt, blue.map((v) => v * sb)),
  };
}

/** The profile every picture here carries: built from the numbers above, never copied from a system or a file. */
export function displayP3Profile(): Buffer {
  return rgbProfile(
    1024,
    colourantsD50(P3_PRIMARIES),
    'Display P3, 1024-point sRGB curve (Storiiboard HEIC test pictures)',
    'Made by scripts/heicFixtures.ts in the Storiiboard repo, for its HEIC test pictures.',
  );
}

// ---- PNG --------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** PNG's CRC-32 (ISO 3309), over a chunk's type and data. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** IDAT chunks of at most this many bytes, as encoders split them. */
const IDAT_SIZE = 1 << 20;

/**
 * An 8-bit RGB PNG of `scanlines` (each row a filter byte, 0, then its pixels), with the profile as its iCCP chunk and
 * nothing else beside IHDR, IDAT and IEND.
 */
export function png(width: number, height: number, scanlines: Buffer, profile: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const iccp = Buffer.concat([Buffer.from('Display P3\0', 'latin1'), Buffer.from([0]), deflateSync(profile)]);
  const data = deflateSync(scanlines);
  const idats: Buffer[] = [];
  for (let at = 0; at < data.length; at += IDAT_SIZE) idats.push(chunk('IDAT', data.subarray(at, at + IDAT_SIZE)));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('iCCP', iccp), ...idats, chunk('IEND', Buffer.alloc(0))]);
}

const clampByte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

// ---- The proof picture ------------------------------------------------------------------------------------------------

export const PROOF_WIDTH = 1024;
export const PROOF_HEIGHT = 768;
const PROOF_GROUND: Rgb = [64, 64, 64];

/** A patch of the proof picture: flat (`left` = `right`) or a gradient from `left` to `right`, in P3 code values. */
export interface Patch {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  left: Rgb;
  right: Rgb;
}

const flat = (name: string, x: number, rgb: Rgb): Patch => ({ name, x, y: 96, w: 160, h: 160, left: rgb, right: rgb });

/** Where each patch is: the red, green and blue lie outside sRGB; (200, 120, 60) inside it. */
export const PROOF_PATCHES: readonly Patch[] = [
  flat('p3-red', 64, [255, 0, 0]),
  flat('p3-green', 256, [0, 255, 0]),
  flat('p3-blue', 448, [0, 0, 255]),
  flat('inside-srgb', 640, [200, 120, 60]),
  flat('mid-grey', 832, [128, 128, 128]),
  { name: 'grey-gradient', x: 64, y: 384, w: 896, h: 160, left: [0, 0, 0], right: [255, 255, 255] },
];

/** A patch's colour at column `x` (inside it). */
const patchColour = (patch: Patch, x: number): Rgb => {
  const f = patch.w > 1 ? (x - patch.x) / (patch.w - 1) : 0;
  return [0, 1, 2].map((i) => clampByte((patch.left[i] ?? 0) + ((patch.right[i] ?? 0) - (patch.left[i] ?? 0)) * f)) as Rgb;
};

/** The proof picture's scanlines (filter byte 0, then RGB). */
export function drawProof(): Buffer {
  const stride = 1 + PROOF_WIDTH * 3;
  const out = Buffer.alloc(PROOF_HEIGHT * stride);
  for (let y = 0; y < PROOF_HEIGHT; y += 1) {
    for (let x = 0; x < PROOF_WIDTH; x += 1) {
      const patch = PROOF_PATCHES.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      out.set(patch ? patchColour(patch, x) : PROOF_GROUND, y * stride + 1 + x * 3);
    }
  }
  return out;
}

/** A rectangle to measure and the drawing's own mean code values there. */
export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  drawn: Rgb;
}

/**
 * Where a measurement reads each patch: 16 px inside its edges, away from the chroma an encoder smears across a border,
 * and the gradient also in eight bands, each with the mean the drawing has in it (worked out from the drawn pixels).
 */
export function proofRegions(scanlines: Buffer = drawProof()): Region[] {
  const stride = 1 + PROOF_WIDTH * 3;
  const mean = (x: number, y: number, w: number, h: number): Rgb => {
    const sum = [0, 0, 0];
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        for (let i = 0; i < 3; i += 1) sum[i] = (sum[i] ?? 0) + (scanlines[row * stride + 1 + col * 3 + i] ?? 0);
      }
    }
    return sum.map((s) => Math.round((s / (w * h)) * 10) / 10) as Rgb;
  };
  const inset = 16;
  const regions: Region[] = [];
  for (const p of PROOF_PATCHES) {
    const x = p.x + inset;
    const y = p.y + inset;
    const w = p.w - inset * 2;
    const h = p.h - inset * 2;
    regions.push({ name: p.name, x, y, w, h, drawn: mean(x, y, w, h) });
    if (p.left.some((v, i) => v !== p.right[i])) {
      const band = Math.floor(w / 8);
      for (let b = 0; b < 8; b += 1) {
        regions.push({ name: `${p.name}-${String(b + 1)}`, x: x + b * band, y, w: band, h, drawn: mean(x + b * band, y, band, h) });
      }
    }
  }
  return regions;
}

// ---- The photo-like detail --------------------------------------------------------------------------------------------

/** mulberry32: a small seeded generator, as fixturePhotos.ts uses. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise on a grid of `cell` px: each corner a seeded value in -1..1, smoothly blended between. */
function valueNoise(width: number, height: number, cell: number, random: () => number): (x: number, y: number) => number {
  const cols = Math.ceil(width / cell) + 2;
  const rows = Math.ceil(height / cell) + 2;
  const values = new Float32Array(cols * rows);
  for (let i = 0; i < values.length; i += 1) values[i] = random() * 2 - 1;
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let fx = gx - ix;
    let fy = gy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const at = iy * cols + ix;
    const a = values[at] ?? 0;
    const b = values[at + 1] ?? 0;
    const c = values[at + cols] ?? 0;
    const d = values[at + cols + 1] ?? 0;
    return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
  };
}

/** A per-pixel grain value in -1..1, from a hash of the place and the seed (no state, so any row can be drawn alone). */
const grain = (x: number, y: number, channel: number, seed: number): number => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(channel + 1, 0x9e3779b9) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
};

export const DETAIL_SEED = 0x5eed_4e1c;

/**
 * Photo-like detail at any size: a colour gradient across the frame (reaching P3's saturated corners), light and shade
 * from value noise at a few scales relative to the frame, a fine texture and a grain. Drawn row by row into scanlines.
 */
export function drawDetail(width: number, height: number, seed: number = DETAIL_SEED): Buffer {
  const random = generator(seed);
  const span = Math.max(width, height);
  const large = valueNoise(width, height, span / 6, random);
  const medium = valueNoise(width, height, span / 40, random);
  const small = valueNoise(width, height, span / 200, random);
  const fine = valueNoise(width, height, 3, random);
  const tintR = valueNoise(width, height, span / 10, random);
  const tintB = valueNoise(width, height, span / 10, random);
  const stride = 1 + width * 3;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(1, height - 1);
    const row = y * stride + 1;
    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1);
      const shade = large(x, y) * 55 + medium(x, y) * 28 + small(x, y) * 14 + fine(x, y) * 7;
      const r = 30 + 215 * u * (1 - 0.6 * v) + tintR(x, y) * 30;
      const g = 25 + 200 * v * (1 - 0.5 * u) + 20 * u;
      const b = 235 - 190 * u * 0.5 - 120 * v * u + tintB(x, y) * 30;
      const o = row + x * 3;
      out[o] = clampByte(r + shade + grain(x, y, 0, seed) * 5);
      out[o + 1] = clampByte(g + shade + grain(x, y, 1, seed) * 5);
      out[o + 2] = clampByte(b + shade + grain(x, y, 2, seed) * 5);
    }
  }
  return out;
}

// ---- The files ----------------------------------------------------------------------------------------------------------

export const PICTURES: readonly { file: string; width: number; height: number; draw: () => Buffer }[] = [
  { file: 'heic-proof.png', width: PROOF_WIDTH, height: PROOF_HEIGHT, draw: drawProof },
  { file: 'heic-12mp.png', width: 4032, height: 3024, draw: () => drawDetail(4032, 3024) },
  { file: 'heic-48mp.png', width: 8064, height: 6048, draw: () => drawDetail(8064, 6048) },
];

export const REGIONS_FILE = 'heic-proof-regions.json';

/** The regions file: the picture it belongs to, its size, and each region with its drawn mean. */
export function regionsJson(): string {
  const body = { picture: 'heic-proof.png', width: PROOF_WIDTH, height: PROOF_HEIGHT, patches: PROOF_PATCHES, regions: proofRegions() };
  return `${JSON.stringify(body, null, 2)}\n`;
}

function main(): void {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('Usage: node scripts/heicFixtures.ts --out <folder>');
  mkdirSync(values.out, { recursive: true });
  const profile = displayP3Profile();
  const write = (file: string, bytes: Buffer) => {
    writeFileSync(join(values.out ?? '.', file), bytes);
    console.log(`${file}  ${String(bytes.length)} bytes  sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
  };
  for (const { file, width, height, draw } of PICTURES) write(file, png(width, height, draw(), profile));
  write(REGIONS_FILE, Buffer.from(regionsJson(), 'utf8'));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

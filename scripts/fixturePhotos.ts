// The test photos, drawn here (Kevin, Nov 18 and 19): the repo holds no one else's pictures, so the photographs the
// end-to-end tests import (e2e/fixtures/images/photo-a.jpg and photo-b.jpg) and the prototype's uploads are scenes this
// script paints, not stills from films. Each is drawn on a 2D canvas in the Chromium Playwright already installs and
// encoded by that canvas (`toBlob('image/jpeg', 0.9)`), so it is the JPEG a webview writes; then a colour profile this
// script writes itself takes the place of Chromium's own, after APP0, as a camera's or an editor's file carries one.
//
//   node scripts/fixturePhotos.ts       writes all six files
//
// Running it twice writes the same bytes: every random value comes from a seeded generator, and nothing reads the clock
// (the profile's date is fixed). A new Chromium could encode differently; then the files change, and deckPictures.ts's
// measurements are taken again. Plain TypeScript Node runs as is (type stripping, Node 22.18 and later): no enums.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

type Rgb = [number, number, number];

/** A shape painted over the ground: in fractions of the picture, its colour running from top to bottom. */
interface Shape {
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  top: Rgb;
  bottom: Rgb;
  /** Edge softness, in pixels. */
  soft: number;
  alpha: number;
}

/** One picture: a sky and a floor meeting at the horizon, a few large shapes, a texture and a grain, all from `seed`. */
interface Scene {
  width: number;
  height: number;
  seed: number;
  skyTop: Rgb;
  skyBottom: Rgb;
  floorFar: Rgb;
  floorNear: Rgb;
  /** Where the floor begins, as a fraction of the height. */
  horizon: number;
  shapes: Shape[];
  /** The soft texture's strength (0 to 255) and the fine grain's. */
  texture: number;
  grain: number;
}

const rect = (x: number, y: number, w: number, h: number, top: Rgb, bottom: Rgb = top, soft = 3, alpha = 1): Shape => ({ kind: 'rect', x, y, w, h, top, bottom, soft, alpha });
const ellipse = (x: number, y: number, w: number, h: number, top: Rgb, bottom: Rgb = top, soft = 3, alpha = 1): Shape => ({ kind: 'ellipse', x, y, w, h, top, bottom, soft, alpha });

// Four scenes, each in colours of its own: photo-a (dusk street) and photo-b (meadow by day) must never pass for each
// other, as deckPictures' comparison is held to tell them apart.
const DUSK: Scene = {
  width: 967, height: 523, seed: 0x5eed_0a01, horizon: 0.64, texture: 14, grain: 9,
  skyTop: [58, 40, 96], skyBottom: [242, 150, 82], floorFar: [86, 70, 72], floorNear: [28, 26, 34],
  shapes: [
    ellipse(0.62, 0.42, 0.16, 0.3, [255, 226, 160], [255, 196, 120], 18),
    rect(0.04, 0.22, 0.2, 0.44, [40, 30, 52], [30, 24, 40], 2),
    rect(0.26, 0.34, 0.14, 0.32, [52, 38, 62], [36, 28, 46], 2),
    rect(0.78, 0.18, 0.18, 0.48, [34, 28, 48], [26, 22, 36], 2),
    rect(0.48, 0.3, 0.012, 0.42, [22, 20, 26], [22, 20, 26], 1),
    ellipse(0.486, 0.3, 0.05, 0.05, [255, 232, 170], [255, 210, 140], 10, 0.9),
    rect(0.1, 0.78, 0.8, 0.03, [210, 190, 120], [180, 160, 100], 4, 0.5),
  ],
};
const MEADOW: Scene = {
  width: 967, height: 521, seed: 0x5eed_0b02, horizon: 0.5, texture: 18, grain: 10,
  skyTop: [70, 132, 214], skyBottom: [196, 224, 242], floorFar: [104, 150, 64], floorNear: [38, 88, 30],
  shapes: [
    ellipse(0.22, 0.16, 0.24, 0.1, [250, 252, 255], [226, 234, 244], 22, 0.85),
    ellipse(0.7, 0.24, 0.3, 0.09, [246, 248, 252], [220, 230, 240], 26, 0.8),
    ellipse(0.08, 0.36, 0.18, 0.3, [36, 82, 40], [24, 60, 28], 6),
    ellipse(0.9, 0.4, 0.16, 0.24, [32, 76, 36], [22, 56, 26], 6),
    rect(0.5, 0.32, 0.2, 0.2, [176, 52, 40], [140, 40, 32], 2),
    rect(0.48, 0.26, 0.24, 0.07, [80, 60, 50], [70, 52, 44], 2),
    rect(0.0, 0.8, 1.0, 0.2, [60, 110, 40], [30, 70, 22], 30, 0.6),
  ],
};
const NIGHT_ROOM: Scene = {
  width: 967, height: 403, seed: 0x5eed_0c03, horizon: 0.7, texture: 12, grain: 8,
  skyTop: [18, 36, 56], skyBottom: [36, 62, 84], floorFar: [96, 58, 36], floorNear: [48, 28, 18],
  shapes: [
    rect(0.56, 0.12, 0.26, 0.42, [252, 204, 124], [236, 170, 96], 4),
    rect(0.685, 0.12, 0.01, 0.42, [30, 26, 24], [30, 26, 24], 1),
    rect(0.56, 0.32, 0.26, 0.012, [30, 26, 24], [30, 26, 24], 1),
    rect(0.1, 0.56, 0.34, 0.08, [70, 42, 28], [56, 34, 22], 2),
    rect(0.13, 0.64, 0.02, 0.24, [50, 30, 20], [40, 24, 16], 1),
    rect(0.39, 0.64, 0.02, 0.24, [50, 30, 20], [40, 24, 16], 1),
    ellipse(0.25, 0.4, 0.2, 0.34, [250, 214, 150], [200, 150, 90], 40, 0.55),
    ellipse(0.26, 0.5, 0.06, 0.08, [255, 236, 190], [250, 220, 160], 6),
  ],
};
const DESERT: Scene = {
  width: 967, height: 410, seed: 0x5eed_0d04, horizon: 0.58, texture: 16, grain: 9,
  skyTop: [138, 184, 214], skyBottom: [236, 216, 182], floorFar: [204, 152, 92], floorNear: [148, 92, 52],
  shapes: [
    rect(0.6, 0.3, 0.34, 0.3, [168, 98, 64], [140, 80, 52], 3),
    rect(0.66, 0.22, 0.2, 0.1, [176, 106, 70], [168, 98, 64], 3),
    ellipse(0.16, 0.66, 0.22, 0.14, [124, 72, 46], [96, 56, 36], 5),
    ellipse(0.42, 0.82, 0.14, 0.08, [116, 68, 44], [90, 52, 34], 5),
    ellipse(0.12, 0.14, 0.08, 0.14, [255, 250, 230], [255, 244, 214], 14, 0.9),
    rect(0.0, 0.54, 1.0, 0.08, [226, 200, 160], [214, 170, 120], 20, 0.5),
  ],
};

/** Each file, the scene it shows, and the profile's curve size (two sizes, as the tests met two real profiles before). */
const FILES: { path: string; scene: Scene; curve: 1024 | 4096 }[] = [
  { path: 'e2e/fixtures/images/photo-a.jpg', scene: DUSK, curve: 1024 },
  { path: 'e2e/fixtures/images/photo-b.jpg', scene: MEADOW, curve: 4096 },
  { path: 'prototype/uploads/small_LF7JADRW.jpg', scene: DUSK, curve: 1024 },
  { path: 'prototype/uploads/small_NVTE6ECR.jpg', scene: MEADOW, curve: 4096 },
  { path: 'prototype/uploads/small_EE2UMJ1P.jpg', scene: NIGHT_ROOM, curve: 4096 },
  { path: 'prototype/uploads/small_KDGP7IMR.jpg', scene: DESERT, curve: 4096 },
];

/** Paints a scene in the page and returns the canvas's JPEG. Runs in the browser: everything it needs is inside it. */
async function paint(scene: Scene): Promise<number[]> {
  // mulberry32: a small seeded generator, so the same seed paints the same pixels.
  let state = scene.seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const { width, height } = scene;
  const mix = (a: number, b: number, f: number): number => a + (b - a) * f;
  const smooth = (f: number): number => f * f * (3 - 2 * f);
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  // A soft texture: value noise on two grids (coarse and fine), each cell's corner a seeded value.
  const grid = (cell: number) => {
    const cols = Math.ceil(width / cell) + 2;
    const rows = Math.ceil(height / cell) + 2;
    const values = Array.from({ length: cols * rows }, () => random() * 2 - 1);
    return (x: number, y: number): number => {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = smooth(gx - ix);
      const fy = smooth(gy - iy);
      const at = (cx: number, cy: number) => values[cy * cols + cx] ?? 0;
      return mix(mix(at(ix, iy), at(ix + 1, iy), fx), mix(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
    };
  };
  const coarse = grid(64);
  const fine = grid(9);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const horizon = scene.horizon * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let colour: number[];
      if (y < horizon) {
        const f = y / horizon;
        colour = scene.skyTop.map((c, i) => mix(c, scene.skyBottom[i] ?? c, f));
      } else {
        const f = (y - horizon) / Math.max(1, height - horizon);
        colour = scene.floorFar.map((c, i) => mix(c, scene.floorNear[i] ?? c, f));
      }
      for (const shape of scene.shapes) {
        const sx = shape.x * width;
        const sy = shape.y * height;
        const sw = shape.w * width;
        const sh = shape.h * height;
        // Distance outside the shape's edge, in pixels (negative inside).
        let distance: number;
        if (shape.kind === 'rect') {
          const dx = Math.max(sx - x, x - (sx + sw));
          const dy = Math.max(sy - y, y - (sy + sh));
          distance = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
        } else {
          const rx = sw / 2;
          const ry = sh / 2;
          const nx = (x - (sx + rx)) / rx;
          const ny = (y - (sy + ry)) / ry;
          distance = (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
        }
        const cover = smooth(clamp(0.5 - distance / Math.max(1, shape.soft))) * shape.alpha;
        if (cover <= 0) continue;
        const f = clamp((y - sy) / Math.max(1, sh));
        colour = colour.map((c, i) => mix(c, mix(shape.top[i] ?? c, shape.bottom[i] ?? c, f), cover));
      }
      const texture = (coarse(x, y) * 0.6 + fine(x, y) * 0.4) * scene.texture;
      // A lens's fall-off at the corners.
      const vx = x / width - 0.5;
      const vy = y / height - 0.5;
      const vignette = 1 - 0.35 * (vx * vx + vy * vy);
      const o = (y * width + x) * 4;
      for (let i = 0; i < 3; i += 1) pixels[o + i] = ((colour[i] ?? 0) + texture + (random() * 2 - 1) * scene.grain) * vignette;
      pixels[o + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('no 2D canvas');
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
  if (!blob) throw new Error('the canvas made no JPEG');
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

// The colour profile: ICC v2, display class, RGB to XYZ, with sRGB's primaries adapted to D50 (Bradford) and sRGB's
// curve as a table of `points` entries.
const s15 = (value: number): number => Math.round(value * 65536);
const SRGB_D50 = {
  white: [0.9642, 1.0, 0.8249],
  red: [0.4360747, 0.2225045, 0.0139322],
  green: [0.3850649, 0.7168786, 0.0971045],
  blue: [0.1430804, 0.0606169, 0.7141733],
};

const padded = (bytes: Buffer): Buffer => Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);

function xyzTag(values: number[]): Buffer {
  const out = Buffer.alloc(20);
  out.write('XYZ ', 0, 'latin1');
  values.forEach((v, i) => out.writeInt32BE(s15(v), 8 + i * 4));
  return out;
}

function textTag(text: string): Buffer {
  return Buffer.concat([Buffer.from('text\0\0\0\0', 'latin1'), Buffer.from(`${text}\0`, 'latin1')]);
}

/** textDescriptionType (v2): the ASCII name, then empty Unicode and ScriptCode parts. */
function descTag(text: string): Buffer {
  const ascii = Buffer.from(`${text}\0`, 'latin1');
  const head = Buffer.alloc(12);
  head.write('desc', 0, 'latin1');
  head.writeUInt32BE(ascii.length, 8);
  // Unicode language code and count (8 bytes), ScriptCode code (2) and count (1), then its 67 bytes.
  return Buffer.concat([head, ascii, Buffer.alloc(8 + 2 + 1 + 67)]);
}

function curveTag(points: number): Buffer {
  const out = Buffer.alloc(12 + points * 2);
  out.write('curv', 0, 'latin1');
  out.writeUInt32BE(points, 8);
  for (let i = 0; i < points; i += 1) {
    const v = i / (points - 1);
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    out.writeUInt16BE(Math.round(linear * 65535), 12 + i * 2);
  }
  return out;
}

/** An RGB space's white and colourants, in D50 XYZ, as a display profile's tags hold them. */
export interface Colourants {
  white: number[];
  red: number[];
  green: number[];
  blue: number[];
}

export function srgbProfile(points: number): Buffer {
  return rgbProfile(
    points,
    SRGB_D50,
    `sRGB, ${String(points)}-point curve (Storiiboard test photos)`,
    'Made by scripts/fixturePhotos.ts in the Storiiboard repo, for its test photos.',
  );
}

/**
 * A display profile with these colourants and sRGB's curve: the one writer behind srgbProfile and the Display P3
 * profile scripts/heicFixtures.ts builds, so both are laid out the same way.
 */
export function rgbProfile(points: number, colourants: Colourants, description: string, copyright: string): Buffer {
  const curve = padded(curveTag(points));
  const data: [string, Buffer][] = [
    ['desc', descTag(description)],
    ['cprt', textTag(copyright)],
    ['wtpt', xyzTag(colourants.white)],
    ['rXYZ', xyzTag(colourants.red)],
    ['gXYZ', xyzTag(colourants.green)],
    ['bXYZ', xyzTag(colourants.blue)],
  ];
  const trcs = ['rTRC', 'gTRC', 'bTRC'];
  const count = data.length + trcs.length;
  const tableEnd = 128 + 4 + count * 12;
  const table = Buffer.alloc(4 + count * 12);
  table.writeUInt32BE(count, 0);
  const bodies: Buffer[] = [];
  let offset = tableEnd;
  let row = 0;
  const entry = (signature: string, at: number, size: number) => {
    table.write(signature, 4 + row * 12, 'latin1');
    table.writeUInt32BE(at, 4 + row * 12 + 4);
    table.writeUInt32BE(size, 4 + row * 12 + 8);
    row += 1;
  };
  // A tag's size in the table is its data alone, as ICC's tag table describes; the padding after it only brings the
  // next tag's offset to a multiple of 4.
  for (const [signature, body] of data) {
    entry(signature, offset, body.length);
    const stored = padded(body);
    bodies.push(stored);
    offset += stored.length;
  }
  // The three channels share one curve: one copy of its data, three entries pointing at it (as ICC allows).
  for (const signature of trcs) entry(signature, offset, 12 + points * 2);
  bodies.push(curve);
  offset += curve.length;
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0);
  header.writeUInt32BE(0x02100000, 8);
  header.write('mntrRGB XYZ ', 12, 'latin1');
  // A fixed date, never the clock's: the same bytes on every run.
  [2026, 11, 19, 0, 0, 0].forEach((v, i) => header.writeUInt16BE(v, 24 + i * 2));
  header.write('acsp', 36, 'latin1');
  colourants.white.forEach((v, i) => header.writeInt32BE(s15(v), 68 + i * 4));
  return Buffer.concat([header, table, ...bodies]);
}

/**
 * The JPEG with the profile as one APP2 ICC_PROFILE block (sequence 1 of 1) right after its APP0. Chromium's encoder
 * writes an sRGB profile of its own there: it goes, so the file carries this script's profile alone.
 */
export function withProfile(jpeg: Buffer, profile: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff || jpeg[3] !== 0xe0) throw new Error('not a JPEG starting with APP0');
  const app0End = 4 + jpeg.readUInt16BE(4);
  let rest = app0End;
  const isIcc = (at: number) => jpeg[at + 1] === 0xe2 && jpeg.subarray(at + 4, at + 16).toString('latin1') === 'ICC_PROFILE\0';
  while (jpeg[rest] === 0xff && isIcc(rest)) rest += 2 + jpeg.readUInt16BE(rest + 2);
  const next = jpeg[rest + 1] ?? 0;
  if (jpeg[rest] !== 0xff || (next >= 0xe0 && next <= 0xef)) throw new Error('the encoder wrote a block other than APP0 and a profile');
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe2, 0);
  head.writeUInt16BE(2 + 14 + profile.length, 2);
  const marker = Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1])]);
  return Buffer.concat([jpeg.subarray(0, app0End), head, marker, profile, jpeg.subarray(rest)]);
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const painted = new Map<Scene, Buffer>();
    for (const { path, scene, curve } of FILES) {
      let jpeg = painted.get(scene);
      if (!jpeg) {
        jpeg = Buffer.from(await page.evaluate(paint, scene));
        painted.set(scene, jpeg);
      }
      writeFileSync(`${root}${path}`, withProfile(jpeg, srgbProfile(curve)));
      console.log(`wrote ${path}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

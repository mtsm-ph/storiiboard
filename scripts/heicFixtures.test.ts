import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PICTURES,
  PROOF_HEIGHT,
  PROOF_PATCHES,
  PROOF_WIDTH,
  colourantsD50,
  crc32,
  displayP3Profile,
  drawDetail,
  drawProof,
  P3_PRIMARIES,
  png,
  proofRegions,
  type Rgb,
} from './heicFixtures';

// The HEIC test pictures' sources (scripts/heicFixtures.ts). Only the proof picture is drawn here whole: the 12 and 48 MP
// ones are checked by their size alone, never their bytes, so this file stays quick.

interface Chunk {
  type: string;
  data: Buffer;
  crc: number;
}

function chunks(file: Buffer): Chunk[] {
  expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const out: Chunk[] = [];
  let at = 8;
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.subarray(at + 4, at + 8).toString('latin1');
    out.push({ type, data: file.subarray(at + 8, at + 8 + length), crc: file.readUInt32BE(at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

/** The pixel at (x, y) of an 8-bit RGB PNG whose rows all use filter 0, as this script writes them. */
function reader(file: Buffer): (x: number, y: number) => Rgb {
  const list = chunks(file);
  const ihdr = list[0]?.data ?? Buffer.alloc(13);
  const width = ihdr.readUInt32BE(0);
  const raw = inflateSync(Buffer.concat(list.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = 1 + width * 3;
  return (x, y) => {
    expect(raw[y * stride]).toBe(0);
    const o = y * stride + 1 + x * 3;
    return [raw[o] ?? -1, raw[o + 1] ?? -1, raw[o + 2] ?? -1];
  };
}

const s15 = (bytes: Buffer, at: number): number => bytes.readInt32BE(at) / 65536;

/** A profile's tag by its signature: its data, as the tag table points at it. */
function tag(profile: Buffer, signature: string): Buffer {
  const count = profile.readUInt32BE(128);
  for (let i = 0; i < count; i += 1) {
    const row = 132 + i * 12;
    if (profile.subarray(row, row + 4).toString('latin1') === signature) {
      const offset = profile.readUInt32BE(row + 4);
      return profile.subarray(offset, offset + profile.readUInt32BE(row + 8));
    }
  }
  throw new Error(`no ${signature} tag`);
}

const xyz = (profile: Buffer, signature: string): number[] => {
  const data = tag(profile, signature);
  expect(data.subarray(0, 4).toString('latin1')).toBe('XYZ ');
  return [s15(data, 8), s15(data, 12), s15(data, 16)];
};

describe('the HEIC test pictures the script draws', () => {
  it('draws the same bytes from the same seed, and other bytes from another', () => {
    const profile = displayP3Profile();
    expect(png(PROOF_WIDTH, PROOF_HEIGHT, drawProof(), profile)).toEqual(png(PROOF_WIDTH, PROOF_HEIGHT, drawProof(), displayP3Profile()));
    expect(drawDetail(64, 48, 7)).toEqual(drawDetail(64, 48, 7));
    expect(drawDetail(64, 48, 7)).not.toEqual(drawDetail(64, 48, 8));
  });

  it('carries a Display P3 profile: P3 primaries adapted to D50, the white at D50 and the sRGB curve', () => {
    const profile = displayP3Profile();
    expect(profile.readUInt32BE(0)).toBe(profile.length);
    expect(profile.subarray(36, 40).toString('latin1')).toBe('acsp');
    expect(profile.subarray(12, 20).toString('latin1')).toBe('mntrRGB ');
    // Display P3's colourants as every Display P3 profile states them (Bradford, D65 to D50), to s15Fixed16's precision.
    const expected: Record<string, number[]> = {
      rXYZ: [0.5151, 0.2412, -0.0011],
      gXYZ: [0.292, 0.6922, 0.0419],
      bXYZ: [0.1571, 0.0666, 0.7841],
      wtpt: [0.9642, 1.0, 0.8249],
    };
    for (const [signature, values] of Object.entries(expected)) {
      xyz(profile, signature).forEach((v, i) => {
        expect(Math.abs(v - (values[i] ?? 0))).toBeLessThan(0.0006);
      });
    }
    // The colourants add up to the white, so P3's white (D65) lands on the PCS's.
    const sum = [0, 1, 2].map((i) => ['rXYZ', 'gXYZ', 'bXYZ'].reduce((s, sig) => s + (xyz(profile, sig)[i] ?? 0), 0));
    sum.forEach((v, i) => {
      expect(Math.abs(v - ([0.9642, 1.0, 0.8249][i] ?? 0))).toBeLessThan(0.0006);
    });
    // The same numbers the script computed, so the profile holds what colourantsD50 gives for P3's primaries.
    const computed = colourantsD50(P3_PRIMARIES);
    xyz(profile, 'rXYZ').forEach((v, i) => {
      expect(Math.abs(v - (computed.red[i] ?? 0))).toBeLessThan(0.00002);
    });
    // sRGB's curve: 1024 points, middle grey (code value 128) at about 21.6% linear light.
    const curve = tag(profile, 'rTRC');
    expect(curve.subarray(0, 4).toString('latin1')).toBe('curv');
    expect(curve.readUInt32BE(8)).toBe(1024);
    expect(curve.readUInt16BE(12 + 1023 * 2)).toBe(65535);
    expect(Math.abs(curve.readUInt16BE(12 + 514 * 2) / 65535 - 0.2165)).toBeLessThan(0.002);
  });

  it('writes the proof picture as IHDR, iCCP, IDAT and IEND, 1024 by 768, 8-bit RGB, each CRC right', () => {
    const file = png(PROOF_WIDTH, PROOF_HEIGHT, drawProof(), displayP3Profile());
    const list = chunks(file);
    const types = list.map((c) => c.type);
    expect(types[0]).toBe('IHDR');
    expect(types[1]).toBe('iCCP');
    expect(types.at(-1)).toBe('IEND');
    expect(new Set(types.slice(2, -1))).toEqual(new Set(['IDAT']));
    for (const c of list) expect(crc32(Buffer.concat([Buffer.from(c.type, 'latin1'), c.data]))).toBe(c.crc);
    const ihdr = list[0]?.data ?? Buffer.alloc(13);
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ...ihdr.subarray(8, 13)]).toEqual([1024, 768, 8, 2, 0, 0, 0]);
    // The iCCP's profile is the script's own, inflated whole.
    const iccp = list[1]?.data ?? Buffer.alloc(0);
    const nul = iccp.indexOf(0);
    expect(iccp.subarray(0, nul).toString('latin1')).toBe('Display P3');
    expect(iccp[nul + 1]).toBe(0);
    expect(inflateSync(iccp.subarray(nul + 2))).toEqual(displayP3Profile());
  });

  it('a known CRC: the IEND chunk every PNG ends with', () => {
    expect(crc32(Buffer.from('IEND', 'latin1'))).toBe(0xae426082);
  });

  it('the patch table matches the pixels: each patch flat, the gradient running from black to white', () => {
    const at = reader(png(PROOF_WIDTH, PROOF_HEIGHT, drawProof(), displayP3Profile()));
    for (const p of PROOF_PATCHES) {
      for (const [dx, dy] of [[0, 0], [p.w - 1, 0], [0, p.h - 1], [p.w - 1, p.h - 1], [p.w >> 1, p.h >> 1]] as const) {
        const f = dx / (p.w - 1);
        const want = p.left.map((v, i) => Math.round(v + ((p.right[i] ?? 0) - v) * f));
        expect(at(p.x + dx, p.y + dy)).toEqual(want);
      }
      // Just outside it, the ground.
      expect(at(p.x - 1, p.y)).toEqual([64, 64, 64]);
      expect(at(p.x, p.y + p.h)).toEqual([64, 64, 64]);
    }
    const byName = new Map(PROOF_PATCHES.map((p) => [p.name, p]));
    expect(byName.get('p3-red')?.left).toEqual([255, 0, 0]);
    expect(byName.get('p3-green')?.left).toEqual([0, 255, 0]);
    expect(byName.get('p3-blue')?.left).toEqual([0, 0, 255]);
    expect(byName.get('inside-srgb')?.left).toEqual([200, 120, 60]);
    expect(byName.get('mid-grey')?.left).toEqual([128, 128, 128]);
    for (const p of PROOF_PATCHES) expect(Math.min(p.w, p.h)).toBeGreaterThanOrEqual(128);
  });

  it('measures each patch inside its edges, with the drawing’s own means', () => {
    const regions = proofRegions();
    const byName = new Map(regions.map((r) => [r.name, r]));
    expect(byName.get('p3-red')).toEqual({ name: 'p3-red', x: 80, y: 112, w: 128, h: 128, drawn: [255, 0, 0] });
    expect(byName.get('inside-srgb')?.drawn).toEqual([200, 120, 60]);
    expect(regions.filter((r) => r.name.startsWith('grey-gradient-'))).toHaveLength(8);
    // The bands rise from dark to light.
    const bands = regions.filter((r) => r.name.startsWith('grey-gradient-')).map((r) => r.drawn[0]);
    expect([...bands].sort((a, b) => a - b)).toEqual(bands);
  });

  it('lists the pictures at their sizes: the proof 1024 by 768, then 12 and 48 MP', () => {
    expect(PICTURES.map((p) => [p.file, p.width, p.height])).toEqual([
      ['heic-proof.png', 1024, 768],
      ['heic-12mp.png', 4032, 3024],
      ['heic-48mp.png', 8064, 6048],
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanPicture } from '../src/core/media/cleanPicture';

// The six photos scripts/fixturePhotos.ts draws: what they carry is what our own clean keeps, so a test that imports one
// stores the very bytes it read, and each keeps the size and the profile the tests were written against.

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../${path}`, import.meta.url)));

const FILES: { path: string; width: number; height: number; curve: number }[] = [
  { path: 'e2e/fixtures/images/photo-a.jpg', width: 967, height: 523, curve: 1024 },
  { path: 'e2e/fixtures/images/photo-b.jpg', width: 967, height: 521, curve: 4096 },
  { path: 'prototype/uploads/small_LF7JADRW.jpg', width: 967, height: 523, curve: 1024 },
  { path: 'prototype/uploads/small_NVTE6ECR.jpg', width: 967, height: 521, curve: 4096 },
  { path: 'prototype/uploads/small_EE2UMJ1P.jpg', width: 967, height: 403, curve: 4096 },
  { path: 'prototype/uploads/small_KDGP7IMR.jpg', width: 967, height: 410, curve: 4096 },
];

const ascii = (bytes: Uint8Array, start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
const u16 = (bytes: Uint8Array, at: number): number => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u32 = (bytes: Uint8Array, at: number): number => u16(bytes, at) * 65536 + u16(bytes, at + 2);

/** Each block's marker and where its data starts and ends, up to the first scan. */
function blocks(bytes: Uint8Array): { marker: number; start: number; end: number }[] {
  const out: { marker: number; start: number; end: number }[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    const end = at + 2 + u16(bytes, at + 2);
    out.push({ marker, start: at + 4, end });
    if (marker === 0xda) break;
    at = end;
  }
  return out;
}

describe('the test photos the script draws', () => {
  it.each(FILES)('$path comes through our own clean unchanged', ({ path }) => {
    const bytes = read(path);
    expect(cleanPicture(bytes)).toEqual(bytes);
  });

  it.each(FILES)('$path is $width by $height, APP0 then one ICC profile of its own with a $curve-point curve', ({ path, width, height, curve }) => {
    const bytes = read(path);
    const list = blocks(bytes);
    const apps = list.filter((b) => b.marker >= 0xe0 && b.marker <= 0xef);
    expect(apps.map((b) => b.marker)).toEqual([0xe0, 0xe2]);
    expect(list.slice(0, 2).map((b) => b.marker)).toEqual([0xe0, 0xe2]);
    const sof = list.find((b) => b.marker === 0xc0);
    if (!sof) throw new Error('no baseline frame');
    expect([u16(bytes, sof.start + 3), u16(bytes, sof.start + 1)]).toEqual([width, height]);
    const icc = list[1];
    if (!icc) throw new Error('no profile');
    expect(ascii(bytes, icc.start, icc.start + 12)).toBe('ICC_PROFILE\0');
    expect([bytes[icc.start + 12], bytes[icc.start + 13]]).toEqual([1, 1]);
    const profile = bytes.subarray(icc.start + 14, icc.end);
    expect(u32(profile, 0)).toBe(profile.length);
    expect(ascii(profile, 36, 40)).toBe('acsp');
    expect(ascii(profile, 12, 24)).toBe('mntrRGB XYZ ');
    const text = ascii(profile, 0, profile.length);
    expect(text).toContain('Made by scripts/fixturePhotos.ts');
    const count = u32(profile, 128);
    const tags = new Map(Array.from({ length: count }, (_, i) => [ascii(profile, 132 + i * 12, 136 + i * 12), u32(profile, 136 + i * 12)] as const));
    expect([...tags.keys()].sort()).toEqual(['bTRC', 'bXYZ', 'cprt', 'desc', 'gTRC', 'gXYZ', 'rTRC', 'rXYZ', 'wtpt']);
    const trc = tags.get('rTRC') ?? 0;
    expect(ascii(profile, trc, trc + 4)).toBe('curv');
    expect(u32(profile, trc + 8)).toBe(curve);
  });

  it('keeps the prototype’s copies as copies, and the two test photos apart', () => {
    expect(read('prototype/uploads/small_LF7JADRW.jpg')).toEqual(read('e2e/fixtures/images/photo-a.jpg'));
    expect(read('prototype/uploads/small_NVTE6ECR.jpg')).toEqual(read('e2e/fixtures/images/photo-b.jpg'));
    expect(read('e2e/fixtures/images/photo-a.jpg')).not.toEqual(read('e2e/fixtures/images/photo-b.jpg'));
  });
});

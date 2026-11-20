import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { builtInPdf, builtInPng, builtInSource, PICTURE_RGB } from '../../../scripts/launchCheckBuiltIn';
import { accentCandidates } from '../../ui/theme/generator/generate';
import { LAUNCH_CHECK_LINE, LAUNCH_CHECK_PDF, LAUNCH_CHECK_PNG } from './builtIn';
import { fromBase64 } from './launchCheck';

// The launch check's own PDF and picture (6.27l): the committed constants are what scripts/launchCheckBuiltIn.ts
// makes, the PDF's text comes back as its line, and the picture offers an accent.

const root = join(import.meta.dirname, '../../..');

/** A PNG's RGBA pixels, for the script's own kind only: 8-bit RGB, not interlaced, every row unfiltered. */
function pngPixels(png: Uint8Array): { data: Uint8ClampedArray; width: number; height: number } {
  const bytes = Buffer.from(png);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8, 13)]).toEqual([8, 2, 0, 0, 0]);
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (width * 3 + 1)]).toBe(0);
    for (let x = 0; x < width; x += 1) {
      const from = y * (width * 3 + 1) + 1 + x * 3;
      rgba.set([raw[from] ?? 0, raw[from + 1] ?? 0, raw[from + 2] ?? 0, 255], (y * width + x) * 4);
    }
  }
  return { data: rgba, width, height };
}

describe('the launch check’s built-in PDF and picture', () => {
  it('are what the script makes, byte for byte, and the file is what it writes', async () => {
    expect(Buffer.from(fromBase64(LAUNCH_CHECK_PDF))).toEqual(Buffer.from(await builtInPdf()));
    expect(Buffer.from(fromBase64(LAUNCH_CHECK_PNG))).toEqual(Buffer.from(builtInPng()));
    const written = readFileSync(join(root, 'src/app/launchCheck/builtIn.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(written).toBe(await builtInSource());
  });

  it('the PDF is one page whose text is the line', async () => {
    const data = fromBase64(LAUNCH_CHECK_PDF);
    const pdf = await getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
    expect(pdf.numPages).toBe(1);
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toBe(LAUNCH_CHECK_LINE);
    expect(LAUNCH_CHECK_LINE).toBe('INT. LAUNCH CHECK - DAY');
    await pdf.destroy();
  });

  it('the picture is 16 × 16 of one saturated colour, and the accent reader finds an accent in it', () => {
    const { data, width, height } = pngPixels(fromBase64(LAUNCH_CHECK_PNG));
    expect([width, height]).toEqual([16, 16]);
    for (let i = 0; i < data.length; i += 4) expect([...data.subarray(i, i + 3)]).toEqual([...PICTURE_RGB]);
    const accents = accentCandidates(data, width, height);
    expect(accents.length).toBeGreaterThan(0);
  });
});

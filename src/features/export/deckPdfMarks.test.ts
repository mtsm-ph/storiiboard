import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { pageSize, type PageFormat, type PageOrientation } from '../moodboards/pageFormats';
import type { DisplayOp } from './deckDisplay';
import { escapedUri, writeDeckPdf, type DeckPdfInput, type FontLoader, type PictureLoader, type PrintPage } from './deckPdfWriter';

// More of the deck PDF writer (5.6a, review): the address in a link, pictures that can't be printed and Stop, characters a font lacks,
// letter spacing, the background, and the made bold and slant. Helpers as deckPdfWriter.test.ts.

const file = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const REGULAR = file('InterTight-Regular');
const MONO = file('JetBrainsMono-Regular');
const jpeg = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url)));

const loader =
  (extra: Readonly<Record<string, Uint8Array>> = {}): FontLoader =>
  (family) => {
    const bytes = extra[family] ?? (family === 'Inter Tight' ? REGULAR : family === 'JetBrains Mono' ? MONO : null);
    return Promise.resolve(bytes ? { key: family, bytes, synthBold: false, synthItalic: false } : null);
  };

const text = (words: string, y = 100, extra: Partial<Extract<DisplayOp, { op: 'text' }>> = {}): DisplayOp[] => [
  { op: 'save' },
  { op: 'concat', m: [1, 0, 0, 1, 100, y] },
  { op: 'text', lines: [{ text: words, baseline: 20 }], align: 'left', padding: 0, width: 600, family: 'Inter Tight', weight: 400, italic: false, size: 24, fill: '#16150F', letterSpacing: 0, ...extra },
  { op: 'restore' },
];

function page(ops: readonly DisplayOp[] = [], format: PageFormat = '16:9', orientation: PageOrientation = 'portrait'): PrintPage {
  return { format, orientation, ...pageSize(format, orientation), background: '#FFFFFF', ops };
}

const build = (pages: readonly PrintPage[], rest: Partial<DeckPdfInput> = {}) =>
  writeDeckPdf({ title: 'Pitch deck', pageCount: pages.length, page: (i) => Promise.resolve(pages[i] ?? page()), fonts: loader(), pictures: () => Promise.resolve(null), watermark: null, ...rest });

/** Every page's content stream, decoded, as text. */
async function contentOf(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Type')) || object.dict.get(PDFName.of('Subtype'))) continue;
    const decoded = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
    if (decoded.includes(' cm\n')) parts.push(decoded);
  }
  return parts.join('\n');
}

async function readText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    out.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  await pdf.destroy();
  return out;
}

describe('an address in a link', () => {
  const link = (url: string): DisplayOp[] => [{ op: 'link', url, width: 400, height: 80 }];

  it('has its parentheses and backslashes written as percent codes, and anything past printable ASCII as UTF-8', () => {
    expect(escapedUri('https://example.com/a)b(c')).toBe('https://example.com/a%29b%28c');
    expect(escapedUri('https://example.com/a\\b')).toBe('https://example.com/a%5Cb');
    expect(escapedUri('https://example.com/café')).toBe('https://example.com/caf%C3%A9');
    expect(escapedUri('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(escapedUri('https://example.com/plain?q=1&r=2#top')).toBe('https://example.com/plain?q=1&r=2#top');
  });

  it('round-trips through a reader with an unbalanced ")" as the address it was, and makes no action of its own', async () => {
    const result = await build([page(link('https://example.com/x)/S/JavaScript/JS(alert(1)'))]);
    const pdf = await getDocument({ data: result.bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const found = (await (await pdf.getPage(1)).getAnnotations()) as { subtype: string; url?: string }[];
    await pdf.destroy();
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toBe('https://example.com/x%29/S/JavaScript/JS%28alert%281%29');
    // Parsed as a file, not searched as text: no dictionary has a JS entry, and no action is a JavaScript one.
    const doc = await PDFDocument.load(result.bytes);
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      expect(object.get(PDFName.of('JS'))).toBeUndefined();
      expect(object.get(PDFName.of('S'))).not.toBe(PDFName.of('JavaScript'));
    }
  });
});

describe('pictures that cannot be printed', () => {
  const picture = (sha: string): DisplayOp[] => [{ op: 'image', sha256: sha, width: 960, height: 540 }];
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);

  it('are counted: a loader with nothing, bytes that will not embed, and a picture that does not say which it is', async () => {
    expect((await build([page(picture(A))])).unprintable).toBe(1);
    const broken = await build([page([...picture(A), ...picture(B)])], {
      pictures: (sha) => Promise.resolve({ bytes: sha === A ? new Uint8Array([1, 2, 3]) : jpeg, kind: 'jpeg', original: true }),
    });
    expect(broken.unprintable).toBe(1);
    expect((await build([page(picture(''))])).unprintable).toBe(1);
    // The same picture twice is one picture.
    expect((await build([page([...picture(A), ...picture(A)])])).unprintable).toBe(1);
    expect((await build([page(picture(A))], { pictures: () => Promise.resolve({ bytes: jpeg, kind: 'jpeg', original: true }) })).unprintable).toBe(0);
  });

  it('stop being read when Stop is pressed: no picture is asked for after it, and the loader is told', async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const seen: (AbortSignal | undefined)[] = [];
    const pictures: PictureLoader = (sha, _edge, signal) => {
      asked.push(sha);
      seen.push(signal);
      controller.abort();
      return Promise.resolve({ bytes: jpeg, kind: 'jpeg', original: true });
    };
    await expect(build([page([...picture(A), ...picture(B), ...picture(C)])], { signal: controller.signal, pictures })).rejects.toThrow();
    expect(asked).toEqual([A]);
    expect(seen[0]).toBe(controller.signal);
  });
});

describe('characters a font does not have', () => {
  const inter = fontkit.create(REGULAR) as unknown as { characterSet: number[] };
  const mono = fontkit.create(MONO) as unknown as { characterSet: number[] };
  const monoSet = new Set(mono.characterSet);
  /** A character Inter Tight has and JetBrains Mono does not. */
  const onlyInter = String.fromCodePoint(inter.characterSet.find((cp) => cp > 0x7f && !monoSet.has(cp)) ?? 0x41);

  it('are set in Inter Tight when it has them, in runs, with no notice', async () => {
    expect(onlyInter).not.toBe('A');
    const word = `A${onlyInter}B`;
    const result = await build([page(text(word, 100, { family: 'Brand Mono' }))], { fonts: loader({ 'Brand Mono': MONO }) });
    expect(result.fontNotes).toEqual([]);
    expect(await readText(result.bytes)).toEqual([word]);
    // Three runs in two fonts: the mono, Inter Tight for the one, the mono again.
    expect((await contentOf(result.bytes)).match(/ Tf/g)).toHaveLength(3);
  });

  it('stay as the font’s own empty box where no font has them, and the font is named', async () => {
    const result = await build([page(text('A中B', 100, { family: 'Brand Mono' }))], { fonts: loader({ 'Brand Mono': MONO }) });
    expect(result.fontNotes).toEqual([{ family: 'Brand Mono', reason: 'glyphs' }]);
  });
});

describe('the text’s own marks', () => {
  it('space letters one fewer time than there are letters, as the canvas does: a right-aligned line ends at the edge', async () => {
    const result = await build([page(text('', 0, { lines: [{ text: 'Spaced', baseline: 20 }], align: 'right', width: 400, letterSpacing: 10 }))]);
    const pdf = await getDocument({ data: result.bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const item = (await (await pdf.getPage(1)).getTextContent()).items[0];
    await pdf.destroy();
    const measuring = await PDFDocument.create();
    measuring.registerFontkit(fontkit);
    const width = (await measuring.embedFont(REGULAR)).widthOfTextAtSize('Spaced', 24) + 10 * 5;
    expect(item && 'transform' in item ? Number(item.transform[4]) : null).toBeCloseTo((100 + 400 - width) / 2, 3);
  });

  it('fill the page’s background in points before the units are set, so it meets the paper’s edge', async () => {
    const content = await contentOf((await build([{ ...page([], 'a4', 'landscape'), background: '#FFE97A' }])).bytes);
    const fillAt = content.indexOf('0 0 841.89 595.28 re');
    expect(fillAt).toBeGreaterThanOrEqual(0);
    expect(fillAt).toBeLessThan(content.indexOf(' cm\n'));
  });

  it('make bold and italic by an outline and a slant where the file has neither: the content says so', async () => {
    const synthetic: FontLoader = () => Promise.resolve({ key: 'it', bytes: REGULAR, synthBold: true, synthItalic: true });
    const made = await contentOf((await build([page(text('Made', 100, { weight: 700, italic: true }))], { fonts: synthetic })).bytes);
    expect(made).toMatch(/\n2 Tr\n/);
    expect(made).toMatch(/\n1 0 0\.2 -1 /);
    const plain = await contentOf((await build([page(text('Plain'))])).bytes);
    expect(plain).not.toMatch(/\n2 Tr\n/);
    expect(plain).not.toMatch(/\n1 0 0\.2 -1 /);
    expect(plain).toMatch(/\n1 0 0 -1 /);
  });
});

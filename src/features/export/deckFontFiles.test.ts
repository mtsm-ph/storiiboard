import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUNDLED } from '../moodboards/fonts';
import { pageSize } from '../moodboards/pageFormats';
import type { DisplayOp } from './deckDisplay';
import { deckFontLoader } from './deckFonts';
import { embedRule, fsTypeOfFont } from './deckFontRules';
import { writeDeckPdf } from './deckPdfWriter';

// 5.10: every bundled family prints at every weight a board can give it, from the publishers' static files in ./fonts. The loader
// resolves each one, the files are what they say, a deck page embeds each under its own family and weight, and the README lists
// every file's SHA-256 so a file can't change unnoticed.

const FOLDER = new URL('./fonts/', import.meta.url);
const ROOT = new URL('../../../', import.meta.url);

interface Parsed {
  familyName: string;
  postscriptName: string;
  unitsPerEm: number;
  name: { records: Record<string, Record<string, string> | undefined> };
  'OS/2': { usWeightClass: number; usWidthClass: number };
  directory: { tables: Record<string, unknown> };
  loca: { offsets: number[] };
  variationAxes: Record<string, { min: number; default: number; max: number }>;
  getVariation: (settings: Record<string, number>) => Parsed;
  glyphsForString: (text: string) => { advanceWidth: number }[];
  hasGlyphForCodePoint: (codePoint: number) => boolean;
}
const parse = (bytes: Uint8Array) => fontkit.create(bytes) as unknown as Parsed;

// Vite's `?url` import gives a path under the project; under Vitest the file is read from disk instead of fetched.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const path = decodeURIComponent(url.split('?')[0] ?? '').replace(/^\/@fs\//, '').replace(/^\//, '');
    const file = readFileSync(path.includes(':') ? path : new URL(path, ROOT));
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) });
  });
});
afterAll(() => {
  vi.stubGlobal('fetch', realFetch);
});

/** The variable files the canvas draws from (src/ui/fonts), by family: upright, then italic. */
const VARIABLE: Readonly<Record<string, readonly [string, string]>> = {
  'Inter Tight': ['intertight/InterTight[wght].ttf', 'intertight/InterTight-Italic[wght].ttf'],
  'JetBrains Mono': ['jetbrainsmono/JetBrainsMono[wght].ttf', 'jetbrainsmono/JetBrainsMono-Italic[wght].ttf'],
  Archivo: ['archivo/Archivo[wdth,wght].ttf', 'archivo/Archivo-Italic[wdth,wght].ttf'],
  'Bodoni Moda': ['bodonimoda/BodoniModa[opsz,wght].ttf', 'bodonimoda/BodoniModa-Italic[opsz,wght].ttf'],
  Jost: ['jost/Jost[wght].ttf', 'jost/Jost-Italic[wght].ttf'],
  Outfit: ['outfit/Outfit[wght].ttf', 'outfit/Outfit[wght].ttf'],
};
const variable = (family: string, italic: boolean): Parsed => {
  const path = VARIABLE[family]?.[italic ? 1 : 0] ?? '';
  return parse(new Uint8Array(readFileSync(new URL(`../../ui/fonts/${path}`, import.meta.url))));
};

const weightsOf = ([low, high]: readonly [number, number]) => Array.from({ length: (high - low) / 100 + 1 }, (_, i) => low + i * 100);

describe('the static files of every bundled family', () => {
  const cases = BUNDLED.flatMap((font) =>
    weightsOf(font.weights).flatMap((weight) => [
      { family: font.name, weight, italic: false, hasItalic: font.italic },
      ...(font.italic ? [{ family: font.name, weight, italic: true, hasItalic: true }] : []),
    ]),
  );

  it.each(cases)('$family $weight (italic: $italic) is that family at that weight, static, with even glyphs and embedding allowed', async ({ family, weight, italic }) => {
    const file = await deckFontLoader(family, weight, italic);
    expect(file, `${family} ${String(weight)} has no file`).not.toBeNull();
    if (!file) return;
    const font = parse(file.bytes);
    // The name table says exactly the family: the preferred family (name ID 16), else the family (ID 1), which for a style-linked
    // file is the family alone. The one spelling allowed besides is Jost's own, "Jost*".
    const named = font.name.records.preferredFamily?.en ?? font.name.records.fontFamily?.en;
    expect(named, font.postscriptName).toBe(family === 'Jost' ? 'Jost*' : family);
    // Normal width: no condensed or expanded file stands in for the family.
    expect(font['OS/2'].usWidthClass).toBe(5);
    expect(font['OS/2'].usWeightClass).toBe(weight);
    expect(/Italic$/.test(font.postscriptName), font.postscriptName).toBe(italic);
    // A static file: no variation table. Even-length glyphs, which pdf-lib's subsetter needs.
    expect('fvar' in font.directory.tables).toBe(false);
    const { offsets } = font.loca;
    for (let i = 1; i < offsets.length; i += 1) expect(((offsets[i] ?? 0) - (offsets[i - 1] ?? 0)) % 2, `${font.postscriptName} glyph ${String(i - 1)}`).toBe(0);
    expect(embedRule(fsTypeOfFont(file.bytes))).toEqual({ embed: true, subset: true });
    // The bold is never made; the slant only where the family has no italic.
    expect(file.synthBold).toBe(false);
    expect(file.synthItalic).toBe(false);
  });

  // The PDF prints with the same widths the canvas laid the text out in: a static file's advances match the variable file's at that weight.
  const SAMPLE = 'The quick brown fox jumps over the lazy dog 0123456789 ÁÉÍÓÚÑÜáéíóúñü';
  it.each(cases)('$family $weight (italic: $italic) has the advance widths of the variable font the canvas draws, within 0.1%', async ({ family, weight, italic }) => {
    const file = await deckFontLoader(family, weight, italic);
    if (!file) throw new Error(`${family} ${String(weight)} has no file`);
    const fixed = parse(file.bytes);
    // Archivo at the width the canvas draws (wdth 100); Bodoni Moda at its default optical size, which the statics are.
    const settings: Record<string, number> = { wght: weight, ...(family === 'Archivo' ? { wdth: 100 } : {}) };
    const drawn = variable(family, italic).getVariation(settings);
    // The glyphs' own advances, with no kerning: fontkit's kerning of a variable font is not reliable (for Outfit it reads 0.1 to
    // 0.35% off a static file at weights 200 to 900, where Chromium's canvas measures static and variable within 0.005%), so what
    // is compared is what it gets right.
    const em = (font: Parsed) => font.glyphsForString(SAMPLE).reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / font.unitsPerEm;
    const staticWidth = em(fixed);
    const canvasWidth = em(drawn);
    expect(Math.abs(staticWidth / canvasWidth - 1), `${family} ${String(weight)}: static ${String(staticWidth)} em, variable ${String(canvasWidth)} em`).toBeLessThanOrEqual(0.001);
  });

  it('keeps the two defaults the parity above rests on: Bodoni Moda’s optical size 11 and Archivo’s width 100', () => {
    expect(variable('Bodoni Moda', false).variationAxes.opsz?.default).toBe(11);
    expect(variable('Bodoni Moda', true).variationAxes.opsz?.default).toBe(11);
    expect(variable('Archivo', false).variationAxes.wdth?.default).toBe(100);
    expect(variable('Archivo', true).variationAxes.wdth?.default).toBe(100);
  });

  // The storyboard PDF prints the status shapes in JetBrains Mono Regular, and Spanish in Inter Tight and JetBrains Mono.
  it('has the status shapes ■ □ ◩ in JetBrains Mono, and Spanish’s letters in Inter Tight and JetBrains Mono', async () => {
    const mono = parse((await deckFontLoader('JetBrains Mono', 400, false))?.bytes ?? new Uint8Array());
    const sans = parse((await deckFontLoader('Inter Tight', 400, false))?.bytes ?? new Uint8Array());
    for (const shape of [0x25a0, 0x25a1, 0x25e9]) expect(mono.hasGlyphForCodePoint(shape), shape.toString(16)).toBe(true);
    for (const [name, font] of [['JetBrains Mono', mono], ['Inter Tight', sans]] as const) {
      for (const letter of 'ÁÉÍÓÚÑÜáéíóúñü¿¡') expect(font.hasGlyphForCodePoint(letter.codePointAt(0) ?? 0), `${name} ${letter}`).toBe(true);
    }
  });

  it('has Outfit’s slant made from its upright file, as it has no italic', async () => {
    const outfit = BUNDLED.find((font) => font.name === 'Outfit');
    expect(outfit?.italic).toBe(false);
    const upright = await deckFontLoader('Outfit', 700, false);
    const slanted = await deckFontLoader('Outfit', 700, true);
    expect(slanted?.key).toBe(upright?.key);
    expect(slanted?.synthItalic).toBe(true);
    expect(upright?.synthItalic).toBe(false);
  });

  it('covers every family in BUNDLED, so one added without its files fails here', () => {
    expect(BUNDLED.map((font) => font.name).sort()).toEqual(['Archivo', 'Bodoni Moda', 'Inter Tight', 'JetBrains Mono', 'Jost', 'Outfit']);
  });
});

describe('a deck page set in several bundled families', () => {
  const text = (words: string, y: number, family: string, weight: number, italic = false): DisplayOp[] => [
    { op: 'save' },
    { op: 'concat', m: [1, 0, 0, 1, 100, y] },
    { op: 'text', lines: [{ text: words, baseline: 20 }], align: 'left', padding: 0, width: 600, family, weight, italic, size: 24, fill: '#16150F', letterSpacing: 0 },
    { op: 'restore' },
  ];
  const ops = [
    ...text('Outfit', 100, 'Outfit', 700),
    ...text('Archivo', 200, 'Archivo', 300, true),
    ...text('Bodoni', 300, 'Bodoni Moda', 900),
    ...text('Jost', 400, 'Jost', 200),
    ...text('Inter', 500, 'Inter Tight', 800),
    ...text('Slant', 600, 'Outfit', 700, true),
  ];

  /** The names of the fonts a PDF embeds, without pdf-lib's random number after the PostScript name. */
  async function embeddedNames(bytes: Uint8Array): Promise<string[]> {
    const pdf = await PDFDocument.load(bytes);
    const names: string[] = [];
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      const base = object instanceof PDFDict ? object.get(PDFName.of('BaseFont')) : undefined;
      if (base instanceof PDFName) names.push(base.decodeText().replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''));
    }
    return names;
  }

  it('embeds each under its own family and weight, with no notice, and makes only Outfit’s slant', async () => {
    const pages = [{ format: '16:9' as const, orientation: 'portrait' as const, ...pageSize('16:9', 'portrait'), background: '#FFFFFF', ops }];
    const result = await writeDeckPdf({ title: 'Deck', pageCount: 1, page: (i) => Promise.resolve(pages[i] ?? pages[0] ?? { format: '16:9', orientation: 'portrait', width: 1, height: 1, background: '#FFFFFF', ops: [] }), fonts: deckFontLoader, pictures: () => Promise.resolve(null), watermark: null });
    expect(result.fontNotes).toEqual([]);
    const names = new Set(await embeddedNames(result.bytes));
    // Jost's publisher calls its 200 "Thin" and its 100 "Hairline": the PostScript name is the publisher's.
    for (const expected of ['Outfit-Bold', 'Archivo-LightItalic', 'BodoniModa-Black', 'Jost-Thin', 'InterTight-ExtraBold']) expect(names.has(expected), `${expected} in ${[...names].join(', ')}`).toBe(true);
    // Nothing else was embedded: no Inter Tight in place of a bundled family (only the 800 asked for).
    expect([...names].filter((name) => name.startsWith('InterTight'))).toEqual(['InterTight-ExtraBold']);
    // The one slanted line of Outfit is made, by the skew; no other line is.
    const content: string[] = [];
    const pdf = await PDFDocument.load(result.bytes);
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Type')) || object.dict.get(PDFName.of('Subtype'))) continue;
      const decoded = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
      if (decoded.includes(' cm\n')) content.push(decoded);
    }
    const stream = content.join('\n');
    expect(stream.match(/\n1 0 0\.2 -1 /g)).toHaveLength(1);
    expect(stream).not.toMatch(/\n2 Tr\n/);
  });
});

describe('the README of the static fonts', () => {
  const readme = readFileSync(new URL('README.md', FOLDER), 'utf8');
  const rows = [...readme.matchAll(/^\| (\S+\.ttf) \| ([0-9a-f]{64}) \|$/gm)];
  const listed = new Map(rows.map((m) => [m[1] ?? '', m[2] ?? '']));
  const files = readdirSync(FOLDER).filter((name) => name.endsWith('.ttf'));

  it('lists every font file in the folder once, and no file that is not there', () => {
    expect(files.length).toBeGreaterThan(0);
    // A file named twice is a duplicate row, which the Map would hide.
    expect(rows.length).toBe(listed.size);
    expect([...listed.keys()].sort()).toEqual([...files].sort());
  });

  it('gives each file’s SHA-256, and it matches', () => {
    for (const name of files) expect(createHash('sha256').update(readFileSync(new URL(name, FOLDER))).digest('hex'), name).toBe(listed.get(name));
  });

  it('keeps the OFL text of every family beside its files', () => {
    for (const licence of ['Outfit', 'Archivo', 'Jost', 'BodoniModa', 'InterTight', 'JetBrainsMono']) {
      const text = readFileSync(new URL(`OFL-${licence}.txt`, FOLDER), 'utf8');
      expect(text, licence).toMatch(/SIL Open Font License, Version 1\.1/i);
      expect(readme).toContain(`OFL-${licence}.txt`);
    }
  });
});

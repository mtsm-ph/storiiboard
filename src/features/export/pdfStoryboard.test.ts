import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { frameBox, localDate, MARGIN, PAGE, storyboardPdf, watermarkPlacement, wrap, type PdfFonts } from './pdfStoryboard';
import { watermarkOutline } from './renderFrame';
import { scenesIn } from './scope';
import type { Watermark, WatermarkPosition } from './watermark';

const font = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const fonts: PdfFonts = {
  sans: font('InterTight-Regular'),
  sansSemiBold: font('InterTight-SemiBold'),
  sansBold: font('InterTight-Bold'),
  mono: font('JetBrainsMono-Regular'),
  monoBold: font('JetBrainsMono-Bold'),
};
const jpeg = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url)));

/** Each page's text, as a PDF reader finds it: what an editor searching the file for "4B" would see. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
  }
  await pdf.destroy();
  return texts;
}

interface PlacedText {
  str: string;
  x: number;
  y: number;
}

/** A page's text items with where each starts, in PDF points (y up from the foot). */
async function pageItems(bytes: Uint8Array, n = 1): Promise<PlacedText[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const content = await (await pdf.getPage(n)).getTextContent();
  const items = content.items.flatMap((item): PlacedText[] =>
    'str' in item ? [{ str: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]) }] : [],
  );
  await pdf.destroy();
  return items;
}

/** The fonts as pdf-lib measures them, for the layout's own functions. */
async function measured(): Promise<{ sans: PDFFont; semi: PDFFont }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // SemiBold: the watermark's weight, as the PNG frames' 600 (renderFrame.ts).
  return { sans: await doc.embedFont(fonts.sans), semi: await doc.embedFont(fonts.sansSemiBold) };
}

describe('wrap', () => {
  it('fills lines word by word, and ends the last with … when the text runs on', async () => {
    const { sans } = await measured();
    const width = sans.widthOfTextAtSize('Mary wipes the', 8);
    expect(wrap('Mary wipes the counter.', sans, 8, width, 3)).toEqual(['Mary wipes the', 'counter.']);
    const cut = wrap('Mary wipes the counter. Jay comes in from the rain.', sans, 8, width, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]?.endsWith('…')).toBe(true);
    for (const line of cut) expect(sans.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(width);
    expect(wrap('', sans, 8, width, 3)).toEqual([]);
  });

  it('cuts a word wider than the line where it reaches the edge, rather than run over the next frame', async () => {
    const { sans } = await measured();
    const width = 60;
    const url = 'https://drive.example.com/bey-county/references/diner-night-wide.jpg';
    const lines = wrap(`See ${url}`, sans, 8, width, 3);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(sans.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(width);
    expect(lines[0]).toBe('See');
    expect(lines[2]?.endsWith('…')).toBe(true);
    // All of it, given room: the pieces put back together are the word.
    const whole = wrap(url, sans, 8, width, 20);
    expect(whole.join('')).toBe(url);
    for (const line of whole) expect(sans.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(width);
  });
});

describe('the PDF watermark', () => {
  const stamp = (text: string, position: WatermarkPosition): Watermark => ({ text, position, opacity: 0.3, appliesTo: ['pdf'] });

  /** The four corners of the text's box as drawn: from its baseline's start, turned by its angle. */
  function corners(font: PDFFont, text: string, at: { x: number; y: number; size: number; angle: number }) {
    const width = font.widthOfTextAtSize(text, at.size);
    const ascent = font.heightAtSize(at.size, { descender: false });
    const descent = font.heightAtSize(at.size) - ascent;
    const turn = (at.angle * Math.PI) / 180;
    return [
      [0, -descent],
      [width, -descent],
      [width, ascent],
      [0, ascent],
    ].map(([u = 0, v = 0]) => ({ x: at.x + u * Math.cos(turn) - v * Math.sin(turn), y: at.y + u * Math.sin(turn) + v * Math.cos(turn) }));
  }

  const long = 'CONFIDENTIAL — NOT FOR DISTRIBUTION — BEY COUNTY CLIENT CUT 3 — PROPERTY OF THE PRODUCTION';

  it('centred, turns about its own middle onto the page’s, and shrinks until it fits inside the margins', async () => {
    const { semi } = await measured();
    for (const text of ['DRAFT', long]) {
      const at = watermarkPlacement(stamp(text, 'center'), semi);
      expect(at.angle).toBe(15);
      const box = corners(semi, text, at);
      const middle = { x: box.reduce((n, c) => n + c.x, 0) / 4, y: box.reduce((n, c) => n + c.y, 0) / 4 };
      expect(middle.x).toBeCloseTo(PAGE.width / 2, 3);
      expect(middle.y).toBeCloseTo(PAGE.height / 2, 3);
      for (const c of box) {
        expect(c.x).toBeGreaterThanOrEqual(MARGIN - 0.01);
        expect(c.x).toBeLessThanOrEqual(PAGE.width - MARGIN + 0.01);
        expect(c.y).toBeGreaterThanOrEqual(MARGIN - 0.01);
        expect(c.y).toBeLessThanOrEqual(PAGE.height - MARGIN + 0.01);
      }
    }
    expect(watermarkPlacement(stamp('DRAFT', 'center'), semi).size).toBe(48);
  });

  it('in a corner, sits clear of the header and the footer, and shrinks to fit between the margins', async () => {
    const { semi } = await measured();
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      for (const text of ['DRAFT', long]) {
        const box = corners(semi, text, watermarkPlacement(stamp(text, position), semi));
        for (const c of box) {
          expect(c.x).toBeGreaterThanOrEqual(MARGIN - 0.01);
          expect(c.x).toBeLessThanOrEqual(PAGE.width - MARGIN + 0.01);
          expect(c.y).toBeGreaterThan(0);
          expect(c.y).toBeLessThan(PAGE.height);
        }
        const lowest = Math.min(...box.map((c) => c.y));
        const highest = Math.max(...box.map((c) => c.y));
        // Top: in the margin, over the title, which stands under it. Bottom: over the date and the page number,
        // whose 8pt type stands on MARGIN - 4, and under the frames' band.
        if (position.startsWith('top')) expect(lowest).toBeGreaterThanOrEqual(PAGE.height - MARGIN - 0.01);
        else {
          expect(lowest).toBeGreaterThan(MARGIN - 4 + 6);
          expect(highest).toBeLessThanOrEqual(MARGIN + 18 + 0.01);
        }
      }
    }
  });
});

describe('the PDF storyboard’s date', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('is the day on this computer’s calendar, not in UTC', () => {
    // 10:30 pm in New York on Nov 3 is already Nov 4 in UTC.
    process.env.TZ = 'America/New_York';
    expect(localDate(new Date('2026-11-04T02:30:00Z'))).toBe('2026-11-03');
    process.env.TZ = 'Asia/Tokyo';
    expect(localDate(new Date('2026-11-03T16:00:00Z'))).toBe('2026-11-04');
  });
});

describe('the PDF storyboard', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  async function scene(id: string, number: string, shots: number) {
    await store.getState().apply([
      {
        kind: 'create',
        record: {
          id,
          type: 'scene',
          parentId: project.projectId,
          sortKey: number.padStart(4, '0'),
          props: { number, name: 'Diner', int_ext: 'INT', day_night: 'NIGHT', page_eighths: 11 },
        },
      },
    ]);
    const ids: string[] = [];
    for (let i = 0; i < shots; i += 1) {
      const added = addShot(store.getState().records, project.projectId, id);
      await store.getState().apply(added.changes);
      ids.push(added.shotId);
    }
    return ids;
  }

  it('is searchable text: headings, shot numbers as on the slate, specs, action and page numbers', async () => {
    const [first = ''] = await scene('sc4', '4', 7);
    await scene('sc5', '5', 1);
    await store.getState().apply([
      { kind: 'update', id: first, set: { size: 'MCU', lens_mm: 35, t_stop: 2.8, status: 'have', action: 'Mary wipes the counter.', dialogue: 'We’re closed.' } },
    ]);
    const scenes = scenesIn(store.getState().records, project.projectId, { kind: 'project' });
    const asked: string[] = [];
    const { bytes, missing } = await storyboardPdf({
      title: 'Bey County',
      scenes,
      aspect: 16 / 9,
      watermark: null,
      fonts,
      // One frame that couldn't be drawn still gets its box and caption.
      frame: (sceneIndex, shotIndex) => {
        asked.push(`${String(sceneIndex)}:${String(shotIndex)}`);
        return Promise.resolve(sceneIndex === 0 && shotIndex === 1 ? null : { jpeg });
      },
      now: new Date('2026-11-03T12:00:00Z'),
    });
    expect(missing).toEqual(['4B']);

    expect(asked).toHaveLength(8);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Bey County storyboard');
    // Two rows of three fit a page under the heading, so scene 4's third row and scene 5 go on page two.
    const [one = '', two = ''] = await pageTexts(bytes);
    expect(pdf.getPageCount()).toBe(2);
    for (const text of ['Bey County', 'STORYBOARD', 'SC 04', 'INT. DINER — NIGHT', '1 3/8 pg', '4A', 'MCU · 35MM · T2.8', 'Have', 'Mary wipes the counter.', '“We’re closed.”', '4F', '1 / 2', '2026-11-03']) {
      expect(one).toContain(text);
    }
    expect(one).not.toContain('4G');
    expect(two).toContain('INT. DINER — NIGHT (continued)');
    for (const text of ['4G', 'SC 05', '5A', '2 / 2']) expect(two).toContain(text);
  });

  it('stamps the watermark on every page', async () => {
    await scene('sc4', '4', 7);
    const { bytes } = await storyboardPdf({
      title: 'Bey County',
      scenes: scenesIn(store.getState().records, project.projectId, { kind: 'project' }),
      aspect: 2.39,
      watermark: { text: 'DRAFT', position: 'center', opacity: 0.3, appliesTo: ['pdf'] },
      fonts,
      frame: () => Promise.resolve({ jpeg }),
    });
    const texts = await pageTexts(bytes);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toContain('DRAFT');
  });

  it('draws the watermark over the pictures, ink with a paper outline at its strength, as the PNG frames do', async () => {
    await scene('sc4', '4', 3);
    const watermark: Watermark = { text: 'DRAFT', position: 'center', opacity: 0.3, appliesTo: ['pdf'] };
    const { bytes } = await storyboardPdf({
      title: 'Bey County',
      scenes: scenesIn(store.getState().records, project.projectId, { kind: 'project' }),
      aspect: 16 / 9,
      watermark,
      fonts,
      frame: () => Promise.resolve({ jpeg }),
    });
    const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const { fnArray, argsArray } = await (await pdf.getPage(1)).getOperatorList();
    await pdf.destroy();
    const args = (i: number) => argsArray[i] as unknown[];
    const lastPicture = fnArray.lastIndexOf(OPS.paintImageXObject);
    const outline = fnArray.findIndex((fn, i) => fn === OPS.setTextRenderingMode && args(i)[0] === 1);
    expect(lastPicture).toBeGreaterThan(-1);
    expect(outline).toBeGreaterThan(lastPicture);
    // The outline's pass: its strength, colour and width set from the pass's save, then one showText; then the fill,
    // in ink, after it.
    const save = fnArray.lastIndexOf(OPS.save, outline);
    const outlineText = fnArray.indexOf(OPS.showText, outline);
    const fill = fnArray.indexOf(OPS.showText, outlineText + 1);
    const pass = (op: number) => {
      const i = fnArray.indexOf(op, save);
      expect(i, `op ${String(op)} in the outline's pass`).toBeGreaterThan(save);
      expect(i).toBeLessThan(outlineText);
      return args(i);
    };
    expect(String(pass(OPS.setStrokeRGBColor)[0])).toMatch(/^#?(ffffff|255,255,255)$/i);
    const { semi } = await measured();
    expect(Number(pass(OPS.setLineWidth)[0])).toBeCloseTo(watermarkOutline(watermarkPlacement(watermark, semi).size), 3);
    expect(pass(OPS.setGState)[0]).toEqual(expect.arrayContaining([['CA', 0.3]]));
    expect(fill).toBeGreaterThan(outlineText);
    expect(String(args(fnArray.lastIndexOf(OPS.setFillRGBColor, fill))[0])).toBe('#16150f');
    expect(fnArray.slice(outlineText + 1, fill).filter((fn) => fn === OPS.setTextRenderingMode)).toHaveLength(0);
  });

  it('is one page with its header when there are no frames', async () => {
    const { bytes } = await storyboardPdf({ title: 'Bey County', scenes: [], aspect: 16 / 9, watermark: null, fonts, frame: () => Promise.resolve(null) });
    const [one = ''] = await pageTexts(bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(one).toContain('Bey County');
    expect(one).toContain('1 / 1');
  });

  const board = (aspect = 16 / 9) => ({
    title: 'Bey County',
    scenes: scenesIn(store.getState().records, project.projectId, { kind: 'project' }),
    aspect,
    watermark: null,
    fonts,
    frame: () => Promise.resolve({ jpeg }),
  });

  it('fits a 9:16 row under its heading, so a tall board pages as a wide one does', async () => {
    await scene('sc4', '4', 6);
    const box = frameBox(9 / 16);
    expect(box.width / box.height).toBeCloseTo(9 / 16, 6);
    const { bytes } = await storyboardPdf(board(9 / 16));
    // A row a page: SC 04's heading with its first row, then the second carried on; never a heading on its own.
    const texts = await pageTexts(bytes);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('4A');
    expect(texts[0]).not.toContain('(continued)');
    expect(texts[1]).toContain('INT. DINER — NIGHT (continued)');
    expect(texts[1]).toContain('4D');
    // And every caption stays above the footer's band.
    for (const n of [1, 2]) {
      const items = (await pageItems(bytes, n)).filter((i) => i.str.trim() !== '' && !/^\d+ \/ \d+$|^\d{4}-\d{2}-\d{2}$/.test(i.str));
      expect(Math.min(...items.map((i) => i.y))).toBeGreaterThan(MARGIN + 18);
    }
  });

  it('never leaves a scene’s heading alone at the foot of a page', async () => {
    // Two rows of SC 04 fill page one: SC 05's heading would fit under them, its frames wouldn't.
    await scene('sc4', '4', 6);
    await scene('sc5', '5', 2);
    const [one = '', two = ''] = await pageTexts((await storyboardPdf(board())).bytes);
    expect(one).toContain('4F');
    expect(one).not.toContain('SC 05');
    expect(two).toContain('SC 05');
    expect(two).toContain('5A');
  });

  it('puts a top-corner watermark in the margin above the header, clear of the first row', async () => {
    await scene('sc4', '4', 3);
    const { bytes } = await storyboardPdf({ ...board(), watermark: { text: 'DRAFT', position: 'top-left', opacity: 0.3, appliesTo: ['pdf'] } });
    const items = await pageItems(bytes);
    const draft = items.find((i) => i.str === 'DRAFT');
    const title = items.find((i) => i.str === 'Bey County');
    if (!draft || !title) throw new Error('no watermark or title');
    expect(draft.x).toBeCloseTo(MARGIN, 3);
    expect(draft.y).toBeGreaterThan(title.y + 14);
  });

  it('prints status as the board’s shapes, and STORYBOARD tracked as the kit’s labels are', async () => {
    const [have = '', need = '', source = ''] = await scene('sc4', '4', 3);
    await store.getState().apply([
      { kind: 'update', id: have, set: { status: 'have' } },
      { kind: 'update', id: need, set: { status: 'need' } },
      { kind: 'update', id: source, set: { status: 'source' } },
    ]);
    const { bytes } = await storyboardPdf(board());
    const [one = ''] = await pageTexts(bytes);
    for (const text of ['■', 'Have', '□', 'Need to shoot', '◩', 'Source', 'STORYBOARD']) expect(one).toContain(text);
    const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const ops = await (await pdf.getPage(1)).getOperatorList();
    const spacings = ops.fnArray.flatMap((fn, i) => (fn === OPS.setCharSpacing ? [Number((ops.argsArray[i] as unknown[])[0])] : []));
    await pdf.destroy();
    // 0.08em of the label's 8pt.
    expect(spacings.some((s) => Math.abs(s - 0.64) < 0.001)).toBe(true);
  });

  it('prints characters its fonts lack as ?, never as blank boxes, and says so', async () => {
    const [first = ''] = await scene('sc4', '4', 1);
    // Accents and the heading's dash are in the fonts: nothing to say.
    expect((await storyboardPdf({ ...board(), title: 'Bey County — Café' })).replaced).toBe(false);
    await store.getState().apply([{ kind: 'update', id: first, set: { action: 'Mary smiles 😀 at the 東京 sign.' } }]);
    const { bytes, replaced } = await storyboardPdf({ ...board(), title: 'Bey County 🎬' });
    expect(replaced).toBe(true);
    const [one = ''] = await pageTexts(bytes);
    expect(one).not.toContain('\0');
    expect(one).toContain('Mary smiles ? at the ? sign.');
    expect(one).toContain('Bey County ?');
  });

  it('prints a frame that fails to draw as PICTURE MISSING, and the rest of the storyboard with it', async () => {
    await scene('sc4', '4', 3);
    const { bytes, missing } = await storyboardPdf({
      ...board(),
      frame: (_scene, shot) => {
        if (shot === 1) return Promise.reject(new Error('The picture’s bytes are damaged.'));
        // Not a JPEG at all: pdf-lib refuses it.
        if (shot === 2) return Promise.resolve({ jpeg: new Uint8Array([1, 2, 3]) });
        return Promise.resolve({ jpeg });
      },
    });
    expect(missing).toEqual(['4B', '4C']);
    const [one = ''] = await pageTexts(bytes);
    for (const text of ['4A', '4B', '4C']) expect(one).toContain(text);
    expect(one.split('PICTURE MISSING')).toHaveLength(3);
  });

  it('names a frame drawn without its stored picture', async () => {
    await scene('sc4', '4', 2);
    const { missing } = await storyboardPdf({ ...board(), frame: (_scene, shot) => Promise.resolve({ jpeg, pictureMissing: shot === 0 }) });
    expect(missing).toEqual(['4A']);
  });

  it('ends when the export is stopped, before the next frame', async () => {
    await scene('sc4', '4', 3);
    const controller = new AbortController();
    let drawn = 0;
    const stopped = storyboardPdf({
      ...board(),
      signal: controller.signal,
      frame: () => {
        drawn += 1;
        controller.abort();
        return Promise.resolve({ jpeg });
      },
    });
    await expect(stopped).rejects.toThrow();
    expect(drawn).toBe(1);
  });
});

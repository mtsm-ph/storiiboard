import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale, t } from '../../core/i18n';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { deckChanges } from '../moodboards/deckTemplates';
import { printPages } from '../moodboards/deckPrint';
import { createItems, trashItemsChanges } from '../moodboards/items';
import { addPageChanges, movePageChanges, pagesOf } from '../moodboards/pages';
import { displayOps, firstFamily, parseColour, parseFontStyle, parsePathData, type PrintNode } from './deckDisplay';
import { deckFileName, deckPageFileName, pageDigits } from './deckNames';
import { deckPdfWarnings } from './deckPdf';
import { writePagePngs } from './deckPng';
import { mayHaveTransparency, printSize } from './deckPictures';
import { embedRule } from './deckFontRules';
import { fsTypeFromBits } from '../moodboards/fonts';
import { FORMATS, DECK_FORMATS } from './registry';

// What a deck prints (5.6a) and the pieces of its export that need no canvas: the pages and what is on them, the names, the
// read-back of the canvas's drawing into operations, the notices, and Stop leaving nothing behind. The PDF itself is in
// deckPdfWriter.test.ts; the canvas and the files are in e2e/deckExport.spec.ts.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  setLocale('en');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const pid = () => project.projectId;

async function deck(template: 'blank' | 'pitch' | 'lookbook' = 'pitch', name = 'Pitch deck') {
  const made = deckChanges(records(), pid(), { template, name, paper: 'a4' });
  await store.getState().apply(made.changes);
  return made.id;
}

const sticky = (x: number, y: number, text: string) => ({ kind: 'sticky' as const, x, y, width: 200, height: 100, rotation: 0, text });

describe('the pages a deck prints', () => {
  it('are the deck’s pages in its order, each with only what lies wholly inside it, and nothing outside the pages', async () => {
    const boardId = await deck('blank');
    await store.getState().apply(addPageChanges(records(), boardId, { name: 'Second' }).changes);
    const items = createItems(records(), boardId, [sticky(100, 100, 'Inside the first'), sticky(2300, 100, 'Inside the second'), sticky(-900, 100, 'Working space'), sticky(1900, 100, 'Across an edge')]);
    await store.getState().apply(items.changes);
    const [a, b, outside, straddle] = items.ids as [string, string, string, string];
    const pages = printPages(records(), boardId);
    expect(pages.map((p) => [p.number, p.name, p.items.map((i) => i.id)])).toEqual([[1, '', [a]], [2, 'Second', [b]]]);
    expect(pages.flatMap((p) => p.items.map((i) => i.id))).not.toContain(outside);
    expect(pages.flatMap((p) => p.items.map((i) => i.id))).not.toContain(straddle);
    // Reordering the deck's pages reorders the export.
    const [first, second] = pagesOf(records(), boardId);
    await store.getState().apply(movePageChanges(records(), boardId, second?.id ?? '', 0));
    expect(printPages(records(), boardId).map((p) => p.id)).toEqual([second?.id, first?.id]);
  });

  it('carry each page’s format, orientation and background, and its size in the canvas’s units', async () => {
    const boardId = await deck('pitch');
    const pages = printPages(records(), boardId);
    expect(pages).toHaveLength(6);
    expect(pages.map((p) => [p.format, p.orientation, p.width, p.height, p.background])).toEqual(Array.from({ length: 6 }, () => ['16:9', 'portrait', 1920, 1080, '#FFFFFF']));
    const blank = await deck('blank', 'Blank');
    expect(printPages(records(), blank)).toHaveLength(1);
  });

  it('are a 16:9 page of 1920 x 1080 units to draw at 1x; the real renders at 1x and 2x, and their pixel sizes, are in e2e/deckExport.spec.ts', async () => {
    const boardId = await deck('pitch');
    const first = printPages(records(), boardId)[0];
    expect([first?.width, first?.height]).toEqual([1920, 1080]);
  });

  it('are none for a deck whose pages are all in the Trash, or a board that is not one', async () => {
    const boardId = await deck('pitch');
    expect(printPages(records(), boardId)).toHaveLength(6);
    await store.getState().apply(trashItemsChanges(records(), pagesOf(records(), boardId).map((p) => p.id)));
    expect(printPages(records(), boardId)).toEqual([]);
    expect(printPages(records(), 'nope')).toEqual([]);
  });

  it('are what the export lists: the deck formats are for a deck and the others are not offered there', () => {
    expect(DECK_FORMATS.map((f) => [f.id, f.output, f.deck])).toEqual([
      ['deck-pdf', 'file', true],
      ['deck-png', 'folder', true],
    ]);
    // Export Project's list is as it was.
    expect(FORMATS.some((f) => f.deck === true)).toBe(false);
    expect(DECK_FORMATS.find((f) => f.id === 'deck-png')?.options).toEqual({ pixelRatio: true });
  });
});

describe('the files’ names', () => {
  it('are the deck’s own for the PDF and each page numbered in the page order with its name for a PNG', () => {
    expect(deckFileName('Pitch deck', 'pdf')).toBe('Pitch deck.pdf');
    expect(deckFileName('Pitch deck')).toBe('Pitch deck');
    expect(deckPageFileName('Pitch deck', 1, 2, 'Title')).toBe('Pitch deck 01 Title.png');
    expect(deckPageFileName('Pitch deck', 12, 2, 'The look')).toBe('Pitch deck 12 The look.png');
    // A page with no name is its number alone.
    expect(deckPageFileName('Pitch deck', 3, 2, '')).toBe('Pitch deck 03.png');
    expect(deckPageFileName('Pitch deck', 3, 2, '   ')).toBe('Pitch deck 03.png');
  });

  it('pad to two digits, and to more for a deck of a hundred pages, so they sort in page order', () => {
    expect(pageDigits(9)).toBe(2);
    expect(pageDigits(99)).toBe(2);
    expect(pageDigits(100)).toBe(3);
    expect(deckPageFileName('Deck', 7, pageDigits(120), 'X')).toBe('Deck 007 X.png');
  });

  it('leave out the characters a file system refuses, in the deck’s name and a page’s', () => {
    expect(deckFileName('Pitch: "Bey" / County?', 'pdf')).toBe('Pitch "Bey" County.pdf'.replace(/"/g, ''));
    expect(deckPageFileName('Pitch', 2, 2, 'Who/what: ?')).toBe('Pitch 02 Who what.png');
    expect(deckPageFileName('Pitch', 2, 2, '???')).toBe('Pitch 02.png');
    expect(deckFileName('...')).toBe(t('app.name'));
  });

  it('follow the app’s language: the order of the parts is the translation’s', () => {
    setLocale('es');
    expect(deckPageFileName('Presentación', 4, 2, 'El look')).toBe('Presentación 04 El look.png');
    expect(t('export.deck.pdf.label')).toBe('Presentación como PDF');
    expect(t('export.deck.png.label')).toBe('Páginas como PNG');
    setLocale('en');
    expect(t('export.deck.pdf.label')).toBe('Deck as PDF');
  });
});

describe('the notice after the export', () => {
  it('says each font that was not used and why, then the pictures printed from their stored copy', () => {
    expect(
      deckPdfWarnings(
        [
          { family: 'Brand Sans', reason: 'restricted' },
          { family: 'Pixel', reason: 'bitmap' },
          { family: 'Gone Serif', reason: 'missing' },
          { family: 'Torn', reason: 'unreadable' },
          { family: 'Brand Sans', reason: 'restricted' },
        ],
        3,
      ),
    ).toEqual([
      'Brand Sans: its licence doesn’t allow embedding, so Inter Tight was used.',
      'Pixel: its licence allows only bitmap embedding, so Inter Tight was used.',
      'Gone Serif: this computer doesn’t have it, so Inter Tight was used.',
      'Torn: this computer couldn’t read it, so Inter Tight was used.',
      '3 pictures printed from the copy kept in the project, not their original files.',
    ]);
    expect(deckPdfWarnings([], 1)).toEqual(['1 picture printed from the copy kept in the project, not its original file.']);
    expect(deckPdfWarnings([], 0, 2)).toEqual(['2 pictures couldn’t be printed.']);
    expect(deckPdfWarnings([{ family: 'Brand Sans', reason: 'glyphs' }], 0)).toEqual(['Brand Sans: some characters it doesn’t have print as empty boxes.']);
    expect(deckPdfWarnings([], 0)).toEqual([]);
  });

  it('is in Spanish too', () => {
    setLocale('es');
    expect(deckPdfWarnings([{ family: 'Brand Sans', reason: 'restricted' }], 2)).toEqual([
      'Brand Sans: su licencia no permite incrustarla, así que se usó Inter Tight.',
      '2 imágenes impresas desde la copia guardada en el proyecto, no desde sus archivos originales.',
    ]);
  });

  it('applies the rules for a font’s licence bits: restricted, bitmap-only, no-subsetting', () => {
    expect(embedRule(null)).toEqual({ embed: true, subset: true });
    expect(embedRule(fsTypeFromBits(0))).toEqual({ embed: true, subset: true });
    expect(embedRule(fsTypeFromBits(0x0002))).toEqual({ embed: false, reason: 'restricted' });
    expect(embedRule(fsTypeFromBits(0x0006))).toEqual({ embed: true, subset: true });
    expect(embedRule(fsTypeFromBits(0x000a))).toEqual({ embed: true, subset: true });
    expect(embedRule(fsTypeFromBits(0x0200))).toEqual({ embed: false, reason: 'bitmap' });
    expect(embedRule(fsTypeFromBits(0x0100))).toEqual({ embed: true, subset: false });
    // Restricted wins over no-subsetting.
    expect(embedRule(fsTypeFromBits(0x0102))).toEqual({ embed: false, reason: 'restricted' });
  });
});

describe('the pictures’ sizes', () => {
  it('are the picture’s own size, or smaller to fit, never larger', () => {
    expect(printSize(6000, 4000, 4096)).toEqual({ width: 4096, height: 2731 });
    expect(printSize(800, 600, 4096)).toEqual({ width: 800, height: 600 });
    expect(printSize(3000, 6000, 6000)).toEqual({ width: 3000, height: 6000 });
  });

  it('keep PNG only for a type that can hold transparency', () => {
    expect(mayHaveTransparency(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(mayHaveTransparency(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(mayHaveTransparency(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe(false);
  });
});

describe('Stop and failures', () => {
  const written: string[] = [];
  const target = { label: 'Pitch deck', write: (name: string) => (written.push(name), Promise.resolve()) };
  beforeEach(() => {
    written.length = 0;
  });

  it('write nothing when Stop is pressed on page 3 of 5: every page is drawn before any is written', async () => {
    const controller = new AbortController();
    await expect(
      writePagePngs({
        count: 5,
        name: (i) => `Page ${String(i + 1)}.png`,
        render: (i) => {
          if (i === 2) controller.abort();
          return Promise.resolve(new Uint8Array([i]));
        },
        target,
        signal: controller.signal,
        progress: () => undefined,
      }),
    ).rejects.toThrow();
    expect(written).toEqual([]);
  });

  it('write nothing when a page can’t be drawn', async () => {
    await expect(
      writePagePngs({
        count: 3,
        name: (i) => `Page ${String(i + 1)}.png`,
        render: (i) => (i === 1 ? Promise.reject(new Error('This computer couldn’t save page 2 as a PNG.')) : Promise.resolve(new Uint8Array([i]))),
        target,
        signal: new AbortController().signal,
        progress: () => undefined,
      }),
    ).rejects.toThrow('page 2');
    expect(written).toEqual([]);
  });

  it('write every page, in order, under names that are each new, when all are drawn', async () => {
    const progress: [number, number][] = [];
    const count = await writePagePngs({
      count: 3,
      // Two pages with the same name: the second is made new.
      name: (i) => (i === 2 ? 'Title.png' : i === 0 ? 'Title.png' : 'Look.png'),
      render: (i) => Promise.resolve(new Uint8Array([i])),
      target,
      signal: new AbortController().signal,
      progress: (done, of) => progress.push([done, of]),
    });
    expect(count).toBe(3);
    expect(written).toEqual(['Title.png', 'Look.png', 'Title (2).png']);
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });
});

describe('the canvas’s drawing read back as operations', () => {
  const node = (kind: PrintNode['kind'], attrs: Record<string, unknown> = {}, children: PrintNode[] = [], extra: Partial<PrintNode> = {}): PrintNode => ({
    kind,
    matrix: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    visible: true,
    attrs,
    children,
    ...extra,
  });

  it('is a save, the node’s transform and its own shape, its children, then a restore', () => {
    const ops = displayOps(node('group', {}, [node('rect', { width: 10, height: 20, fill: '#FFE97A', stroke: '#16150F', strokeWidth: 1.5 })], { matrix: [1, 0, 0, 1, 5, 6] }));
    expect(ops.map((op) => op.op)).toEqual(['save', 'concat', 'save', 'concat', 'shape', 'restore', 'restore']);
    expect(ops[1]).toEqual({ op: 'concat', m: [1, 0, 0, 1, 5, 6] });
    expect(ops[4]).toMatchObject({ op: 'shape', fill: '#FFE97A', stroke: '#16150F', strokeWidth: 1.5, fixedStroke: false });
  });

  it('draws a rectangle as its four corners, an ellipse as four curves, a line as its points, closed or not', () => {
    const path = (n: PrintNode) => displayOps(n).flatMap((op) => (op.op === 'shape' ? [op.path] : []))[0] ?? [];
    expect(path(node('rect', { width: 10, height: 20, fill: '#000000' }))).toEqual([{ m: [0, 0] }, { l: [10, 0] }, { l: [10, 20] }, { l: [0, 20] }, { z: true }]);
    expect(path(node('ellipse', { radiusX: 10, radiusY: 5, fill: '#000000' }))).toHaveLength(6);
    expect(path(node('line', { points: [0, 0, 10, 0, 10, 10], stroke: '#000000' }))).toEqual([{ m: [0, 0] }, { l: [10, 0] }, { l: [10, 10] }]);
    expect(path(node('line', { points: [0, 0, 10, 0, 10, 10], closed: true, fill: '#000000' })).at(-1)).toEqual({ z: true });
    expect(path(node('path', { data: 'M0,0 C10,0 20,10 30,10', stroke: '#000000' }))).toEqual([{ m: [0, 0] }, { c: [10, 0, 20, 10, 30, 10] }]);
  });

  it('keeps a fixed stroke width, a dash and a round cap', () => {
    const shape = displayOps(node('rect', { width: 1, height: 1, stroke: '#000000', strokeScaleEnabled: false, dash: [8, 6], lineCap: 'round' })).find((op) => op.op === 'shape');
    expect(shape).toMatchObject({ fixedStroke: true, dash: [8, 6], cap: 'round', strokeWidth: 2 });
  });

  it('turns a clip into one, and leaves out what is hidden or fully transparent', () => {
    const clipped = displayOps(node('group', { clipX: 10, clipY: 20, clipWidth: 100, clipHeight: 50 }, [node('rect', { width: 1, height: 1, fill: '#000000' })]));
    expect(clipped.find((op) => op.op === 'clip')).toEqual({ op: 'clip', x: 10, y: 20, width: 100, height: 50 });
    expect(displayOps(node('rect', { width: 1, height: 1, fill: '#000000' }, [], { visible: false }))).toEqual([]);
    expect(displayOps(node('rect', { width: 1, height: 1, fill: '#000000' }, [], { opacity: 0 }))).toEqual([]);
    expect(displayOps(node('rect', { width: 1, height: 1, fill: '#000000' }, [], { opacity: 0.4 })).find((op) => op.op === 'opacity')).toEqual({ op: 'opacity', value: 0.4 });
  });

  it('turns text into the lines the canvas broke, each with its baseline: top, middle or bottom of the box, from the line height', () => {
    const layout = { lines: [{ text: 'one' }, { text: 'two' }], width: 200, height: 100, baselineShift: 4 };
    const lines = (verticalAlign: string) =>
      displayOps(node('text', { text: 'one two', fontSize: 20, lineHeight: 1.2, verticalAlign, fontFamily: '"Archivo", "Inter Tight"', fontStyle: 'italic 700', fill: '#112233', align: 'center', padding: 8 }, [], { layout })).flatMap((op) => (op.op === 'text' ? [op] : []))[0];
    const top = lines('top');
    if (!top) throw new Error('no text');
    // A 24-unit line: the first baseline is the padding, half a line and the shift down; the next a line lower.
    expect(top.lines).toEqual([{ text: 'one', baseline: 8 + 12 + 4 }, { text: 'two', baseline: 8 + 12 + 4 + 24 }]);
    expect(top).toMatchObject({ family: 'Archivo', weight: 700, italic: true, align: 'center' });
    // Middle: the free height (100 - 48 - 16) halved goes above; bottom: all of it.
    expect(lines('middle')?.lines[0]?.baseline).toBe(8 + 36 / 2 + 12 + 4);
    expect(lines('bottom')?.lines[0]?.baseline).toBe(8 + 36 + 12 + 4);
  });

  it('has no text for an empty one, a picture only where it names a stored picture, a link only on a card with an address', () => {
    expect(displayOps(node('text', { text: '', fontSize: 12 }, [], { layout: { lines: [], width: 0, height: 0, baselineShift: 0 } })).some((op) => op.op === 'text')).toBe(false);
    expect(displayOps(node('image', { width: 10, height: 10 })).some((op) => op.op === 'image')).toBe(false);
    expect(displayOps(node('image', { width: 10, height: 20, sbSha: 'a'.repeat(64) })).find((op) => op.op === 'image')).toEqual({ op: 'image', sha256: 'a'.repeat(64), width: 10, height: 20 });
    expect(displayOps(node('rect', { width: 300, height: 100, fill: '#EEE9DF', sbUrl: 'https://example.com/' })).find((op) => op.op === 'link')).toEqual({ op: 'link', url: 'https://example.com/', width: 300, height: 100 });
    expect(displayOps(node('rect', { width: 300, height: 100, fill: '#EEE9DF' })).some((op) => op.op === 'link')).toBe(false);
  });

  it('reads colours, families, font styles and path data', () => {
    expect(parseColour('#FFE97A')).toEqual([1, 233 / 255, 122 / 255]);
    expect(parseColour('#fff')).toEqual([1, 1, 1]);
    expect(parseColour('transparent')).toBeNull();
    expect(firstFamily('"JetBrains Mono", monospace')).toBe('JetBrains Mono');
    expect(firstFamily('Arial')).toBe('Arial');
    expect(parseFontStyle('italic 700')).toEqual({ weight: 700, italic: true });
    expect(parseFontStyle('bold')).toEqual({ weight: 700, italic: false });
    expect(parseFontStyle('normal')).toEqual({ weight: 400, italic: false });
    expect(parsePathData('M1,2 L3,4 Z')).toEqual([{ m: [1, 2] }, { l: [3, 4] }, { z: true }]);
  });
});

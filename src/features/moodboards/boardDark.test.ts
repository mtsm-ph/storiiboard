import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCanvasView } from '../../app/canvasView';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { contrastRatio, DARK_COLOURS } from '../../ui/canvas/canvasPalette';
import { INK, PAPER_COLOURS, RAISED } from '../../ui/canvas/paperColours';
import type { CanvasColours, CanvasItem, CanvasLink } from '../../ui/canvas/types';
import { deckChanges } from './deckTemplates';
import { printPages } from './deckPrint';
import { linkInks, withDrawing } from './drawing';
import type { ShotCardData } from './liveCards';
import { PictureNode } from './PictureNode';
import { BOARD_COLOURS, canvasItems, createItems, itemFields, STICKY_COLOURS, STICKY_INK, type ItemFields, type ItemSeed } from './items';
import { pagesOf } from './pages';

// A board in the Dark view (6.5.1, Kevin, Nov 16): what has no colour of its own (a text box's default words, a shape's
// default fill and outline, a link card's paper and words) follows the palette the board view passes; a colour a person
// chose is drawn as stored, even one equal to ink; a sticky keeps its swatch and its ink words; and a deck's export, with
// the boards' view on Dark, draws exactly what it draws on Paper.

type Props = Record<string, unknown>;

/** Every Konva element a drawing makes, function components called one level at a time (a picture, which has hooks, kept whole). */
function flat(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => flat(n));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Props>;
  if (el.type === PictureNode) return [el];
  if (typeof el.type === 'function') return flat((el.type as (p: Props) => ReactNode)(el.props));
  return [el, ...flat(el.props.children as ReactNode)];
}

/** A drawing as plain data: each element's kind and its props, without children or functions. */
const plain = (node: ReactNode): unknown[] =>
  flat(node).map((el) => ({
    type: typeof el.type === 'string' ? el.type : String(el.type),
    props: Object.fromEntries(Object.entries(el.props).filter(([key, value]) => key !== 'children' && typeof value !== 'function')),
  }));

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
  setCanvasView('board', 'paper');
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

/** A deck with one 16:9 page, and these items on it (or, `onPage` false, well clear of it on the bare board); their ids, in order. */
async function deckWith(seeds: readonly ItemSeed[], onPage = true): Promise<{ boardId: string; ids: string[] }> {
  const made = deckChanges(records(), project.projectId, { template: 'blank', name: 'Look', paper: 'a4' });
  await store.getState().apply(made.changes);
  const page = pagesOf(records(), made.id)[0];
  const at = onPage ? { x: page?.fields.x ?? 0, y: page?.fields.y ?? 0 } : { x: (page?.fields.x ?? 0) - 10000, y: page?.fields.y ?? 0 };
  const items = createItems(records(), made.id, seeds.map((seed) => ({ ...seed, x: seed.x + at.x, y: seed.y + at.y })));
  await store.getState().apply(items.changes);
  return { boardId: made.id, ids: items.ids };
}

/** The board's items drawn as the board view draws them, in a palette. */
function drawnIn(boardId: string, colours: CanvasColours, override: (fields: ItemFields) => ItemFields = (f) => f): Map<string, ReactNode> {
  const fieldsOf = (id: string) => {
    const fields = itemFields(records()[id]?.props ?? {});
    return fields ? override(fields) : null;
  };
  const items = withDrawing(canvasItems(records(), boardId), fieldsOf, () => null, () => null, null, 0);
  return new Map(items.map((item: CanvasItem) => [item.id, item.draw?.({ width: item.width, height: item.height, colours, zoom: 1, inView: true })]));
}

const geometry = (x: number) => ({ x, y: 40, width: 300, height: 120, rotation: 0 });

describe('a board in the Dark view', () => {
  it('draws default words, a default shape and a link card on the bare board in the light palette, and chosen colours as stored', async () => {
    const { boardId, ids } = await deckWith(
      [
      { kind: 'text', ...geometry(40), text: 'Default words' },
      { kind: 'text', ...geometry(400), text: 'Chosen ink', color: INK },
      { kind: 'text', ...geometry(760), text: 'Chosen orange', color: '#DF5E27' },
      { kind: 'rect', ...geometry(1120) },
      { kind: 'rect', ...geometry(1480), fill: '#16150F', stroke: '#2C5F8A' },
      { kind: 'link', ...geometry(40), y: 400, url: 'https://example.com/look' },
      { kind: 'sticky', ...geometry(400), y: 400, text: 'Sticky words' },
      ],
      false,
    );
    const [text, chosenInk, chosenOrange, shape, chosenShape, link, sticky] = ids as [string, string, string, string, string, string, string];
    const dark = drawnIn(boardId, DARK_COLOURS);
    const paper = drawnIn(boardId, PAPER_COLOURS);
    const textOf = (drawing: ReactNode, words: string) => flat(drawing).find((el) => el.props.text === words)?.props;

    // No colour of its own: the light ink in Dark, ink on Paper.
    expect(textOf(dark.get(text), 'Default words')).toMatchObject({ fill: DARK_COLOURS.ink });
    expect(textOf(paper.get(text), 'Default words')).toMatchObject({ fill: INK });
    // A colour chosen, even ink itself, is drawn as stored in both.
    expect(textOf(dark.get(chosenInk), 'Chosen ink')).toMatchObject({ fill: INK });
    expect(textOf(dark.get(chosenOrange), 'Chosen orange')).toMatchObject({ fill: '#DF5E27' });
    // A shape with no fill or outline of its own: the dark well and the light ink; one with its own keeps them.
    expect(flat(dark.get(shape))[0]?.props).toMatchObject({ fill: DARK_COLOURS.raised, stroke: DARK_COLOURS.ink });
    expect(flat(paper.get(shape))[0]?.props).toMatchObject({ fill: RAISED, stroke: INK });
    expect(flat(dark.get(chosenShape))[0]?.props).toMatchObject({ fill: '#16150F', stroke: '#2C5F8A' });
    // A link card's paper and words swap together: never paper words on paper, nor ink on the dark page.
    const card = flat(dark.get(link));
    expect(card.find((el) => el.props.name === 'sb-link')?.props).toMatchObject({ fill: DARK_COLOURS.paper, stroke: DARK_COLOURS.ink });
    for (const words of card.filter((el) => typeof el.props.text === 'string')) expect(words.props.fill).toBe(DARK_COLOURS.ink);
    expect(flat(paper.get(link)).find((el) => el.props.name === 'sb-link')?.props).toMatchObject({ fill: PAPER_COLOURS.paper });
    // A sticky keeps its swatch and the ink words readable on it, and its default outline is the ink readable on its swatch.
    const note = flat(dark.get(sticky));
    expect(note.find((el) => el.type === 'Rect')?.props).toMatchObject({ fill: STICKY_COLOURS[0], stroke: INK });
    expect(textOf(dark.get(sticky), 'Sticky words')).toMatchObject({ fill: STICKY_INK });
  });

  it('draws default words and outlines on a light fill underneath in the ink readable on it (round 2)', async () => {
    const { boardId, ids } = await deckWith([
      // On the deck's white page.
      { kind: 'text', ...geometry(40), text: 'On the page' },
      { kind: 'rect', ...geometry(400) },
      // A section on the page, words wholly inside it. A section stores only its six light tints, so the dark fill is the
      // drawing's input below (as if a dark tint were chosen): what the rule reads is the fill, whatever made it.
      { kind: 'section', x: 800, y: 300, width: 600, height: 400, rotation: 0 },
      { kind: 'text', x: 850, y: 400, width: 300, height: 120, rotation: 0, text: 'In the dark section' },
      // Words over a sticky's yellow, and over a shape with a dark fill of its own.
      { kind: 'sticky', x: 40, y: 600, width: 300, height: 300, rotation: 0, text: '' },
      { kind: 'text', x: 60, y: 700, width: 200, height: 60, rotation: 0, text: 'On the sticky' },
      { kind: 'rect', x: 1500, y: 600, width: 300, height: 300, rotation: 0, fill: '#16150F' },
      { kind: 'text', x: 1520, y: 700, width: 200, height: 60, rotation: 0, text: 'On the black shape' },
    ]);
    const [onPage, rect, , inSection, , onSticky, , onBlack] = ids;
    const darkSection = (fields: ItemFields): ItemFields => (fields.kind === 'section' ? { ...fields, color: '#1F2F4D' } : fields);
    const dark = drawnIn(boardId, DARK_COLOURS, darkSection);
    const paper = drawnIn(boardId, PAPER_COLOURS, darkSection);
    // With the section's own light tint, the words in it are ink in Dark too.
    expect(flat(drawnIn(boardId, DARK_COLOURS).get(inSection ?? '')).find((el) => el.props.text === 'In the dark section')?.props).toMatchObject({ fill: INK });
    const textOf = (id: string | undefined, words: string, drawn = dark) => flat(drawn.get(id ?? '')).find((el) => el.props.text === words)?.props;
    // On the white page: ink, not the light ink.
    expect(textOf(onPage, 'On the page')).toMatchObject({ fill: INK });
    // The whole paper palette on the white page (round 4): its raised fill and ink outline, as on Paper.
    expect(flat(dark.get(rect ?? ''))[0]?.props).toMatchObject({ fill: RAISED, stroke: INK });
    // In a section with a dark chosen fill: the light ink.
    expect(textOf(inSection, 'In the dark section')).toMatchObject({ fill: DARK_COLOURS.ink });
    // On a sticky's yellow: ink; on a black shape: the light ink.
    expect(textOf(onSticky, 'On the sticky')).toMatchObject({ fill: INK });
    expect(textOf(onBlack, 'On the black shape')).toMatchObject({ fill: DARK_COLOURS.ink });
    // On Paper all of it is ink, as always.
    for (const [id, words] of [[onPage, 'On the page'], [inSection, 'In the dark section'], [onSticky, 'On the sticky'], [onBlack, 'On the black shape']] as const) {
      expect(textOf(id, words, paper)).toMatchObject({ fill: INK });
    }
  });

  it('builds a deck’s export pages and drawing without reading the boards’ view: the same on Dark as on Paper (the PNG’s byte check in e2e/canvasView.spec.ts is the real guard)', async () => {
    const { boardId } = await deckWith([
      { kind: 'text', ...geometry(40), text: 'Default words' },
      { kind: 'text', ...geometry(400), text: 'Chosen ink', color: INK },
      { kind: 'ellipse', ...geometry(760) },
      { kind: 'rect', ...geometry(1120) },
      { kind: 'link', ...geometry(40), y: 400, url: 'https://example.com/look' },
      { kind: 'sticky', ...geometry(400), y: 400, text: 'Sticky words' },
    ]);
    // As deckRender draws a page for a PNG or a PDF: the page and its items in the board's paper palette, for print.
    const exported = () =>
      printPages(records(), boardId).map((page) => ({
        id: page.id,
        background: page.background,
        size: [page.width, page.height],
        page: plain(page.page.draw?.({ width: page.page.width, height: page.page.height, colours: BOARD_COLOURS, zoom: 1, inView: true, present: true, print: true })),
        items: page.items.map((item) => ({
          id: item.id,
          drawing: plain(item.draw?.({ width: item.width, height: item.height, colours: BOARD_COLOURS, zoom: 1, inView: true, present: true, print: true })),
        })),
      }));
    setCanvasView('board', 'paper');
    const paper = exported();
    setCanvasView('board', 'dark');
    const dark = exported();
    expect(paper).toHaveLength(1);
    expect(paper[0]?.items).toHaveLength(6);
    expect(dark).toEqual(paper);
    // Nothing on the page is in the Dark view's colours.
    expect(JSON.stringify(paper)).not.toContain(DARK_COLOURS.paper);
    expect(JSON.stringify(paper)).not.toContain(DARK_COLOURS.raised);
  });
});

describe('a board in the Dark view, round 3', () => {
  const at = (x: number, y: number, width = 300, height = 120) => ({ x, y, width, height, rotation: 0 });

  it('reads what is DRAWN under words: a fill-less rectangle’s dark well, a link card’s dark paper, both readable', async () => {
    const { boardId, ids } = await deckWith([
      { kind: 'rect', ...at(40, 40, 400, 300) },
      { kind: 'text', ...at(60, 120, 300, 80), text: 'On the plain rectangle' },
      { kind: 'link', ...at(600, 40, 400, 300), url: 'https://example.com/look' },
      { kind: 'text', ...at(620, 120, 300, 80), text: 'On the link card' },
    ]);
    const [, onRect, , onLink] = ids;
    const dark = drawnIn(boardId, DARK_COLOURS);
    const fillOf = (id: string | undefined, words: string) => flat(dark.get(id ?? '')).find((el) => el.props.text === words)?.props.fill as string;
    // The rectangle draws the dark well, the link card the dark page: words on them are the light ink, readable.
    expect(fillOf(onRect, 'On the plain rectangle')).toBe(DARK_COLOURS.ink);
    expect(contrastRatio(fillOf(onRect, 'On the plain rectangle'), DARK_COLOURS.raised)).toBeGreaterThanOrEqual(4.5);
    expect(fillOf(onLink, 'On the link card')).toBe(DARK_COLOURS.ink);
    expect(contrastRatio(fillOf(onLink, 'On the link card'), DARK_COLOURS.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it('counts words whose centre is on a page as on it, even running past its edge', async () => {
    const made = deckChanges(records(), project.projectId, { template: 'blank', name: 'Look', paper: 'a4' });
    await store.getState().apply(made.changes);
    const page = pagesOf(records(), made.id)[0]?.fields;
    const px = page?.x ?? 0;
    const py = page?.y ?? 0;
    const items = createItems(records(), made.id, [
      // Centre 100 inside the page's left edge, the box running 200 past it.
      { kind: 'text', x: px - 200, y: py + 100, width: 600, height: 80, rotation: 0, text: 'Over the edge' },
      // Centre 100 outside it.
      { kind: 'text', x: px - 500, y: py + 300, width: 600, height: 80, rotation: 0, text: 'Mostly off' },
    ]);
    await store.getState().apply(items.changes);
    const dark = drawnIn(made.id, DARK_COLOURS);
    const fillOf = (id: string | undefined, words: string) => flat(dark.get(id ?? '')).find((el) => el.props.text === words)?.props.fill;
    expect(fillOf(items.ids[0], 'Over the edge')).toBe(INK);
    expect(fillOf(items.ids[1], 'Mostly off')).toBe(DARK_COLOURS.ink);
  });

  it('gives a default connector inside a white page the ink, one leaving it the light ink, a coloured one none; paper none', async () => {
    const { boardId, ids } = await deckWith([
      { kind: 'rect', ...at(40, 40) },
      { kind: 'rect', ...at(600, 40) },
    ]);
    const [a, b] = ids as [string, string];
    const page = pagesOf(records(), boardId)[0]?.fields;
    const off = { x: (page?.x ?? 0) - 3000, y: page?.y ?? 0 };
    const link = (id: string, to: CanvasLink['to'], color: string | null = null): CanvasLink => ({ id, label: id, from: { item: a, side: 'auto' }, to, route: 'straight', startHead: 'none', endHead: 'arrow', color, width: 2, text: '' });
    const links = [link('inside', { item: b, side: 'auto' }), link('leaving', off), link('coloured', { item: b, side: 'auto' }, '#2C5F8A')];
    const items = canvasItems(records(), boardId);
    const fieldsOf = (id: string) => itemFields(records()[id]?.props ?? {});
    const inks = linkInks(links, items, fieldsOf, DARK_COLOURS);
    expect(inks.get('inside')).toBe(INK);
    expect(contrastRatio(inks.get('inside') ?? '', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(inks.has('leaving')).toBe(false);
    expect(inks.has('coloured')).toBe(false);
    expect(linkInks(links, items, fieldsOf, PAPER_COLOURS).size).toBe(0);
  });

  it('hands what lies on a white page the whole paper palette in Dark: a field card’s empty label and a picture’s placeholder read (round 4)', async () => {
    const onPage = await deckWith([
      { kind: 'field_card', ...at(40, 40, 600, 120), field: 'logline' },
      { kind: 'picture', ...at(40, 300, 400, 300) },
    ]);
    const offPage = await deckWith(
      [
        { kind: 'field_card', ...at(40, 40, 600, 120), field: 'logline' },
        { kind: 'picture', ...at(40, 300, 400, 300) },
      ],
      false,
    );
    const label = (drawing: ReactNode) => flat(drawing).find((el) => typeof el.props.text === 'string' && el.props.text !== '')?.props;
    const picture = (drawing: ReactNode) => flat(drawing).find((el) => el.type === PictureNode)?.props;
    const white = '#FFFFFF';

    const dark = drawnIn(onPage.boardId, DARK_COLOURS);
    const [card, pic] = onPage.ids;
    // The empty label in the paper's muted ink, readable on the white page.
    const muted = label(dark.get(card ?? ''))?.fill as string;
    expect(muted).toBe('#5E5A52');
    expect(contrastRatio(muted, white)).toBeGreaterThanOrEqual(4.5);
    // The picture's placeholder ("Picture gone", loading) in the paper palette: ink on the raised surface.
    const placeholder = picture(dark.get(pic ?? ''))?.colours as CanvasColours;
    expect(placeholder).toBe(BOARD_COLOURS);
    expect(placeholder.dark).not.toBe(true);
    expect(contrastRatio(placeholder.ink, placeholder.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(placeholder.ink, white)).toBeGreaterThanOrEqual(4.5);

    // On the bare dark canvas, still the dark pair.
    const bare = drawnIn(offPage.boardId, DARK_COLOURS);
    const [bareCard, barePic] = offPage.ids;
    expect(label(bare.get(bareCard ?? ''))?.fill).toBe('#A9B2BC');
    expect(picture(bare.get(barePic ?? ''))?.colours).toBe(DARK_COLOURS);
  });

  it('draws a shot card exactly as on Paper in Dark: its picture handed the board’s paper colours', async () => {
    const { boardId, ids } = await deckWith([{ kind: 'shot_card', ...at(40, 40, 400, 300), shotId: 'shot-1' }]);
    const [card] = ids as [string];
    const data: ShotCardData = { kind: 'shot_card', state: 'live', number: '1A', size: 'MS', lens: '35mm', lensMm: 35, move: '', status: 'have', sha256: 'c'.repeat(64), crop: { x: 0.5, y: 0.5, zoom: 1 }, strokes: [], aspect: 16 / 9 };
    const fieldsOf = (id: string) => itemFields(records()[id]?.props ?? {});
    const drawWith = (colours: CanvasColours) => {
      const item = withDrawing(canvasItems(records(), boardId), fieldsOf, () => null, (id) => (id === card ? data : null), null, 0).find((i) => i.id === card);
      return item?.draw?.({ width: item.width, height: item.height, colours, zoom: 1, inView: true });
    };
    const picture = flat(drawWith(DARK_COLOURS)).find((el) => el.type === PictureNode);
    expect(picture?.props.colours).toBe(BOARD_COLOURS);
    expect(plain(drawWith(DARK_COLOURS))).toEqual(plain(drawWith(PAPER_COLOURS)));
  });
});

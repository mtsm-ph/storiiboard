import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setBoardGrid } from '../../app/boardGrid';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { importProjectJson, projectJsonBytes, readProjectJson } from '../../core/storage/projectJson';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { contrastRatio, DARK_COLOURS, wordsOn } from '../../ui/canvas/canvasPalette';
import { INK, PAPER, PAPER_COLOURS } from '../../ui/canvas/paperColours';
import type { CanvasColours, CanvasItem } from '../../ui/canvas/types';
import { deckChanges } from './deckTemplates';
import { printPages } from './deckPrint';
import { withDrawing } from './drawing';
import { PictureNode } from './PictureNode';
import { BOARD_COLOURS, canvasItems, clipOf, createItems, itemFields, pasteChanges, STICKY_COLOURS, styleChanges, type ItemSeed } from './items';
import { pagesOf } from './pages';

// A sticky in any colour (6.5.7a): its `color` holds any `#RRGGBB` and it is drawn in it, its words in ink or paper by
// contrast (one function, the same in Paper, Dark and every export); a style change takes a custom hex; a copy keeps it;
// it goes out and back through the JSON export; and a deck's export is the same with the dot grid on as with it off.

type Props = Record<string, unknown>;

function flat(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => flat(n));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Props>;
  if (el.type === PictureNode) return [el];
  if (typeof el.type === 'function') return flat((el.type as (p: Props) => ReactNode)(el.props));
  return [el, ...flat(el.props.children as ReactNode)];
}

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
  setBoardGrid({ boardGrid: false, boardGridSnap: false });
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

async function deckWith(seeds: readonly ItemSeed[]): Promise<{ boardId: string; ids: string[] }> {
  const made = deckChanges(records(), project.projectId, { template: 'blank', name: 'Look', paper: 'a4' });
  await store.getState().apply(made.changes);
  const page = pagesOf(records(), made.id)[0];
  const items = createItems(records(), made.id, seeds.map((seed) => ({ ...seed, x: seed.x + (page?.fields.x ?? 0), y: seed.y + (page?.fields.y ?? 0) })));
  await store.getState().apply(items.changes);
  return { boardId: made.id, ids: items.ids };
}

function drawnIn(boardId: string, colours: CanvasColours): Map<string, ReactNode> {
  const items = withDrawing(canvasItems(records(), boardId), (id) => itemFields(records()[id]?.props ?? {}), () => null, () => null, null, 0);
  return new Map(items.map((item: CanvasItem) => [item.id, item.draw?.({ width: item.width, height: item.height, colours, zoom: 1, inView: true })]));
}

const at = (x: number) => ({ x, y: 40, width: 200, height: 200, rotation: 0 });
const ACCENT = '#DF5E27';

describe('the words on a chosen fill', () => {
  it('are ink or paper, whichever has the higher contrast: white, the accent and mid grey take ink; black takes paper', () => {
    expect(wordsOn('#FFFFFF')).toBe(INK);
    expect(wordsOn('#000000')).toBe(PAPER);
    expect(wordsOn(ACCENT)).toBe(INK);
    expect(wordsOn('#808080')).toBe(INK);
    expect(wordsOn('#2C5F8A')).toBe(PAPER);
    expect(wordsOn('#16150F')).toBe(PAPER);
    // A fill that can't be read: ink, as a sticky's words always were.
    expect(wordsOn('not a colour')).toBe(INK);
  });

  it('are ink on each of the six swatches, as the swatches always had, and always the more readable of the two', () => {
    for (const swatch of STICKY_COLOURS) expect(wordsOn(swatch), swatch).toBe(INK);
    for (const fill of ['#FFFFFF', '#000000', ACCENT, '#808080', '#2C5F8A', ...STICKY_COLOURS]) {
      const chosen = contrastRatio(wordsOn(fill), fill) ?? 0;
      const other = contrastRatio(wordsOn(fill) === INK ? PAPER : INK, fill) ?? 0;
      expect(chosen, fill).toBeGreaterThanOrEqual(other);
    }
  });
});

describe('a sticky in a colour of its own', () => {
  it('reads its stored colour, any #RRGGBB, and what is not a colour as the first swatch', () => {
    const base = { kind: 'sticky', x: 0, y: 0, width: 200, height: 200, rotation: 0 };
    expect(itemFields({ ...base, color: '#123456' })?.color).toBe('#123456');
    expect(itemFields({ ...base, color: '#b5ddf5' })?.color).toBe('#B5DDF5');
    expect(itemFields({ ...base, color: 'teal' })?.color).toBe(STICKY_COLOURS[0]);
    expect(itemFields({ ...base, color: '#12345' })?.color).toBe(STICKY_COLOURS[0]);
    expect(itemFields({ ...base })?.color).toBe(STICKY_COLOURS[0]);
  });

  it('is drawn in its colour, its words in paper on a dark fill and ink on a light one, alike in Paper and Dark', async () => {
    const { boardId, ids } = await deckWith([
      { kind: 'sticky', ...at(40), text: 'Night', color: '#1B2632' },
      { kind: 'sticky', ...at(300), text: 'Day', color: '#FFFFFF' },
      { kind: 'sticky', ...at(560), text: 'Swatch', color: STICKY_COLOURS[3] },
    ]);
    const [night, day, swatch] = ids as [string, string, string];
    for (const colours of [PAPER_COLOURS, DARK_COLOURS]) {
      const drawn = drawnIn(boardId, colours);
      const box = (id: string) => flat(drawn.get(id)).find((el) => el.type === 'Rect')?.props;
      const words = (id: string, text: string) => flat(drawn.get(id)).find((el) => el.props.text === text)?.props;
      expect(box(night)).toMatchObject({ fill: '#1B2632' });
      expect(words(night, 'Night')).toMatchObject({ fill: PAPER });
      expect(box(day)).toMatchObject({ fill: '#FFFFFF' });
      expect(words(day, 'Day')).toMatchObject({ fill: INK });
      expect(box(swatch)).toMatchObject({ fill: STICKY_COLOURS[3] });
      expect(words(swatch, 'Swatch')).toMatchObject({ fill: INK });
    }
  });

  it('takes a custom hex from a style change as one update, refuses one that isn’t a colour, and writes nothing for the same', async () => {
    const { ids } = await deckWith([{ kind: 'sticky', ...at(40), text: 'Rain' }]);
    const [id] = ids as [string];
    expect(styleChanges(records(), [id], { stickyColor: '#2C5F8A' })).toEqual([{ kind: 'update', id, set: { color: '#2C5F8A' } }]);
    expect(styleChanges(records(), [id], { stickyColor: 'blue' })).toEqual([]);
    await store.getState().apply(styleChanges(records(), [id], { stickyColor: '#2C5F8A' }));
    expect(records()[id]?.props.color).toBe('#2C5F8A');
    expect(styleChanges(records(), [id], { stickyColor: '#2C5F8A' })).toEqual([]);
    // Back to a swatch.
    expect(styleChanges(records(), [id], { stickyColor: STICKY_COLOURS[1] })).toEqual([{ kind: 'update', id, set: { color: STICKY_COLOURS[1] } }]);
  });

  it('keeps its colour when copied and pasted', async () => {
    const { boardId, ids } = await deckWith([{ kind: 'sticky', ...at(40), text: 'Rain', color: '#2C5F8A' }]);
    const pasted = pasteChanges(records(), boardId, clipOf(records(), boardId, ids), null);
    await store.getState().apply(pasted.changes);
    expect(records()[pasted.ids[0] ?? '']?.props.color).toBe('#2C5F8A');
  });

  it('goes out through the JSON export and back with its colour as stored', async () => {
    const { ids } = await deckWith([{ kind: 'sticky', ...at(40), text: 'Rain', color: '#2C5F8A' }]);
    const [id] = ids as [string];
    const now = new Date('2026-11-16T12:00:00.000Z');
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, now)));
    const copy = folder.path('Bey County (copy).sbd');
    await importProjectJson(nodeDriver, copy, data, now);
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = await imported.file.query('SELECT id, props FROM records WHERE id = ?', [id]);
      expect(JSON.parse(String(rows[0]?.props))).toMatchObject({ kind: 'sticky', color: '#2C5F8A', text: 'Rain' });
      const all = await imported.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      expect(all).toEqual(await project.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id'));
    } finally {
      await imported.close();
    }
  });
});

describe('a deck’s export with the dot grid on', () => {
  it('is the same pages and drawing as with it off: the grid is a view, never printed', async () => {
    const { boardId } = await deckWith([
      { kind: 'sticky', ...at(40), text: 'Night', color: '#1B2632' },
      { kind: 'rect', ...at(300) },
      { kind: 'text', ...at(560), text: 'Words' },
    ]);
    const exported = () =>
      JSON.stringify(
        printPages(records(), boardId).map((page) => ({
          id: page.id,
          background: page.background,
          size: [page.width, page.height],
          page: plain(page.page.draw?.({ width: page.page.width, height: page.page.height, colours: BOARD_COLOURS, zoom: 1, inView: true, present: true, print: true })),
          items: page.items.map((item) => ({ id: item.id, drawing: plain(item.draw?.({ width: item.width, height: item.height, colours: BOARD_COLOURS, zoom: 1, inView: true, present: true, print: true })) })),
        })),
      );
    setBoardGrid({ boardGrid: false, boardGridSnap: false });
    const off = exported();
    setBoardGrid({ boardGrid: true, boardGridSnap: true });
    const on = exported();
    expect(on).toBe(off);
    expect(JSON.parse(off)).toHaveLength(1);
    expect(off).toContain('#1B2632');
  });
});

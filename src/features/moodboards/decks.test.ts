import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { addShot } from '../storyboard/board';
import { restoreChanges, trashItems } from '../trash/trash';
import { boardFields, boardsOf, boardTitle } from './boards';
import { connectChanges, connectorsOf } from './connectors';
import { deckChanges, LOOKBOOK_SCENES, type DeckTemplate } from './deckTemplates';
import { fieldValue } from './deckFields';
import { canvasItems, createItems, geometryChanges, itemFields, itemsOf, reorderChanges, styleChanges, textEditChanges, trashItemsChanges } from './items';
import { isPageFormat, PAGE_FORMATS, pageSize, ratioLocked } from './pageFormats';
import { addPageChanges, deletePageChanges, duplicatePageChanges, movePageChanges, pageContents, pagesOf, presentPages } from './pages';
import { moveChanges } from './sections';
import { duplicateSelection } from './boardActions';
import { moodboardStore } from './moodboardStore';
import { noticeStore } from '../../app/notice';
import { pasteClipboard } from './boardActions';
import { openDepartmentBoard } from './boards';
import { clipOf } from './items';
import { isPresentKey, type PresentKeyEvent } from './presentKey';
import { drawLive } from './liveDraw';
import { liveCardData } from './liveCards';
import { fitFieldText } from './drawing';
import { paperNow } from '../../app/paper';

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
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await log(project.file)).length;
const pid = () => project.projectId;

/** A deck made through the same function the picker uses, written in one op group. */
async function deck(template: DeckTemplate, options: { paper?: 'a4' | 'letter'; name?: string; format?: (typeof PAGE_FORMATS)[number] } = {}) {
  const made = deckChanges(records(), pid(), { template, name: options.name ?? 'Pitch', paper: options.paper ?? 'a4', ...(options.format ? { format: options.format } : {}) });
  await store.getState().apply(made.changes);
  return made.id;
}

/** A project with a title, a logline, scenes (the first with seven frames, the second with two and a palette), people and days. */
async function seed(scenes = 3) {
  await store.getState().apply([{ kind: 'update', id: pid(), set: { title: 'Bey County', logline: 'A diner at dawn.', format: 'Short film', runtime: '12 min' } }]);
  const ids: string[] = [];
  for (let i = 1; i <= scenes; i += 1) {
    const id = `sc${String(i)}`;
    ids.push(id);
    await store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: pid(), sortKey: `V${String(i).padStart(2, '0')}`, props: { number: String(i), name: `Scene ${String(i)}`, int_ext: 'INT', day_night: 'DAY' } } }]);
  }
  const frames = new Map<string, string[]>();
  const counts = [7, 2, 0, 1];
  for (let s = 0; s < Math.min(scenes, counts.length); s += 1) {
    const sceneId = ids[s] ?? '';
    for (let n = 0; n < (counts[s] ?? 0); n += 1) {
      const added = addShot(records(), pid(), sceneId);
      await store.getState().apply(added.changes);
      frames.set(sceneId, [...(frames.get(sceneId) ?? []), added.shotId]);
    }
  }
  await store.getState().apply([{ kind: 'update', id: 'sc2', set: { palette: { size: 4, colors: [{ hex: '#A35139' }, { hex: '#1F2F4D' }] } } }]);
  return { ids, frames };
}

const sticky = (x: number, y: number) => ({ kind: 'sticky' as const, x, y, width: 100, height: 100, rotation: 0, text: 'Warm' });

describe('page sizes and the ratio lock', () => {
  it('has the five formats at the sizes Kevin gave, paper turning landscape', () => {
    expect(PAGE_FORMATS.map((f) => [f, pageSize(f)])).toEqual([
      ['16:9', { width: 1920, height: 1080 }],
      ['9:16', { width: 1080, height: 1920 }],
      ['4:5', { width: 1080, height: 1350 }],
      ['a4', { width: 1240, height: 1754 }],
      ['letter', { width: 1275, height: 1650 }],
    ]);
    expect(pageSize('a4', 'landscape')).toEqual({ width: 1754, height: 1240 });
    expect(pageSize('letter', 'landscape')).toEqual({ width: 1650, height: 1275 });
    // Screen and social pages have no turn.
    expect(pageSize('9:16', 'landscape')).toEqual({ width: 1080, height: 1920 });
    expect(isPageFormat('a3')).toBe(false);
  });

  it('keeps the format\'s ratio when resized to a width', () => {
    expect(ratioLocked('16:9', 'portrait', 960)).toEqual({ width: 960, height: 540 });
    expect(ratioLocked('4:5', 'portrait', 540)).toEqual({ width: 540, height: 675 });
    expect(ratioLocked('a4', 'landscape', 877)).toEqual({ width: 877, height: 620 });
  });

  it('is a page item that is always upright, locks its ratio on the canvas and reads an odd format as 16:9', async () => {
    const boardId = await deck('blank', { format: '4:5' });
    const [first] = pagesOf(records(), boardId);
    expect(first?.fields).toMatchObject({ kind: 'page', format: '4:5', width: 1080, height: 1350, background: '#FFFFFF', rotation: 0 });
    const item = canvasItems(records(), boardId).find((i) => i.id === first?.id);
    expect(item).toMatchObject({ keepRatio: true, editable: true, rotation: 0 });
    expect(item?.section?.tab.height).toBe(24);
    const odd = itemFields({ kind: 'page', x: 0, y: 0, width: 10, height: 10, rotation: 30, format: 'a3', background: 'red' });
    expect(odd).toMatchObject({ format: '16:9', rotation: 0, background: '#FFFFFF' });
  });
});

describe('what a page holds', () => {
  async function pages() {
    // A deck board is a board whose kind says so: made with its first page already placed.
    const made = deckChanges(records(), pid(), { template: 'blank', name: 'Deck', paper: 'a4' });
    await store.getState().apply(made.changes);
    const deckId = made.id;
    const second = addPageChanges(records(), deckId);
    await store.getState().apply(second.changes);
    const items = createItems(records(), deckId, [sticky(100, 100), sticky(1800, 100), sticky(2200, 100), sticky(5000, 100)]);
    await store.getState().apply(items.changes);
    return { deckId, items: items.ids as [string, string, string, string], second: second.id };
  }

  it('is the items wholly inside it, worked out each time and never stored', async () => {
    const { deckId, items, second } = await pages();
    const [first] = pagesOf(records(), deckId);
    // The sticky at 1800 reaches 1900 (inside the first page, 0 to 1920); the one at 2200 is in the second (2120 to 4040).
    expect(pageContents(records(), deckId, first?.id ?? '')).toEqual([items[0], items[1]]);
    expect(pageContents(records(), deckId, second)).toEqual([items[2]]);
    expect(Object.keys(records()[first?.id ?? '']?.props ?? {}).sort()).toEqual(['background', 'format', 'height', 'kind', 'name', 'rotation', 'width', 'x', 'y']);
    // One half over the edge is on no page.
    await store.getState().apply([{ kind: 'update', id: items[1], set: { x: 1850 } }]);
    expect(pageContents(records(), deckId, first?.id ?? '')).toEqual([items[0]]);
  });

  it('carries its contents when it moves, in one op group, and leaves what is outside every page', async () => {
    const { deckId, items } = await pages();
    const [first] = pagesOf(records(), deckId);
    if (!first) throw new Error('the first page');
    const before = await groups();
    await store.getState().apply(moveChanges(records(), [{ id: first.id, x: 0, y: 500, width: 1920, height: 1080, rotation: 0 }]));
    expect(await groups()).toBe(before + 1);
    const at = (id: string) => itemFields(records()[id]?.props ?? {})?.y;
    expect([at(first.id), at(items[0]), at(items[1])]).toEqual([500, 600, 600]);
    // The second page's sticky and the one outside every page stay.
    expect([at(items[2]), at(items[3])]).toEqual([100, 100]);
  });

  it('is not reordered by the front and back commands: the pages\' order is the deck\'s page order', async () => {
    const { deckId } = await pages();
    const [first, second] = pagesOf(records(), deckId);
    expect(reorderChanges(records(), deckId, [first?.id ?? ''], 'front')).toEqual([]);
    expect(pagesOf(records(), deckId).map((p) => p.id)).toEqual([first?.id, second?.id]);
  });

  it('takes a background, and no other style, from the properties strip', async () => {
    const { deckId } = await pages();
    const [first] = pagesOf(records(), deckId);
    const changes = styleChanges(records(), [first?.id ?? ''], { pageBackground: '#112233', fill: '#FF0000', fontSize: 40 });
    await store.getState().apply(changes);
    expect(itemFields(records()[first?.id ?? '']?.props ?? {})).toMatchObject({ background: '#112233' });
    expect(records()[first?.id ?? '']?.props.fill).toBeUndefined();
  });

  it('is renamed by typing on its tab, one line', async () => {
    const { deckId } = await pages();
    const [first] = pagesOf(records(), deckId);
    await store.getState().apply(textEditChanges(records(), first?.id ?? '', 'The look\nand feel'));
    expect(itemFields(records()[first?.id ?? '']?.props ?? {})?.name).toBe('The look and feel');
  });
});

describe('the page order', () => {
  it('adds a page 200 units right of the last, in the deck\'s format, as one op group', async () => {
    const boardId = await deck('blank', { format: 'letter' });
    const before = await groups();
    const added = addPageChanges(records(), boardId);
    await store.getState().apply(added.changes);
    expect(await groups()).toBe(before + 1);
    const [one, two] = pagesOf(records(), boardId);
    expect([one?.fields.x, two?.fields.x, two?.fields.y]).toEqual([0, 1275 + 200, 0]);
    expect(two?.fields).toMatchObject({ format: 'letter', width: 1275, height: 1650 });
    // A 9:16 and a 4:5 page for a social deck, after that.
    for (const format of ['9:16', '4:5'] as const) await store.getState().apply(addPageChanges(records(), boardId, { format }).changes);
    expect(pagesOf(records(), boardId).map((p) => [p.number, p.fields.format])).toEqual([[1, 'letter'], [2, 'letter'], [3, '9:16'], [4, '4:5']]);
    expect(pagesOf(records(), boardId).map((p) => p.fields.x)).toEqual([0, 1475, 2950, 4230]);
  });

  it('reorders by moving one page to a place, one op group, whatever sits between them', async () => {
    const boardId = await deck('blank');
    for (let i = 0; i < 3; i += 1) await store.getState().apply(addPageChanges(records(), boardId, { name: `P${String(i + 2)}` }).changes);
    // A sticky and a section share the siblings' keys: the new key never ties with one.
    await store.getState().apply(createItems(records(), boardId, [sticky(9000, 0)]).changes);
    const ids = pagesOf(records(), boardId).map((p) => p.id);
    const before = await groups();
    await store.getState().apply(movePageChanges(records(), boardId, ids[0] ?? '', 2));
    expect(await groups()).toBe(before + 1);
    expect(pagesOf(records(), boardId).map((p) => p.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    await store.getState().apply(movePageChanges(records(), boardId, ids[3] ?? '', 0));
    expect(pagesOf(records(), boardId).map((p) => p.id)).toEqual([ids[3], ids[1], ids[2], ids[0]]);
    expect(pagesOf(records(), boardId).map((p) => p.number)).toEqual([1, 2, 3, 4]);
    const keys = Object.values(records()).filter((r) => r.parentId === boardId).map((r) => r.sortKey);
    expect(new Set(keys).size).toBe(keys.length);
    // A move to where it is, or off the ends, is no step.
    expect(movePageChanges(records(), boardId, ids[3] ?? '', 0)).toEqual([]);
    expect(movePageChanges(records(), boardId, ids[3] ?? '', 9)).toEqual([]);
    // Undo takes the move back.
    await store.getState().undo();
    expect(pagesOf(records(), boardId).map((p) => p.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  });

  it('duplicates a page with what it holds, after the last page, as one op group', async () => {
    const boardId = await deck('blank');
    const [first] = pagesOf(records(), boardId);
    if (!first) throw new Error('the page');
    const items = createItems(records(), boardId, [sticky(100, 100), sticky(400, 100), sticky(5000, 0)]);
    await store.getState().apply(items.changes);
    await store.getState().apply(connectChanges(records(), boardId, { id: null, from: { item: items.ids[0] ?? '', side: 'right' }, to: { item: items.ids[1] ?? '', side: 'left' } }).changes);
    const before = await groups();
    const copy = duplicatePageChanges(records(), boardId, first.id);
    if (!copy) throw new Error('the copy');
    await store.getState().apply(copy.changes);
    expect(await groups()).toBe(before + 1);
    const pages = pagesOf(records(), boardId);
    expect(pages.map((p) => p.fields.x)).toEqual([0, 2120]);
    const held = pageContents(records(), boardId, copy.id);
    expect(held).toHaveLength(2);
    expect(held.map((id) => itemFields(records()[id]?.props ?? {})?.x)).toEqual([2220, 2520]);
    // The connector between them came with them, joined to the copies.
    expect(connectorsOf(records(), boardId)).toHaveLength(2);
    // The original and the sticky outside every page are as they were.
    expect(pageContents(records(), boardId, first.id)).toEqual([items.ids[0], items.ids[1]]);
    expect(pagesOf(records(), boardId)).toHaveLength(2);
  });

  it('deletes a page to the Trash, its contents staying as working space, as one op group', async () => {
    const boardId = await deck('blank');
    const [first] = pagesOf(records(), boardId);
    const items = createItems(records(), boardId, [sticky(100, 100)]);
    await store.getState().apply(items.changes);
    const before = await groups();
    await store.getState().apply(deletePageChanges(records(), first?.id ?? ''));
    expect(await groups()).toBe(before + 1);
    expect(records()[first?.id ?? '']?.trashedAt).not.toBeNull();
    expect(records()[items.ids[0] ?? '']?.trashedAt).toBeNull();
    expect(pagesOf(records(), boardId)).toEqual([]);
    // It is among the live items still, outside every page now.
    expect(itemsOf(records(), boardId).map((r) => r.id)).toEqual(items.ids);
    expect(presentPages(records(), boardId)).toEqual([]);
    await store.getState().undo();
    expect(pagesOf(records(), boardId)).toHaveLength(1);
  });
});

describe('field cards', () => {
  it('read the project live: change the logline and the card changes, with no step on the card', async () => {
    await seed(1);
    const boardId = await deck('pitch');
    const card = itemsOf(records(), boardId).find((r) => itemFields(r.props)?.field === 'logline');
    expect(Object.keys(card?.props ?? {}).sort()).toEqual(['align', 'field', 'font_family', 'font_italic', 'font_size', 'font_weight', 'height', 'kind', 'rotation', 'width', 'x', 'y']);
    expect(fieldValue(records(), pid(), 'logline').text).toBe('A diner at dawn.');
    const before = records()[card?.id ?? ''];
    await store.getState().apply([{ kind: 'update', id: pid(), set: { logline: 'A diner at dusk.' } }]);
    expect(fieldValue(records(), pid(), 'logline').text).toBe('A diner at dusk.');
    expect(records()[card?.id ?? '']).toBe(before);
    expect(['title', 'format', 'runtime'].map((f) => fieldValue(records(), pid(), f as 'title').text)).toEqual(['Bey County', 'Short film', '12 min']);
  });

  it('says nothing for a field the project has nothing for, and "Dates to come" for no dates', () => {
    expect(fieldValue(records(), pid(), 'logline').text).toBe('');
    expect(fieldValue(records(), pid(), 'company').text).toBe('');
    expect(fieldValue(records(), pid(), 'cast').text).toBe('');
    expect(fieldValue(records(), pid(), 'dates').text).toBe('Dates to come');
    setLocale('es');
    expect(fieldValue(records(), pid(), 'dates').text).toBe('Fechas por confirmar');
  });

  it('lists the first and last shoot day, the company by name', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: pid(), sortKey: 'a', props: { date: '2026-11-18' } } },
      { kind: 'create', record: { id: 'd2', type: 'shoot_day', parentId: pid(), sortKey: 'b', props: { date: '2026-11-16' } } },
      { kind: 'update', id: pid(), set: { company: { profile_id: 'co1', name: 'Bey Films', address: '1 Main St', phone: '555 0100', email: 'a@b.co', logo_id: null } } },
    ]);
    expect(fieldValue(records(), pid(), 'dates').text).toBe('Mon, Nov 16 to Wed, Nov 18');
    expect(fieldValue(records(), pid(), 'company').text).toBe('Bey Films');
    await store.getState().apply([{ kind: 'update', id: 'd1', set: { date: '2026-11-16' } }]);
    expect(fieldValue(records(), pid(), 'dates').text).toBe('Mon, Nov 16');
  });

  it('shows cast and crew by name and role, and never a phone, an email, an address or a note', async () => {
    const person = (id: string, props: Record<string, string | string[]>): { kind: 'create'; record: { id: string; type: 'person'; parentId: string; sortKey: string; props: Record<string, string | string[]> } } => ({
      kind: 'create',
      record: { id, type: 'person', parentId: pid(), sortKey: id, props },
    });
    await store.getState().apply([
      person('p1', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0101', email: 'ana@example.com', notes: 'allergic to nuts' }),
      person('p2', { name: 'Kevin Matos', role: 'dp', departments: ['camera'], title: 'Director of photography', phone: '555 0102', email: 'kevin@example.com', notes: 'gate code 1234' }),
      person('p3', { name: 'Lee Park', role: 'gaffer', departments: ['grip-electric'], phone: '555 0103' }),
      { kind: 'create', record: { id: 'c1', type: 'character', parentId: pid(), sortKey: 'a', props: { name: 'MAYA', cast_id: 'p1' } } },
      { kind: 'create', record: { id: 'c2', type: 'character', parentId: pid(), sortKey: 'b', props: { name: 'DINER OWNER' } } },
    ]);
    const cast = fieldValue(records(), pid(), 'cast').text;
    const crew = fieldValue(records(), pid(), 'crew').text;
    expect(cast).toBe('DINER OWNER\nMAYA — Ana Ruiz');
    expect(crew).toContain('Kevin Matos — Director of photography');
    expect(crew).toContain('Lee Park — Gaffer');
    expect(crew).not.toContain('Ana Ruiz');
    for (const text of [cast, crew]) expect(text).not.toMatch(/555|@|gate code|allergic/);
  });
});

describe('the templates', () => {
  const kindsOn = (boardId: string) =>
    pagesOf(records(), boardId).map((p) => {
      const held = pageContents(records(), boardId, p.id).map((id) => itemFields(records()[id]?.props ?? {}));
      return held.flatMap((f) => (f ? [f.kind === 'field_card' ? `field:${f.field}` : f.kind] : []));
    });

  it('makes each one as a deck in one op group, its pages left to right 200 apart', async () => {
    await seed();
    for (const template of ['treatment', 'lookbook', 'pitch', 'shotlist'] as const) {
      const before = await groups();
      const boardId = await deck(template, { name: template });
      expect(await groups()).toBe(before + 1);
      expect(boardFields(records()[boardId]?.props ?? {}).kind).toBe('deck');
      const pages = pagesOf(records(), boardId);
      pages.slice(1).forEach((p, i) => {
        const previous = pages[i];
        expect(p.fields.x).toBe((previous?.fields.x ?? 0) + (previous?.fields.width ?? 0) + 200);
        expect(p.fields.y).toBe(0);
      });
    }
    expect(boardsOf(records(), pid()).map((b) => boardTitle(b))).toEqual(['treatment', 'lookbook', 'pitch', 'shotlist']);
  });

  it('Treatment: A4 or Letter by region, portrait; title, format and runtime, characters, then four scene cards a page', async () => {
    await seed(6);
    const a4 = await deck('treatment', { paper: 'a4', name: 'A' });
    const letter = await deck('treatment', { paper: 'letter', name: 'L' });
    expect(pagesOf(records(), a4).map((p) => [p.fields.format, p.fields.orientation, p.fields.width, p.fields.height])).toEqual(Array(5).fill(['a4', 'portrait', 1240, 1754]));
    expect(pagesOf(records(), letter).map((p) => [p.fields.format, p.fields.width])).toEqual(Array(5).fill(['letter', 1275]));
    // Six scenes: two pages of scene cards (four, then two).
    const kinds = kindsOn(a4);
    expect(kinds[0]).toEqual(['field:title', 'field:logline', 'field:company']);
    expect(kinds[1]).toEqual(['text', 'field:format', 'text', 'field:runtime']);
    expect(kinds[2]).toEqual(['text', 'field:cast']);
    expect(kinds[3]).toEqual(['text', 'scene_card', 'scene_card', 'scene_card', 'scene_card']);
    expect(kinds[4]).toEqual(['text', 'scene_card', 'scene_card']);
    expect(boardFields(records()[a4]?.props ?? {}).kind).toBe('deck');
    expect(records()[a4]?.props).toMatchObject({ page_format: 'a4' });
  });

  it('Lookbook: 16:9; a title page, a page per scene with its scene card, palette card and up to four shot cards, a brand kit page', async () => {
    const { ids } = await seed(3);
    const boardId = await deck('lookbook');
    const pages = pagesOf(records(), boardId);
    expect(pages.map((p) => p.fields.format)).toEqual(Array(5).fill('16:9'));
    expect(pages.map((p) => p.fields.name)).toEqual(['Title', 'SC 01', 'SC 02', 'SC 03', 'Closing']);
    const kinds = kindsOn(boardId);
    // Every scene page has its palette card (live: one made later appears; an empty one draws nothing when presenting).
    expect(kinds[1]).toEqual(['scene_card', 'palette_card', 'shot_card', 'shot_card', 'shot_card', 'shot_card']);
    expect(kinds[2]).toEqual(['scene_card', 'palette_card', 'shot_card', 'shot_card']);
    expect(kinds[3]).toEqual(['scene_card', 'palette_card']);
    expect(kinds[4]).toEqual(['brand_card']);
    const cards = pageContents(records(), boardId, pages[1]?.id ?? '').map((id) => itemFields(records()[id]?.props ?? {}));
    expect(cards.filter((c) => c?.kind !== 'shot_card').map((c) => c?.sceneId)).toEqual([ids[0], ids[0]]);
  });

  it('Lookbook: at most 12 scenes get a page', async () => {
    await seed(13);
    const boardId = await deck('lookbook');
    expect(pagesOf(records(), boardId)).toHaveLength(1 + LOOKBOOK_SCENES + 1);
  });

  it('Pitch: title, logline, the team, the look with the palettes of the first scenes that have one, the schedule, a brand kit page', async () => {
    await seed(3);
    const boardId = await deck('pitch');
    expect(pagesOf(records(), boardId).map((p) => [p.fields.name, p.fields.format])).toEqual([
      ['Title', '16:9'],
      ['Logline', '16:9'],
      ['The team', '16:9'],
      ['The look', '16:9'],
      ['The schedule', '16:9'],
      ['Closing', '16:9'],
    ]);
    const kinds = kindsOn(boardId);
    expect(kinds[1]).toEqual(['text', 'field:logline']);
    expect(kinds[2]).toEqual(['text', 'field:crew']);
    // Only scene 2 has a palette in this project.
    expect(kinds[3]).toEqual(['text', 'palette_card']);
    expect(kinds[4]).toEqual(['text', 'field:dates']);
    expect(kinds[5]).toEqual(['brand_card']);
  });

  it('Shot list: paper landscape, a page per scene with its scene card on top and shot cards three by two, more pages as needed', async () => {
    const { ids, frames } = await seed(3);
    const boardId = await deck('shotlist', { paper: 'letter' });
    const pages = pagesOf(records(), boardId);
    // Seven frames in scene 1: two pages; two in scene 2: one; none in scene 3: one with only its scene card.
    expect(pages.map((p) => p.fields.name)).toEqual(['SC 01, page 1', 'SC 01, page 2', 'SC 02', 'SC 03']);
    expect(pages.map((p) => [p.fields.format, p.fields.orientation, p.fields.width, p.fields.height])).toEqual(Array(4).fill(['letter', 'landscape', 1650, 1275]));
    const kinds = kindsOn(boardId);
    expect(kinds[0]).toEqual(['scene_card', 'shot_card', 'shot_card', 'shot_card', 'shot_card', 'shot_card', 'shot_card']);
    expect(kinds[1]).toEqual(['scene_card', 'shot_card']);
    expect(kinds[3]).toEqual(['scene_card']);
    // The first row of three shares a top, the second row is below; every card lies inside the page.
    const first = pageContents(records(), boardId, pages[0]?.id ?? '').map((id) => itemFields(records()[id]?.props ?? {})).filter((f) => f?.kind === 'shot_card');
    expect(first.map((f) => f?.y)).toEqual([first[0]?.y, first[0]?.y, first[0]?.y, first[3]?.y, first[3]?.y, first[3]?.y]);
    expect((first[3]?.y ?? 0) > (first[0]?.y ?? 0)).toBe(true);
    expect(frames.get(ids[0] ?? '')).toHaveLength(7);
    expect(pageContents(records(), boardId, pages[0]?.id ?? '')).toHaveLength(7);
  });

  it('makes a sensible deck from an empty project, with the placeholders', async () => {
    for (const template of ['blank', 'treatment', 'lookbook', 'pitch', 'shotlist'] as const) {
      const boardId = await deck(template, { name: template });
      const pages = pagesOf(records(), boardId);
      expect(pages.length).toBeGreaterThan(0);
      if (template !== 'blank') expect(kindsOn(boardId)[0]).toContain('field:title');
      // Every item lies wholly on a page.
      const onPages = new Set(pages.flatMap((p) => pageContents(records(), boardId, p.id)));
      const all = itemsOf(records(), boardId).filter((r) => r.props.kind !== 'page');
      expect(all.every((r) => onPages.has(r.id))).toBe(true);
    }
    const social = await deck('blank', { format: '9:16', name: 'Social' });
    expect(pagesOf(records(), social)[0]?.fields).toMatchObject({ format: '9:16', width: 1080, height: 1920 });
  });

  it('writes its headings in the language in use, as plain text a later language change leaves alone', async () => {
    await seed();
    setLocale('es');
    const boardId = await deck('pitch');
    const headings = itemsOf(records(), boardId).flatMap((r) => (r.props.kind === 'text' ? [typeof r.props.text === 'string' ? r.props.text : ''] : []));
    expect(headings).toEqual(['Logline', 'El equipo', 'El look', 'El calendario']);
    setLocale('en');
    expect(itemsOf(records(), boardId).flatMap((r) => (r.props.kind === 'text' ? [typeof r.props.text === 'string' ? r.props.text : ''] : []))).toEqual(headings);
  });
});

describe('Present: the page sequence', () => {
  it('runs through the pages in the deck\'s order, each with what is wholly inside it, and nothing outside every page', async () => {
    const boardId = await deck('blank');
    await store.getState().apply(addPageChanges(records(), boardId, { name: 'Second' }).changes);
    const [one, two] = pagesOf(records(), boardId);
    const items = createItems(records(), boardId, [sticky(100, 100), sticky(2300, 100), sticky(-900, 100), sticky(1900, 100)]);
    await store.getState().apply(items.changes);
    const [a, b, outside, straddle] = items.ids as [string, string, string, string];
    let sequence = presentPages(records(), boardId);
    expect(sequence.map((p) => [p.number, p.name, p.items])).toEqual([[1, '', [a]], [2, 'Second', [b]]]);
    // Not one outside every page, nor one across an edge.
    expect(sequence.flatMap((p) => p.items)).not.toContain(outside);
    expect(sequence.flatMap((p) => p.items)).not.toContain(straddle);
    // Reordering the pages reorders the presentation.
    await store.getState().apply(movePageChanges(records(), boardId, two?.id ?? '', 0));
    sequence = presentPages(records(), boardId);
    expect(sequence.map((p) => p.id)).toEqual([two?.id, one?.id]);
    expect(sequence.map((p) => p.number)).toEqual([1, 2]);
    // A trashed page is not presented; the empty deck presents nothing.
    await store.getState().apply(trashItemsChanges(records(), [one?.id ?? '', two?.id ?? '']));
    expect(presentPages(records(), boardId)).toEqual([]);
  });

  it('numbers a page by its place and says it in the live region\'s words', async () => {
    const boardId = await deck('pitch');
    const [, logline] = presentPages(records(), boardId);
    expect([logline?.number, logline?.name]).toEqual([2, 'Logline']);
    const items = canvasItems(records(), boardId);
    expect(items.find((i) => i.id === logline?.id)?.label).toBe('Page 2, Logline');
  });
});

describe('History and the Trash name pages, field cards and decks', () => {
  it('lists a deleted page as "Page 3 \'The look\' on Pitch deck", a field card by its field, and a deck as a deck', async () => {
    const boardId = await deck('pitch');
    const look = pagesOf(records(), boardId).find((p) => p.fields.name === 'The look');
    expect(look?.number).toBe(4);
    await store.getState().apply(deletePageChanges(records(), look?.id ?? ''));
    expect(trashItems(records(), pid()).map((r) => r.name)).toEqual(["Page 4 'The look' on Pitch deck"]);
    const logline = itemsOf(records(), boardId).find((r) => itemFields(r.props)?.field === 'logline');
    await store.getState().apply(trashItemsChanges(records(), [logline?.id ?? '']));
    expect(trashItems(records(), pid()).map((r) => r.name).sort()).toEqual(["Logline field card on Pitch deck", "Page 4 'The look' on Pitch deck"]);
    await store.getState().apply(restoreChanges(records(), pid(), look?.id ?? ''));
    setLocale('es');
    await store.getState().apply(deletePageChanges(records(), look?.id ?? ''));
    expect(trashItems(records(), pid()).map((r) => r.name)).toContain("Página 4 «The look» en la presentación Pitch");
    setLocale('en');
    await store.getState().apply([{ kind: 'trash', id: boardId }]);
    expect(trashItems(records(), pid()).some((r) => r.name.startsWith('Pitch'))).toBe(true);
  });

  it('words the steps: a deck made, a page added, a page renamed and moved', async () => {
    const boardId = await deck('pitch');
    await store.getState().apply(addPageChanges(records(), boardId, { name: 'Extra' }).changes);
    const [, logline] = pagesOf(records(), boardId);
    await store.getState().apply(textEditChanges(records(), logline?.id ?? '', 'The pitch'));
    await store.getState().apply(deletePageChanges(records(), logline?.id ?? ''));
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines[0]).toBe("Deleted page 'The pitch'");
    expect(lines[1]).toBe("Page 'The pitch': name Logline → The pitch");
    expect(lines[2]).toBe("Added page 'Extra'");
  });
});

describe('geometry of a page resize', () => {
  it('writes the page\'s own box and never rotates it', async () => {
    const boardId = await deck('blank');
    const [first] = pagesOf(records(), boardId);
    const written = geometryChanges(records(), [{ id: first?.id ?? '', x: 0, y: 0, width: 960, height: 540, rotation: 20 }]);
    await store.getState().apply(written);
    const after = records()[first?.id ?? ''] as SbdRecord;
    expect(after.props).toMatchObject({ width: 960, height: 540, rotation: 0 });
  });
});

const overlaps = (boardId: string) => {
  const pages = pagesOf(records(), boardId).map((p) => p.fields);
  return pages.flatMap((a, i) => pages.slice(i + 1).filter((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
};

describe('where a new page goes (H1)', () => {
  it('goes right of the rightmost page, so a reorder never puts Add page or Duplicate on an existing one', async () => {
    const boardId = await deck('blank');
    for (let i = 0; i < 3; i += 1) await store.getState().apply(addPageChanges(records(), boardId).changes);
    const ids = pagesOf(records(), boardId).map((p) => p.id);
    // The last in order is now the leftmost in the list, but still the rightmost on the board.
    await store.getState().apply(movePageChanges(records(), boardId, ids[3] ?? '', 0));
    await store.getState().apply(addPageChanges(records(), boardId).changes);
    const copy = duplicatePageChanges(records(), boardId, ids[1] ?? '');
    await store.getState().apply(copy?.changes ?? []);
    expect(pagesOf(records(), boardId)).toHaveLength(6);
    expect(overlaps(boardId)).toEqual([]);
    expect(Math.max(...pagesOf(records(), boardId).map((p) => p.fields.x))).toBe(5 * (1920 + 200));
  });

  it('steps past pages drawn with the Page tool, and puts a duplicate right after its original in the order', async () => {
    const boardId = await deck('blank');
    await store.getState().apply(addPageChanges(records(), boardId, { at: { x: 2120, y: 0 } }).changes);
    // A page drawn left of the row, and one where the next would go.
    await store.getState().apply(addPageChanges(records(), boardId, { at: { x: -2200, y: 0 } }).changes);
    const [first] = pagesOf(records(), boardId);
    const copy = duplicatePageChanges(records(), boardId, first?.id ?? '');
    const before = await groups();
    await store.getState().apply(copy?.changes ?? []);
    expect(await groups()).toBe(before + 1);
    expect(pagesOf(records(), boardId).map((p) => p.id).slice(0, 2)).toEqual([first?.id, copy?.id]);
    expect(overlaps(boardId)).toEqual([]);
    await store.getState().apply(addPageChanges(records(), boardId).changes);
    expect(overlaps(boardId)).toEqual([]);
    // A page sitting exactly where the next would go is stepped past.
    const rightmost = Math.max(...pagesOf(records(), boardId).map((p) => p.fields.x + p.fields.width));
    await store.getState().apply(addPageChanges(records(), boardId, { at: { x: rightmost + 200, y: 0 } }).changes);
    await store.getState().apply(addPageChanges(records(), boardId).changes);
    expect(overlaps(boardId)).toEqual([]);
  });
});

describe('a page resize is written in its format ratio', () => {
  it('turns 960 by 300 into 960 by 540', async () => {
    const boardId = await deck('blank');
    const [first] = pagesOf(records(), boardId);
    await store.getState().apply(geometryChanges(records(), [{ id: first?.id ?? '', x: 10, y: 20, width: 960, height: 300, rotation: 0 }]));
    expect(itemFields(records()[first?.id ?? '']?.props ?? {})).toMatchObject({ x: 10, y: 20, width: 960, height: 540 });
  });
});

describe('Present keeps editing hints off the page (M2)', () => {
  const ctx = (present: boolean) => ({ width: 360, height: 332, colours: { ink: '#000', paper: '#fff', raised: '#ccc' }, zoom: 1, inView: true, present });
  it('draws no hint for an empty palette, a missing company, or a card whose record is in the Trash or gone', async () => {
    await seed(2);
    const palette = liveCardData(records(), pid(), { kind: 'palette_card', shotId: '', sceneId: 'sc1' });
    expect(JSON.stringify(drawLive('a', palette, ctx(false)))).toContain('No palette yet');
    expect(JSON.stringify(drawLive('a', palette, ctx(true)))).not.toContain('No palette yet');
    const brand = liveCardData(records(), pid(), { kind: 'brand_card', shotId: '', sceneId: '' });
    expect(drawLive('b', brand, ctx(false))).not.toBeNull();
    expect(drawLive('b', brand, ctx(true))).toBeNull();
    await store.getState().apply([{ kind: 'trash', id: 'sc2' }]);
    const trashed = liveCardData(records(), pid(), { kind: 'scene_card', shotId: '', sceneId: 'sc2' });
    expect(JSON.stringify(drawLive('c', trashed, ctx(false)))).toContain('In the Trash');
    expect(drawLive('c', trashed, ctx(true))).toBeNull();
    const gone = liveCardData(records(), pid(), { kind: 'shot_card', shotId: 'nope', sceneId: '' });
    expect(drawLive('d', gone, ctx(true))).toBeNull();
  });
});

describe('the Present key (M4)', () => {
  const key = (over: Partial<PresentKeyEvent> & { altGr?: boolean } = {}): PresentKeyEvent => ({
    code: 'KeyP',
    altKey: true,
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    repeat: false,
    target: null,
    getModifierState: (name: string) => name === 'AltGraph' && over.altGr === true,
    ...over,
  });
  it('is Ctrl+Alt+P, or Cmd+Option+P on a Mac, by the key place', () => {
    expect(isPresentKey(key(), false)).toBe(true);
    expect(isPresentKey(key({ ctrlKey: false, metaKey: true }), true)).toBe(true);
    expect(isPresentKey(key({ ctrlKey: false, metaKey: true }), false)).toBe(false);
    expect(isPresentKey(key({ code: 'KeyO' }), false)).toBe(false);
  });
  it('steps aside for AltGr, a held key, and text entry', () => {
    expect(isPresentKey(key({ altGr: true }), false)).toBe(false);
    expect(isPresentKey(key({ repeat: true }), false)).toBe(false);
    const field = { tagName: 'INPUT', type: 'text', isContentEditable: false } as unknown as EventTarget;
    expect(isPresentKey(key({ target: field }), false)).toBe(false);
    const area = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;
    expect(isPresentKey(key({ target: area }), false)).toBe(false);
  });
});

describe('field cards that overflow (L3)', () => {
  const fields = itemFields({ kind: 'field_card', field: 'cast', x: 0, y: 0, width: 300, height: 100, rotation: 0, font_size: 30 });
  it('shrinks the text to its box, no further than 60% of the size set, and says when it still overflows', () => {
    if (!fields) throw new Error('fields');
    expect(fitFieldText(fields, 'Short', 300, 100)).toEqual({ size: 30, over: false });
    const medium = fitFieldText(fields, Array(6).fill('A line of the cast list').join('\n'), 300, 100);
    expect(medium.size).toBeLessThan(30);
    const long = fitFieldText(fields, Array(80).fill('A line of the cast list').join('\n'), 300, 100);
    expect(long).toEqual({ size: 18, over: true });
  });
});

describe('the crew card and the title field (L4, L7)', () => {
  it('leaves out the client', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'k1', type: 'person', parentId: pid(), sortKey: 'a', props: { name: 'Pat Client', role: 'client', departments: ['client'] } } },
      { kind: 'create', record: { id: 'k2', type: 'person', parentId: pid(), sortKey: 'b', props: { name: 'Sam Sound', role: 'sound', departments: ['sound'] } } },
    ]);
    const crew = fieldValue(records(), pid(), 'crew').text;
    expect(crew).toContain('Sam Sound');
    expect(crew).not.toContain('Pat Client');
  });
  it('falls back to the file name, as the sidebar does, when the project has no title', async () => {
    await store.getState().apply([{ kind: 'update', id: pid(), set: { title: '' } }]);
    expect(fieldValue(records(), pid(), 'title', 'en', 'Bey County').text).toBe('Bey County');
    await store.getState().apply([{ kind: 'update', id: pid(), set: { title: 'Real title' } }]);
    expect(fieldValue(records(), pid(), 'title', 'en', 'Bey County').text).toBe('Real title');
  });
  it('says the Spanish range as "del ... al ..."', async () => {
    setLocale('es');
    await store.getState().apply([
      { kind: 'create', record: { id: 'd1', type: 'shoot_day', parentId: pid(), sortKey: 'a', props: { date: '2026-11-16' } } },
      { kind: 'create', record: { id: 'd2', type: 'shoot_day', parentId: pid(), sortKey: 'b', props: { date: '2026-11-18' } } },
    ]);
    expect(fieldValue(records(), pid(), 'dates').text).toMatch(/^del .+ al .+$/);
  });
});

describe('Treatment and Shot list on the paper of the region', () => {
  it('print on Letter in a Letter region and A4 elsewhere, through paperNow', async () => {
    try {
      vi.stubGlobal('navigator', { language: 'es-MX' });
      expect(paperNow()).toBe('letter');
      const mx = await deck('treatment', { paper: paperNow(), name: 'MX' });
      expect(pagesOf(records(), mx)[0]?.fields.format).toBe('letter');
      vi.stubGlobal('navigator', { language: 'es-ES' });
      expect(paperNow()).toBe('a4');
      const es = await deck('shotlist', { paper: paperNow(), name: 'ES' });
      expect(pagesOf(records(), es)[0]?.fields).toMatchObject({ format: 'a4', orientation: 'landscape' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('History words for decks and pages (L1)', () => {
  it('says Added deck, Deleted deck, Moved page, and names a duplicated page and its contents after the page', async () => {
    const boardId = await deck('blank', { name: 'Pitch' });
    const [first] = pagesOf(records(), boardId);
    await store.getState().apply(textEditChanges(records(), first?.id ?? '', 'Cover'));
    await store.getState().apply(createItems(records(), boardId, [sticky(100, 100)]).changes);
    await store.getState().apply(duplicatePageChanges(records(), boardId, first?.id ?? '')?.changes ?? []);
    await store.getState().apply(movePageChanges(records(), boardId, pagesOf(records(), boardId)[1]?.id ?? '', 0));
    await store.getState().apply([{ kind: 'trash', id: boardId }]);
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines[0]).toBe('Deleted deck Pitch');
    expect(lines[1]).toBe("Moved page 'Cover'");
    expect(lines[2]).toBe("Duplicated page 'Cover'");
    expect(lines.at(-1)).toBe('Added deck Pitch');
  });
});

describe('pages on a board that is not a deck (L5)', () => {
  it('are left out of a paste, with a short notice, and the other items paste', async () => {
    const deckId = await deck('blank');
    const stuck = createItems(records(), deckId, [sticky(100, 100)]);
    await store.getState().apply(stuck.changes);
    const camera = openDepartmentBoard(records(), pid(), 'camera');
    await store.getState().apply(camera.changes);
    const [first] = pagesOf(records(), deckId);
    const clip = clipOf(records(), deckId, [first?.id ?? '', stuck.ids[0] ?? '']);
    expect(clip.map((c) => c.kind)).toEqual(['page', 'sticky']);
    noticeStore.setState({ message: null });
    await pasteClipboard(camera.id, null, clip, store);
    expect(itemsOf(records(), camera.id).map((r) => r.props.kind)).toEqual(['sticky']);
    expect(noticeStore.getState().message).toBe('Pages paste only into a deck.');
    // Into a deck they paste.
    await pasteClipboard(deckId, null, clip, store);
    expect(pagesOf(records(), deckId)).toHaveLength(2);
  });
});

describe('a height-only page resize (N4)', () => {
  it('takes the exact ratio of the format, not a rounded one', async () => {
    const wide = await deck('blank', { name: 'W' });
    const [a] = pagesOf(records(), wide);
    await store.getState().apply(geometryChanges(records(), [{ id: a?.id ?? '', x: 0, y: 0, width: 1920, height: 540, rotation: 0 }]));
    expect(itemFields(records()[a?.id ?? '']?.props ?? {})).toMatchObject({ width: 960, height: 540 });
    const tall = await deck('blank', { name: 'T', format: '9:16' });
    const [b] = pagesOf(records(), tall);
    await store.getState().apply(geometryChanges(records(), [{ id: b?.id ?? '', x: 0, y: 0, width: 1080, height: 1920 + 1920, rotation: 0 }]));
    // Width unchanged, height changed: the height decides.
    expect(itemFields(records()[b?.id ?? '']?.props ?? {})).toMatchObject({ width: 2160, height: 3840 });
    await store.getState().apply(geometryChanges(records(), [{ id: b?.id ?? '', x: 0, y: 0, width: 2160, height: 1920, rotation: 0 }]));
    expect(itemFields(records()[b?.id ?? '']?.props ?? {})).toMatchObject({ width: 1080, height: 1920 });
  });
});

describe('field card fitting is remembered (N3)', () => {
  it('answers the same box and text with the very same result', () => {
    const f = itemFields({ kind: 'field_card', field: 'cast', x: 0, y: 0, width: 300, height: 100, rotation: 0, font_size: 30 });
    if (!f) throw new Error('fields');
    const text = Array(30).fill('A line of the cast list').join('\n');
    expect(fitFieldText(f, text, 300, 100)).toBe(fitFieldText(f, text, 300, 100));
    expect(fitFieldText(f, text, 300, 100)).not.toBe(fitFieldText(f, text, 300, 400));
  });
});

describe('duplicate (N2)', () => {
  it('copies two pages and a sticky in one op group, one undo takes every copy away', async () => {
    const boardId = await deck('blank');
    await store.getState().apply(addPageChanges(records(), boardId).changes);
    const loose = createItems(records(), boardId, [sticky(9000, 0), sticky(100, 100)]);
    await store.getState().apply(loose.changes);
    const [one, two] = pagesOf(records(), boardId);
    moodboardStore.getState().select(boardId, [one?.id ?? '', two?.id ?? '', loose.ids[0] ?? '']);
    const before = await groups();
    const live = Object.keys(records()).length;
    await duplicateSelection(boardId, store);
    expect(await groups()).toBe(before + 1);
    expect(pagesOf(records(), boardId)).toHaveLength(4);
    expect(overlaps(boardId)).toEqual([]);
    // Two pages, the sticky inside the first (a copy with the page), and the loose sticky copied: 4 new records.
    expect(Object.keys(records()).length).toBe(live + 4);
    await store.getState().undo();
    expect(pagesOf(records(), boardId)).toHaveLength(2);
    const keys = Object.values(records()).filter((r) => r.parentId === boardId).map((r) => r.sortKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

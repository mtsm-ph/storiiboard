import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { contrast, parseHex as rgbOf } from '../../ui/theme/generator/color';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { restoreChanges, trashItems } from '../trash/trash';
import { arrangedAs } from './arrangeNames';
import { openDepartmentBoard } from './boards';
import { connectorFields } from './connectorFields';
import { connectChanges, connectorsOf } from './connectors';
import {
  BOARD_INK,
  canvasItems,
  clipOf,
  createItems,
  geometryChanges,
  itemFields,
  itemsOf,
  pasteChanges,
  reorderChanges,
  SECTION_COLOURS,
  styleChanges,
  textEditChanges,
  trashItemsChanges,
} from './items';
import { arrangeChanges, contentsOf, createSectionChanges, moveChanges, nudgeMoveChanges, sectionAroundChanges } from './sections';

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
const sticky = (x: number, y: number, text = 'Warm light') => ({ kind: 'sticky' as const, x, y, width: 100, height: 100, rotation: 0, text });
const geometry = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, rotation: 0 });
const place = (id: string) => {
  const f = itemFields(records()[id]?.props ?? {});
  return f ? [f.x, f.y] : null;
};

async function camera() {
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  return opened.id;
}

/** A board with a section (0,0 to 600,400) holding two stickies, and a third sticky outside it. */
async function sectioned() {
  const boardId = await camera();
  const made = createSectionChanges(records(), boardId, geometry(0, 0, 600, 400), { name: 'Act One' });
  await store.getState().apply(made.changes);
  const items = createItems(records(), boardId, [sticky(40, 60), sticky(300, 200), sticky(900, 60, 'Outside')]);
  await store.getState().apply(items.changes);
  const [a, b, out] = items.ids as [string, string, string];
  return { boardId, section: made.id, a, b, out };
}

describe('the section record', () => {
  it('is a board_item of kind section with a name and one of six tints, always upright', async () => {
    const boardId = await camera();
    const made = createSectionChanges(records(), boardId, { x: 10, y: 20, width: 300, height: 200, rotation: 45 });
    await store.getState().apply(made.changes);
    const record = records()[made.id];
    expect(record?.type).toBe('board_item');
    expect(record?.parentId).toBe(boardId);
    expect(record?.props).toEqual({ kind: 'section', x: 10, y: 20, width: 300, height: 200, rotation: 0, name: '', color: SECTION_COLOURS[0] });
    expect(itemFields(record?.props ?? {})).toMatchObject({ kind: 'section', name: '', rotation: 0 });
    // A stored rotation, or a colour outside the six, reads as upright and the first tint.
    expect(itemFields({ ...(record?.props ?? {}), rotation: 30, color: '#123456' })).toMatchObject({ rotation: 0, color: SECTION_COLOURS[0] });
    // The canvas gets it as a section with its name tab, announced with its name and how many items it holds.
    expect(canvasItems(records(), boardId)[0]).toMatchObject({ label: 'Section, 0 items inside', editable: true, quick: false });
    expect(canvasItems(records(), boardId)[0]?.section?.tab).toMatchObject({ x: 0, y: -24, height: 24 });
  });

  it('has six tints, each passing AA (4.5 to 1) with the board’s ink', () => {
    expect(SECTION_COLOURS).toHaveLength(6);
    expect(new Set(SECTION_COLOURS).size).toBe(6);
    for (const colour of SECTION_COLOURS) expect(contrast(rgbOf(BOARD_INK), rgbOf(colour)), colour).toBeGreaterThanOrEqual(4.5);
  });

  it('changes colour among the six only, and its name as one line', async () => {
    const { section } = await sectioned();
    expect(styleChanges(records(), [section], { sectionColor: '#FF0000' })).toEqual([]);
    await store.getState().apply(styleChanges(records(), [section], { sectionColor: SECTION_COLOURS[3] }));
    expect(itemFields(records()[section]?.props ?? {})?.color).toBe(SECTION_COLOURS[3]);
    expect(textEditChanges(records(), section, 'Act One')).toEqual([]);
    await store.getState().apply(textEditChanges(records(), section, 'Act\nTwo'));
    expect(records()[section]?.props.name).toBe('Act Two');
  });

  it('is announced with its name and how many items it holds', async () => {
    const { boardId, section } = await sectioned();
    expect(canvasItems(records(), boardId).find((i) => i.id === section)?.label).toBe('Section Act One, 2 items inside');
    setLocale('es');
    expect(canvasItems(records(), boardId).find((i) => i.id === section)?.label).toBe('Sección Act One, 2 elementos dentro');
  });
});

describe('what a section holds', () => {
  it('is worked out from where things are: wholly inside only, nothing stored', async () => {
    const { boardId, section, a, b, out } = await sectioned();
    expect(contentsOf(records(), boardId, section)).toEqual([a, b]);
    // An item that crosses the edge is not held; no record names its section.
    const crossing = createItems(records(), boardId, [sticky(550, 100)]);
    await store.getState().apply(crossing.changes);
    expect(contentsOf(records(), boardId, section)).toEqual([a, b]);
    for (const id of [a, b, out]) expect(records()[id]?.parentId).toBe(boardId);
    expect(JSON.stringify(records()[section]?.props)).not.toContain(a);
    // Taken out and put back by moving it: no record but its own changes.
    const before = await groups();
    await store.getState().apply(geometryChanges(records(), [{ id: a, ...geometry(2000, 0, 100, 100) }]));
    expect(await groups()).toBe(before + 1);
    expect(contentsOf(records(), boardId, section)).toEqual([b]);
  });

  it('holds sections, and what they hold', async () => {
    const { boardId, section, a } = await sectioned();
    const inner = createSectionChanges(records(), boardId, geometry(20, 40, 200, 150), { name: 'Inner' });
    await store.getState().apply(inner.changes);
    expect(contentsOf(records(), boardId, section)).toContain(inner.id);
    expect(contentsOf(records(), boardId, inner.id)).toEqual([a]);
  });
});

describe('moving a section', () => {
  it('moves what it holds in the same op group, and one undo puts everything back', async () => {
    const { section, a, b, out } = await sectioned();
    const before = await groups();
    await store.getState().apply(moveChanges(records(), [{ id: section, ...geometry(100, 50, 600, 400) }]));
    expect(await groups()).toBe(before + 1);
    expect(place(section)).toEqual([100, 50]);
    expect(place(a)).toEqual([140, 110]);
    expect(place(b)).toEqual([400, 250]);
    expect(place(out)).toEqual([900, 60]);
    await store.getState().undo();
    expect([place(section), place(a), place(b)]).toEqual([[0, 0], [40, 60], [300, 200]]);
  });

  it('does not move an item twice when a drag already brings it', async () => {
    const { section, a, b } = await sectioned();
    await store.getState().apply(
      moveChanges(records(), [
        { id: section, ...geometry(100, 50, 600, 400) },
        { id: a, ...geometry(140, 110, 100, 100) },
        { id: b, ...geometry(400, 250, 100, 100) },
      ]),
    );
    expect([place(a), place(b)]).toEqual([[140, 110], [400, 250]]);
    const log_ = (await log(project.file)).at(-1);
    expect(log_?.opCount).toBe(3);
  });

  it('moves what it holds when nudged, including a nested section and its contents', async () => {
    const { boardId, section, a } = await sectioned();
    const inner = createSectionChanges(records(), boardId, geometry(20, 40, 200, 150));
    await store.getState().apply(inner.changes);
    await store.getState().apply(nudgeMoveChanges(records(), [section], 10, -5));
    expect(place(section)).toEqual([10, -5]);
    expect(place(inner.id)).toEqual([30, 35]);
    expect(place(a)).toEqual([50, 55]);
  });

  it('moves the free end of a connector inside it, and leaves an attached end and a free end outside alone', async () => {
    const { boardId, section, a, out } = await sectioned();
    const inside = connectChanges(records(), boardId, { id: null, from: { item: out, side: 'left' }, to: { x: 300, y: 300 } });
    const outside = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'top' }, to: { x: 1500, y: 700 } });
    await store.getState().apply([...inside.changes, ...outside.changes]);
    const before = await groups();
    await store.getState().apply(moveChanges(records(), [{ id: section, ...geometry(100, 0, 600, 400) }]));
    expect(await groups()).toBe(before + 1);
    const ends = (id: string) => connectorFields(records()[id]?.props ?? {});
    expect(ends(inside.id as string)?.to).toEqual({ x: 400, y: 300 });
    expect(ends(inside.id as string)?.from).toEqual({ item: out, side: 'left' });
    expect(ends(outside.id as string)?.to).toEqual({ x: 1500, y: 700 });
    // The connector joined to a held item follows it by itself: nothing written for it.
    expect(connectorsOf(records(), boardId)).toHaveLength(2);
    await store.getState().undo();
    expect(ends(inside.id as string)?.to).toEqual({ x: 300, y: 300 });
  });

  it('moves nothing else when it is resized', async () => {
    const { section, a, b } = await sectioned();
    const before = await groups();
    await store.getState().apply(moveChanges(records(), [{ id: section, ...geometry(0, 0, 900, 700) }]));
    expect(await groups()).toBe(before + 1);
    expect(place(section)).toEqual([0, 0]);
    expect([place(a), place(b)]).toEqual([[40, 60], [300, 200]]);
    expect((await log(project.file)).at(-1)?.opCount).toBe(1);
    // Resized from the top left: the corner moves, the width changes, and nothing is carried.
    await store.getState().apply(moveChanges(records(), [{ id: section, ...geometry(-50, -50, 950, 750) }]));
    expect([place(a), place(b)]).toEqual([[40, 60], [300, 200]]);
  });
});

describe('Section around selection', () => {
  it('draws a section round the selection with 40 units of padding and room for the name, in one group', async () => {
    const boardId = await camera();
    const made = createItems(records(), boardId, [sticky(100, 100), sticky(400, 300)]);
    await store.getState().apply(made.changes);
    const before = await groups();
    const around = sectionAroundChanges(records(), boardId, made.ids);
    await store.getState().apply(around?.changes ?? []);
    expect(await groups()).toBe(before + 1);
    // The bounds are 100..500 across and 100..400 down.
    expect(itemFields(records()[around?.id ?? '']?.props ?? {})).toMatchObject({ kind: 'section', x: 60, y: 36, width: 480, height: 404 });
    expect(contentsOf(records(), boardId, around?.id ?? '')).toEqual(made.ids);
    await store.getState().undo();
    expect(itemsOf(records(), boardId).map((r) => r.id)).toEqual(made.ids);
  });

  it('puts a section drawn round other sections under them, and one drawn inside above', async () => {
    const { boardId, section } = await sectioned();
    const inner = createSectionChanges(records(), boardId, geometry(20, 40, 200, 150));
    await store.getState().apply(inner.changes);
    const outer = createSectionChanges(records(), boardId, geometry(-100, -100, 1000, 700));
    await store.getState().apply(outer.changes);
    const order = itemsOf(records(), boardId)
      .filter((r) => r.props.kind === 'section')
      .map((r) => r.id);
    expect(order).toEqual([outer.id, section, inner.id]);
    expect(sectionAroundChanges(records(), boardId, [])).toBeNull();
  });
});

describe('deleting and copying', () => {
  it('trashes the section only, leaving its contents, and lists it by its name', async () => {
    const { boardId, section, a, b } = await sectioned();
    const before = await groups();
    await store.getState().apply(trashItemsChanges(records(), [section]));
    expect(await groups()).toBe(before + 1);
    expect(records()[section]?.trashedAt).not.toBeNull();
    expect([records()[a]?.trashedAt, records()[b]?.trashedAt]).toEqual([null, null]);
    expect(itemsOf(records(), boardId).map((r) => r.id)).toEqual([a, b, expect.any(String)]);
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(["Section 'Act One' on Camera board"]);
    await store.getState().apply(restoreChanges(records(), project.projectId, section));
    expect(records()[section]?.trashedAt).toBeNull();
    setLocale('es');
    await store.getState().apply(trashItemsChanges(records(), [section]));
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(["Sección 'Act One' en el tablero Cámara"]);
  });

  it('lists a section with no name as just a section', async () => {
    const boardId = await camera();
    const made = createSectionChanges(records(), boardId, geometry(0, 0, 100, 100));
    await store.getState().apply(made.changes);
    await store.getState().apply(trashItemsChanges(records(), [made.id]));
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Section on Camera board']);
  });

  it('copies a section alone as only the section, and with its contents selected, together', async () => {
    const { boardId, section, a, b } = await sectioned();
    expect(clipOf(records(), boardId, [section]).map((c) => c.kind)).toEqual(['section']);
    const all = clipOf(records(), boardId, [section, a, b]);
    expect(all.map((c) => c.kind)).toEqual(['section', 'sticky', 'sticky']);
    const pasted = pasteChanges(records(), boardId, all, null);
    await store.getState().apply(pasted.changes);
    const [copy] = pasted.ids;
    expect(records()[copy as string]?.props).toMatchObject({ kind: 'section', name: 'Act One', x: 16, y: 16, rotation: 0 });
  });
});

describe('z order', () => {
  it('moves a section among the sections only', async () => {
    const { boardId, section, a } = await sectioned();
    const second = createSectionChanges(records(), boardId, geometry(2000, 0, 300, 300), { name: 'Two' });
    await store.getState().apply(second.changes);
    // Sent to the front of the board's order, the first section goes above the second, not above the stickies.
    const front = reorderChanges(records(), boardId, [section], 'front');
    await store.getState().apply(front);
    const sections = itemsOf(records(), boardId).filter((r) => r.props.kind === 'section').map((r) => r.id);
    expect(sections).toEqual([second.id, section]);
    // A sticky sent to the back stays among the stickies; the sections' order is untouched.
    await store.getState().apply(reorderChanges(records(), boardId, [a], 'back'));
    expect(itemsOf(records(), boardId).filter((r) => r.props.kind === 'section').map((r) => r.id)).toEqual([second.id, section]);
    expect(reorderChanges(records(), boardId, [second.id], 'back')).toEqual([]);
    // A mixed selection reorders each kind in its own group, in one change list.
    const mixed = reorderChanges(records(), boardId, [section, a], 'back');
    expect(mixed.length).toBeGreaterThan(0);
  });
});

describe('align, distribute and Tidy up', () => {
  async function three() {
    const boardId = await camera();
    const made = createItems(records(), boardId, [sticky(0, 0), sticky(130, 220), sticky(400, 90)]);
    await store.getState().apply(made.changes);
    return { boardId, ids: made.ids };
  }

  it('aligns in one group, with a row for every item it covered, and History says so', async () => {
    const { boardId, ids } = await three();
    const before = await groups();
    await store.getState().apply(arrangeChanges(records(), boardId, ids, { kind: 'align', mode: 'left' }));
    expect(await groups()).toBe(before + 1);
    expect(ids.map(place)).toEqual([[0, 0], [0, 220], [0, 90]]);
    expect((await log(project.file)).at(-1)?.opCount).toBe(3);
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines[0]).toBe('Aligned 3 items');
    await store.getState().undo();
    expect(ids.map(place)).toEqual([[0, 0], [130, 220], [400, 90]]);
  });

  it('distributes and tidies, each named in History', async () => {
    const { boardId, ids } = await three();
    await store.getState().apply(arrangeChanges(records(), boardId, ids, { kind: 'distribute', axis: 'horizontal' }));
    expect(ids.map(place)).toEqual([[0, 0], [200, 220], [400, 90]]);
    await store.getState().apply(arrangeChanges(records(), boardId, ids, { kind: 'tidy', mode: 'grid' }));
    // Three items in reading order (the first, the third, the second): two columns; cells 100 by 100, 24 apart, from the corner.
    expect(ids.map(place)).toEqual([[0, 0], [0, 124], [124, 0]]);
    await store.getState().apply(arrangeChanges(records(), boardId, ids, { kind: 'tidy', mode: 'row' }));
    expect(ids.map(place)).toEqual([[0, 0], [248, 0], [124, 0]]);
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines.slice(0, 3)).toEqual(['Tidied 3 items into a row', 'Tidied 3 items into a grid', 'Distributed 3 items']);
    setLocale('es');
    const spanish = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(spanish.slice(0, 3)).toEqual(['Se ordenó en una fila: 3 elementos', 'Se ordenó en una cuadrícula: 3 elementos', 'Se distribuyó: 3 elementos']);
  });

  it('writes nothing when nothing would move, or for a single item', async () => {
    const { boardId, ids } = await three();
    expect(arrangeChanges(records(), boardId, ids.slice(0, 1), { kind: 'align', mode: 'left' })).toEqual([]);
    expect(arrangeChanges(records(), boardId, ids.slice(0, 2), { kind: 'distribute', axis: 'vertical' })).toEqual([]);
    await store.getState().apply(arrangeChanges(records(), boardId, ids, { kind: 'align', mode: 'top' }));
    expect(arrangeChanges(records(), boardId, ids, { kind: 'align', mode: 'top' })).toEqual([]);
  });

  it('carries what a section holds when the section is moved by a command, and keeps connectors following', async () => {
    const { boardId, section, a, out } = await sectioned();
    const tied = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'right' }, to: { item: out, side: 'left' } });
    await store.getState().apply(tied.changes);
    const far = createItems(records(), boardId, [sticky(-500, -300, 'Far')]);
    await store.getState().apply(far.changes);
    // Aligning to the left edge of the item far to the left moves the section, and the stickies inside go with it.
    await store.getState().apply(arrangeChanges(records(), boardId, [section, far.ids[0] as string], { kind: 'align', mode: 'left' }));
    expect(place(section)).toEqual([-500, 0]);
    expect(place(a)).toEqual([-460, 60]);
    expect(place(far.ids[0] as string)).toEqual([-500, -300]);
    expect(place(out)).toEqual([900, 60]);
    expect(connectorsOf(records(), boardId)).toHaveLength(1);
  });

  it('leaves a covered item that is inside a moving section where the command put it', async () => {
    const boardId = await camera();
    const s = createSectionChanges(records(), boardId, geometry(0, 0, 600, 400));
    await store.getState().apply(s.changes);
    const made = createItems(records(), boardId, [sticky(40, 60), sticky(-420, 1000)]);
    await store.getState().apply(made.changes);
    const [a, x] = made.ids as [string, string];
    // The section's middle (300) moves to the lot's (90); the note inside it, already centred there, stays.
    await store.getState().apply(arrangeChanges(records(), boardId, [s.id, a, x], { kind: 'align', mode: 'center' }));
    expect(place(a)).toEqual([40, 60]);
    expect(place(s.id)).toEqual([-210, 0]);
  });

  it('moves what nested sections hold by the distance of the innermost one that moves', async () => {
    const boardId = await camera();
    const s1 = createSectionChanges(records(), boardId, geometry(0, 0, 1000, 1000));
    await store.getState().apply(s1.changes);
    const s2 = createSectionChanges(records(), boardId, geometry(100, 100, 200, 200));
    await store.getState().apply(s2.changes);
    const made = createItems(records(), boardId, [{ ...sticky(150, 150), width: 50, height: 50 }, sticky(2000, 0)]);
    await store.getState().apply(made.changes);
    const [a, x] = made.ids as [string, string];
    await store.getState().apply(arrangeChanges(records(), boardId, [s1.id, s2.id, x], { kind: 'align', mode: 'center' }));
    // Centres 500, 200 and 2050 go to 1050: the outer moves 550, the inner 850; the note follows the inner.
    expect(place(s1.id)).toEqual([550, 0]);
    expect(place(s2.id)).toEqual([950, 100]);
    expect(place(a)).toEqual([1000, 150]);
  });

  it('names a layout step by the items it covered, not those a section carried', async () => {
    const { boardId, section, a } = await sectioned();
    const far = createItems(records(), boardId, [sticky(-500, -300, 'Far')]);
    await store.getState().apply(far.changes);
    await store.getState().apply(arrangeChanges(records(), boardId, [section, far.ids[0] as string], { kind: 'align', mode: 'left' }));
    expect(place(a)).toEqual([-460, 60]);
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines[0]).toBe('Aligned 2 items');
  });

  it('says a section added and a section renamed', async () => {
    const boardId = await camera();
    const made = createSectionChanges(records(), boardId, geometry(0, 0, 300, 200));
    await store.getState().apply(made.changes);
    await store.getState().apply(textEditChanges(records(), made.id, 'Act One'));
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
    expect(lines.slice(0, 2)).toEqual(['A section: name — → Act One', 'Added a section']);
  });

  it('is recognised from the rows alone, and a drag is not taken for one', () => {
    const row = (id: string, x: number, y: number) => ({ id, ...{ kind: 'rect', x, y, width: 50, height: 50, rotation: 0 } });
    const before = [row('a', 0, 0), row('b', 100, 30), row('c', 220, 70)];
    const after = [row('a', 0, 0), row('b', 100, 0), row('c', 220, 0)];
    const rows = (to: typeof after) => before.map((b, i) => ({ id: b.id, before: { ...b }, after: { ...(to[i] as object) } }));
    expect(arrangedAs(rows(after) as never)).toBe('align');
    const dragged = before.map((b) => ({ ...b, x: b.x + 40, y: b.y + 40 }));
    expect(arrangedAs(rows(dragged) as never)).toBeNull();
    expect(arrangedAs(rows(before) as never)).toBeNull();
  });
});

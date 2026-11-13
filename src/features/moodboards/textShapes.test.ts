import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { projectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { contrast, parseHex as rgbOf } from '../../ui/theme/generator/color';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { trashItems } from '../trash/trash';
import { changeStyle, finishEditing, placeItem } from './boardActions';
import { openDepartmentBoard } from './boards';
import { availability, cssFamily, faceKey, unreadableFamilies, drawnFamily, familiesOf, fontsStore, newlyMissing, fsTypeFromBits, missingFamilies, nearestStyle, parseFontPayload, setSystemFonts, unreported } from './fonts';
import {
  canvasItems,
  createItems,
  estimateTextHeight,
  geometryChanges,
  itemFields,
  keepTop,
  stickyColourName,
  itemsOf,
  parseHex,
  propsFor,
  seedWithText,
  STICKY_COLOURS,
  STICKY_INK,
  styleChanges,
  textEditChanges,
} from './items';
import { moodboardStore } from './moodboardStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('no Rust here'))), isTauri: () => false }));

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
  moodboardStore.setState({ editing: null, selections: {}, tool: 'select', openBoardId: null });
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

const records = () => projectStore.getState().records;
const groups = async () => (await log(project.file)).length;
const box = (x: number) => ({ x, y: 0, width: 200, height: 120, rotation: 0 });

async function board(): Promise<string> {
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await projectStore.getState().apply(opened.changes);
  return opened.id;
}

describe('item kinds and their props', () => {
  it('reads every kind with its defaults, and drops a colour that is not #RRGGBB', () => {
    const base = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    expect(itemFields({ kind: 'rect', ...base })).toMatchObject({ kind: 'rect', fill: null, stroke: null });
    for (const kind of ['ellipse', 'triangle', 'diamond'] as const) {
      expect(itemFields({ kind, ...base, fill: '#ff0000', stroke: 'red' })).toMatchObject({ kind, fill: '#FF0000', stroke: null });
    }
    expect(itemFields({ kind: 'text', ...base, text: 'Hi' })).toMatchObject({
      kind: 'text',
      text: 'Hi',
      fontFamily: 'Inter Tight',
      fontWeight: 400,
      fontItalic: false,
      fontSize: 24,
      color: null,
      align: 'left',
    });
    expect(itemFields({ kind: 'sticky', ...base })).toMatchObject({ kind: 'sticky', fontSize: 20, text: '' });
    // Out-of-range values are brought in; an unknown alignment is left.
    expect(itemFields({ kind: 'text', ...base, font_weight: 950, font_size: -3, align: 'justify' })).toMatchObject({ fontWeight: 900, fontSize: 24, align: 'left' });
    expect(itemFields({ kind: 'hologram', ...base })).toBeNull();
  });

  it('writes only the props a kind uses', () => {
    expect(propsFor({ ...box(0), kind: 'ellipse', fill: '#FF0000' })).toEqual({ kind: 'ellipse', x: 0, y: 0, width: 200, height: 120, rotation: 0, fill: '#FF0000' });
    expect(propsFor({ ...box(0), kind: 'rect' })).not.toHaveProperty('fill');
    const sticky = propsFor({ ...box(0), kind: 'sticky' });
    expect(sticky).toMatchObject({ color: STICKY_COLOURS[0], font_family: 'Inter Tight', font_size: 20, text: '' });
    expect(propsFor({ ...box(0), kind: 'text' })).not.toHaveProperty('color');
  });

  it('takes a typed hex with or without the #, in three or six digits', () => {
    expect(parseHex('df5e27')).toBe('#DF5E27');
    expect(parseHex(' #abc ')).toBe('#AABBCC');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('zzzzzz')).toBeNull();
  });

  it('gives sticky colours that pass AA with ink: six of them, each at least 4.5 to 1', () => {
    expect(STICKY_COLOURS).toHaveLength(6);
    for (const colour of STICKY_COLOURS) {
      expect(contrast(rgbOf(STICKY_INK), rgbOf(colour)), colour).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('labels every kind for the canvas, text and stickies as editable', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'rect' }, { ...box(300), kind: 'text', text: 'Hi' }, { ...box(600), kind: 'sticky' }]);
    await projectStore.getState().apply(made.changes);
    expect(canvasItems(records(), boardId).map((i) => [i.label, i.editable])).toEqual([
      ['Rectangle', false],
      ['Text box', true],
      ['Sticky note', true],
    ]);
  });
});

describe('property changes', () => {
  it('apply to three items as one op group, and one undo puts all three back', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'rect' }, { ...box(300), kind: 'ellipse' }, { ...box(600), kind: 'diamond' }]);
    await projectStore.getState().apply(made.changes);
    const before = await groups();
    moodboardStore.getState().select(boardId, made.ids);
    await changeStyle(boardId, { fill: '#2C5F8A' });
    expect(await groups()).toBe(before + 1);
    expect(made.ids.map((id) => itemFields(records()[id]?.props ?? {})?.fill)).toEqual(['#2C5F8A', '#2C5F8A', '#2C5F8A']);
    await projectStore.getState().undo();
    expect(made.ids.map((id) => itemFields(records()[id]?.props ?? {})?.fill)).toEqual([null, null, null]);
  });

  it('give each kind only what fits it, and write nothing for a value already there', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'rect', fill: '#FFFFFF' }, { ...box(300), kind: 'text', text: 'Hi' }, { ...box(600), kind: 'sticky' }]);
    await projectStore.getState().apply(made.changes);
    const [rect, text, sticky] = made.ids as [string, string, string];
    const changes = styleChanges(records(), made.ids, { fill: '#FFFFFF', textColor: '#A35139', stickyColor: STICKY_COLOURS[2], fontWeight: 700 });
    // The rectangle already has that fill and takes no font; the text box takes its colour and weight; the sticky its own.
    expect(changes.map((c) => (c.kind === 'update' ? c.id : ''))).toEqual([text, sticky]);
    expect(changes[0]).toMatchObject({ set: { color: '#A35139', font_weight: 700 } });
    expect(changes[1]).toMatchObject({ set: { color: STICKY_COLOURS[2], font_weight: 700 } });
    expect(styleChanges(records(), [rect], { fontSize: 40 })).toEqual([]);
  });

  it('give a text box a new height when its font size changes', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'text', text: 'A long line of words that wraps in a narrow box', height: 29 }]);
    await projectStore.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    const [change] = styleChanges(records(), [id], { fontSize: 48 });
    expect(change?.kind === 'update' && change.set?.height).toBeGreaterThan(29);
  });

  it('keep a text box’s height with its width when it is resized', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'text', text: 'A long line of words that wraps in a narrow box', height: 29 }]);
    await projectStore.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    const narrower = geometryChanges(records(), [{ id, x: 0, y: 0, width: 80, height: 29, rotation: 0 }]);
    expect(narrower[0]?.kind === 'update' && narrower[0].set?.height).toBeGreaterThan(29);
    // A move alone leaves the height as stored.
    const moved = geometryChanges(records(), [{ id, x: 40, y: 0, width: 200, height: 29, rotation: 0 }]);
    expect(moved[0]).toMatchObject({ set: { x: 40, height: 29 } });
  });
});

describe('editing text in place', () => {
  it('writes one op group for everything typed, a text box’s height with its text', async () => {
    const boardId = await board();
    await placeItem(boardId, { x: 0, y: 0, width: 240, height: 29, rotation: 0 }, 'text');
    const editing = moodboardStore.getState().editing;
    expect(editing?.draft?.kind).toBe('text');
    // Nothing is in the project while it is typed into.
    expect(itemsOf(records(), boardId)).toHaveLength(0);
    const before = await groups();
    await finishEditing('First line\nSecond line');
    expect(await groups()).toBe(before + 1);
    const [item] = itemsOf(records(), boardId);
    expect(itemFields(item?.props ?? {})).toMatchObject({ kind: 'text', text: 'First line\nSecond line' });
    expect(itemFields(item?.props ?? {})?.height).toBeGreaterThan(29);
    expect(moodboardStore.getState().editing).toBeNull();
    expect(moodboardStore.getState().selections[boardId]).toEqual([item?.id]);
  });

  it('writes nothing for a new text box left empty, and a second end writes nothing either', async () => {
    const boardId = await board();
    await placeItem(boardId, { x: 0, y: 0, width: 240, height: 29, rotation: 0 }, 'text');
    const before = await groups();
    await finishEditing('  \n ');
    await finishEditing('late');
    expect(await groups()).toBe(before);
    expect(itemsOf(records(), boardId)).toHaveLength(0);
  });

  it('makes a new sticky note even when it is blank, and edits an existing one in one group', async () => {
    const boardId = await board();
    await placeItem(boardId, { x: 0, y: 0, width: 200, height: 200, rotation: 0 }, 'sticky');
    await finishEditing('');
    const [sticky] = itemsOf(records(), boardId);
    expect(itemFields(sticky?.props ?? {})?.kind).toBe('sticky');
    const before = await groups();
    moodboardStore.getState().startEditing({ boardId, id: sticky?.id ?? '', draft: null });
    await finishEditing('Rain cover?');
    expect(await groups()).toBe(before + 1);
    expect(itemFields(records()[sticky?.id ?? '']?.props ?? {})?.text).toBe('Rain cover?');
    // Ending with the same text writes nothing.
    moodboardStore.getState().startEditing({ boardId, id: sticky?.id ?? '', draft: null });
    await finishEditing('Rain cover?');
    expect(await groups()).toBe(before + 1);
  });

  it('places a shape at once, selected, and starts editing for text and sticky only', async () => {
    const boardId = await board();
    await placeItem(boardId, box(0), 'diamond');
    expect(itemsOf(records(), boardId).map((r) => r.props.kind)).toEqual(['diamond']);
    expect(moodboardStore.getState().editing).toBeNull();
    await placeItem(boardId, box(300), 'sticky');
    expect(moodboardStore.getState().editing?.draft?.kind).toBe('sticky');
    expect(itemsOf(records(), boardId)).toHaveLength(1);
  });

  it('measures a typed text box by the estimate when there is no canvas', () => {
    const seed = seedWithText({ ...box(0), kind: 'text', height: 29 }, 'one two three four five six seven eight nine ten', estimateTextHeight);
    expect(seed.height).toBeGreaterThan(29);
    expect(textEditChanges(records(), 'nothing', 'x')).toEqual([]);
  });
});

describe('words in History and the Trash', () => {
  it('names the new kinds and the new changes', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'text', text: 'Hi' }, { ...box(300), kind: 'sticky' }]);
    await projectStore.getState().apply(made.changes);
    moodboardStore.getState().select(boardId, made.ids);
    await changeStyle(boardId, { fontSize: 30 });
    moodboardStore.getState().startEditing({ boardId, id: made.ids[0] ?? '', draft: null });
    await finishEditing('Hello there');
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((step) => lineText(step.line)).reverse();
    expect(lines).toEqual(['Added board Camera', 'Added 2 items', 'Changed 2 items', 'Edited the text of 1 item']);
    setLocale('es');
    expect((await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((step) => lineText(step.line)).reverse().slice(1)).toEqual([
      'Agregado: 2 elementos',
      'Cambiado: 2 elementos',
      'Texto editado: 1 elemento',
    ]);
    setLocale('en');
    // A trashed sticky note reads as what it is.
    await projectStore.getState().apply([{ kind: 'trash', id: made.ids[1] ?? '' }]);
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Sticky note on Camera board']);
  });
});

describe('fonts', () => {
  beforeEach(() => {
    fontsStore.setState({ status: 'ready', system: [], broken: [], version: 0 });
  });

  it('list only the bundled fonts in the browser build, which has no Rust', () => {
    // Outside the desktop app the store starts ready with no system fonts.
    expect(familiesOf(fontsStore.getState().system).map((f) => f.name)).toEqual(['Inter Tight', 'JetBrains Mono', 'Archivo', 'Bodoni Moda', 'Jost', 'Outfit']);
    expect(familiesOf([]).every((f) => f.bundled)).toBe(true);
    const outfit = familiesOf([]).find((f) => f.name === 'Outfit');
    expect(outfit?.styles.some((s) => s.italic)).toBe(false);
    expect(familiesOf([]).find((f) => f.name === 'Bodoni Moda')?.styles.map((s) => s.weight)).not.toContain(300);
  });

  it('puts this computer’s fonts after the bundled ones, and a bundled name wins over a system font of the same name', () => {
    setSystemFonts([
      { name: 'Brand Sans', styles: [{ weight: 400, italic: false, postscriptName: 'BrandSans-Regular' }] },
      { name: 'Jost', styles: [{ weight: 400, italic: false, postscriptName: 'Jost-Regular' }] },
    ]);
    expect(familiesOf(fontsStore.getState().system).map((f) => f.name).slice(-2)).toEqual(['Outfit', 'Brand Sans']);
    expect(availability('Brand Sans', fontsStore.getState())).toBe('system');
    expect(availability('Jost', fontsStore.getState())).toBe('bundled');
  });

  it('draws a missing family in Inter Tight and reports it once per board', () => {
    const state = fontsStore.getState();
    expect(availability('Brand Sans', state)).toBe('missing');
    expect(drawnFamily('Brand Sans', state)).toBe('Inter Tight');
    expect(drawnFamily('Outfit', state)).toBe('Outfit');
    const reported = new Set<string>();
    const names = missingFamilies(['Brand Sans', 'Brand Sans', 'Outfit', 'Other Sans'], state);
    expect(names).toEqual(['Brand Sans', 'Other Sans']);
    expect(unreported('board-1', names, reported)).toEqual(['Brand Sans', 'Other Sans']);
    expect(unreported('board-1', names, reported)).toEqual([]);
    // Another board says it again.
    expect(unreported('board-2', ['Brand Sans'], reported)).toEqual(['Brand Sans']);
  });

  it('does not call a font missing until the list is known', () => {
    const waiting = { status: 'loading' as const, system: [] };
    expect(availability('Brand Sans', waiting)).toBe('pending');
    expect(drawnFamily('Brand Sans', waiting)).toBe('Brand Sans');
    expect(missingFamilies(['Brand Sans'], waiting)).toEqual([]);
  });

  it('keeps a board’s font name and style as stored, never the font’s bytes', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'text', fontFamily: 'Brand Sans', fontWeight: 700, fontItalic: true, text: 'x' }]);
    await projectStore.getState().apply(made.changes);
    expect(Object.keys(records()[made.ids[0] ?? '']?.props ?? {}).sort()).toEqual(['align', 'font_family', 'font_italic', 'font_size', 'font_weight', 'height', 'kind', 'rotation', 'text', 'width', 'x', 'y']);
    expect(records()[made.ids[0] ?? '']?.props.font_family).toBe('Brand Sans');
  });

  it('picks the nearest style: the same slant first, then the closest weight', () => {
    const styles = [
      { weight: 400, italic: false },
      { weight: 700, italic: false },
      { weight: 400, italic: true },
    ];
    expect(nearestStyle(styles, 600, false)).toEqual({ weight: 700, italic: false });
    expect(nearestStyle(styles, 700, true)).toEqual({ weight: 400, italic: true });
    expect(nearestStyle([], 400, false)).toBeNull();
  });

  it('reads the licensing bits and the header Rust sends with a font', () => {
    const bits = fsTypeFromBits(0x0002 | 0x0100);
    expect(bits).toMatchObject({ restricted: true, previewPrint: false, editable: false, noSubsetting: true, bitmapOnly: false });
    expect(fsTypeFromBits(0x0204)).toMatchObject({ previewPrint: true, bitmapOnly: true });
    const payload = new Uint8Array([1, 0x00, 0x08, 9, 9]).buffer;
    const parsed = parseFontPayload(payload);
    expect(parsed?.fsType).toMatchObject({ editable: true, raw: 8 });
    expect([...new Uint8Array(parsed?.data ?? new ArrayBuffer(0))]).toEqual([9, 9]);
    // No OS/2 table: no bits, which is not "installable".
    expect(parseFontPayload(new Uint8Array([0, 0, 0, 7, 7]).buffer)?.fsType).toBeNull();
    expect(parseFontPayload(new Uint8Array([1, 0]).buffer)).toBeNull();
  });
});

describe('review fixes', () => {
  beforeEach(() => {
    fontsStore.setState({ status: 'ready', system: [], broken: [], version: 0 });
  });

  it('rounds a weight to the nearest 100 and reads a sticky colour outside the six as the first', () => {
    const base = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    expect(itemFields({ kind: 'text', ...base, font_weight: 449 })?.fontWeight).toBe(400);
    expect(itemFields({ kind: 'text', ...base, font_weight: 450 })?.fontWeight).toBe(500);
    expect(itemFields({ kind: 'sticky', ...base, color: '#123456' })?.color).toBe(STICKY_COLOURS[0]);
    expect(itemFields({ kind: 'sticky', ...base, color: '#b5ddf5' })?.color).toBe('#B5DDF5');
    expect(itemFields({ kind: 'text', ...base, color: '#123456' })?.color).toBe('#123456');
    expect(STICKY_COLOURS.map(stickyColourName)).toEqual(['Yellow', 'Peach', 'Pink', 'Green', 'Blue', 'Lilac']);
  });

  it('keeps the top edge of a turned text box where it was when its height changes', () => {
    expect(keepTop({ x: 0, y: 0, width: 100, height: 20, rotation: 0 }, 60)).toEqual({ x: 0, y: 0 });
    // Turned a quarter clockwise, the box's top edge faces right: growing it moves its centre along that edge's normal.
    const turned = keepTop({ x: 0, y: 0, width: 100, height: 20, rotation: 90 }, 60);
    expect(turned.x).toBeCloseTo(-20, 1);
    expect(turned.y).toBeCloseTo(-20, 1);
  });

  it('snaps a height-only resize of a text box back to its text', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), kind: 'text', text: 'Short', height: 29 }]);
    await projectStore.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    const stretched = geometryChanges(records(), [{ id, x: 0, y: -40, width: 200, height: 120, rotation: 0 }]);
    expect(stretched).toEqual([]);
  });

  it('draws a failed face in Inter Tight and reports it like a missing one, but not while the list failed', () => {
    fontsStore.setState({ broken: [faceKey('Outfit', 700, false)] });
    const state = fontsStore.getState();
    // Only that face: the family's other faces, and the family itself, are fine.
    expect(cssFamily('Outfit', state, { weight: 700, italic: false })).toBe('"Inter Tight"');
    expect(cssFamily('Outfit', state, { weight: 400, italic: false })).toBe('"Outfit", "Inter Tight"');
    expect(availability('Outfit', state)).toBe('bundled');
    expect(unreadableFamilies([{ fontFamily: 'Outfit', fontWeight: 700, fontItalic: false }, { fontFamily: 'Outfit', fontWeight: 400, fontItalic: false }], state)).toEqual(['Outfit']);
    expect(cssFamily('Jost', state)).toBe('"Jost", "Inter Tight"');
    // A quote or a backslash in a family name can't end the CSS string early.
    const slash = String.fromCharCode(92);
    expect(cssFamily(`A"B${slash}C`, { status: 'loading', system: [] })).toBe(`"A${slash}"B${slash}${slash}C", "Inter Tight"`);
    fontsStore.setState({ broken: [], status: 'failed' });
    expect(availability('Brand Sans', fontsStore.getState())).toBe('pending');
    expect(newlyMissing('b', ['Brand Sans'], fontsStore.getState(), new Set())).toEqual([]);
  });

  it('says a missing font once per board, as the board view does', () => {
    const reported = new Set<string>();
    const state = fontsStore.getState();
    expect(newlyMissing('b', ['Brand Sans', 'Jost'], state, reported)).toEqual(['Brand Sans']);
    expect(newlyMissing('b', ['Brand Sans'], state, reported)).toEqual([]);
  });

  it('starts ready in the browser build, and never asks Rust for a list', async () => {
    // A fresh copy of the module, so the status read is the one it starts with, not one a test set.
    vi.resetModules();
    const fresh = await import('./fonts');
    expect(fresh.fontsStore.getState()).toMatchObject({ status: 'ready', system: [], broken: [] });
    await fresh.loadSystemFonts();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it('reads a rotated text edit, whose position moves with its height, as an edit of the text', async () => {
    const boardId = await board();
    const made = createItems(records(), boardId, [{ ...box(0), width: 60, rotation: 30, kind: 'text', text: 'a', height: 29 }]);
    await projectStore.getState().apply(made.changes);
    moodboardStore.getState().startEditing({ boardId, id: made.ids[0] ?? '', draft: null });
    await finishEditing('a much longer line of words that wraps many times');
    const props = records()[made.ids[0] ?? '']?.props ?? {};
    expect(props.height).toBeGreaterThan(29);
    expect(props.x === 0 && props.y === 0).toBe(false);
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((step) => lineText(step.line));
    expect(lines[0]).toBe('Edited the text of 1 item');
  });

  it('tells the caller an edit was dropped because the project changed while it waited', async () => {
    const boardId = await board();
    const before = await groups();
    const original = projectStore.getState().project;
    const written = await projectStore.getState().applyWith(() => {
      // A switch of project during the wait.
      projectStore.setState({ project: original ? { ...original } : null });
      return { changes: createItems(records(), boardId, [{ ...box(0), kind: 'rect' }]).changes };
    });
    projectStore.setState({ project: original });
    expect(written).toBe(false);
    expect(await groups()).toBe(before);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from '../history/steps';
import { lineText, valueLabel } from '../history/summary';
import { restoreChanges, trashItems } from '../trash/trash';
import { pasteClipboard } from './boardActions';
import { openDepartmentBoard } from './boards';
import { connectorFields } from './connectorFields';
import { grownQuickSeed, canvasLinks, clipConnectorsOf, connectChanges, connectorsOf, connectorStyleChanges, labelChanges, quickCreateChanges } from './connectors';
import { clipOf, createItems, geometryChanges, itemFields, itemsOf, trashItemsChanges } from './items';
import { moodboardStore } from './moodboardStore';

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  moodboardStore.getState().copy([], null, []);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await log(project.file)).length;

const sticky = (x: number, y: number) => ({ kind: 'sticky' as const, x, y, width: 200, height: 200, rotation: 0, text: 'Warm light' });
const rect = (x: number, y: number) => ({ kind: 'rect' as const, x, y, width: 200, height: 120, rotation: 0 });

/** The Camera board with a sticky at the left and a rectangle at the right, joined by a connector. */
async function joined() {
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  const boardId = opened.id;
  const made = createItems(records(), boardId, [sticky(0, 0), rect(500, 40)]);
  await store.getState().apply(made.changes);
  const [a, b] = made.ids as [string, string];
  const drop = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'right' }, to: { item: b, side: 'left' } });
  await store.getState().apply(drop.changes);
  return { boardId, a, b, connector: drop.id as string };
}

describe('the connector record', () => {
  it('is a board_item of kind connector with its ends, route and heads, and draws at the back', async () => {
    const { boardId, a, b, connector } = await joined();
    const record = records()[connector];
    expect(record?.type).toBe('board_item');
    expect(record?.parentId).toBe(boardId);
    expect(record?.props).toEqual({
      kind: 'connector',
      from: { item: a, side: 'right' },
      to: { item: b, side: 'left' },
      route: 'straight',
      start_head: 'none',
      end_head: 'arrow',
      width: 1.5,
    });
    // At the back: its key is before both items'.
    expect((record?.sortKey ?? '') < (records()[a]?.sortKey ?? '')).toBe(true);
    expect((record?.sortKey ?? '') < (records()[b]?.sortKey ?? '')).toBe(true);
    // An item made later is in front of it and shares no key with it.
    const later = createItems(records(), boardId, [rect(0, 400)]);
    await store.getState().apply(later.changes);
    const keys = Object.values(records()).filter((r) => r.type === 'board_item').map((r) => r.sortKey);
    expect(new Set(keys).size).toBe(keys.length);
    // It isn't an item the board's item functions list.
    expect(itemsOf(records(), boardId).map((r) => r.id)).not.toContain(connector);
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('is announced with what it joins, and keeps a free end as a point', async () => {
    const { boardId, a, connector } = await joined();
    expect(canvasLinks(records(), boardId).map((l) => l.label)).toEqual(['Connector from Sticky note to Rectangle']);
    const free = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'top' }, to: { x: 10, y: -300 } });
    await store.getState().apply(free.changes);
    expect(canvasLinks(records(), boardId).map((l) => l.label)).toEqual(['Connector from Sticky note to a point', 'Connector from Sticky note to Rectangle']);
    expect(connectorFields(records()[free.id as string]?.props ?? {})?.to).toEqual({ x: 10, y: -300 });
    expect(connector).not.toBe(free.id);
  });

  it('writes nothing for a connector on one item, an end whose item is gone, or two free ends on the same point', async () => {
    const { boardId, a, connector } = await joined();
    expect(connectChanges(records(), boardId, { id: null, from: { item: a, side: 'right' }, to: { item: a, side: 'left' } }).changes).toEqual([]);
    expect(connectChanges(records(), boardId, { id: null, from: { item: 'gone', side: 'right' }, to: { x: 1, y: 1 } }).changes).toEqual([]);
    expect(connectChanges(records(), boardId, { id: null, from: { x: 4, y: 4 }, to: { x: 4, y: 4 } }).changes).toEqual([]);
    // An end that did not change is no step.
    expect(connectChanges(records(), boardId, { id: connector, from: { item: a, side: 'right' }, to: connectorFields(records()[connector]?.props ?? {})?.to ?? { x: 0, y: 0 } }).changes).toEqual([]);
  });

  it('re-attaches or frees one end with one update', async () => {
    const { boardId, a, b, connector } = await joined();
    const third = createItems(records(), boardId, [sticky(0, 600)]);
    await store.getState().apply(third.changes);
    const c = third.ids[0] as string;
    const before = await groups();
    const moved = connectChanges(records(), boardId, { id: connector, from: { item: a, side: 'right' }, to: { item: c, side: 'auto' } });
    await store.getState().apply(moved.changes);
    expect(await groups()).toBe(before + 1);
    expect(connectorFields(records()[connector]?.props ?? {})?.to).toEqual({ item: c, side: 'auto' });
    const freed = connectChanges(records(), boardId, { id: connector, from: { item: a, side: 'right' }, to: { x: 90, y: 90 } });
    await store.getState().apply(freed.changes);
    expect(connectorFields(records()[connector]?.props ?? {})?.to).toEqual({ x: 90, y: 90 });
    expect(b).toBeDefined();
  });

  it('changes route, heads, colour, width and label, each only when it changes', async () => {
    const { boardId, connector } = await joined();
    expect(connectorStyleChanges(records(), [connector], { route: 'straight', endHead: 'arrow', width: 1.5 })).toEqual([]);
    await store.getState().apply(connectorStyleChanges(records(), [connector], { route: 'elbow', startHead: 'arrow', endHead: 'none', color: '#2C5F8A', width: 3, label: 'Key light' }));
    expect(connectorFields(records()[connector]?.props ?? {})).toMatchObject({ route: 'elbow', startHead: 'arrow', endHead: 'none', color: '#2C5F8A', width: 3, label: 'Key light' });
    expect(canvasLinks(records(), boardId)[0]).toMatchObject({ route: 'elbow', text: 'Key light', color: '#2C5F8A' });
    // A label emptied leaves no prop; a width out of range reads inside it.
    await store.getState().apply(labelChanges(records(), connector, ''));
    expect(records()[connector]?.props.label).toBeUndefined();
    await store.getState().apply(connectorStyleChanges(records(), [connector], { width: 500 }));
    expect(connectorFields(records()[connector]?.props ?? {})?.width).toBe(24);
  });
});

describe('moving an item', () => {
  it('writes nothing to its connectors, and the connector still names the item', async () => {
    const { a, connector } = await joined();
    const before = records()[connector];
    const changes = geometryChanges(records(), [{ id: a, x: 40, y: 20, width: 260, height: 220, rotation: 30 }]);
    expect(changes.map((c) => ('id' in c ? c.id : ''))).toEqual([a]);
    await store.getState().apply(changes);
    expect(records()[connector]).toEqual(before);
  });
});

describe('the Trash', () => {
  it('trashes an item’s connectors with it in one group, and one undo brings both back', async () => {
    const { boardId, a, connector } = await joined();
    const before = await groups();
    await store.getState().apply(trashItemsChanges(records(), [a]));
    expect(await groups()).toBe(before + 1);
    expect(records()[connector]?.trashedAt).not.toBeNull();
    expect(records()[connector]?.trashedAt).toBe(records()[a]?.trashedAt);
    expect(connectorsOf(records(), boardId)).toEqual([]);
    await store.getState().undo();
    expect(records()[a]?.trashedAt).toBeNull();
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('lists the item, not the connector that went with it, and Restore brings both back', async () => {
    const { boardId, a, connector } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [a]));
    const rows = trashItems(records(), project.projectId);
    expect(rows.map((r) => r.id)).toEqual([a]);
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('lists a connector deleted on its own, by the board, and restores it alone', async () => {
    const { boardId, connector } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [connector]));
    const rows = trashItems(records(), project.projectId);
    expect(rows.map((r) => [r.id, r.name])).toEqual([[connector, 'Connector on Camera board']]);
    expect(connectorsOf(records(), boardId)).toEqual([]);
    await store.getState().apply(restoreChanges(records(), project.projectId, connector));
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('keeps a restored connector hidden while one of its items is in the Trash, and shows it when that item is back', async () => {
    const { boardId, b, connector } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [connector]));
    await store.getState().apply(trashItemsChanges(records(), [b]));
    await store.getState().apply(restoreChanges(records(), project.projectId, connector));
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId)).toEqual([]);
    await store.getState().apply(restoreChanges(records(), project.projectId, b));
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('brings a connector back with the item it was trashed with even when its other item is still in the Trash, hidden until that one is back', async () => {
    const { boardId, a, b, connector } = await joined();
    // Both items deleted together take the connector with them.
    await store.getState().apply(trashItemsChanges(records(), [a, b]));
    expect(records()[connector]?.trashedAt).not.toBeNull();
    expect(trashItems(records(), project.projectId).map((r) => r.id).sort()).toEqual([a, b].sort());
    // Restoring one restores the connector with it; it stays hidden, and is never listed on its own.
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId)).toEqual([]);
    expect(trashItems(records(), project.projectId).map((r) => r.id)).toEqual([b]);
    // The other one back, and it shows.
    await store.getState().apply(restoreChanges(records(), project.projectId, b));
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('restores an item whose board is in the Trash with the board and the connectors that went with the item', async () => {
    const { boardId, a, connector } = await joined();
    const { trashBoardChanges } = await import('./boards');
    await store.getState().apply(trashItemsChanges(records(), [a]));
    await store.getState().apply(trashBoardChanges(records(), boardId));
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(records()[boardId]?.trashedAt).toBeNull();
    expect(records()[a]?.trashedAt).toBeNull();
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('is purged by Empty Trash with the item it went with', async () => {
    const { a, connector } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [a]));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(records()[a]).toBeUndefined();
    expect(records()[connector]).toBeUndefined();
  });

  it('also deletes for good a live connector whose item is deleted for good (a connector restored after its item was trashed)', async () => {
    const { boardId, a, b, connector } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [connector]));
    await store.getState().apply(trashItemsChanges(records(), [b]));
    await store.getState().apply(restoreChanges(records(), project.projectId, connector));
    expect(records()[connector]?.trashedAt).toBeNull();
    const { emptyTrashConfirmed } = await import('../../app/deleteForGood');
    const done = await emptyTrashConfirmed(store, { current: false }, () => Promise.resolve(true));
    expect(done.ran).toBe(true);
    expect(records()[b]).toBeUndefined();
    expect(records()[connector]).toBeUndefined();
    expect(records()[a]).toBeDefined();
    expect(connectorsOf(records(), boardId)).toEqual([]);
  });

  it('keeps a connector whose item is restored while the Empty Trash confirm is up', async () => {
    const { boardId, b, connector } = await joined();
    const other = createItems(records(), boardId, [rect(0, 400)]);
    await store.getState().apply(other.changes);
    await store.getState().apply(trashItemsChanges(records(), [b]));
    await store.getState().apply(trashItemsChanges(records(), [other.ids[0] as string]));
    const { emptyTrashConfirmed } = await import('../../app/deleteForGood');
    const done = await emptyTrashConfirmed(store, { current: false }, async () => {
      // Someone restores the item while the question is open.
      await store.getState().apply(restoreChanges(records(), project.projectId, b));
      return true;
    });
    expect(done.ran).toBe(true);
    expect(records()[other.ids[0] as string]).toBeUndefined();
    expect(records()[b]?.trashedAt).toBeNull();
    expect(records()[connector]?.trashedAt).toBeNull();
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });

  it('never deletes an extra record that has children', async () => {
    const { boardId, a } = await joined();
    await store.getState().apply(trashItemsChanges(records(), [a]));
    await store.getState().emptyTrash(undefined, () => [boardId]);
    expect(records()[a]).toBeUndefined();
    expect(records()[boardId]).toBeDefined();
  });

  it('trashes a board’s connectors with the board and brings them back with it', async () => {
    const { boardId, connector } = await joined();
    const { trashBoardChanges } = await import('./boards');
    await store.getState().apply(trashBoardChanges(records(), boardId));
    expect(records()[connector]?.trashedAt).not.toBeNull();
    expect(trashItems(records(), project.projectId).map((r) => r.kind)).toEqual(['board']);
    await store.getState().apply(restoreChanges(records(), project.projectId, boardId));
    expect(connectorsOf(records(), boardId).map((r) => r.id)).toEqual([connector]);
  });
});

describe('copy and paste', () => {
  const connectorsOnBoard = (boardId: string) => connectorsOf(records(), boardId).map((r) => connectorFields(r.props));

  it('pastes a connector whose two items are copied attached to their copies', async () => {
    const { boardId, a, b, connector } = await joined();
    const selected = [a, b, connector];
    const clip = clipOf(records(), boardId, selected);
    const connectors = clipConnectorsOf(records(), boardId, selected);
    await pasteClipboard(boardId, null, clip, store, connectors);
    const all = connectorsOnBoard(boardId);
    expect(all).toHaveLength(2);
    const copies = itemsOf(records(), boardId).map((r) => r.id).filter((id) => ![a, b].includes(id));
    expect(copies).toHaveLength(2);
    const pasted = all.find((f) => f && 'item' in f.from && copies.includes(f.from.item));
    expect(pasted).toMatchObject({ from: { item: copies[0], side: 'right' }, to: { item: copies[1], side: 'left' }, route: 'straight', endHead: 'arrow' });
    // The original is untouched.
    expect(connectorFields(records()[connector]?.props ?? {})?.from).toEqual({ item: a, side: 'right' });
  });

  it('pastes the end of an item not copied as a free end where it was', async () => {
    const { boardId, a, b, connector } = await joined();
    const selected = [a, connector];
    const connectors = clipConnectorsOf(records(), boardId, selected);
    expect(connectors).toHaveLength(1);
    await pasteClipboard(boardId, null, clipOf(records(), boardId, selected), store, connectors);
    const copy = itemsOf(records(), boardId).map((r) => r.id).find((id) => ![a, b].includes(id)) ?? '';
    const pasted = connectorsOnBoard(boardId).find((f) => f && 'item' in f.from && f.from.item === copy);
    // The right side of the rectangle's left edge at (500, 100) is where the end was.
    expect(pasted?.to).toEqual({ x: 500, y: 100 });
    // The sticky stays attached to nothing else: only the copy and the original share the right-hand end.
    expect(connectorsOnBoard(boardId)).toHaveLength(2);
  });

  it('pastes a connector copied alone with both ends free, moved by the paste offset so it is not on the original', async () => {
    const { boardId, connector } = await joined();
    const connectors = clipConnectorsOf(records(), boardId, [connector]);
    await pasteClipboard(boardId, null, [], store, connectors);
    const all = connectorsOnBoard(boardId);
    expect(all).toHaveLength(2);
    const copy = all.find((f) => f && !('item' in f.from) && !('item' in f.to));
    expect(copy).toMatchObject({ from: { x: 216, y: 116 }, to: { x: 516, y: 116 } });
    // At the pointer: the group’s middle lands on it.
    await pasteClipboard(boardId, { x: 1000, y: 1000 }, [], store, connectors);
    expect(connectorsOnBoard(boardId).some((f) => f && !('item' in f.from) && f.from.x === 850 && f.from.y === 1000 && !('item' in f.to) && f.to.x === 1150 && f.to.y === 1000)).toBe(true);
  });

  it('copies the label as the words the system clipboard gets, with the style', async () => {
    const { boardId, connector } = await joined();
    await store.getState().apply(connectorStyleChanges(records(), [connector], { label: 'Key light', color: '#C23B5A', route: 'curved' }));
    const [clip] = clipConnectorsOf(records(), boardId, [connector]);
    expect(clip).toMatchObject({ label: 'Key light', color: '#C23B5A', route: 'curved' });
  });
});

describe('quick-create', () => {
  it('makes a copy of the item’s kind and style 80 units beyond a side, with a connector, in one group', async () => {
    const { boardId, a } = await joined();
    const before = await groups();
    const made = quickCreateChanges(records(), boardId, a, 'bottom');
    expect(made).not.toBeNull();
    if (!made) return;
    await store.getState().apply(made.changes);
    expect(await groups()).toBe(before + 1);
    const copy = itemFields(records()[made.itemId]?.props ?? {});
    // Below the 200 x 200 sticky at (0, 0): its top is 80 under the original's bottom, aligned to it.
    expect(copy).toMatchObject({ kind: 'sticky', x: 0, y: 280, width: 200, height: 200, rotation: 0, text: '' });
    expect(made.edit).toBe(true);
    const link = connectorFields(records()[made.connectorId]?.props ?? {});
    expect(link).toMatchObject({ from: { item: a, side: 'bottom' }, to: { item: made.itemId, side: 'top' } });
    // Behind the items, like every connector.
    expect((records()[made.connectorId]?.sortKey ?? '') < (records()[a]?.sortKey ?? '')).toBe(true);
    // One undo takes both back.
    await store.getState().undo();
    expect(records()[made.itemId]).toBeUndefined();
    expect(records()[made.connectorId]).toBeUndefined();
  });

  it('keeps the style and turns with a turned item, on every side', async () => {
    const opened = openDepartmentBoard(records(), project.projectId, 'camera');
    await store.getState().apply(opened.changes);
    const made = createItems(records(), opened.id, [{ kind: 'ellipse', x: 0, y: 0, width: 100, height: 60, rotation: 90, fill: '#2F6B4F', stroke: '#16150F' }]);
    await store.getState().apply(made.changes);
    const id = made.ids[0] as string;
    // Turned a quarter, the box's "right" side faces down: the copy goes below, still turned.
    const q = quickCreateChanges(records(), opened.id, id, 'right');
    if (!q) throw new Error('no copy');
    await store.getState().apply(q.changes);
    const copy = itemFields(records()[q.itemId]?.props ?? {});
    expect(copy).toMatchObject({ kind: 'ellipse', fill: '#2F6B4F', stroke: '#16150F', rotation: 90, width: 100, height: 60 });
    expect(copy?.x).toBeCloseTo(0, 5);
    // Centre to centre along the turned axis: 100 wide + 80 = 180 below the original's middle (50, 30).
    expect((copy?.y ?? 0) + 30).toBeCloseTo(30 + 180, 5);
    expect(q.edit).toBe(false);
    // A picture, a video card and a link can't be copied this way; neither can an item that isn't there.
    const others = createItems(records(), opened.id, [{ kind: 'picture', x: 0, y: 300, width: 100, height: 60, rotation: 0 }, { kind: 'link', x: 300, y: 300, width: 280, height: 88, rotation: 0, url: 'https://example.com' }]);
    await store.getState().apply(others.changes);
    for (const other of others.ids) expect(quickCreateChanges(records(), opened.id, other, 'left')).toBeNull();
    expect(quickCreateChanges(records(), opened.id, 'nothing', 'left')).toBeNull();
  });
});

describe('a quick-created text box that grows', () => {
  const seed = { kind: 'text' as const, x: 100, y: 200, width: 240, height: 29, rotation: 0 };
  it('keeps its bottom edge above, its top edge below and its middle to the sides', () => {
    const taller = { ...seed, height: 89 };
    expect(grownQuickSeed(seed, taller, 'top')).toMatchObject({ y: 140, height: 89 });
    expect(grownQuickSeed(seed, taller, 'bottom')).toMatchObject({ y: 200, height: 89 });
    expect(grownQuickSeed(seed, taller, 'right')).toMatchObject({ y: 170, height: 89 });
    expect(grownQuickSeed(seed, taller, 'left')).toMatchObject({ y: 170, height: 89 });
    expect(grownQuickSeed(seed, seed, 'top')).toEqual(seed);
  });
});

describe('History', () => {
  it('shows a connector’s ends as an item or a point, and its route and arrowheads in words', () => {
    expect(valueLabel('to', { item: 'abc', side: 'left' })).toBe('an item');
    expect(valueLabel('from', { x: 1, y: 2 })).toBe('a point');
    expect(valueLabel('route', 'elbow')).toBe('elbow');
    expect(valueLabel('end_head', 'arrow')).toBe('arrowhead');
    setLocale('es');
    expect(valueLabel('route', 'curved')).toBe('curvo');
  });

  const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).reverse();

  it('says a connector drawn between two items, its label, its ends, its look and a copy made with a connector', async () => {
    const { boardId, a, connector } = await joined();
    await store.getState().apply(labelChanges(records(), connector, 'Key'));
    const third = createItems(records(), boardId, [sticky(0, 600)]);
    await store.getState().apply(third.changes);
    await store.getState().apply(connectChanges(records(), boardId, { id: connector, from: { item: a, side: 'right' }, to: { item: third.ids[0] as string, side: 'top' } }).changes);
    await store.getState().apply(connectorStyleChanges(records(), [connector], { route: 'curved' }));
    const quick = quickCreateChanges(records(), boardId, a, 'left');
    await store.getState().apply(quick?.changes ?? []);
    await store.getState().apply(trashItemsChanges(records(), [connector]));
    const free = connectChanges(records(), boardId, { id: null, from: { item: a, side: 'top' }, to: { x: 0, y: -200 } });
    await store.getState().apply(free.changes);
    expect((await lines()).slice(2)).toEqual([
      'Connected 2 items',
      'Changed a connector’s label',
      'Added a sticky note',
      'Reconnected a connector',
      'Changed a connector',
      'Added a sticky note and a connector',
      'Deleted a connector',
      'Added a connector',
    ]);
    setLocale('es');
    expect((await lines()).slice(2, 5)).toEqual(['Se conectaron 2 elementos', 'Se cambió la etiqueta de un conector', 'Se agregó una nota adhesiva']);
  });
});

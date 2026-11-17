import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { duplicateSelection, finishEditing, pasteClipboard } from './boardActions';
import { openDepartmentBoard } from './boards';
import { isConnector } from './connectorFields';
import { clipConnectorsOf, connectorProps, createConnectors, madeWithJoined, quickCreateChanges } from './connectors';
import { clipOf, createItems } from './items';
import { moodboardStore } from './moodboardStore';
import { duplicatePageChanges } from './pages';

// Items and connectors made in one group never share a key (6.25, Kevin: "Pasting items with connectors into an empty
// board gives two items the same key"). On an empty board the new items and the new connectors both start from the
// first key there is, so the group is keyed as one sequence, connectors behind items. A board that has items already
// keeps them apart, and gets exactly keyBetween's keys, as before.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const item = (id: string, sortKey: string, kind: string, x = 0, extra: Props = {}) =>
  record(id, 'board_item', 'b', { kind, x, y: 0, width: 100, height: 100, rotation: 0, ...extra }, sortKey);
const board = (...items: SbdRecord[]) => recordsOf(record('p', 'project', null, { name: 'Keys' }), record('b', 'board', 'p', { kind: 'deck', name: 'Deck' }), ...items);

/** The changes as the store would apply them: a create or a move. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const itemsOn = (records: Records, boardId: string): SbdRecord[] =>
  Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === boardId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
const keysUniqueOn = (records: Records, boardId: string) => {
  const keys = itemsOn(records, boardId).map((r) => r.sortKey);
  return new Set(keys).size === keys.length;
};
/** Every connector's key strictly under every other item's: a tie would be broken by id, and could draw it on top. */
const connectorsBehind = (records: Records, boardId: string, among: readonly string[]) => {
  const made = itemsOn(records, boardId).filter((r) => among.includes(r.id));
  const wires = made.filter((r) => isConnector(r));
  const others = made.filter((r) => !isConnector(r));
  return wires.every((w) => others.every((o) => w.sortKey < o.sortKey));
};
const keysOf = (changes: readonly Change[]) => changes.map((c) => (c.kind === 'create' ? c.record.sortKey : c.kind));

const rect = (x: number) => ({ kind: 'rect' as const, x, y: 0, width: 100, height: 100, rotation: 0 });
const free = { from: { x: 0, y: 0 }, to: { x: 50, y: 50 } };

describe('items and connectors made in one group (6.25)', () => {
  it('on an empty board the two lists would tie: keyed as one sequence, the connectors behind the items', () => {
    const empty = board();
    const made = createItems(empty, 'b', [rect(0), rect(300)]);
    const joined = createConnectors(empty, 'b', [free, { from: { item: made.ids[0] ?? '', side: 'right' }, to: { item: made.ids[1] ?? '', side: 'left' } }]);
    // What went wrong: both lists begin at the same key.
    expect(keysOf(made.changes)[0]).toBe(keysOf(joined.changes)[0]);
    const changes = madeWithJoined(empty, 'b', made.changes, joined.changes);
    const after = applied(empty, changes);
    expect(itemsOn(after, 'b').map((r) => r.id)).toEqual([...joined.ids, ...made.ids]);
    expect(keysUniqueOn(after, 'b')).toBe(true);
    expect(connectorsBehind(after, 'b', [...made.ids, ...joined.ids])).toBe(true);
    // Nothing else is written: each record made takes its key in its own create.
    expect(changes.map((c) => c.kind)).toEqual(['create', 'create', 'create', 'create']);
  });

  it('items alone or connectors alone on an empty board keep keyBetween’s keys', () => {
    const empty = board();
    const made = createItems(empty, 'b', [rect(0), rect(300)]);
    const joined = createConnectors(empty, 'b', [free, free]);
    expect(madeWithJoined(empty, 'b', made.changes)).toEqual(made.changes);
    expect(madeWithJoined(empty, 'b', [], joined.changes)).toEqual(joined.changes);
    const first = keyBetween(null, null);
    expect(keysOf(made.changes)).toEqual([first, keyBetween(first, null)]);
    expect(keysOf(joined.changes)).toEqual([first, keyBetween(first, null)]);
  });

  it('a board with one item: the two lists exactly, keyBetween’s keys', () => {
    const one = board(item('r1', 'V', 'rect'));
    const made = createItems(one, 'b', [rect(300), rect(600)]);
    const joined = createConnectors(one, 'b', [free, free]);
    expect(madeWithJoined(one, 'b', made.changes, joined.changes)).toEqual([...made.changes, ...joined.changes]);
    const front = keyBetween('V', null);
    const back = keyBetween(null, 'V');
    expect(keysOf([...made.changes, ...joined.changes])).toEqual([front, keyBetween(front, null), back, keyBetween(back, 'V')]);
  });

  it('quick-create beside a board’s only item: the copy after it, the connector before it, keyBetween’s keys', () => {
    const one = board(item('r1', 'V', 'rect'));
    const made = quickCreateChanges(one, 'b', 'r1', 'bottom');
    if (!made) throw new Error('no quick-create');
    expect(keysOf(made.changes)).toEqual([keyBetween('V', null), keyBetween(null, 'V')]);
    const after = applied(one, made.changes);
    expect(itemsOn(after, 'b').map((r) => r.id)).toEqual([made.connectorId, 'r1', made.itemId]);
    expect(keysUniqueOn(after, 'b')).toBe(true);
  });

  it('a duplicated page with its contents: unique keys, the connector’s copy behind, keyBetween’s keys', () => {
    const inside = { y: 100 };
    const deck = board(
      item('w1', 'a', 'connector', 0, connectorProps({ from: { item: 'r1', side: 'right' }, to: { item: 'r2', side: 'left' } })),
      item('p1', 'b', 'page', 0, { width: 1920, height: 1080, format: '16:9', orientation: 'portrait', name: '' }),
      item('r1', 'd', 'rect', 100, inside),
      item('r2', 'f', 'rect', 400, inside),
    );
    const made = duplicatePageChanges(deck, 'b', 'p1');
    if (!made) throw new Error('no copy');
    const after = applied(deck, made.changes);
    const before = new Set(Object.keys(deck));
    const copies = itemsOn(after, 'b').filter((r) => !before.has(r.id));
    expect(copies).toHaveLength(4);
    expect(keysUniqueOn(after, 'b')).toBe(true);
    expect(connectorsBehind(after, 'b', copies.map((r) => r.id))).toBe(true);
    // The board's own records are where they were: only creates.
    expect(made.changes.every((c) => c.kind === 'create')).toBe(true);
    const front = keyBetween('f', null);
    expect(copies.map((r) => r.sortKey)).toEqual([keyBetween(null, 'a'), keyBetween('b', 'd'), front, keyBetween(front, null)]);
    expect(copies.map((r) => r.props.kind)).toEqual(['connector', 'page', 'rect', 'rect']);
  });
});

describe('Paste, Duplicate and the text quick-create through the board (6.25)', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    setLocale('en');
    folder = makeTestFolder();
    project = await createProject(folder.path('Empty Board.sbd'), { driver: nodeDriver, backups: false });
    await projectStore.getState().open(project);
    moodboardStore.setState({ editing: null, selections: {}, tool: 'select', openBoardId: null });
  });
  afterEach(async () => {
    await projectStore.getState().close();
    folder.remove();
  });

  const records = () => projectStore.getState().records as Records;

  async function openBoard(department: 'camera' | 'art'): Promise<string> {
    const opened = openDepartmentBoard(records(), project.projectId, department);
    await projectStore.getState().apply(opened.changes);
    return opened.id;
  }

  /** Two items and the connector between them, made as the app makes them: the items first, the connector after. */
  async function joinedPair(boardId: string, kind: 'rect' | 'text' = 'rect'): Promise<[string, string, string]> {
    const seed = (x: number) => (kind === 'text' ? { kind, x, y: 0, width: 100, height: 40, rotation: 0, text: 'Hi' } : { kind, x, y: 0, width: 100, height: 40, rotation: 0 });
    const made = createItems(records(), boardId, [seed(0), seed(400)]);
    await projectStore.getState().apply(made.changes);
    const [r1, r2] = made.ids as [string, string];
    const joined = createConnectors(records(), boardId, [{ from: { item: r1, side: 'right' }, to: { item: r2, side: 'left' } }]);
    await projectStore.getState().apply(joined.changes);
    return [joined.ids[0] as string, r1, r2];
  }

  it('Paste into an empty board: every key unique, the connector’s copy behind the items’ copies', async () => {
    const from = await openBoard('camera');
    const ids = await joinedPair(from);
    const to = await openBoard('art');
    expect(itemsOn(records(), to)).toHaveLength(0);
    const clip = clipOf(records(), from, ids);
    const connectors = clipConnectorsOf(records(), from, ids);
    expect(clip).toHaveLength(2);
    expect(connectors).toHaveLength(1);
    await pasteClipboard(to, null, clip, projectStore, connectors);
    const pasted = itemsOn(records(), to);
    expect(pasted.map((r) => r.props.kind)).toEqual(['connector', 'rect', 'rect']);
    expect(keysUniqueOn(records(), to)).toBe(true);
    expect(connectorsBehind(records(), to, pasted.map((r) => r.id))).toBe(true);
    // The board it was copied from is as it was.
    expect(itemsOn(records(), from).map((r) => r.id)).toEqual(ids);
  });

  it('Paste into a board with items: exactly keyBetween’s keys, the board’s own as they were', async () => {
    const boardId = await openBoard('camera');
    const ids = await joinedPair(boardId);
    const was = ids.map((id) => records()[id]?.sortKey ?? '');
    const [first, , last] = was as [string, string, string];
    const before = new Set(Object.keys(records()));
    await pasteClipboard(boardId, null, clipOf(records(), boardId, ids), projectStore, clipConnectorsOf(records(), boardId, ids));
    expect(ids.map((id) => records()[id]?.sortKey)).toEqual(was);
    const made = itemsOn(records(), boardId).filter((r) => !before.has(r.id));
    const front = keyBetween(last, null);
    expect(made.map((r) => r.sortKey)).toEqual([keyBetween(null, first), front, keyBetween(front, null)]);
    expect(made.map((r) => r.props.kind)).toEqual(['connector', 'rect', 'rect']);
    expect(keysUniqueOn(records(), boardId)).toBe(true);
  });

  it('Duplicate of everything on a board: exactly keyBetween’s keys, the connector’s copy behind', async () => {
    const boardId = await openBoard('camera');
    const ids = await joinedPair(boardId);
    const was = ids.map((id) => records()[id]?.sortKey ?? '');
    const [first, , last] = was as [string, string, string];
    moodboardStore.getState().select(boardId, ids);
    const before = new Set(Object.keys(records()));
    await duplicateSelection(boardId, projectStore);
    expect(ids.map((id) => records()[id]?.sortKey)).toEqual(was);
    const made = itemsOn(records(), boardId).filter((r) => !before.has(r.id));
    const front = keyBetween(last, null);
    expect(made.map((r) => r.sortKey)).toEqual([keyBetween(null, first), front, keyBetween(front, null)]);
    expect(connectorsBehind(records(), boardId, made.map((r) => r.id))).toBe(true);
    expect(keysUniqueOn(records(), boardId)).toBe(true);
  });

  it('the text quick-create beside a board’s only item: the box after it, the connector before it', async () => {
    const boardId = await openBoard('camera');
    const made = createItems(records(), boardId, [{ kind: 'text', x: 0, y: 0, width: 100, height: 40, rotation: 0, text: 'Hi' }]);
    await projectStore.getState().apply(made.changes);
    const source = made.ids[0] as string;
    const key = records()[source]?.sortKey ?? '';
    const id = crypto.randomUUID();
    moodboardStore.getState().startEditing({ boardId, id, draft: { kind: 'text', x: 0, y: 200, width: 100, height: 40, rotation: 0 }, join: { item: source, side: 'bottom' } });
    await finishEditing('Next');
    const after = itemsOn(records(), boardId);
    expect(after.map((r) => r.id).slice(1)).toEqual([source, id]);
    expect(after.map((r) => r.sortKey)).toEqual([keyBetween(null, key), key, keyBetween(key, null)]);
    expect(isConnector(after[0])).toBe(true);
  });
});

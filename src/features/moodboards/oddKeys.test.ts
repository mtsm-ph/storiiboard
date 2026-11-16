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
import { clipConnectorsOf, connectorProps, createConnectors, madeWithJoined, quickCreateChanges } from './connectors';
import { clipOf, createItems, reorderChanges } from './items';
import { moodboardStore } from './moodboardStore';
import { duplicatePageChanges, movePageChanges, pagesOf } from './pages';
import { createSectionChanges } from './sections';

// A board's writes past a sort key keyBetween can't read (6.23, Kevin: "an unreadable one from an odd imported file never
// makes it throw"): a new item goes after the last key that can be read; a key asked between two stored ones is kept
// in the order asked for by writing the board's items afresh, in the same group. A sound file's keys are keyBetween's.

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
const page = (id: string, sortKey: string, x: number) => item(id, sortKey, 'page', x, { width: 1920, height: 1080, format: '16:9', orientation: 'portrait', name: '' });
const board = (...items: SbdRecord[]) => recordsOf(record('p', 'project', null, { name: 'Odd' }), record('b', 'board', 'p', { kind: 'deck', name: 'Deck' }), ...items);

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

/** The board's items back to front, as their keys sort. */
const order = (records: Records): string[] =>
  Object.values(records)
    .filter((r) => r.type === 'board_item' && r.parentId === 'b')
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((r) => r.id);

const unique = (records: Records) => new Set(Object.values(records).filter((r) => r.parentId === 'b').map((r) => r.sortKey)).size === order(records).length;

const ODD = '~';

describe('a board past a key that can’t be read (6.23)', () => {
  it('makes items after the last readable key; a sound board’s key as before', () => {
    const odd = board(item('r1', 'b', 'rect'), item('r2', ODD, 'rect'));
    const made = createItems(odd, 'b', [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, { kind: 'rect', x: 0, y: 0, width: 10, height: 10, rotation: 0 }]);
    const after = applied(odd, made.changes);
    expect(made.ids.map((id) => after[id]?.sortKey)).toEqual([keyBetween('b', null), keyBetween(keyBetween('b', null), null)]);
    const sound = board(item('r1', 'b', 'rect'), item('r2', 'd', 'rect'));
    const plain = createItems(sound, 'b', [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, rotation: 0 }]);
    expect(plain.changes[0]?.kind === 'create' ? plain.changes[0].record.sortKey : null).toBe(keyBetween('d', null));
  });

  it('Bring to front and Send to back give the order asked for; a sound board’s key as before', () => {
    const odd = board(item('r1', 'b', 'rect'), item('r2', 'd', 'rect'), item('r3', ODD, 'rect'));
    const front = applied(odd, reorderChanges(odd, 'b', ['r1'], 'front'));
    expect(order(front)).toEqual(['r2', 'r3', 'r1']);
    expect(unique(front)).toBe(true);
    const first = board(item('r1', '!', 'rect'), item('r2', 'd', 'rect'), item('r3', 'e', 'rect'));
    expect(order(applied(first, reorderChanges(first, 'b', ['r3'], 'back')))).toEqual(['r3', 'r1', 'r2']);
    const sound = board(item('r1', 'b', 'rect'), item('r2', 'd', 'rect'), item('r3', 'e', 'rect'));
    expect(reorderChanges(sound, 'b', ['r1'], 'front')).toEqual([{ kind: 'move', id: 'r1', parentId: 'b', sortKey: keyBetween('e', null) }]);
    expect(reorderChanges(sound, 'b', ['r3'], 'back')).toEqual([{ kind: 'move', id: 'r3', parentId: 'b', sortKey: keyBetween(null, 'b') }]);
  });

  it('makes connectors at the back past an odd first key; a sound board’s keys as before', () => {
    const ends = { from: { x: 0, y: 0 }, to: { x: 50, y: 50 } };
    const odd = board(item('r1', '!', 'rect'), item('r2', 'd', 'rect'));
    const made = createConnectors(odd, 'b', [ends, ends]);
    const after = applied(odd, made.changes);
    expect(order(after)).toEqual([...made.ids, 'r1', 'r2']);
    expect(unique(after)).toBe(true);
    const sound = board(item('r1', 'b', 'rect'), item('r2', 'd', 'rect'));
    const plain = createConnectors(sound, 'b', [ends, ends]);
    const first = keyBetween(null, 'b');
    expect(plain.changes.map((c) => (c.kind === 'create' ? c.record.sortKey : c.kind))).toEqual([first, keyBetween(first, 'b')]);
  });

  it('puts a section drawn round another just under it past an odd key before it; a sound board’s key as before', () => {
    const odd = board(item('x', '!', 'rect', 5000), item('s1', 'd', 'section', 0, { name: '' }), item('r1', 'e', 'rect', 5000));
    const made = createSectionChanges(odd, 'b', { x: -50, y: -50, width: 300, height: 300, rotation: 0 });
    const after = applied(odd, made.changes);
    expect(order(after)).toEqual(['x', made.id, 's1', 'r1']);
    expect(unique(after)).toBe(true);
    const sound = board(item('x', 'b', 'rect', 5000), item('s1', 'd', 'section', 0, { name: '' }));
    const plain = createSectionChanges(sound, 'b', { x: -50, y: -50, width: 300, height: 300, rotation: 0 });
    expect(plain.changes).toHaveLength(1);
    expect(plain.changes[0]?.kind === 'create' ? plain.changes[0].record.sortKey : null).toBe(keyBetween('b', 'd'));
  });

  it('moves a deck’s page past an odd key in the order asked for; a sound deck’s key as before', () => {
    const odd = board(page('p1', 'b', 0), page('p2', 'd', 2200), page('p3', ODD, 4400));
    expect(pagesOf(odd, 'b').map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    const last = applied(odd, movePageChanges(odd, 'b', 'p1', 2));
    expect(pagesOf(last, 'b').map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
    const middle = applied(odd, movePageChanges(odd, 'b', 'p3', 1));
    expect(pagesOf(middle, 'b').map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(unique(middle)).toBe(true);
    const sound = board(page('p1', 'b', 0), page('p2', 'd', 2200), page('p3', 'e', 4400));
    expect(movePageChanges(sound, 'b', 'p1', 1)).toEqual([{ kind: 'move', id: 'p1', parentId: 'b', sortKey: keyBetween('d', 'e') }]);
  });

  it('duplicates a page just after it past an odd key after it; a sound deck’s key as before', () => {
    const odd = board(page('p1', 'b', 0), page('p2', 'd', 2200), page('p3', ODD, 4400));
    const made = duplicatePageChanges(odd, 'b', 'p2');
    if (!made) throw new Error('no copy');
    const after = applied(odd, made.changes);
    expect(pagesOf(after, 'b').map((p) => p.id)).toEqual(['p1', 'p2', made.id, 'p3']);
    expect(unique(after)).toBe(true);
    const sound = board(page('p1', 'b', 0), page('p2', 'd', 2200), page('p3', 'e', 4400));
    const plain = duplicatePageChanges(sound, 'b', 'p2');
    expect(plain?.changes.map((c) => (c.kind === 'create' ? c.record.sortKey : c.kind))).toEqual([keyBetween('d', 'e')]);
  });

  it('quick-creates a copy in front with its connector at the back past odd keys, every key unique (6.23 review, M1)', () => {
    const odd = board(item('r1', '!', 'rect'), item('r2', ODD, 'rect', 500));
    const made = quickCreateChanges(odd, 'b', 'r1', 'bottom');
    if (!made) throw new Error('no quick-create');
    const after = applied(odd, made.changes);
    expect(order(after)).toEqual([made.connectorId, 'r1', 'r2', made.itemId]);
    expect(unique(after)).toBe(true);
    // A move of a record made in the group never goes with it: each new one takes its key in its create.
    expect(made.changes.flatMap((c) => (c.kind === 'move' ? [c.id] : []))).toEqual(['r1', 'r2']);
  });

  it('a sound board’s quick-create is the item and the connector alone, as before this round', () => {
    const sound = board(item('r1', 'b', 'rect'), item('r2', 'd', 'rect', 500));
    const made = quickCreateChanges(sound, 'b', 'r1', 'bottom');
    if (!made) throw new Error('no quick-create');
    expect(made.changes.map((c) => (c.kind === 'create' ? c.record.sortKey : c.kind))).toEqual([keyBetween('d', null), keyBetween(null, 'b')]);
    // madeWithJoined hands a sound group's two lists back exactly, made then joined.
    const items = createItems(sound, 'b', [{ kind: 'rect', x: 0, y: 300, width: 100, height: 100, rotation: 0 }]).changes;
    const joined = createConnectors(sound, 'b', [{ from: { item: 'r1', side: 'bottom' }, to: { x: 0, y: 0 } }]).changes;
    expect(madeWithJoined(sound, 'b', items, joined)).toEqual([...items, ...joined]);
  });
});

describe('quick-create, Paste and Duplicate through the board past odd keys (6.23 review, M1)', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    setLocale('en');
    folder = makeTestFolder();
    project = await createProject(folder.path('Odd Board.sbd'), { driver: nodeDriver, backups: false });
    await projectStore.getState().open(project);
    moodboardStore.setState({ editing: null, selections: {}, tool: 'select', openBoardId: null });
  });
  afterEach(async () => {
    await projectStore.getState().close();
    folder.remove();
  });

  const records = () => projectStore.getState().records as Records;
  const boardOrder = (boardId: string) =>
    Object.values(records())
      .filter((r) => r.type === 'board_item' && r.parentId === boardId)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((r) => r.id);
  const keysUnique = (boardId: string) => {
    const keys = Object.values(records()).filter((r) => r.type === 'board_item' && r.parentId === boardId).map((r) => r.sortKey);
    return new Set(keys).size === keys.length;
  };

  /** A board with r1 and r2 (rects, or text boxes) and a connector between them, at the keys given. */
  async function oddBoard(keys: { connector: string; r1: string; r2: string }, kind = 'rect', department: 'camera' | 'art' = 'camera'): Promise<{ boardId: string; ids: [string, string, string] }> {
    const opened = openDepartmentBoard(records(), project.projectId, department);
    await projectStore.getState().apply(opened.changes);
    const [c, r1, r2] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const extra = kind === 'text' ? { text: 'Hi', font_family: 'Inter Tight', font_weight: 400, font_italic: false, font_size: 24, align: 'left' } : {};
    const at = (x: number) => ({ kind, x, y: 0, width: 100, height: 40, rotation: 0, ...extra });
    await projectStore.getState().apply([
      { kind: 'create', record: { id: r1, type: 'board_item', parentId: opened.id, sortKey: keys.r1, props: at(0) } },
      { kind: 'create', record: { id: r2, type: 'board_item', parentId: opened.id, sortKey: keys.r2, props: at(400) } },
      { kind: 'create', record: { id: c, type: 'board_item', parentId: opened.id, sortKey: keys.connector, props: connectorProps({ from: { item: r1, side: 'right' }, to: { item: r2, side: 'left' } }) } },
    ]);
    return { boardId: opened.id, ids: [c, r1, r2] };
  }
  const ODD_KEYS = { connector: '!', r1: '"', r2: ODD };
  const SOUND_KEYS = { connector: 'b', r1: 'd', r2: 'f' };

  it('the text quick-create: the new box in front, its connector at the back, every key unique', async () => {
    const { boardId, ids } = await oddBoard(ODD_KEYS, 'text');
    const [, r1] = ids;
    const id = crypto.randomUUID();
    moodboardStore.getState().startEditing({ boardId, id, draft: { kind: 'text', x: 0, y: 200, width: 100, height: 40, rotation: 0 }, join: { item: r1, side: 'bottom' } });
    await finishEditing('Next');
    const after = boardOrder(boardId);
    expect(after.at(-1)).toBe(id);
    expect(after.slice(1, 4)).toEqual(ids);
    expect(after).toHaveLength(5);
    expect(keysUnique(boardId)).toBe(true);
  });

  it('the text quick-create on a sound board writes the box after the last key and the connector before the first, nothing else', async () => {
    const { boardId, ids } = await oddBoard(SOUND_KEYS, 'text');
    const id = crypto.randomUUID();
    moodboardStore.getState().startEditing({ boardId, id, draft: { kind: 'text', x: 0, y: 200, width: 100, height: 40, rotation: 0 }, join: { item: ids[1], side: 'bottom' } });
    await finishEditing('Next');
    expect(records()[id]?.sortKey).toBe(keyBetween('f', null));
    expect(ids.map((i) => records()[i]?.sortKey)).toEqual(['b', 'd', 'f']);
    expect(boardOrder(boardId)[0]).not.toBe(ids[0]);
    expect(records()[boardOrder(boardId)[0] ?? '']?.sortKey).toBe(keyBetween(null, 'b'));
  });

  it('Paste: the copies in front, the connector’s copy at the back, every key unique; a sound board’s keys as before', async () => {
    for (const [keys, odd, department] of [[ODD_KEYS, true, 'camera'], [SOUND_KEYS, false, 'art']] as const) {
      const { boardId, ids } = await oddBoard(keys, 'rect', department);
      const [c, r1, r2] = ids;
      const clip = clipOf(records(), boardId, [c, r1, r2]);
      const connectors = clipConnectorsOf(records(), boardId, [c, r1, r2]);
      const before = new Set(Object.keys(records()));
      await pasteClipboard(boardId, null, clip, projectStore, connectors);
      const after = boardOrder(boardId);
      const made = after.filter((id) => !before.has(id));
      expect(made).toHaveLength(3);
      // The connector's copy first, the board as it was, then the two copies.
      expect(after.indexOf(made[0] ?? '')).toBe(0);
      expect(after.slice(1, 4)).toEqual(ids);
      expect(after.slice(4)).toEqual(made.slice(1));
      expect(keysUnique(boardId)).toBe(true);
      if (!odd) {
        expect(ids.map((i) => records()[i]?.sortKey)).toEqual(['b', 'd', 'f']);
        const first = keyBetween('f', null);
        expect(after.slice(4).map((i) => records()[i]?.sortKey)).toEqual([first, keyBetween(first, null)]);
        expect(records()[after[0] ?? '']?.sortKey).toBe(keyBetween(null, 'b'));
      }
    }
  });

  it('Duplicate: the copies in front, every key unique; a sound board’s keys as before', async () => {
    for (const [keys, odd, department] of [[ODD_KEYS, true, 'camera'], [SOUND_KEYS, false, 'art']] as const) {
      const { boardId, ids } = await oddBoard(keys, 'rect', department);
      moodboardStore.getState().select(boardId, ids);
      const before = new Set(Object.keys(records()));
      await duplicateSelection(boardId, projectStore);
      const after = boardOrder(boardId);
      const made = after.filter((id) => !before.has(id));
      expect(made).toHaveLength(3);
      expect(after.slice(1, 4)).toEqual(ids);
      expect(after.slice(4)).toEqual(made.slice(1));
      expect(keysUnique(boardId)).toBe(true);
      if (!odd) {
        expect(ids.map((i) => records()[i]?.sortKey)).toEqual(['b', 'd', 'f']);
        const first = keyBetween('f', null);
        expect(after.slice(4).map((i) => records()[i]?.sortKey)).toEqual([first, keyBetween(first, null)]);
      }
    }
  });
});

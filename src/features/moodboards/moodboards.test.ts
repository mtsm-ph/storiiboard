import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { log } from '../../core/ops/ops';
import { importProjectJson, projectJsonBytes, readProjectJson } from '../../core/storage/projectJson';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { restoreChanges, restoredName, trashItems } from '../trash/trash';
import { boardFields, boardsOf, boardTitle, departmentBoard, departmentsWithoutBoard, newBoard, openDepartmentBoard, restoreBoardChanges, trashBoardChanges } from './boards';
import { canvasItems, clipOf, createRects, geometryChanges, itemsOf, nudgeChanges, pasteChanges, reorderChanges, trashItemsChanges } from './items';

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
const rect = (x: number, y: number) => ({ x, y, width: 200, height: 120, rotation: 0 });

/** The Camera board, opened the way a person does (made the first time), with some rectangles on it. */
async function cameraBoard(count = 0): Promise<{ boardId: string; ids: string[] }> {
  const opened = openDepartmentBoard(records(), project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const made = createRects(records(), opened.id, [rect(i * 300, 0)]);
    await store.getState().apply(made.changes);
    ids.push(...made.ids);
  }
  return { boardId: opened.id, ids };
}
const order = (boardId: string) => itemsOf(records(), boardId).map((r) => r.id);
const geometry = (id: string) => {
  const p = records()[id]?.props ?? {};
  return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation };
};

describe('boards', () => {
  it('starts a project with none, and makes a department’s board the first time it is opened, once', async () => {
    expect(boardsOf(records(), project.projectId)).toEqual([]);
    const first = await cameraBoard();
    expect(boardFields(records()[first.boardId]?.props ?? {})).toEqual({ kind: 'moodboard', department: 'camera', name: null });
    expect(boardTitle(records()[first.boardId] as never)).toBe('Camera');
    const before = await groups();
    const again = openDepartmentBoard(records(), project.projectId, 'camera');
    expect(again).toEqual({ id: first.boardId, changes: [] });
    await store.getState().apply(again.changes);
    expect(await groups()).toBe(before);
    expect(boardsOf(records(), project.projectId)).toHaveLength(1);
  });

  it('names a department’s board in the language in use, and stores no name', async () => {
    const { boardId } = await cameraBoard();
    expect(records()[boardId]?.props.name).toBeNull();
    setLocale('es');
    expect(boardTitle(records()[boardId] as never)).toBe('Cámara');
    setLocale('en');
  });

  it('restores a department’s board from the Trash instead of making a second, items and all', async () => {
    const { boardId, ids } = await cameraBoard(2);
    await store.getState().apply(trashBoardChanges(records(), boardId));
    expect(boardsOf(records(), project.projectId)).toEqual([]);
    expect(records()[ids[0] ?? '']?.trashedAt).not.toBeNull();
    expect(departmentBoard(records(), project.projectId, 'camera')?.id).toBe(boardId);

    const reopened = openDepartmentBoard(records(), project.projectId, 'camera');
    expect(reopened.id).toBe(boardId);
    expect(reopened.changes.every((c) => c.kind === 'restore')).toBe(true);
    await store.getState().apply(reopened.changes);
    const all = Object.values(records()).filter((r) => r.type === 'board');
    expect(all).toHaveLength(1);
    expect(all[0]?.trashedAt).toBeNull();
    expect(order(boardId)).toEqual(ids);
  });

  it('brings back only the items trashed with the board, not ones deleted before', async () => {
    const { boardId, ids } = await cameraBoard(3);
    await store.getState().apply(trashItemsChanges(records(), [ids[0] ?? '']));
    // A later timestamp for the board, as a real second delete has.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.getState().apply(trashBoardChanges(records(), boardId));
    await store.getState().apply(restoreBoardChanges(records(), boardId));
    expect(order(boardId)).toEqual([ids[1], ids[2]]);
  });

  it('keeps one board per department outside the Trash, and many free ones', async () => {
    const { boardId } = await cameraBoard();
    // Opening it again, or after a trash and a restore, never makes a second.
    await store.getState().apply(openDepartmentBoard(records(), project.projectId, 'camera').changes);
    await store.getState().apply(trashBoardChanges(records(), boardId));
    expect(departmentsWithoutBoard(records(), project.projectId)).toContain('camera');
    const reopened = openDepartmentBoard(records(), project.projectId, 'camera');
    await store.getState().apply(reopened.changes);
    expect(reopened.id).toBe(boardId);
    expect(departmentsWithoutBoard(records(), project.projectId)).not.toContain('camera');
    // If a live one and a trashed one ever coexist (a file edited by hand), the live one is the department's board.
    await store.getState().apply([
      { kind: 'create', record: { id: 'old', type: 'board', parentId: project.projectId, sortKey: '0V', props: { kind: 'moodboard', department: 'camera', name: null } } },
      { kind: 'trash', id: 'old' },
    ]);
    expect(departmentBoard(records(), project.projectId, 'camera')?.id).toBe(boardId);
    expect(boardsOf(records(), project.projectId)).toHaveLength(1);
    for (const name of ['Look book', 'Locations']) {
      const made = newBoard(records(), project.projectId, name);
      await store.getState().apply(made.changes);
    }
    expect(boardsOf(records(), project.projectId).map((b) => boardTitle(b))).toEqual(['Camera', 'Look book', 'Locations']);
  });

  it('deletes a board with its items for good on Empty Trash, items made and undone under it too', async () => {
    const { boardId, ids } = await cameraBoard(2);
    const made = createRects(records(), boardId, [rect(900, 0)]);
    await store.getState().apply(made.changes);
    await store.getState().undo();
    expect(records()[made.ids[0] ?? '']).toBeUndefined();
    await store.getState().apply(trashBoardChanges(records(), boardId));
    const done = await store.getState().emptyTrash();
    expect(done?.removed).toBeGreaterThan(0);
    const left = Object.values(records()).filter((r) => r.type === 'board' || r.type === 'board_item');
    expect(left).toEqual([]);
    const rows = await project.file.query("SELECT id FROM records WHERE type IN ('board', 'board_item')");
    expect(rows).toEqual([]);
    expect(ids.map((id) => records()[id])).toEqual([undefined, undefined]);
    const lingering = await project.file.query('SELECT count(*) AS n FROM ops WHERE record_id = ? AND (before IS NOT NULL OR after IS NOT NULL)', [made.ids[0] ?? '']);
    expect(Number(lingering[0]?.n)).toBe(0);
  });
});

describe('items and gestures', () => {
  it('draws rectangles with a standard place and puts each at the front', async () => {
    const { boardId, ids } = await cameraBoard(3);
    expect(order(boardId)).toEqual(ids);
    expect(canvasItems(records(), boardId).map((i) => [i.x, i.width, i.height, i.label])).toEqual([
      [0, 200, 120, 'Rectangle'],
      [300, 200, 120, 'Rectangle'],
      [600, 200, 120, 'Rectangle'],
    ]);
  });

  it('writes a drag of three items as one op group, and one undo puts all three back', async () => {
    const { ids } = await cameraBoard(3);
    const before = await groups();
    const moves = ids.map((id, i) => ({ id, ...rect(i * 300 + 40, 25), width: 200, height: 120 }));
    await store.getState().applyWith((now) => ({ changes: geometryChanges(now, moves) }));
    expect(await groups()).toBe(before + 1);
    expect(ids.map((id) => geometry(id).x)).toEqual([40, 340, 640]);
    expect(ids.map((id) => geometry(id).y)).toEqual([25, 25, 25]);

    await store.getState().undo();
    expect(ids.map((id) => geometry(id).x)).toEqual([0, 300, 600]);
    expect(ids.map((id) => geometry(id).y)).toEqual([0, 0, 0]);
    await store.getState().redo();
    expect(ids.map((id) => geometry(id).x)).toEqual([40, 340, 640]);
  });

  it('writes a resize and a rotate, and each undoes on its own', async () => {
    const { ids } = await cameraBoard(1);
    const [id] = ids as [string];
    await store.getState().applyWith((now) => ({ changes: geometryChanges(now, [{ id, x: -10, y: -5, width: 240, height: 60.5, rotation: 0 }]) }));
    expect(geometry(id)).toEqual({ x: -10, y: -5, width: 240, height: 60.5, rotation: 0 });
    await store.getState().applyWith((now) => ({ changes: geometryChanges(now, [{ id, x: -10, y: -5, width: 240, height: 60.5, rotation: 345 }]) }));
    expect(geometry(id).rotation).toBe(345);
    await store.getState().undo();
    expect(geometry(id).rotation).toBe(0);
    expect(geometry(id).width).toBe(240);
    await store.getState().undo();
    expect(geometry(id)).toEqual({ x: 0, y: 0, width: 200, height: 120, rotation: 0 });
  });

  it('writes each nudge as a group of its own', async () => {
    const { ids } = await cameraBoard(2);
    const before = await groups();
    for (const step of [1, 1, 10]) {
      await store.getState().applyWith((now) => ({
        changes: geometryChanges(now, ids.map((id) => ({ id, ...(geometryOf(id)), x: geometryOf(id).x + step }))),
      }));
    }
    expect(await groups()).toBe(before + 3);
    expect(geometry(ids[0] ?? '').x).toBe(12);
    expect(geometry(ids[1] ?? '').x).toBe(312);

    function geometryOf(id: string) {
      const p = records()[id]?.props ?? {};
      return { x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height), rotation: Number(p.rotation) };
    }
  });

  it('pastes offset 16 units from the originals, or at a point, at the front, and undoes in one step', async () => {
    const { boardId, ids } = await cameraBoard(2);
    const clip = clipOf(records(), boardId, ids);
    expect(clip).toHaveLength(2);
    const before = await groups();
    const offset = pasteChanges(records(), boardId, clip, null);
    await store.getState().apply(offset.changes);
    expect(await groups()).toBe(before + 1);
    expect(order(boardId)).toEqual([...ids, ...offset.ids]);
    expect(offset.ids.map((id) => geometry(id).x)).toEqual([16, 316]);
    expect(offset.ids.map((id) => geometry(id).y)).toEqual([16, 16]);

    const at = pasteChanges(records(), boardId, clip, { x: 1000, y: 1000 });
    await store.getState().apply(at.changes);
    // The two together span 0–500 by 0–120; their middle (250, 60) lands on the point.
    expect(at.ids.map((id) => geometry(id).x)).toEqual([750, 1050]);
    expect(at.ids.map((id) => geometry(id).y)).toEqual([940, 940]);

    await store.getState().undo();
    expect(order(boardId)).toEqual([...ids, ...offset.ids]);
  });

  it('orders by sibling order: to front is one move to the last key, and one undo restores the order', async () => {
    const { boardId, ids } = await cameraBoard(4);
    const [a, b, c, d] = ids as [string, string, string, string];
    const before = await groups();
    const toFront = reorderChanges(records(), boardId, [a], 'front');
    expect(toFront).toHaveLength(1);
    expect(toFront[0]).toMatchObject({ kind: 'move', id: a, parentId: boardId });
    await store.getState().apply(toFront);
    expect(order(boardId)).toEqual([b, c, d, a]);
    expect(await groups()).toBe(before + 1);

    await store.getState().apply(reorderChanges(records(), boardId, [a, b], 'back'));
    expect(order(boardId)).toEqual([b, a, c, d]);

    await store.getState().apply(reorderChanges(records(), boardId, [c], 'forward'));
    await store.getState().apply(reorderChanges(records(), boardId, [c], 'backward'));
    await store.getState().undo();
    await store.getState().undo();
    await store.getState().undo();
    await store.getState().undo();
    expect(order(boardId)).toEqual(ids);
    // Nothing to move writes nothing.
    expect(reorderChanges(records(), boardId, [d], 'front')).toEqual([]);
  });

  it('adds quick nudges one after another, each its own group that changes x', async () => {
    const { ids } = await cameraBoard(2);
    const before = await groups();
    // Three presses before any write has landed: each is worked out when its turn comes.
    await Promise.all([1, 2, 3].map(() => store.getState().applyWith((now) => ({ changes: nudgeChanges(now, ids, 1, 0) }))));
    expect(await groups()).toBe(before + 3);
    expect(ids.map((id) => geometry(id).x)).toEqual([3, 303]);
    for (let i = 0; i < 3; i += 1) {
      await store.getState().undo();
      expect(geometry(ids[0] ?? '').x).toBe(2 - i);
    }
  });

  it('writes nothing for a gesture that changes nothing', async () => {
    const { ids } = await cameraBoard(1);
    const same = { id: ids[0] ?? '', ...rect(0, 0) };
    expect(geometryChanges(records(), [same])).toEqual([]);
    const before = await groups();
    await store.getState().applyWith((now) => ({ changes: geometryChanges(now, [same]) }));
    expect(await groups()).toBe(before);
  });

  it('keeps sort keys unique when an item in the Trash sits beside the one moved, and ⌘[ still works after', async () => {
    const { boardId, ids } = await cameraBoard(3);
    const [a, , c] = ids as [string, string, string];
    await store.getState().apply(trashItemsChanges(records(), [c]));
    await store.getState().apply(reorderChanges(records(), boardId, [a], 'front'));
    await store.getState().apply(restoreChanges(records(), project.projectId, c));
    const keys = Object.values(records()).filter((r) => r.type === 'board_item').map((r) => r.sortKey);
    expect(new Set(keys).size).toBe(keys.length);
    // A to the front was placed after the Trash's item, so the restored one is not in front of it.
    expect(order(boardId).at(-1)).toBe(a);
    const back = reorderChanges(records(), boardId, [a], 'backward');
    expect(back.length).toBeGreaterThan(0);
    await store.getState().apply(back);
    const again = Object.values(records()).filter((r) => r.type === 'board_item').map((r) => r.sortKey);
    expect(new Set(again).size).toBe(again.length);
  });

  it('writes no move for an item already at the front among the live ones, a trashed sibling after it or not', async () => {
    const { boardId, ids } = await cameraBoard(3);
    const [a, b, c] = ids as [string, string, string];
    await store.getState().apply(trashItemsChanges(records(), [c]));
    // b is the front item that shows; c sits after it in the Trash.
    expect(reorderChanges(records(), boardId, [b], 'front')).toEqual([]);
    expect(reorderChanges(records(), boardId, [a], 'back')).toEqual([]);
    expect(reorderChanges(records(), boardId, [a], 'front')).toHaveLength(1);
  });

  it('writes both of two moves when the second begins before the first has landed, and nothing snaps back', async () => {
    const { ids } = await cameraBoard(1);
    const [id] = ids as [string];
    const before = await groups();
    const to = (x: number) => ({ id, ...rect(x, 0) });
    // The second is worked out against the records as they are when its turn comes, after the first has been written.
    await Promise.all([40, 90].map((x) => store.getState().applyWith((now) => ({ changes: geometryChanges(now, [to(x)]) }))));
    expect(await groups()).toBe(before + 2);
    expect(geometry(id).x).toBe(90);
    // A second move back to where the first began is a real move too.
    await Promise.all([40, 0].map((x) => store.getState().applyWith((now) => ({ changes: geometryChanges(now, [to(x)]) }))));
    expect(await groups()).toBe(before + 4);
    expect(geometry(id).x).toBe(0);
  });

  it('counts an item with no rotation prop as turned 0, so a drag back to where it began writes nothing', async () => {
    const { boardId } = await cameraBoard(0);
    await store.getState().apply([
      { kind: 'create', record: { id: 'bare', type: 'board_item', parentId: boardId, sortKey: 'V', props: { kind: 'rect', x: 5, y: 5, width: 50, height: 50 } } },
    ]);
    expect(geometryChanges(records(), [{ id: 'bare', x: 5, y: 5, width: 50, height: 50, rotation: 0 }])).toEqual([]);
  });

  it('writes no move for an item already at the front', async () => {
    const { boardId, ids } = await cameraBoard(2);
    expect(reorderChanges(records(), boardId, [ids[1] ?? ''], 'front')).toEqual([]);
    expect(reorderChanges(records(), boardId, [ids[1] ?? ''], 'forward')).toEqual([]);
  });

  it('does not list an item a later version wrote with a kind this one does not know', async () => {
    const { boardId } = await cameraBoard(1);
    await store.getState().apply([
      { kind: 'create', record: { id: 'future', type: 'board_item', parentId: boardId, sortKey: 'zz', props: { kind: 'sticky', x: 0, y: 0, width: 10, height: 10, rotation: 0 } } },
    ]);
    expect(order(boardId)).toHaveLength(1);
    expect(records().future).toBeDefined();
  });
});

describe('the Trash and History', () => {
  it('lists a trashed board by its name or department, with its items inside it, and restores both', async () => {
    const { boardId, ids } = await cameraBoard(2);
    await store.getState().apply(trashBoardChanges(records(), boardId));
    const rows = trashItems(records(), project.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'board', name: 'Camera' });

    await store.getState().apply(restoreChanges(records(), project.projectId, boardId));
    expect(trashItems(records(), project.projectId)).toEqual([]);
    expect(boardsOf(records(), project.projectId)).toHaveLength(1);
    expect(order(boardId)).toEqual(ids);
  });

  it('lists a trashed item as "Rectangle on Camera board" and restores just it', async () => {
    const { boardId, ids } = await cameraBoard(3);
    const [a, b] = ids as [string, string, string];
    await store.getState().apply(trashItemsChanges(records(), [b]));
    const rows = trashItems(records(), project.projectId);
    expect(rows.map((r) => [r.kind, r.name])).toEqual([['boardItem', 'Rectangle on Camera board']]);
    expect(order(boardId)).toEqual([a, ids[2]]);
    await store.getState().apply(restoreChanges(records(), project.projectId, b));
    // It comes back in its place in the stack.
    expect(order(boardId)).toEqual(ids);
    expect(restoredName(records(), b)).toBe('Rectangle on Camera board');
  });

  it('restores an item whose board is in the Trash by bringing the board back', async () => {
    const { boardId, ids } = await cameraBoard(2);
    const [a, b] = ids as [string, string];
    await store.getState().apply(trashItemsChanges(records(), [a]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.getState().apply(trashBoardChanges(records(), boardId));
    expect(trashItems(records(), project.projectId).map((r) => r.kind).sort()).toEqual(['board', 'boardItem']);
    await store.getState().apply(restoreChanges(records(), project.projectId, a));
    expect(boardsOf(records(), project.projectId)).toHaveLength(1);
    expect(order(boardId)).toEqual([a, b]);
  });

  it('names board and item steps in words, in both languages', async () => {
    const { boardId, ids } = await cameraBoard(3);
    await store.getState().apply(geometryChanges(records(), ids.map((id) => ({ id, ...rect(5, 5), width: 200, height: 120 }))));
    await store.getState().apply(geometryChanges(records(), [{ id: ids[0] ?? '', x: 5, y: 5, width: 90, height: 40, rotation: 0 }]));
    await store.getState().apply(geometryChanges(records(), [{ id: ids[0] ?? '', x: 5, y: 5, width: 90, height: 40, rotation: 30 }]));
    await store.getState().apply(reorderChanges(records(), boardId, [ids[0] ?? ''], 'front'));
    await store.getState().apply(trashItemsChanges(records(), [ids[1] ?? '']));
    await store.getState().apply(trashBoardChanges(records(), boardId));
    await store.getState().apply(restoreBoardChanges(records(), boardId));
    const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).reverse();
    expect(await lines()).toEqual([
      'Added board Camera',
      'Added a rectangle',
      'Added a rectangle',
      'Added a rectangle',
      'Moved 3 rectangles',
      'Resized 1 rectangle',
      'Rotated 1 rectangle',
      'Reordered 1 rectangle',
      'Deleted a rectangle',
      'Deleted board Camera',
      'Restored board Camera',
    ]);
    setLocale('es');
    expect((await lines()).slice(0, 2)).toEqual(['Se agregó el tablero Cámara', 'Se agregó un rectángulo']);
    expect((await lines())[4]).toBe('Movido: 3 rectángulos');
  });
});

describe('the lossless JSON export', () => {
  it('carries boards and their items out and back, the Trash and History too', async () => {
    const { boardId, ids } = await cameraBoard(3);
    await store.getState().apply(geometryChanges(records(), [{ id: ids[0] ?? '', x: 12.5, y: -3, width: 90, height: 40, rotation: 30 }]));
    await store.getState().apply(reorderChanges(records(), boardId, [ids[0] ?? ''], 'front'));
    await store.getState().apply(trashItemsChanges(records(), [ids[1] ?? '']));
    const text = new TextDecoder().decode(await projectJsonBytes(project.file, new Date('2026-11-10T12:00:00.000Z')));
    const copy = folder.path('Bey County (imported).sbd');
    await importProjectJson(nodeDriver, copy, readProjectJson(text), new Date('2026-11-10T12:00:00.000Z'));
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = (file: Project['file']) => file.query("SELECT * FROM records WHERE type IN ('board', 'board_item') ORDER BY rowid");
      const was = await rows(project.file);
      expect(was).toHaveLength(4);
      expect(await rows(imported.file)).toEqual(was);
      const count = async (file: Project['file']) => (await file.query('SELECT count(*) AS n FROM ops'))[0]?.n;
      expect(await count(imported.file)).toBe(await count(project.file));
    } finally {
      await imported.close();
    }
  });
});

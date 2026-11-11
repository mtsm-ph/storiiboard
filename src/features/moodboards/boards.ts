import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS, DEPARTMENTS, isDepartment, type Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';

// Boards (5.0, docs/SBD_FORMAT.md, Boards): a `board` record under the project. A department's board has
// `department` and no name, and reads as its department's label in the language in use; a free board has a name. At
// most one board per department isn't in the Trash, and one in the Trash is restored when its department's board is
// opened, never made twice.

type Records = Readonly<Record<string, SbdRecord>>;

export interface BoardFields {
  kind: 'moodboard';
  department: Department | null;
  name: string | null;
}

export function boardFields(props: SbdRecord['props']): BoardFields {
  return {
    kind: 'moodboard',
    department: isDepartment(props.department) ? props.department : null,
    name: typeof props.name === 'string' && props.name.trim() !== '' ? props.name : null,
  };
}

const byKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** Every board of the project, in the order they were made; the Trash's included only when asked. */
export function boardsOf(records: Records, projectId: string, withTrashed = false): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'board' && r.parentId === projectId && (withTrashed || r.trashedAt === null))
    .sort(byKey);
}

/** What a board is called: its name, else its department's label. */
export function boardTitle(record: SbdRecord): string {
  const fields = boardFields(record.props);
  if (fields.name !== null) return fields.name;
  return fields.department !== null ? DEPARTMENT_LABELS[fields.department] : t('moodboard.untitled');
}

/** The department's board: the one that isn't in the Trash, else the one that is. */
export function departmentBoard(records: Records, projectId: string, department: Department): SbdRecord | undefined {
  const mine = boardsOf(records, projectId, true).filter((b) => boardFields(b.props).department === department);
  return mine.find((b) => b.trashedAt === null) ?? mine[0];
}

/** The departments with no live board yet, in the call sheet's order: what the picker offers to open. */
export function departmentsWithoutBoard(records: Records, projectId: string): Department[] {
  const have = new Set(boardsOf(records, projectId).map((b) => boardFields(b.props).department));
  return DEPARTMENTS.filter((d) => !have.has(d));
}

/** The items that went to the Trash with their board: the same op group, so the same time and person. */
export function trashedWithBoard(records: Records, board: SbdRecord): SbdRecord[] {
  return Object.values(records).filter(
    (r) => r.type === 'board_item' && r.parentId === board.id && board.trashedAt !== null && r.trashedAt === board.trashedAt && r.trashedBy === board.trashedBy,
  );
}

/** A trashed board and everything that went with it, brought back. */
export function restoreBoardChanges(records: Records, boardId: string): Change[] {
  const board = records[boardId];
  if (board?.type !== 'board' || board.trashedAt === null) return [];
  return [{ kind: 'restore', id: boardId }, ...trashedWithBoard(records, board).map((r): Change => ({ kind: 'restore', id: r.id }))];
}

/** A board and its live items, to the Trash in one group. */
export function trashBoardChanges(records: Records, boardId: string): Change[] {
  const board = records[boardId];
  if (board?.type !== 'board' || board.trashedAt !== null) return [];
  const items = Object.values(records).filter((r) => r.type === 'board_item' && r.parentId === boardId && r.trashedAt === null);
  return [{ kind: 'trash', id: boardId }, ...items.map((r): Change => ({ kind: 'trash', id: r.id }))];
}

function nextBoardKey(records: Records, projectId: string): string {
  // Trashed boards count, so one restored later never shares a place with one made since.
  return keyBetween(boardsOf(records, projectId, true).at(-1)?.sortKey ?? null, null);
}

export interface OpenBoard {
  id: string;
  /** Empty when the board is already there: opening it writes nothing. */
  changes: Change[];
}

/**
 * Opening a department's board: the live one as it is; one in the Trash restored with its items (never a second);
 * else a new one. Made the first time it's opened and never ahead, so a new project has none.
 */
export function openDepartmentBoard(records: Records, projectId: string, department: Department): OpenBoard {
  const found = departmentBoard(records, projectId, department);
  if (found) return { id: found.id, changes: found.trashedAt === null ? [] : restoreBoardChanges(records, found.id) };
  const id = crypto.randomUUID();
  return {
    id,
    changes: [
      {
        kind: 'create',
        record: { id, type: 'board', parentId: projectId, sortKey: nextBoardKey(records, projectId), props: { kind: 'moodboard', department, name: null } },
      },
    ],
  };
}

/** A free board with a name. */
export function newBoard(records: Records, projectId: string, name: string): OpenBoard {
  const id = crypto.randomUUID();
  return {
    id,
    changes: [
      {
        kind: 'create',
        record: { id, type: 'board', parentId: projectId, sortKey: nextBoardKey(records, projectId), props: { kind: 'moodboard', department: null, name: name.trim() } },
      },
    ],
  };
}

export const renameBoard = (boardId: string, name: string): Change => ({ kind: 'update', id: boardId, set: { name: name.trim() } });

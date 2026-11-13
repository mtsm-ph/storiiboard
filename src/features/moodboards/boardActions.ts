import { showInfo } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { isMac } from '../../app/shell/undoShortcuts';
import { t } from '../../core/i18n';
import type { Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import type { Geometry, GeometryChange, PlaceTool, ReorderMode } from '../../ui/canvas/types';
import { boardsOf, boardTitle, newBoard, openDepartmentBoard, renameBoard, trashBoardChanges } from './boards';
import { clipOf, createItems, DEFAULT_FONT_FAMILY, isTextKind, itemFields, geometryChanges, nudgeChanges, pasteChanges, reorderChanges, seedWithText, styleChanges, textEditChanges, trashItemsChanges, type StylePatch } from './items';
import { fontReady } from './fonts';
import { moodboardStore } from './moodboardStore';
import { measureText } from './textFit';

// What a person does on boards, as edits through projectStore.apply (decision 11): each is one op group, so one ⌘Z.

type Records = Readonly<Record<string, SbdRecord>>;

/** Opens a department's board, making it the first time and restoring it from the Trash if that's where it is. */
export async function openDepartment(department: Department): Promise<string | null> {
  const { project } = projectStore.getState();
  if (!project) return null;
  const made = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const opened = openDepartmentBoard(records, project.projectId, department);
    made.id = opened.id;
    return { changes: opened.changes };
  });
  if (!written || made.id === null) return null;
  moodboardStore.getState().openBoard(made.id);
  return made.id;
}

/** A free board with a name, opened. */
export async function createBoard(name: string): Promise<string | null> {
  const { project } = projectStore.getState();
  if (!project || name.trim() === '') return null;
  const made = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const board = newBoard(records, project.projectId, name);
    made.id = board.id;
    return { changes: board.changes };
  });
  if (!written || made.id === null) return null;
  moodboardStore.getState().openBoard(made.id);
  return made.id;
}

export async function renameBoardTo(boardId: string, name: string): Promise<void> {
  if (name.trim() === '') return;
  await projectStore.getState().apply([renameBoard(boardId, name)]);
}

/**
 * Delete on a board's row: the board and its items to the Trash in one step, undoable. No confirm, as for a scene:
 * nothing is lost, and the notice says how to take it back. Resolves to the board that took its place in the list.
 */
export async function deleteBoard(boardId: string): Promise<{ written: boolean; next: string | null }> {
  const { project } = projectStore.getState();
  if (!project) return { written: false, next: null };
  let said = '';
  let next: string | null = null;
  const written = await projectStore.getState().applyWith((records) => {
    const changes = trashBoardChanges(records, boardId);
    if (changes.length === 0) return { changes };
    const boards = boardsOf(records, project.projectId);
    const at = boards.findIndex((b) => b.id === boardId);
    next = (boards[at + 1] ?? boards[at - 1])?.id ?? null;
    said = t('moodboard.deleted', { board: boardTitle(records[boardId] as SbdRecord), undo: isMac() ? '⌘Z' : 'Ctrl+Z' });
    return { changes };
  });
  if (!written || said === '') return { written: false, next: null };
  if (moodboardStore.getState().openBoardId === boardId) moodboardStore.getState().openBoard(null);
  showInfo(said, { step: true });
  return { written: true, next };
}

/** The selected ids that are live items of this board. */
export function liveSelection(records: Records, boardId: string): string[] {
  return (moodboardStore.getState().selections[boardId] ?? []).filter((id) => {
    const r = records[id];
    return r?.type === 'board_item' && r.parentId === boardId && r.trashedAt === null;
  });
}

const select = (boardId: string, ids: readonly string[]) => {
  moodboardStore.getState().select(boardId, ids);
};

/**
 * A shape drawn or clicked into place, selected once made. A text box or sticky note is not made yet: it is a draft the
 * person types into, and is written when editing ends (finishEditing), so an empty text box leaves no step behind.
 */
export async function placeItem(boardId: string, geometry: Geometry, tool: PlaceTool): Promise<void> {
  if (tool === 'text' || tool === 'sticky') {
    // Nothing is selected while it is typed: the properties strip must not show, or change, what was selected before.
    select(boardId, []);
    moodboardStore.getState().startEditing({ boardId, id: crypto.randomUUID(), draft: { ...geometry, kind: tool } });
    return;
  }
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const made = createItems(records, boardId, [{ ...geometry, kind: tool }]);
    ids = made.ids;
    return { changes: made.changes };
  });
  // After drawing, the new item is selected.
  if (written) select(boardId, ids);
}

/** Enter or a double-click on a text box or sticky note: edit it in place. */
export function editItem(boardId: string, id: string): void {
  moodboardStore.getState().startEditing({ boardId, id, draft: null });
}

/**
 * Editing in place ended (Escape, or a click outside): one op group for everything typed, none per keystroke. A new text
 * box with nothing typed disappears, with no op; a new sticky note is made even when blank.
 */
export async function finishEditing(text: string): Promise<void> {
  const editing = moodboardStore.getState().editing;
  if (!editing) return;
  // First, so Escape and the blur it causes can't write twice.
  moodboardStore.getState().stopEditing();
  const { boardId, id, draft } = editing;
  if (draft) {
    if (draft.kind === 'text' && text.trim() === '') return;
    // The font is loaded inside the edit's turn in the queue (not before it), so the step keeps its place among later ones.
    const seed = draft;
    const written = await projectStore.getState().applyWith(async () => {
      await fontReady(seed.fontFamily ?? DEFAULT_FONT_FAMILY, seed.fontWeight ?? 400, seed.fontItalic ?? false);
      // The records as they are after the wait, not as they were when the turn began.
      return { changes: createItems(projectStore.getState().records, boardId, [seedWithText(seed, text, measureText)], id).changes };
    });
    if (written) select(boardId, [id]);
    return;
  }
  await projectStore.getState().applyWith(async (records) => {
    const fields = itemFields(records[id]?.props ?? {});
    if (fields) await fontReady(fields.fontFamily, fields.fontWeight, fields.fontItalic);
    return { changes: textEditChanges(projectStore.getState().records, id, text, measureText) };
  });
}

/** A change in the properties strip, applied to every selected item it fits in one op group. */
export async function changeStyle(boardId: string, patch: StylePatch): Promise<void> {
  const ids = liveSelection(projectStore.getState().records, boardId);
  const font = patch.fontFamily !== undefined || patch.fontWeight !== undefined || patch.fontItalic !== undefined;
  // A text box is measured in its new font, so the face is loaded first, inside the edit's turn in the queue: a later
  // edit, undo or delete waits behind it instead of landing before it.
  await projectStore.getState().applyWith(async (records) => {
    if (font) {
      await Promise.all(
        ids.flatMap((id) => {
          const fields = itemFields(records[id]?.props ?? {});
          return fields && isTextKind(fields.kind)
            ? [fontReady(patch.fontFamily ?? fields.fontFamily, patch.fontWeight ?? fields.fontWeight, patch.fontItalic ?? fields.fontItalic)]
            : [];
        }),
      );
    }
    return { changes: styleChanges(projectStore.getState().records, ids, patch, measureText) };
  });
}

export async function changeGeometry(changes: readonly GeometryChange[]): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: geometryChanges(records, changes, measureText) }));
}

/** An arrow key's nudge: worked out from the records as they are when the write's turn comes. */
export async function nudge(ids: readonly string[], dx: number, dy: number): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: nudgeChanges(records, ids, dx, dy) }));
}

export async function reorder(boardId: string, mode: ReorderMode): Promise<void> {
  const ids = liveSelection(projectStore.getState().records, boardId);
  await projectStore.getState().applyWith((records) => ({ changes: reorderChanges(records, boardId, ids, mode) }));
}

export function copySelection(boardId: string): number {
  const clip = clipOf(projectStore.getState().records, boardId, liveSelection(projectStore.getState().records, boardId));
  if (clip.length > 0) moodboardStore.getState().copy(clip);
  return clip.length;
}

export async function deleteSelection(boardId: string): Promise<void> {
  const ids = liveSelection(projectStore.getState().records, boardId);
  if (ids.length === 0) return;
  const written = await projectStore.getState().applyWith((records) => ({ changes: trashItemsChanges(records, ids) }));
  if (written) select(boardId, []);
}

export async function cutSelection(boardId: string): Promise<void> {
  if (copySelection(boardId) > 0) await deleteSelection(boardId);
}

/** Paste at the pointer when it's over the canvas, else offset 16 units from the originals; the pasted are selected. */
export async function pasteClipboard(boardId: string, at: { x: number; y: number } | null, clip = moodboardStore.getState().clipboard): Promise<void> {
  if (clip.length === 0) return;
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const made = pasteChanges(records, boardId, clip, at);
    ids = made.ids;
    return { changes: made.changes };
  });
  if (written) select(boardId, ids);
}

/** Duplicate is Copy then Paste offset from the originals, without touching the clipboard. */
export async function duplicateSelection(boardId: string): Promise<void> {
  const clip = clipOf(projectStore.getState().records, boardId, liveSelection(projectStore.getState().records, boardId));
  await pasteClipboard(boardId, null, clip);
}

import { showInfo, showNotice } from '../../app/notice';
import { openLink } from '../../app/opener';
import { fromFile, type PictureFile } from '../../app/pictures';
import { projectStore } from '../../app/projectStore';
import { isMac } from '../../app/shell/undoShortcuts';
import { rememberVideoFile, videoFileKept } from '../../app/videoFiles';
import { localizeError, t } from '../../core/i18n';
import type { Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import { DEFAULT_VIEWPORT } from '../../ui/canvas/viewport';
import type { ConnectDrop, Geometry, GeometryChange, PlaceTool, Point, ReorderMode, Side } from '../../ui/canvas/types';
import { prepare, reason, toAdded, type AddedFile } from '../storyboard/addPictures';
import { picturesBusy } from '../storyboard/picturesBusy';
import type { PreparedFile } from '../video/linkVideos';
import { makeCopy } from '../video/playbackCopies';
import { playCard } from '../video/playerSource';
import { clipText, clipTaken, decidePasteOf } from './clipboardMarker';
import { isConnector } from './connectorFields';
import { clipConnectorsOf, connectChanges, connectorStyleChanges, createConnectors, grownQuickSeed, labelChanges, OPPOSITE, pasteConnectorChanges, pasteDelta, quickCreateChanges, quickSeedOf, type ClipConnector, type ConnectorPatch } from './connectors';
import { boardFileChanges, type PlacedBoardFiles } from './boardFiles';
import { boardsOf, boardTitle, newBoard, openDepartmentBoard, renameBoard, trashBoardChanges } from './boards';
import { clipOf, type ClipItem, createItems, DEFAULT_FONT_FAMILY, isTextKind, itemFields, linkChanges, geometryChanges, nudgeChanges, pasteChanges, reorderChanges, seedWithText, styleChanges, textEditChanges, trashItemsChanges, type StylePatch } from './items';
import { fontReady } from './fonts';
import { mediaChildOf, shaOfClip } from './itemMedia';
import { cardUrl, pastedAddress } from './links';
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
  if (tool === 'link') {
    // The card is made once it has an address (placeLink): the person is asked for it in a small window.
    moodboardStore.getState().askLink({ boardId, geometry });
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
  const { boardId, id, draft, join } = editing;
  if (draft) {
    if (draft.kind === 'text' && text.trim() === '') {
      // A quick-created box left empty is dropped with its connector; the item it came from is selected again.
      if (join) select(boardId, [join.item]);
      return;
    }
    // The font is loaded inside the edit's turn in the queue (not before it), so the step keeps its place among later ones.
    const seed = draft;
    const written = await projectStore.getState().applyWith(async () => {
      await fontReady(seed.fontFamily ?? DEFAULT_FONT_FAMILY, seed.fontWeight ?? 400, seed.fontItalic ?? false);
      // The records as they are after the wait, not as they were when the turn began.
      const now = projectStore.getState().records;
      const written = seedWithText(seed, text, measureText);
      const placed = join ? grownQuickSeed(seed, written, join.side) : written;
      const made = createItems(now, boardId, [placed], id).changes;
      // A text box made with a connector (quick-create) is written with it, in the one group, if the item is still there.
      const source = join ? now[join.item] : undefined;
      const joined =
        join && source?.type === 'board_item' && source.trashedAt === null
          ? createConnectors(now, boardId, [{ from: { item: join.item, side: join.side }, to: { item: id, side: OPPOSITE[join.side] } }]).changes
          : [];
      return { changes: [...made, ...joined] };
    });
    if (written) select(boardId, [id]);
    return;
  }
  await projectStore.getState().applyWith(async (records) => {
    // A connector's label: the words alone, no font to wait for.
    if (isConnector(records[id])) return { changes: labelChanges(projectStore.getState().records, id, text) };
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

/** The words a copied item puts on the system clipboard: a text's or sticky's text, a link's address, a file's name. */
function wordsOf(item: ClipItem): string {
  if (item.kind === 'text' || item.kind === 'sticky') return item.text;
  if (item.kind === 'link') return item.url;
  const name = item.media?.props.source_name;
  return typeof name === 'string' ? name : '';
}

/**
 * Copy: the items are kept inside the app at once (a paste right after sees them) and the system clipboard gets their
 * words, marked as ours (src/features/moodboards/clipboardMarker.ts).
 */
export function copySelection(boardId: string): number {
  const { project, records } = projectStore.getState();
  const selected = liveSelection(records, boardId);
  const clip = clipOf(records, boardId, selected);
  const connectors = clipConnectorsOf(records, boardId, selected);
  if (clip.length === 0 && connectors.length === 0) return 0;
  moodboardStore.getState().copy(clip, project ? { projectId: project.projectId, path: project.file.path } : null, connectors);
  clipTaken(clipText([...clip.map(wordsOf), ...connectors.map((c) => c.label)]));
  return clip.length + connectors.length;
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

/**
 * Paste at the pointer when it's over the canvas, else offset 16 units from the originals; the pasted are selected.
 * Pictures and video cards paste only into the project they were copied in; there, one whose stored picture has gone
 * since (Empty Trash) is left out. What is stored is looked at inside the edit's turn in the queue, after any Empty
 * Trash ahead of it. Each of these says so, once.
 */
export async function pasteClipboard(
  boardId: string,
  at: { x: number; y: number } | null,
  clip = moodboardStore.getState().clipboard,
  store: typeof projectStore = projectStore,
  connectors: readonly ClipConnector[] = clip === moodboardStore.getState().clipboard ? moodboardStore.getState().clipConnectors : [],
): Promise<void> {
  if (clip.length === 0 && connectors.length === 0) return;
  const { project } = store.getState();
  if (!project) return;
  const { clipSource, clipboard } = moodboardStore.getState();
  // A duplicate gives its clip directly, from this project. Another file with the same id (a backup, an opened version) is another project.
  const elsewhere = clip === clipboard && clipSource !== null && (clipSource.projectId !== project.projectId || clipSource.path !== project.file.path);
  let ids: string[] = [];
  let videos: { from: string; to: string }[] = [];
  const outcome = { left: 'none' as 'none' | 'elsewhere' | 'gone' };
  const written = await store.getState().applyWith(async () => {
    const shas = [...new Set(clip.flatMap((item) => (item.media ? [shaOfClip(item.media)] : [])).filter((sha): sha is string => sha !== null))];
    const rows = elsewhere || shas.length === 0 ? [] : await project.file.query('SELECT sha256 FROM media_files WHERE sha256 IN (SELECT value FROM json_each(?))', [JSON.stringify(shas)]);
    const stored = new Set(rows.map((row) => String(row.sha256)));
    const keptAt = clip.flatMap((item, i) => {
      if (!item.media) return [i];
      const sha = shaOfClip(item.media);
      // A video card with no poster pastes without one; anything else needs its stored picture.
      return !elsewhere && (sha === null ? item.kind === 'video' : stored.has(sha)) ? [i] : [];
    });
    const allowed = keptAt.map((i) => clip[i] as ClipItem);
    if (allowed.length < clip.length) outcome.left = elsewhere ? 'elsewhere' : 'gone';
    if (allowed.length === 0 && connectors.length === 0) return { changes: [] };
    const now = store.getState().records;
    const made = pasteChanges(now, boardId, allowed, at);
    // Each connector joins the copies of its items; one whose item was left out keeps that end where it was.
    const newIds = clip.map((_, i) => {
      const k = keptAt.indexOf(i);
      return k >= 0 ? (made.ids[k] ?? null) : null;
    });
    const joined = pasteConnectorChanges(now, boardId, connectors, newIds, pasteDelta(allowed, connectors, at));
    ids = [...made.ids, ...joined.ids];
    videos = made.videos;
    return { changes: [...made.changes, ...joined.changes] };
  });
  if (outcome.left === 'elsewhere') showNotice(t('moodboard.pasteElsewhere'));
  else if (outcome.left === 'gone') showNotice(t('moodboard.pasteGone'));
  if (!written) return;
  // The browser build plays the file it was handed: a pasted card plays it too.
  for (const { from, to } of videos) rememberVideoFile(to, videoFileKept(from) ?? undefined);
  select(boardId, ids);
}

/** Duplicate is Copy then Paste offset from the originals, without touching the clipboard. */
export async function duplicateSelection(boardId: string): Promise<void> {
  const { records } = projectStore.getState();
  const selected = liveSelection(records, boardId);
  await pasteClipboard(boardId, null, clipOf(records, boardId, selected), projectStore, clipConnectorsOf(records, boardId, selected));
}

/** A link card with its address (http or https only) and the title typed for it; false when the address isn't one. */
export async function placeLink(boardId: string, geometry: Geometry, typed: string, title = ''): Promise<boolean> {
  const url = cardUrl(typed);
  if (url === null) return false;
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const made = createItems(records, boardId, [{ ...geometry, kind: 'link', url, ...(title.trim() !== '' ? { title: title.trim() } : {}) }]);
    ids = made.ids;
    return { changes: made.changes };
  });
  if (written) select(boardId, ids);
  return written;
}

/** The address or the title of the selected link card, edited in the properties strip. */
export async function changeLink(id: string, patch: { url?: string; title?: string }): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: linkChanges(records, id, patch) }));
}

/** Where files go that have no drop point (a paste, the Picture button): the middle of the view. */
const viewCentre = (boardId: string): Point => {
  const view = moodboardStore.getState().viewports[boardId] ?? DEFAULT_VIEWPORT;
  return { x: view.cx, y: view.cy };
};

/**
 * Dropped, pasted or chosen files onto a board: each is prepared as a frame's is (src/features/storyboard/addPictures.ts;
 * a file that can't be read is left out and named in one notice), then all land in one edit, side by side from the drop
 * point, so one undo takes back the whole drop. Without a point they are centred on the view.
 */
export async function addBoardFiles(boardId: string, added: readonly AddedFile[], at: Point | null, centred = at === null): Promise<void> {
  const { project } = projectStore.getState();
  if (!project || added.length === 0) return;
  picturesBusy.setState((s) => ({ count: s.count + added.length }));
  const prepared: PreparedFile[] = [];
  const problems: { name: string; reason: string }[] = [];
  try {
    for (const file of added) {
      try {
        prepared.push(await prepare(file, project.file.nativeHandle));
      } catch (error) {
        problems.push({ name: file.file.name, reason: reason(error) });
      }
    }
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - added.length }));
  }
  // Another project may have opened while they were prepared; they belong to the one they were dropped on.
  if (prepared.length > 0 && projectStore.getState().project === project) {
    let placed: PlacedBoardFiles | null = null;
    const saved = await projectStore.getState().applyWith((records) => {
      const board = records[boardId];
      // The board went to the Trash while the files were prepared: nothing is written onto it.
      placed = board?.type === 'board' && board.trashedAt === null ? boardFileChanges(records, boardId, prepared, at ?? viewCentre(boardId), project.file.path, centred) : null;
      return placed ?? { changes: [] };
    });
    const result = placed as PlacedBoardFiles | null;
    if (saved && result) {
      // The browser build keeps the file to play; the desktop app makes the video's playback copy (the frames' way).
      const videos = prepared.flatMap((file) => (file.kind === 'video' ? [file.video] : []));
      result.videoIds.forEach((videoId, i) => {
        rememberVideoFile(videoId, videos[i]?.file);
        makeCopy(videoId);
      });
      select(boardId, result.ids);
    } else if (!result) {
      showNotice(t('moodboard.boardGone'));
    }
  }
  const [first] = problems;
  if (first) {
    showNotice(
      added.length === 1
        ? localizeError(first.reason)
        : t('pictures.someNotAdded', { failed: problems.length, total: added.length, name: first.name, reason: localizeError(first.reason) }),
    );
  }
}

/** Pictures and videos as a drop, a paste or the Picture button hand them over: a video by its name goes in as a video. */
export const addBoardPictures = (boardId: string, files: readonly PictureFile[], at: Point | null, centred = at === null): Promise<void> => addBoardFiles(boardId, toAdded(files), at, centred);

/**
 * ⌘V into the focused canvas: pictures on the system clipboard, or text that is one web address, are the board's (true);
 * anything else is left for the items copied inside the app.
 */
export function pasteFromSystem(boardId: string, data: DataTransfer, at: Point | null): boolean {
  const decision = decidePasteOf(data, moodboardStore.getState().clipboard.length > 0 || moodboardStore.getState().clipConnectors.length > 0);
  // The items copied in the app; or text that isn't the board's and isn't an address, which pastes nothing.
  if (decision === 'items') return false;
  if (decision === 'nothing') return true;
  if (decision === 'foreign') {
    showInfo(t('moodboard.pasteNothing'));
    return true;
  }
  const files = [...data.files];
  if (files.length > 0) {
    // A paste lands with its middle at the pointer; a drop with its top left there.
    void addBoardPictures(boardId, files.map(fromFile), at, true);
    return true;
  }
  const url = pastedAddress(data.getData('text/plain'));
  if (url === null) return false;
  const point = at ?? viewCentre(boardId);
  const size = { width: 280, height: 88 };
  void placeLink(boardId, { x: Math.round(point.x - size.width / 2), y: Math.round(point.y - size.height / 2), ...size, rotation: 0 }, url);
  return true;
}

/**
 * Enter or a double-click on a card: a link opens in the browser (through the app's opener; nothing is fetched), a video
 * opens the Player on its video. `showPlayer` brings the Player tile to the front of the current workspace.
 */
export async function openCard(boardId: string, id: string, showPlayer: () => void, records: Records = projectStore.getState().records): Promise<void> {
  const record = records[id];
  const fields = record?.type === 'board_item' && record.parentId === boardId && record.trashedAt === null ? itemFields(record.props) : null;
  if (fields?.kind === 'link') {
    try {
      await openLink(fields.url);
    } catch (error) {
      showNotice(localizeError(reason(error)));
    }
  } else if (fields?.kind === 'video') {
    const video = mediaChildOf(records, id, 'video');
    if (!video) return;
    playCard(video.id, id);
    showPlayer();
  }
}

/**
 * A connector drawn, or one end of one dragged (5.2): one op group. A new connector is selected once made, as a shape is.
 * Nothing is written for a connector joined to one item at both ends or whose item is gone.
 */
export async function connect(boardId: string, drop: ConnectDrop): Promise<void> {
  let id: string | null = null;
  const written = await projectStore.getState().applyWith((records) => {
    const made = connectChanges(records, boardId, drop);
    id = made.id;
    return { changes: made.changes };
  });
  const made = id as string | null;
  if (written && made) select(boardId, [made]);
}

/** A change in the properties strip, applied to the selected connectors it fits in one op group. */
export async function changeConnector(boardId: string, patch: ConnectorPatch): Promise<void> {
  const ids = liveSelection(projectStore.getState().records, boardId);
  await projectStore.getState().applyWith((records) => ({ changes: connectorStyleChanges(records, ids, patch) }));
}

/**
 * The "+" handle, or ⌘⌥ + an arrow (5.2): a copy of the item's kind and style 80 units beyond one side with a connector
 * from the side to the copy, one op group. The copy is selected, and its text typed into at once when it has text.
 */
export async function quickCreate(boardId: string, itemId: string, side: Side): Promise<void> {
  const original = itemFields(projectStore.getState().records[itemId]?.props ?? {});
  // A text box is typed into before it exists, as a new one is: left empty it leaves nothing behind, connector included.
  if (original?.kind === 'text') {
    const seed = quickSeedOf(projectStore.getState().records, boardId, itemId, side, measureText);
    if (!seed) return;
    select(boardId, []);
    moodboardStore.getState().startEditing({ boardId, id: crypto.randomUUID(), draft: seed, join: { item: itemId, side } });
    return;
  }
  let made: ReturnType<typeof quickCreateChanges> = null;
  const written = await projectStore.getState().applyWith(async (records) => {
    const fields = itemFields(records[itemId]?.props ?? {});
    if (fields && isTextKind(fields.kind)) await fontReady(fields.fontFamily, fields.fontWeight, fields.fontItalic);
    made = quickCreateChanges(projectStore.getState().records, boardId, itemId, side, measureText);
    return { changes: made?.changes ?? [] };
  });
  const result = made as ReturnType<typeof quickCreateChanges>;
  if (!written || !result) return;
  select(boardId, [result.itemId]);
  if (result.edit) editItem(boardId, result.itemId);
}

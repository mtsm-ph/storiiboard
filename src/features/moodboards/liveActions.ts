import { openSettings } from '../../app/settings/settingsStore';
import { projectStore } from '../../app/projectStore';
import { showWorkspace } from '../../app/shell/workspaceStore';
import { tn, t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { DEFAULT_VIEWPORT } from '../../ui/canvas/viewport';
import type { Point } from '../../ui/canvas/types';
import { selectionStore } from '../storyboard/selection';
import { trashFocus } from '../trash/trashFocus';
import { setLinksChange, type BoardLinks } from './boards';
import { itemFields } from './items';
import { cardChanges, type CardTarget } from './liveAdd';
import { isLiveKind, liveCardData, projectIdOf } from './liveCards';
import { moodboardStore } from './moodboardStore';

// What a person does with live cards and a board's links (5.4): each edit is one op group, so one ⌘Z.

type Records = Readonly<Record<string, SbdRecord>>;

/** The middle of the board's view: where cards with no drop point land. */
const viewCentre = (boardId: string): Point => {
  const view = moodboardStore.getState().viewports[boardId] ?? DEFAULT_VIEWPORT;
  return { x: view.cx, y: view.cy };
};

/**
 * Cards for these frames and scenes, as a tidied row at the middle of the board's view (or at `centre`), in one op group.
 * The cards are selected once made. Resolves to their ids (none when nothing was live to add).
 */
export async function addLiveCards(boardId: string, targets: readonly CardTarget[], centre?: Point): Promise<string[]> {
  if (targets.length === 0) return [];
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const board = records[boardId];
    // A board that went to the Trash meanwhile gets nothing.
    if (board?.type !== 'board' || board.trashedAt !== null) return { changes: [] };
    const made = cardChanges(records, boardId, targets, centre ?? viewCentre(boardId));
    ids = made.ids;
    return { changes: made.changes };
  });
  if (!written || ids.length === 0) return [];
  moodboardStore.getState().select(boardId, ids);
  moodboardStore.getState().announce(tn('moodboard.live.added', ids.length));
  return ids;
}

/** The storyboard's "Add to board…": cards for these on the chosen board, which opens in the Moodboard with them selected. */
export async function addToBoard(boardId: string, targets: readonly CardTarget[]): Promise<void> {
  const ids = await addLiveCards(boardId, targets);
  if (ids.length === 0) return;
  moodboardStore.getState().openBoard(boardId);
  moodboardStore.getState().select(boardId, ids);
  showWorkspace('moodboard');
}

/** Sets which scenes, characters and locations a board is linked to (one op group). */
export async function setBoardLinks(boardId: string, links: BoardLinks): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: setLinksChange(records, boardId, links) }));
}

/** Retries for a few frames: the workspace being switched to is drawn after this runs. */
function whenThere(selector: string, then: (element: HTMLElement) => void, tries = 30): void {
  // Never in the same tick as the switch: the old workspace is still drawn then.
  requestAnimationFrame(() => {
    // Only one on screen: another workspace's Storyboard tile, or a hidden copy, is not the one switched to.
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => candidate.offsetParent !== null);
    if (element) then(element);
    else if (tries > 0) whenThere(selector, then, tries - 1);
  });
}

/** Opens the storyboard with the scene selected, scrolled into view (the palette editor is in its Inspector). */
export function showScene(sceneId: string): void {
  selectionStore.getState().selectScene(sceneId);
  showWorkspace('storyboard');
  // The scene's first frame (or its "+ frame" button, which is a board item too), as the Inspector's jump does.
  whenThere(`[data-board] [data-scene-group="${CSS.escape(sceneId)}"] [data-board-item]`, (element) => {
    element.scrollIntoView({ block: 'nearest' });
    element.focus();
  });
}

/** Opens the storyboard with the frame selected, scrolled into view. */
export function showShot(shotId: string, sceneId: string | null): void {
  selectionStore.getState().selectShot(shotId, sceneId);
  showWorkspace('storyboard');
  whenThere(`[data-board] [data-shot-id="${CSS.escape(shotId)}"]`, (element) => {
    // Focus follows, as it does after a move on the board (StoryboardTile's focusFrame).
    element.scrollIntoView({ block: 'nearest' });
    element.focus();
  });
}

/**
 * Enter or a double-click on a live card (5.4). A shot or scene card jumps back to the storyboard and selects its frame or
 * scene; one whose record is in the Trash opens the Trash tile filtered to it instead; a palette card opens its scene,
 * where the palette editor is; a brand kit with no company attached opens Settings, where one is attached.
 */
export function openLiveCard(boardId: string, id: string, showTrash: () => void, records: Records = projectStore.getState().records): void {
  const record = records[id];
  const fields = record?.type === 'board_item' && record.parentId === boardId && record.trashedAt === null ? itemFields(record.props) : null;
  if (!fields || !isLiveKind(fields.kind)) return;
  const data = liveCardData(records, projectIdOf(records, id), { kind: fields.kind, shotId: fields.shotId, sceneId: fields.sceneId });
  if (data.kind === 'brand_card') {
    if (!data.company) openSettings('project');
    return;
  }
  const sceneId = fields.kind === 'shot_card' ? (records[fields.shotId]?.parentId ?? null) : fields.sceneId;
  if (data.state === 'gone') {
    moodboardStore.getState().announce(fields.kind === 'shot_card' ? t('moodboard.live.shotRemoved') : t('moodboard.live.sceneRemoved'));
    return;
  }
  if (data.state === 'trash') {
    // A frame that went with its scene is found by the scene; one trashed alone, by the frames.
    const scene = sceneId ? records[sceneId] : undefined;
    const sceneTrashed = scene !== undefined && scene.trashedAt !== null;
    trashFocus.getState().ask(fields.kind === 'shot_card' && !sceneTrashed ? 'frame' : 'scene', sceneId, projectIdOf(records, id) ?? '');
    showTrash();
    return;
  }
  if (fields.kind === 'shot_card') showShot(fields.shotId, sceneId);
  else if (sceneId) showScene(sceneId);
}

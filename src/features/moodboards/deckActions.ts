import { paperNow } from '../../app/paper';
import { projectStore } from '../../app/projectStore';
import { openSettings } from '../../app/settings/settingsStore';
import { showWorkspace } from '../../app/shell/workspaceStore';
import { rememberVideoFile, videoFileKept } from '../../app/videoFiles';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { Geometry } from '../../ui/canvas/types';
import { createItems, itemFields } from './items';
import { deckChanges, type DeckTemplate } from './deckTemplates';
import { isPaper, pageSize, type DeckField, type PageFormat, type PageOrientation } from './pageFormats';
import { addPageChanges, deckPageFormat, deletePageChanges, duplicatePageChanges, movePageChanges, pagesOf } from './pages';
import { moodboardStore } from './moodboardStore';
import { measureText } from './textFit';

// What a person does with decks (5.5): each edit is one op group, so one ⌘Z. Selection and the view stay in the session.

type Records = Readonly<Record<string, SbdRecord>>;

const select = (boardId: string, ids: readonly string[]) => {
  moodboardStore.getState().select(boardId, ids);
};

/** A new deck from a template (or blank), opened. Treatment and Shot list print on the paper the app's setting and region choose. */
export async function createDeck(name: string, template: DeckTemplate, format?: PageFormat, orientation?: PageOrientation): Promise<string | null> {
  const { project } = projectStore.getState();
  if (!project || name.trim() === '') return null;
  const made = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const deck = deckChanges(records, project.projectId, {
      template,
      name,
      paper: paperNow(),
      ...(format ? { format } : {}),
      ...(orientation ? { orientation } : {}),
      measure: measureText,
    });
    made.id = deck.id;
    return { changes: deck.changes };
  });
  if (!written || made.id === null) return null;
  moodboardStore.getState().openBoard(made.id);
  // The first page is in view and selected when a deck opens.
  const first = pagesOf(projectStore.getState().records, made.id)[0];
  if (first) select(made.id, [first.id]);
  return made.id;
}

/** Add page: a page of a format after the last (the deck's own when none is given), selected once made. Resolves to its id. */
export async function addPage(boardId: string, format?: PageFormat, orientation?: PageOrientation): Promise<string | null> {
  const out = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const board = records[boardId];
    if (board?.type !== 'board' || board.trashedAt !== null) return { changes: [] };
    const made = addPageChanges(records, boardId, format ? { format, orientation: orientation ?? deckPageFormat(board).orientation } : {});
    out.id = made.id;
    return { changes: made.changes };
  });
  if (!written || out.id === null) return null;
  select(boardId, [out.id]);
  return out.id;
}

/** The Page tool: a page of the deck's format centred where the click or drag was. */
export async function placePage(boardId: string, at: Geometry): Promise<void> {
  const out = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const { format, orientation } = deckPageFormat(records[boardId]);
    const size = pageSize(format, orientation);
    const made = createItems(records, boardId, [{ kind: 'page', x: Math.round(at.x + at.width / 2 - size.width / 2), y: Math.round(at.y + at.height / 2 - size.height / 2), ...size, rotation: 0, format, orientation: isPaper(format) ? orientation : 'portrait', name: '' }]);
    out.id = made.ids[0] ?? null;
    return { changes: made.changes };
  });
  if (written && out.id) select(boardId, [out.id]);
}

/** Duplicate page: the page and what it holds, after the last page; selected. */
export async function duplicatePage(boardId: string, pageId: string): Promise<void> {
  const out = { id: null as string | null };
  let videos: { from: string; to: string }[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const made = duplicatePageChanges(records, boardId, pageId);
    out.id = made?.id ?? null;
    videos = made?.videos ?? [];
    return { changes: made?.changes ?? [] };
  });
  if (!written || out.id === null) return;
  // A copied video card plays the file the original does.
  for (const { from, to } of videos) rememberVideoFile(to, videoFileKept(from) ?? undefined);
  select(boardId, [out.id]);
}

/** Delete page: the page to the Trash, its contents left on the board as working space. One group. Resolves to the page's number (for saying so). */
export async function deletePage(boardId: string, pageId: string): Promise<boolean> {
  const written = await projectStore.getState().applyWith((records) => {
    const board = records[boardId];
    return { changes: board?.type === 'board' && board.trashedAt === null ? deletePageChanges(records, pageId) : [] };
  });
  if (written) select(boardId, []);
  return written;
}

/** Move page up or down, or to a place (0-based) in the deck's order. */
export async function movePage(boardId: string, pageId: string, to: number): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: movePageChanges(records, boardId, pageId, to) }));
}

/** A live field card for a field, at the middle of the view. */
export async function addFieldCard(boardId: string, field: DeckField): Promise<void> {
  const out = { id: null as string | null };
  const written = await projectStore.getState().applyWith((records) => {
    const view = moodboardStore.getState().viewports[boardId] ?? { cx: 0, cy: 0, zoom: 1 };
    const wide = field === 'cast' || field === 'crew' || field === 'dates';
    const size = { width: 480, height: wide ? 320 : field === 'logline' ? 160 : 80 };
    const made = createItems(records, boardId, [
      { kind: 'field_card', field, x: Math.round(view.cx - size.width / 2), y: Math.round(view.cy - size.height / 2), ...size, rotation: 0, fontSize: field === 'title' ? 48 : 28, fontWeight: field === 'title' ? 700 : 400 },
    ]);
    out.id = made.ids[0] ?? null;
    return { changes: made.changes };
  });
  if (written && out.id) select(boardId, [out.id]);
}

/**
 * Enter or a double-click on a field card (5.5): where its value is edited. The title, logline, format, runtime and company are
 * in Settings → Project; cast and crew in the Team tile; dates in Shoot days (Production).
 */
export function openFieldCard(records: Records, id: string): void {
  const fields = itemFields(records[id]?.props ?? {});
  if (fields?.kind !== 'field_card') return;
  if (fields.field === 'cast' || fields.field === 'crew') showWorkspace('team');
  else if (fields.field === 'dates') showWorkspace('production');
  else openSettings('project');
  moodboardStore.getState().announce(t('deck.openedWhere', { where: fields.field === 'cast' || fields.field === 'crew' ? t('deck.where.team') : fields.field === 'dates' ? t('deck.where.shootDays') : t('deck.where.settings') }));
}

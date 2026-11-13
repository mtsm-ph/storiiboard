import { COMPANY_LOGO_ROLE } from '../../core/model/company';
import { mediaFields } from '../../core/media/store';
import { videoFields } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../../core/model/shotNumbers';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { restoredScene } from '../storyboard/board';
import { boardTitle, restoreBoardChanges } from '../moodboards/boards';
import { connectorsToRestore, trashedWithItem } from '../moodboards/connectors';
import { isConnector } from '../moodboards/connectorFields';
import { isLiveKind, itemFields, KIND_LABEL } from '../moodboards/items';
import { DECK_FIELD_LABEL } from '../moodboards/pageFormats';
import { pageNumberOf } from '../moodboards/pages';
import { headingOf } from '../storyboard/ScenesView';
import { labels, t, tn } from '../../core/i18n';
import { dayDateLabel, shootDayFields } from '../../core/model/shootDay';
import { ATTACHMENT_KIND_LABEL, attachmentFields } from '../../core/model/attachment';

// The Trash (1.20, CLAUDE.md): what's been deleted (frames, scenes, notes and pictures), kept until Empty Trash
// (1.21), each restorable with one click. Never mixed with an archived project, which is the project's `state`.
// Sketch strokes the eraser took aren't listed: they're part of a frame's sketch, and undo brings them back.

type Records = Readonly<Record<string, SbdRecord>>;

export type TrashKind = 'scene' | 'frame' | 'note' | 'picture' | 'location' | 'person' | 'day' | 'gear' | 'attachment' | 'board' | 'boardItem';

export const TRASH_KIND_LABEL: Readonly<Record<TrashKind, string>> = labels({
  scene: 'trash.kind.scene',
  frame: 'trash.kind.frame',
  note: 'trash.kind.note',
  picture: 'trash.kind.picture',
  location: 'trash.kind.location',
  person: 'trash.kind.person',
  day: 'trash.kind.day',
  gear: 'trash.kind.gear',
  attachment: 'trash.kind.attachment',
  board: 'trash.kind.board',
  boardItem: 'trash.kind.boardItem',
});

/** The Type filter's choices: every scene, every frame… */
export const TRASH_KIND_PLURAL: Readonly<Record<TrashKind, string>> = labels({
  scene: 'trash.kinds.scene',
  frame: 'trash.kinds.frame',
  note: 'trash.kinds.note',
  picture: 'trash.kinds.picture',
  location: 'trash.kinds.location',
  person: 'trash.kinds.person',
  day: 'trash.kinds.day',
  gear: 'trash.kinds.gear',
  attachment: 'trash.kinds.attachment',
  board: 'trash.kinds.board',
  boardItem: 'trash.kinds.boardItem',
});

/** "Restore frame 4A": the kind as it reads inside a sentence. */
export const TRASH_KIND_IN_SENTENCE: Readonly<Record<TrashKind, string>> = labels({
  scene: 'trash.kindLower.scene',
  frame: 'trash.kindLower.frame',
  note: 'trash.kindLower.note',
  picture: 'trash.kindLower.picture',
  location: 'trash.kindLower.location',
  person: 'trash.kindLower.person',
  day: 'trash.kindLower.day',
  gear: 'trash.kindLower.gear',
  attachment: 'trash.kindLower.attachment',
  board: 'trash.kindLower.board',
  boardItem: 'trash.kindLower.boardItem',
});

export interface NamePart {
  text: string;
  mono: boolean;
}

export interface TrashItem {
  id: string;
  kind: TrashKind;
  /** What it was, as the board names it: `1A`, `SC 04 INT. DINER — NIGHT`, a note's first words, a picture's file. */
  name: string;
  /** The name in pieces, the shot and scene numbers in it marked to be set in mono. */
  parts: readonly NamePart[];
  /** The scene it belongs to, for the filter, and how that reads: `SC 04`. Null for the project's own image. */
  sceneId: string | null;
  sceneName: string | null;
  /** When it went to the Trash (ISO). */
  trashedAt: string;
}

/** The scene a record sits in: itself for a scene, its parent for a frame or a note, its frame's for a picture. */
function sceneOf(records: Records, record: SbdRecord): SbdRecord | null {
  let at: SbdRecord | undefined = record;
  for (let depth = 0; at && depth < 4; depth += 1) {
    if (at.type === 'scene') return at;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return null;
}

function kindOf(record: SbdRecord): TrashKind | null {
  if (record.type === 'scene') return 'scene';
  if (record.type === 'shot') return 'frame';
  if (record.type === 'note') return 'note';
  // A PDF or a link (3.11) is an attachment, not a picture.
  if (record.type === 'media') return attachmentFields(record.props) ? 'attachment' : 'picture';
  if (record.type === 'location') return 'location';
  if (record.type === 'person') return 'person';
  if (record.type === 'shoot_day') return 'day';
  if (record.type === 'gear_item') return 'gear';
  if (record.type === 'board') return 'board';
  if (record.type === 'board_item') return 'boardItem';
  return null;
}

const mono = (text: string): NamePart => ({ text, mono: true });
const plain = (text: string): NamePart => ({ text, mono: false });

function partsOf(records: Records, record: SbdRecord, kind: TrashKind): NamePart[] {
  switch (kind) {
    case 'scene': {
      const fields = sceneFields(record.props);
      return [mono(sceneLabel(fields.number)), plain(t('trash.sceneHeading', { heading: headingOf(fields) }))];
    }
    case 'frame': {
      const number = shotFields(record.props).number;
      return [number ? mono(number) : plain(t('trash.unnumberedFrame'))];
    }
    case 'note': {
      const text = typeof record.props.text === 'string' ? record.props.text.trim().replace(/\s+/g, ' ') : '';
      return [plain(text === '' ? t('trash.emptyNote') : text.length > 60 ? `${text.slice(0, 59)}…` : text)];
    }
    case 'person': {
      const name = typeof record.props.name === 'string' && record.props.name.trim() !== '' ? record.props.name : t('trash.unnamedPerson');
      return [plain(name)];
    }
    case 'location': {
      const name = typeof record.props.name === 'string' && record.props.name.trim() !== '' ? record.props.name : t('trash.unnamedLocation');
      return [plain(name)];
    }
    case 'attachment': {
      const fields = attachmentFields(record.props);
      const name = fields ? fields.name || (fields.kind === 'link' ? fields.url : t('assets.unnamedPdf')) : '';
      return [plain(name), plain(fields ? t('trash.attachmentKind', { kind: ATTACHMENT_KIND_LABEL[fields.kind] }) : '')];
    }
    case 'board':
      // A deck says so (5.5), as a department's board does not need to.
      return record.props.kind === 'deck' ? [plain(boardTitle(record)), plain(t('trash.deckTag'))] : [plain(boardTitle(record))];
    case 'boardItem': {
      // "Rectangle on Camera board": what it is, and the board it was on (as that board is called now).
      const board = record.parentId ? records[record.parentId] : undefined;
      const fields = itemFields(record.props);
      const kind = fields ? KIND_LABEL[fields.kind]() : isConnector(record) ? t('moodboard.item.connector') : t('trash.boardItemUnknown');
      const where = board ? boardTitle(board) : t('moodboard.untitled');
      // A live card (5.4) is named by what it shows: "Shot card 4A on Camera board". One whose record is gone is just its kind.
      if (fields && isLiveKind(fields.kind) && fields.kind !== 'brand_card') {
        const shown = fields.kind === 'shot_card' ? records[fields.shotId] : records[fields.sceneId];
        const name =
          fields.kind === 'shot_card'
            ? shown?.type === 'shot'
              ? shotFields(shown.props).number
              : ''
            : shown?.type === 'scene'
              ? sceneLabel(sceneFields(shown.props).number)
              : '';
        if (name !== '') return [plain(t('trash.liveCardOnBoard', { item: KIND_LABEL[fields.kind](), name, board: where }))];
      }
      // A deck's page: "Page 3 'The look' on Pitch deck"; a field card by its field (5.5).
      if (fields?.kind === 'page') {
        const number = pageNumberOf(records, record);
        return [plain(fields.name.trim() === '' ? t('trash.pageOnDeckUnnamed', { number, board: where }) : t('trash.pageOnDeck', { number, name: fields.name.trim(), board: where }))];
      }
      if (fields?.kind === 'field_card' && fields.field !== '') return [plain(t('trash.fieldCardOnDeck', { field: DECK_FIELD_LABEL[fields.field], board: where }))];
      // A section is named: "Section 'Act One' on Camera board" (5.3).
      if (fields?.kind === 'section' && fields.name.trim() !== '') return [plain(t('trash.sectionOnBoard', { name: fields.name.trim(), board: where }))];
      return [plain(t('trash.itemOnBoard', { item: kind, board: where }))];
    }
    case 'gear': {
      const name = typeof record.props.name === 'string' && record.props.name.trim() !== '' ? record.props.name : t('gear.unnamed');
      return [plain(name)];
    }
    case 'day': {
      // By its date (3.7): its number belongs to the live days' order, which it has left.
      const date = dayDateLabel(shootDayFields(record.props).date);
      return [plain(date ? t('trash.dayOn', { date }) : t('trash.undatedDay'))];
    }
    case 'picture': {
      // A linked video (2.2b), by its file's name.
      const video = videoFields(record.props);
      if (video) return [plain(video.sourceName), plain(t('trash.video'))];
      const file = plain(mediaFields(record.props)?.sourceName || t('trash.pastedPicture'));
      const parent = record.parentId ? records[record.parentId] : undefined;
      if (parent?.type === 'media') return [file, plain(t('trash.videoPoster'))];
      // A location's photo (3.3), by its location's name.
      if (parent?.type === 'location') return [file, plain(t('trash.photoOf', { name: typeof parent.props.name === 'string' && parent.props.name.trim() !== '' ? parent.props.name : t('trash.unnamedLocation') }))];
      return parent?.type === 'shot' ? [file, plain(t('trash.pictureOf')), mono(shotFields(parent.props).number)] : [file, plain(t('trash.logoPicture'))];
    }
  }
}

/** Whether a record went to the Trash with its parent, in the same op group (a scene's frames and notes). */
function trashedWithParent(records: Records, record: SbdRecord): boolean {
  const parent = record.parentId ? records[record.parentId] : undefined;
  return parent !== undefined && parent.trashedAt !== null && parent.trashedAt === record.trashedAt && parent.trashedBy === record.trashedBy;
}

/** A scene's frames and notes that went to the Trash with it. */
function trashedWith(records: Records, scene: SbdRecord): SbdRecord[] {
  return Object.values(records).filter((r) => r.parentId === scene.id && (r.type === 'shot' || r.type === 'note') && trashedWithParent(records, r));
}

/** What an item is called now, as the list names it: after a restore, under the number it came back with. */
export function restoredName(records: Records, id: string): string | null {
  const record = records[id];
  const kind = record ? kindOf(record) : null;
  return record && kind ? partsOf(records, record, kind).map((p) => p.text).join('') : null;
}

/**
 * The live location a restore of this one would sit beside under the same name (3.3: one name per place), or null.
 * The Trash says so rather than restore it.
 */
export function restoreClash(records: Records, id: string): string | null {
  const record = records[id];
  // A location's photo brings its trashed location back with it (restoreChanges), so it's that location's clash.
  const parent = record?.type === 'media' && record.parentId ? records[record.parentId] : undefined;
  if (parent?.type === 'location' && parent.trashedAt !== null) return restoreClash(records, parent.id);
  if (record?.type !== 'location' || typeof record.props.name !== 'string') return null;
  const wanted = record.props.name.trim().toLowerCase();
  if (wanted === '') return null;
  const live = Object.values(records).find(
    (r) => r.type === 'location' && r.id !== id && r.trashedAt === null && r.parentId === record.parentId && typeof r.props.name === 'string' && r.props.name.trim().toLowerCase() === wanted,
  );
  return live ? record.props.name.trim() : null;
}

/** Everything in the project's Trash, the most recently deleted first; a scene's frames deleted with it are in its row. */
export function trashItems(records: Records, projectId: string): TrashItem[] {
  const items: TrashItem[] = [];
  for (const record of Object.values(records)) {
    if (record.trashedAt === null) continue;
    const kind = kindOf(record);
    if (!kind || (record.type !== 'scene' && record.type !== 'media' && trashedWithParent(records, record))) continue;
    // A company's replaced logo (3.2) belongs to the company's copy, which undo puts back: restored alone, it would be
    // a picture nothing shows. Empty Trash still clears it.
    if (isCompanyLogo(record)) continue;
    // A connector that went to the Trash with one of its items (5.2) comes back with it; the Trash lists the item.
    if (trashedWithItem(records, record)) continue;
    const scene = sceneOf(records, record);
    // Only this project's records (a file holds one project, but the check is cheap and keeps the list honest).
    let top: SbdRecord | undefined = record;
    while (top?.parentId) top = records[top.parentId];
    if (top?.id !== projectId) continue;
    const inside = kind === 'scene' ? trashedWith(records, record).filter((r) => r.type === 'shot').length : 0;
    const parts = [...partsOf(records, record, kind), ...(inside > 0 ? [plain(tn('trash.withFrames', inside))] : [])];
    items.push({
      id: record.id,
      kind,
      name: parts.map((p) => p.text).join(''),
      parts,
      sceneId: scene?.id ?? null,
      sceneName: scene ? sceneLabel(sceneFields(scene.props).number) : null,
      trashedAt: record.trashedAt,
    });
  }
  return items.sort((a, b) => (a.trashedAt < b.trashedAt ? 1 : a.trashedAt > b.trashedAt ? -1 : a.id.localeCompare(b.id)));
}

/**
 * The op group that brings one item back, with what it needs to be seen again:
 * - a frame or a note comes back with its scene, if that's in the Trash too, and with everything deleted with the
 *   scene (polish 5); a frame's scene renumbers unless locked;
 * - a frame's picture comes back with its frame, as the frame's picture again, and the one it has now goes to the
 *   Trash in its place, so nothing is lost and undo swaps them back;
 * - a location's photo comes back with its location, if that's in the Trash too (3.3);
 * - the project's logo or key image comes back on its own; Settings → Theme makes it the theme's image again.
 */
export function restoreChanges(records: Records, projectId: string, id: string, slate: SlateNumbers = NO_SLATE_NUMBERS): Change[] {
  const record = records[id];
  if (!record || record.trashedAt === null) return [];
  const parent = record.parentId ? records[record.parentId] : undefined;
  // A frame or note deleted before its scene, restored while the scene is in the Trash, brings the scene back whole:
  // with what was deleted with it, not just this one (which would leave the rest as loose rows).
  const withScene = (scene: SbdRecord | undefined, back: string): Change[] =>
    scene?.type === 'scene'
      ? restoredScene(records, projectId, scene.id, [...new Set([...(scene.trashedAt !== null ? trashedWith(records, scene).map((r) => r.id) : []), back])], slate)
      : [];
  switch (record.type) {
    case 'shot':
      return withScene(parent, id);
    case 'note':
      return parent?.type === 'scene' ? withScene(parent, id) : [{ kind: 'restore', id }];
    case 'media': {
      // A location's photo comes back with its location if that's in the Trash too, so it's seen again (3.3).
      if (parent?.type === 'location') return [...(parent.trashedAt !== null ? [{ kind: 'restore' as const, id: parent.id }] : []), { kind: 'restore', id }];
      // A PDF or a link (3.11) comes back as itself: never as a frame's picture, which stays as it is.
      if (parent?.type !== 'shot' || attachmentFields(record.props)) return [{ kind: 'restore', id }];
      const current = shotFields(parent.props).mediaId;
      const showing = current ? records[current] : undefined;
      return [
        ...(parent.trashedAt !== null ? withScene(parent.parentId ? records[parent.parentId] : undefined, parent.id) : []),
        { kind: 'restore', id },
        { kind: 'update', id: parent.id, set: { media_id: id }, unset: ['crop'] },
        ...(showing && showing.id !== id && showing.trashedAt === null ? [{ kind: 'trash' as const, id: showing.id }] : []),
      ];
    }
    case 'board':
      // With the items that went to the Trash with it, not ones deleted before.
      return restoreBoardChanges(records, id);
    case 'board_item': {
      // An item comes back with the connectors trashed with it whose other end is live, free or coming back too (5.2); a
      // connector deleted on its own comes back alone, and stays hidden while one of its items is in the Trash.
      const connectors = connectorsToRestore(records, id).map((connector): Change => ({ kind: 'restore', id: connector }));
      // An item whose board is in the Trash brings the board back whole, or it would come back onto nothing.
      if (parent?.type === 'board' && parent.trashedAt !== null) {
        const board = restoreBoardChanges(records, parent.id);
        const have = (restoring: string) => board.some((c) => c.kind === 'restore' && c.id === restoring);
        return [...board, ...(have(id) ? [] : [{ kind: 'restore' as const, id }]), ...connectors.filter((c) => c.kind === 'restore' && !have(c.id))];
      }
      return [{ kind: 'restore', id }, ...connectors];
    }
    case 'scene':
      // With the frames and notes deleted with it (docs/SBD_FORMAT.md, Trash), not ones deleted before.
      // With a new number if a live scene has taken its own; its frames are numbered the board's way.
      return restoredScene(records, projectId, id, trashedWith(records, record).map((r) => r.id), slate);
    default:
      return [{ kind: 'restore', id }];
  }
}

/** A company's logo (3.2): kept with the company's copy, so the Trash doesn't list it on its own. */
const isCompanyLogo = (record: SbdRecord) => record.type === 'media' && record.props.role === COMPANY_LOGO_ROLE;

/**
 * Company logos replaced or detached (3.2), in the Trash though it doesn't list them: Empty Trash clears them too, so
 * it counts them, to be offered while they're all there is, and to say so.
 */
export function oldCompanyLogos(records: Records, projectId: string): number {
  return Object.values(records).filter((r) => r.trashedAt !== null && r.parentId === projectId && isCompanyLogo(r)).length;
}

/** How many of these Trash rows are gone from the project: what an Empty Trash deleted, counted as the Trash lists it. */
export function rowsGone(records: Records, rows: readonly TrashItem[]): number {
  return rows.filter((row) => !records[row.id]).length;
}

/**
 * The Empty Trash confirm, the same in the Trash tile and Settings → Storage. `hidden` counts items the Trash tile's
 * filters hide, since it empties them too. `unknown`: some slate numbers from before schema 5 couldn't be recovered.
 */
export function emptyTrashMessage(records: Records, count: number, hidden = 0, unknown = false, logos = 0): string {
  const items = tn('count.items', count);
  const listed = hidden > 0 ? t('trash.itemsHidden', { items, hidden }) : items;
  // Old company logos aren't listed, so they're named: they go too.
  const what = logos === 0 ? listed : count === 0 ? tn('trash.oldLogos', logos) : t('trash.andOldLogos', { items: listed, logos: tn('trash.oldLogos', logos) });
  // A locked scene keeps every number it has given out (1.26), so emptying the Trash can't free one. The exception is
  // what an Empty Trash deleted before that: gone, numbers and all. Said while any scene is locked.
  const locked = Object.values(records).some((r) => r.type === 'scene' && r.trashedAt === null && sceneFields(r.props).numbersLocked);
  return [
    t('trash.emptyConfirm', { what }),
    t('trash.emptyCantUndo'),
    ...(unknown && locked ? [t('trash.emptyLettersUnknown')] : []),
  ].join(' ');
}

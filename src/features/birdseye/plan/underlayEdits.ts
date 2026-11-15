import { isPictureType, typeOf } from '../../../app/pictures';
import { t } from '../../../core/i18n';
import { imageStatements, mediaFields, mediaProps } from '../../../core/media/store';
import { lastKeyUnder, scaledUnderlay, underlayFields, type Point, type ShownItem } from '../../../core/model/plan';
import type { Props, SbdRecord } from '../../../core/model/record';
import { childrenOf } from '../../../core/model/recordIndex';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import type { Statement } from '../../../core/storage/driver';
import { hitsPoint } from '../../../ui/canvas/hitTest';
import type { FramePicture } from '../../storyboard/framePictures';
import { runRoomId, unreadableAfter } from './planItems';

// The room's underlays (6.9, docs/PHASE6_DECISIONS.md 12): a floor plan or a location photo under the room, stored as a
// board's pictures are (the pipeline's capped picture and thumbnail in the file, a pointer to the original, never the
// original itself), set to scale by two points and a typed distance. Pure, so each edit is tested without a browser.

type Records = Readonly<Record<string, SbdRecord>>;

/** A new underlay's longer side, metres (decision 12): about a room's, so it reads at once and is set to scale after. */
export const UNDERLAY_LONG_SIDE = 10;

const tidy = (m: number): number => Math.round(m * 10000) / 10000;

/** A new underlay's size for a picture of `aspect` (width over height): its longer side 10 m, the other in proportion. */
export function underlaySize(aspect: number): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return safe >= 1 ? { width: UNDERLAY_LONG_SIDE, height: tidy(UNDERLAY_LONG_SIDE / safe) } : { width: tidy(UNDERLAY_LONG_SIDE * safe), height: UNDERLAY_LONG_SIDE };
}

/** Whether a file is a PDF, which this milestone doesn't read as an underlay (the notice says to save it as a picture). */
export const isPdfName = (name: string): boolean => /\.pdf$/i.test(name.trim());

/** What a file offered as an underlay is, told by its name and type alone, before anything is read (6.9 review, L6). */
export type UnderlayFileKind = 'picture' | 'pdf' | 'other';

/**
 * A PDF by its name or its type; a picture when its extension or its type is one of the picture types boards take
 * (src/app/pictures.ts); anything else (a video, a program) is refused without being read, opened or run.
 */
export function underlayFileKind(file: { name: string; type?: string | undefined }): UnderlayFileKind {
  const type = (file.type ?? '').toLowerCase();
  if (isPdfName(file.name) || type === 'application/pdf') return 'pdf';
  if (typeOf(file.name) !== '' || isPictureType(type)) return 'picture';
  return 'other';
}

export interface AddedUnderlay {
  id: string;
  changes: Change[];
  alsoWrite: Statement[];
}

/**
 * A picture added under the scene's room (6.9): an `underlay` item at the front of the room's plan, its middle at `centre`
 * (metres), its longer side 10 m, and its picture a `media` record under it, named by its `media_id`, with the bytes in
 * the same transaction: one op group. Nothing when the scene has no live room, or it would land past the plan's reach.
 */
export function addUnderlayChanges(
  records: Records,
  sceneId: string,
  picture: FramePicture,
  centre: Point,
  projectPath: string,
  now = new Date(),
  id: string = crypto.randomUUID(),
  mediaId: string = crypto.randomUUID(),
): AddedUnderlay {
  const roomId = runRoomId(records, sceneId);
  if (roomId === null) return { id, changes: [], alsoWrite: [] };
  const { width, height } = picture.image.original;
  const size = underlaySize(width / height);
  const props: Props = { kind: 'underlay', media_id: mediaId, x: tidy(centre.x - size.width / 2), y: tidy(centre.y - size.height / 2), width: size.width, height: size.height, rotation: 0 };
  const changes: Change[] = [
    { kind: 'create', record: { id, type: 'plan_item', parentId: roomId, sortKey: keyBetween(lastKeyUnder(records, roomId, 'plan_item'), null), props } },
    { kind: 'create', record: { id: mediaId, type: 'media', parentId: id, sortKey: keyBetween(null, null), props: mediaProps(picture.image, picture.source, projectPath) } },
  ];
  if (unreadableAfter(records, changes)) return { id, changes: [], alsoWrite: [] };
  return { id, changes, alsoWrite: imageStatements(picture.image, now) };
}

/**
 * "Set scale" (6.9): the underlay scaled about the first of two points clicked on it (metres) so they are `typed` metres
 * apart, `scaled` set and the distance kept for History's words, one op group. Nothing for an underlay that isn't live,
 * points on top of each other, a distance not above 0, or a box past the plan's reach or size.
 */
export function setScaleChanges(records: Records, underlayId: string, a: Point, b: Point, typed: number): Change[] {
  const record = records[underlayId];
  const fields = record?.type === 'plan_item' && record.trashedAt === null ? underlayFields(record.props) : null;
  if (!fields) return [];
  const next = scaledUnderlay(fields, a, b, typed);
  if (!next) return [];
  const changes: Change[] = [{ kind: 'update', id: underlayId, set: { x: next.x, y: next.y, width: next.width, height: next.height, scaled: true, scale_m: tidy(typed) } }];
  return unreadableAfter(records, changes) ? [] : changes;
}

/** The live underlays of a room, back to front. */
export function roomUnderlays(records: Records, roomId: string | null): SbdRecord[] {
  if (roomId === null) return [];
  return childrenOf(records, roomId, 'plan_item')
    .filter((r) => r.trashedAt === null && underlayFields(r.props) !== null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The underlay "Set scale" works on (6.9): the one selected, when it is one of the room's; else the room's frontmost.
 * Null when the room has none.
 */
export function scaleTarget(records: Records, roomId: string | null, selected: readonly string[]): string | null {
  const all = roomUnderlays(records, roomId);
  const picked = all.find((r) => selected.includes(r.id));
  return (picked ?? all.at(-1))?.id ?? null;
}

/**
 * The underlay Set scale's first click is on (6.9 review, L2): of the room's live underlays under `point` (metres, as
 * each is drawn, turned about its middle), the one Set scale was started for when it is one of them, else the topmost.
 * Null when the click is on none: an underlay of another room is never one (L1).
 */
export function underlayAt(records: Records, roomId: string | null, point: Point, preferred: string | null = null): string | null {
  const under = roomUnderlays(records, roomId).flatMap((r) => {
    const fields = underlayFields(r.props);
    return fields && hitsPoint(fields, point) ? [r.id] : [];
  });
  if (preferred !== null && under.includes(preferred)) return preferred;
  return under.at(-1) ?? null;
}

/** What an underlay is called in Set scale's words: its name, else its picture's file name, else null. */
export function underlayName(records: Records, underlayId: string): string | null {
  const fields = underlayFields(records[underlayId]?.props ?? {});
  if (!fields) return null;
  if (fields.name !== '') return fields.name;
  const media = fields.mediaId === null ? undefined : records[fields.mediaId];
  const name = media?.type === 'media' ? mediaFields(media.props)?.sourceName : undefined;
  return name !== undefined && name !== '' ? name : null;
}

/**
 * What Set scale's hint calls an underlay among the room's (`underlays`, back to front): its name or its picture's file
 * name, else its number. Two from the same picture share a name, so a name another underlay has too carries the number
 * (6.9 review, L5): "plan.jpg (2)".
 */
export function underlayHintName(records: Records, underlays: readonly SbdRecord[], underlayId: string): string {
  const number = underlays.findIndex((r) => r.id === underlayId) + 1;
  const name = underlayName(records, underlayId);
  if (name === null) return t('plan.underlay.numbered', { number });
  return underlays.some((r) => r.id !== underlayId && underlayName(records, r.id) === name) ? t('plan.underlay.nameNumbered', { name, number }) : name;
}

/** Whether any of the room's underlays is still to be set to scale: the Plan tile's quiet note. */
export const unscaledIn = (records: Records, roomId: string | null): boolean => roomUnderlays(records, roomId).some((r) => underlayFields(r.props)?.scaled !== true);

/** Each shown underlay's picture: its `media_id` to the stored picture's address; a record missing or unreadable is left out (drawn "gone"). */
export function underlayPictures(records: Records, shown: readonly ShownItem[]): ReadonlyMap<string, string> {
  const pictures = new Map<string, string>();
  for (const item of shown) {
    if (item.fields.kind !== 'underlay' || item.fields.mediaId === null) continue;
    const media = records[item.fields.mediaId];
    const fields = media?.type === 'media' && media.trashedAt === null ? mediaFields(media.props) : null;
    if (fields) pictures.set(item.fields.mediaId, fields.sha256);
  }
  return pictures;
}

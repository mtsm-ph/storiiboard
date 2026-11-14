import { imageStatements, mediaFields, mediaProps } from '../../../core/media/store';
import { lastKeyUnder, scaledUnderlay, underlayFields, type Point, type ShownItem } from '../../../core/model/plan';
import type { Props, SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import type { Statement } from '../../../core/storage/driver';
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
  return Object.values(records)
    .filter((r) => r.type === 'plan_item' && r.parentId === roomId && r.trashedAt === null && underlayFields(r.props) !== null)
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

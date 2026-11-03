import { cropProp, isDefaultCrop, type Crop } from '../../core/media/crop';
import { imageStatements, mediaFields, mediaProps, type ImageSource, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { shotFields, type ShotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { addShots } from './board';
import type { FramePictureView } from './FrameImage';

// The edits that put pictures in frames (1.11). A frame's picture is a `media` record under its shot, named by the
// shot's `media_id`; the bytes go in the same transaction (alsoWrite), so the frame and its picture land together.
// Replacing or removing a picture trashes its media record in the same op group: undo brings it straight back, and
// the bytes stay in the file for History until Empty Trash or Clean up old pictures (1.21).

type Records = Readonly<Record<string, SbdRecord>>;

/** A picture ready to go in a frame: what the pipeline made of a file, and where the file was. */
export interface FramePicture {
  image: PreparedImage;
  source: ImageSource;
}

/** One edit's changes with the bytes they need. */
export interface PictureEdit {
  changes: Change[];
  alsoWrite: Statement[];
}

function mediaCreate(shotId: string, sortKey: string, picture: FramePicture, projectPath: string): Change & { kind: 'create' } {
  return {
    kind: 'create',
    record: {
      id: crypto.randomUUID(),
      type: 'media',
      parentId: shotId,
      sortKey,
      props: mediaProps(picture.image, picture.source, projectPath),
    },
  };
}

/** The bytes for every picture, once each: the same picture dropped twice is stored once anyway. */
function bytesFor(pictures: readonly FramePicture[], now: Date): Statement[] {
  const seen = new Set<string>();
  return pictures.flatMap((picture) => {
    if (seen.has(picture.image.original.sha256)) return [];
    seen.add(picture.image.original.sha256);
    return imageStatements(picture.image, now);
  });
}

/** The shot's media records, live ones, in order. */
function mediaOf(records: Records, shotId: string): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'media' && r.parentId === shotId && r.trashedAt === null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/** The picture a frame shows now, if any: trashed with the change that replaces or removes it. */
function currentMedia(records: Records, shotId: string): SbdRecord | null {
  const shot = records[shotId];
  const id = shot ? shotFields(shot.props).mediaId : null;
  const media = id ? records[id] : undefined;
  return media && media.trashedAt === null ? media : null;
}

/** What a view draws for a frame: its live picture's address and shape, and the crop; null for an empty frame. */
export function pictureView(records: Records, fields: ShotFields): FramePictureView | null {
  const media = fields.mediaId ? records[fields.mediaId] : undefined;
  const picture = media && media.trashedAt === null ? mediaFields(media.props) : null;
  return picture ? { sha256: picture.sha256, aspect: picture.width / picture.height, crop: fields.crop } : null;
}

/** Gives a frame a picture, replacing the one it had. The new picture starts centred, so the old crop goes. */
export function setPicture(
  records: Records,
  shotId: string,
  picture: FramePicture,
  projectPath: string,
  now = new Date(),
): PictureEdit {
  if (!records[shotId]) return { changes: [], alsoWrite: [] };
  const old = currentMedia(records, shotId);
  const create = mediaCreate(shotId, keyBetween(mediaOf(records, shotId).at(-1)?.sortKey ?? null, null), picture, projectPath);
  return {
    changes: [
      create,
      { kind: 'update', id: shotId, set: { media_id: create.record.id ?? '' }, unset: ['crop'] },
      ...(old ? [{ kind: 'trash', id: old.id } as const] : []),
    ],
    alsoWrite: bytesFor([picture], now),
  };
}

/** Empties a frame: its picture goes to the Trash with the edit, and the frame stays. */
export function removePicture(records: Records, shotId: string): Change[] {
  const old = currentMedia(records, shotId);
  const shot = records[shotId];
  if (!shot || !shotFields(shot.props).mediaId) return [];
  return [{ kind: 'update', id: shotId, unset: ['media_id', 'crop'] }, ...(old ? [{ kind: 'trash', id: old.id } as const] : [])];
}

/** A new framing for the picture; the centred default is stored as no prop at all. */
export function setCrop(shotId: string, crop: Crop): Change {
  return isDefaultCrop(crop)
    ? { kind: 'update', id: shotId, unset: ['crop'] }
    : { kind: 'update', id: shotId, set: { crop: cropProp(crop) } };
}

/**
 * New frames, one per picture, after `afterShotId` (or at the end of the scene), with their scene renumbered: one op
 * group, so one undo takes them all back.
 */
export function addFramesWithPictures(
  records: Records,
  projectId: string,
  sceneId: string,
  afterShotId: string | null,
  pictures: readonly FramePicture[],
  projectPath: string,
  now = new Date(),
): PictureEdit & { shotIds: string[] } {
  if (pictures.length === 0) return { changes: [], alsoWrite: [], shotIds: [] };
  const mediaIds = pictures.map(() => crypto.randomUUID());
  const { changes, shotIds } = addShots(
    records,
    projectId,
    sceneId,
    afterShotId,
    mediaIds.map((id) => ({ media_id: id })),
  );
  const media = pictures.map((picture, i): Change => {
    const create = mediaCreate(shotIds[i] ?? '', keyBetween(null, null), picture, projectPath);
    return { ...create, record: { ...create.record, id: mediaIds[i] ?? '' } };
  });
  // The shots first, since each picture's record hangs from its shot.
  return { changes: [...changes, ...media], alsoWrite: bytesFor(pictures, now), shotIds };
}

/** Where pictures dropped or pasted on the board go. */
export type PictureTarget = { kind: 'frame'; shotId: string } | { kind: 'scene'; sceneId: string; afterShotId: string | null };

/**
 * Pictures into the board: onto a frame, the first becomes its picture and the rest new frames after it; into a
 * scene, all of them new frames. Returns the frame to select afterwards.
 */
export function placePictures(
  records: Records,
  projectId: string,
  target: PictureTarget,
  pictures: readonly FramePicture[],
  projectPath: string,
  now = new Date(),
): PictureEdit & { selectShotId: string | null; sceneId: string | null } {
  const [first, ...rest] = pictures;
  if (!first) return { changes: [], alsoWrite: [], selectShotId: null, sceneId: null };
  if (target.kind === 'scene') {
    const added = addFramesWithPictures(records, projectId, target.sceneId, target.afterShotId, pictures, projectPath, now);
    return { ...added, selectShotId: added.shotIds[0] ?? null, sceneId: target.sceneId };
  }
  const shot = records[target.shotId];
  const sceneId = shot?.parentId ?? null;
  if (!shot || !sceneId) return { changes: [], alsoWrite: [], selectShotId: null, sceneId: null };
  const own = setPicture(records, target.shotId, first, projectPath, now);
  const more = addFramesWithPictures(records, projectId, sceneId, target.shotId, rest, projectPath, now);
  return {
    changes: [...own.changes, ...more.changes],
    // Made once for all of them, so a picture dropped twice isn't sent twice.
    alsoWrite: bytesFor(pictures, now),
    selectShotId: target.shotId,
    sceneId,
  };
}

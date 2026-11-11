import { mediaFields } from '../../core/media/store';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';

// The `media` record a picture or video card keeps as its child (5.1b, docs/SBD_FORMAT.md, Boards), as a frame's picture
// is its shot's child. Kept apart from items.ts so the copy and paste there can use it without a cycle.

type Records = Readonly<Record<string, SbdRecord>>;

const byKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

// A parent-to-children index, built once for each records object (the store replaces it on every change), so a card
// finds its media without a scan of every record in the project.
const indexes = new WeakMap<object, Map<string, SbdRecord[]>>();

function childrenOf(records: Records, parentId: string): readonly SbdRecord[] {
  let index = indexes.get(records);
  if (!index) {
    index = new Map();
    for (const record of Object.values(records)) {
      if (record.parentId === null) continue;
      const list = index.get(record.parentId);
      if (list) list.push(record);
      else index.set(record.parentId, [record]);
    }
    indexes.set(records, index);
  }
  return index.get(parentId) ?? [];
}

/** The item's live media record of that kind (an `image` for a picture, a `video` for a video card). */
export function mediaChildOf(records: Records, itemId: string, kind: 'image' | 'video'): SbdRecord | undefined {
  return childrenOf(records, itemId)
    .filter((r) => r.type === 'media' && r.trashedAt === null && r.props.kind === kind)
    .sort(byKey)[0];
}

/** A video record's poster: the image `media` record its `poster` prop names, under it. */
export function posterOf(records: Records, video: SbdRecord): SbdRecord | undefined {
  const id = video.props.poster;
  const poster = typeof id === 'string' ? records[id] : undefined;
  return poster?.type === 'media' && poster.trashedAt === null ? poster : undefined;
}

/**
 * What Copy keeps of a picture or video card's media: the props to write again (and a video's poster props). Pictures and
 * video cards paste only into the project they were copied in, where the stored pictures and the file paths are as they
 * were, so a clip carries no bytes and no paths of its own.
 */
export interface ClipMedia {
  /** The record copied from (a video's, to hand its browser-build file on). */
  recordId: string;
  props: Props;
  poster: Props | null;
}

/** The media of an item, as Copy keeps it; null for a kind with none, or one whose record is gone. */
export function clipMediaOf(records: Records, itemId: string, kind: 'picture' | 'video'): ClipMedia | null {
  const media = mediaChildOf(records, itemId, kind === 'picture' ? 'image' : 'video');
  if (!media) return null;
  const poster = kind === 'video' ? posterOf(records, media) : undefined;
  return { recordId: media.id, props: media.props, poster: poster?.props ?? null };
}

/** The sha of the stored picture a clip's media shows (a video's is its poster's, or null with no poster). */
export const shaOfClip = (media: ClipMedia): string | null =>
  media.props.kind === 'video' ? (media.poster ? (mediaFields(media.poster)?.sha256 ?? null) : null) : (mediaFields(media.props)?.sha256 ?? null);

export interface CopiedMedia {
  changes: Change[];
  /** A video's new record id, with the one it was copied from. */
  video: { from: string; to: string } | null;
}

/**
 * New media records under a new item, naming the same stored file as the original (a picture's `file` hash, a video's
 * path and poster): the bytes are stored once. A video's poster is a new record too, so the copy owns it.
 */
export function mediaCopyChanges(itemId: string, media: ClipMedia): CopiedMedia {
  const videoId = crypto.randomUUID();
  const posterId = media.poster ? crypto.randomUUID() : null;
  const props: Props = { ...media.props };
  if (media.poster) props.poster = posterId ?? '';
  else delete props.poster;
  const changes: Change[] = [{ kind: 'create', record: { id: videoId, type: 'media', parentId: itemId, sortKey: keyBetween(null, null), props } }];
  if (posterId && media.poster) {
    changes.push({ kind: 'create', record: { id: posterId, type: 'media', parentId: videoId, sortKey: keyBetween(null, null), props: media.poster } });
  }
  return { changes, video: media.props.kind === 'video' ? { from: media.recordId, to: videoId } : null };
}

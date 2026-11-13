import { imageStatements, mediaProps } from '../../core/media/store';
import { displayAspect, videoFields, videoProps } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { PASTE_OFFSET, tidy } from '../../ui/canvas/placement';
import type { Point } from '../../ui/canvas/types';
import type { PreparedFile } from '../video/linkVideos';
import { createItems, type ItemSeed } from './items';

// Pictures and videos dropped, pasted or chosen onto a board (5.1b). A picture is stored as a frame's is (the pipeline's
// capped picture and thumbnail in the file, a pointer to the original, never the original itself); a video stays where it
// is, linked by path, with its first frame as its poster. Each becomes a `board_item` with its `media` record as its
// child, and all of a drop land side by side, left to right from the drop point, in one op group.

type Records = Readonly<Record<string, SbdRecord>>;

/** The long edge of a picture or video card when it is placed, in world units; the shorter edge keeps the aspect. */
export const PLACED_LONG_EDGE = 400;
/** The space between files dropped together. */
export const DROP_GAP = PASTE_OFFSET;

/** A box of `aspect` (width over height) whose long edge is 400. */
export function sizeForAspect(aspect: number): { width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  return safe >= 1
    ? { width: PLACED_LONG_EDGE, height: tidy(PLACED_LONG_EDGE / safe) }
    : { width: tidy(PLACED_LONG_EDGE * safe), height: PLACED_LONG_EDGE };
}

export interface PlacedBoardFiles {
  ids: string[];
  changes: Change[];
  alsoWrite: Statement[];
  /** The video record of each video card made, in order. */
  videoIds: string[];
}

/**
 * The edit for files placed on a board. `origin` is where the first card's top left goes; with `centred`, the row is
 * centred on it instead (a paste or the Picture button, which have no drop point).
 */
export function boardFileChanges(
  records: Records,
  boardId: string,
  files: readonly PreparedFile[],
  origin: Point,
  projectPath: string,
  centred = false,
  now = new Date(),
): PlacedBoardFiles {
  const posterIds = files.map(() => crypto.randomUUID());
  const sizes = files.map((file, i) => {
    if (file.kind === 'picture') {
      const { width, height } = file.picture.image.original;
      return sizeForAspect(width / height);
    }
    const fields = videoFields(videoProps(file.video.probe, file.video.source, projectPath, posterIds[i] ?? null));
    return sizeForAspect(fields ? displayAspect(fields) : file.video.still.original.width / file.video.still.original.height);
  });
  const total = sizes.reduce((sum, size, i) => sum + size.width + (i > 0 ? DROP_GAP : 0), 0);
  const tallest = Math.max(0, ...sizes.map((size) => size.height));
  let x = centred ? origin.x - total / 2 : origin.x;
  const top = centred ? origin.y - tallest / 2 : origin.y;
  const seeds: ItemSeed[] = files.map((file, i) => {
    const size = sizes[i] ?? sizeForAspect(1);
    const seed: ItemSeed = { kind: file.kind, x: tidy(x), y: tidy(top), width: size.width, height: size.height, rotation: 0 };
    x += size.width + DROP_GAP;
    return seed;
  });
  const made = createItems(records, boardId, seeds);
  const media: Change[] = [];
  const bytes: Statement[] = [];
  const stored = new Set<string>();
  const store = (image: Parameters<typeof imageStatements>[0]) => {
    if (stored.has(image.original.sha256)) return;
    stored.add(image.original.sha256);
    bytes.push(...imageStatements(image, now));
  };
  const videoIds: string[] = [];
  files.forEach((file, i) => {
    const itemId = made.ids[i] ?? '';
    if (file.kind === 'picture') {
      const { image, source } = file.picture;
      store(image);
      media.push({ kind: 'create', record: { id: crypto.randomUUID(), type: 'media', parentId: itemId, sortKey: keyBetween(null, null), props: mediaProps(image, source, projectPath) } });
      return;
    }
    const { video } = file;
    const videoId = crypto.randomUUID();
    const posterId = posterIds[i] ?? '';
    store(video.still);
    videoIds.push(videoId);
    media.push(
      { kind: 'create', record: { id: videoId, type: 'media', parentId: itemId, sortKey: keyBetween(null, null), props: videoProps(video.probe, video.source, projectPath, posterId) } },
      { kind: 'create', record: { id: posterId, type: 'media', parentId: videoId, sortKey: keyBetween(null, null), props: mediaProps(video.still, { name: video.source.name }) } },
    );
  });
  return { ids: made.ids, changes: [...made.changes, ...media], alsoWrite: bytes, videoIds };
}

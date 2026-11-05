import { DEFAULT_CROP } from '../../core/media/crop';
import { imageStatements, mediaProps, type PreparedImage } from '../../core/media/store';
import { clipProp, fromVideoProp, videoFields, videoProps, type VideoProbe, type VideoSource } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../../core/model/shotNumbers';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { placePictures, type FramePicture, type PictureTarget } from '../storyboard/framePictures';

// Linking videos to frames (Phase 2.2). A video stays where it is (CLAUDE.md): the project gets a `media` record of
// kind `video` that points at it, with a poster (its first frame, as an image record under it), and each frame it
// goes into gets that frame as its picture and the whole video as its `clip`. Linking the same file again reuses its
// record, so two frames play parts of one video. Everything lands in one edit: one undo takes it all back.

type Records = Readonly<Record<string, SbdRecord>>;

/** A video read and its first frame prepared, ready to link. */
export interface PreparedVideo {
  probe: VideoProbe;
  source: VideoSource;
  /** Frame 0 through the picture pipeline: the frame's picture, and the poster of a new video record. */
  still: PreparedImage;
}

/** A live video record that already points at this file, by its path as the project stores it. */
function existingVideo(records: Records, projectId: string, storedPath: string): SbdRecord | undefined {
  if (storedPath === '') return undefined;
  return Object.values(records).find(
    (r) =>
      r.type === 'media' &&
      r.parentId === projectId &&
      r.trashedAt === null &&
      r.props.kind === 'video' &&
      r.props.source_path === storedPath,
  );
}

/** The last child's sort key under a parent, so a new one goes after it. */
function lastKey(records: Records, parentId: string): string | null {
  let last: string | null = null;
  for (const r of Object.values(records)) if (r.parentId === parentId && (last === null || r.sortKey > last)) last = r.sortKey;
  return last;
}

export interface VideoLinkEdit {
  changes: Change[];
  alsoWrite: Statement[];
  /** The video record each video went into, in order: new or reused. */
  videoIds: string[];
  selectShotId: string | null;
  sceneId: string | null;
}

const NOTHING: VideoLinkEdit = { changes: [], alsoWrite: [], videoIds: [], selectShotId: null, sceneId: null };

/**
 * The edit that links videos to frames: onto a frame, the first video becomes its picture and clip and the rest new
 * frames after it; into a scene, each a new frame.
 */
export function linkVideos(
  records: Records,
  projectId: string,
  target: PictureTarget,
  videos: readonly PreparedVideo[],
  projectPath: string,
  slate: SlateNumbers = NO_SLATE_NUMBERS,
  now = new Date(),
): VideoLinkEdit {
  const changes: Change[] = [];
  const videoIds: string[] = [];
  const pictures: FramePicture[] = [];
  let key = lastKey(records, projectId);
  const made = new Map<string, string>();
  for (const video of videos) {
    const props = videoProps(video.probe, video.source, projectPath, null);
    const storedPath = typeof props.source_path === 'string' ? props.source_path : '';
    // The same file twice in one drop, or a file the project links already: one record.
    let videoId = (storedPath ? made.get(storedPath) : undefined) ?? existingVideo(records, projectId, storedPath)?.id;
    if (!videoId) {
      videoId = crypto.randomUUID();
      const posterId = crypto.randomUUID();
      key = keyBetween(key, null);
      changes.push(
        { kind: 'create', record: { id: videoId, type: 'media', parentId: projectId, sortKey: key, props: { ...props, poster: posterId } } },
        {
          kind: 'create',
          record: { id: posterId, type: 'media', parentId: videoId, sortKey: keyBetween(null, null), props: mediaProps(video.still, { name: video.source.name }) },
        },
      );
      if (storedPath) made.set(storedPath, videoId);
    }
    videoIds.push(videoId);
    const fields = videoFields(props);
    pictures.push({
      image: video.still,
      source: { name: video.source.name, ...(video.source.path ? { path: video.source.path } : {}) },
      ...(fields ? { fromVideo: fromVideoProp(videoId, fields, 0, null) } : {}),
      clip: clipProp({ videoId, inFrame: 0, outFrame: Math.max(0, video.probe.durationFrames - 1), crop: DEFAULT_CROP }),
    });
  }
  // The records first, then the frames that play them, so nothing names a record that isn't there yet.
  const placed = placePictures(records, projectId, target, pictures, projectPath, slate, now);
  if (placed.changes.length === 0) return NOTHING;
  // Each still is stored once: as the poster and as the frame's picture, it's the same bytes.
  const seen = new Set<string>();
  const alsoWrite = videos.flatMap((video) => {
    if (seen.has(video.still.original.sha256)) return [];
    seen.add(video.still.original.sha256);
    return imageStatements(video.still, now);
  });
  return { changes: [...changes, ...placed.changes], alsoWrite, videoIds, selectShotId: placed.selectShotId, sceneId: placed.sceneId };
}

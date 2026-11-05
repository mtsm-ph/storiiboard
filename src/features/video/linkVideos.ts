import { DEFAULT_CROP } from '../../core/media/crop';
import { mediaProps, type PreparedImage } from '../../core/media/store';
import { clipProp, fromVideoProp, videoFields, videoProps, type VideoProbe, type VideoSource } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../../core/model/shotNumbers';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { placePictures, type FramePicture, type PictureTarget } from '../storyboard/framePictures';

// Files into frames (1.11, and videos from 2.2b), as one edit whatever the mix, so one undo takes back a whole drop.
// A picture is stored in the file; a video stays where it is (CLAUDE.md): the project gets a `media` record of kind
// `video` pointing at it, with a poster (its first frame, as an image record under it), and the frame it goes into gets
// that frame as its picture and the whole video as its `clip`. Linking the same file again reuses its record, as long
// as the file is still the one the record describes.

type Records = Readonly<Record<string, SbdRecord>>;

/** A video read and its first frame prepared, ready to link. */
export interface PreparedVideo {
  probe: VideoProbe;
  source: VideoSource;
  /** Frame 0 through the picture pipeline: the frame's picture, and the poster of a new video record. */
  still: PreparedImage;
}

/** One file of a drop, prepared, in the order it was dropped. */
export type PreparedFile = { kind: 'picture'; picture: FramePicture } | { kind: 'video'; video: PreparedVideo };

/**
 * A live video record for this file that still describes it: the same stored path, rate, length and start timecode.
 * A file re-exported to the same path with another length is another video, so it gets a record of its own.
 */
function existingVideo(records: Records, projectId: string, storedPath: string, probe: VideoProbe): SbdRecord | undefined {
  if (storedPath === '') return undefined;
  return Object.values(records).find((r) => {
    if (r.type !== 'media' || r.parentId !== projectId || r.trashedAt !== null || r.props.source_path !== storedPath) return false;
    const video = videoFields(r.props);
    return (
      video !== null &&
      video.fps.num * probe.fpsDen === probe.fpsNum * video.fps.den &&
      video.durationFrames === probe.durationFrames &&
      video.startTimecode === (probe.startTimecode || null)
    );
  });
}

/** The last child's sort key under a parent, so a new one goes after it. */
function lastKey(records: Records, parentId: string): string | null {
  let last: string | null = null;
  for (const r of Object.values(records)) if (r.parentId === parentId && (last === null || r.sortKey > last)) last = r.sortKey;
  return last;
}

export interface PlacedFiles {
  changes: Change[];
  alsoWrite: Statement[];
  /** The video record each video went into, in order: new or reused. */
  videoIds: string[];
  selectShotId: string | null;
  sceneId: string | null;
}

const NOTHING: PlacedFiles = { changes: [], alsoWrite: [], videoIds: [], selectShotId: null, sceneId: null };

/**
 * The edit that puts a drop's files into frames, in order: onto a frame, the first becomes its picture (and, for a
 * video, its clip) and the rest new frames after it; into a scene, each a new frame.
 */
export function placeFiles(
  records: Records,
  projectId: string,
  target: PictureTarget,
  files: readonly PreparedFile[],
  projectPath: string,
  slate: SlateNumbers = NO_SLATE_NUMBERS,
  now = new Date(),
): PlacedFiles {
  const changes: Change[] = [];
  const videoIds: string[] = [];
  const pictures: FramePicture[] = [];
  let key = lastKey(records, projectId);
  const made = new Map<string, { id: string; probe: VideoProbe }>();
  for (const file of files) {
    if (file.kind === 'picture') {
      pictures.push(file.picture);
      continue;
    }
    const { video } = file;
    const props = videoProps(video.probe, video.source, projectPath, null);
    const storedPath = typeof props.source_path === 'string' ? props.source_path : '';
    // The same file twice in one drop, or a file the project links already: one record.
    const twice = storedPath ? made.get(storedPath) : undefined;
    let videoId =
      (twice && twice.probe.durationFrames === video.probe.durationFrames ? twice.id : undefined) ??
      existingVideo(records, projectId, storedPath, video.probe)?.id;
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
      if (storedPath) made.set(storedPath, { id: videoId, probe: video.probe });
    }
    videoIds.push(videoId);
    // A reused record describes this file exactly (existingVideo), so the clip and timecode agree with it.
    const fields = videoFields(props);
    pictures.push({
      image: video.still,
      source: { name: video.source.name, ...(video.source.path ? { path: video.source.path } : {}) },
      ...(fields ? { fromVideo: fromVideoProp(videoId, fields, 0, null) } : {}),
      clip: clipProp({ videoId, inFrame: 0, outFrame: Math.max(0, video.probe.durationFrames - 1), crop: DEFAULT_CROP }),
    });
  }
  // The records first, then the frames that use them, so nothing names a record that isn't there yet. Every
  // picture's bytes are written once: a poster is the same bytes as its frame's picture.
  const placed = placePictures(records, projectId, target, pictures, projectPath, slate, now);
  if (placed.changes.length === 0) return NOTHING;
  return {
    changes: [...changes, ...placed.changes],
    alsoWrite: placed.alsoWrite,
    videoIds,
    selectShotId: placed.selectShotId,
    sceneId: placed.sceneId,
  };
}

/** Videos alone into frames: placeFiles with only videos. */
export function linkVideos(
  records: Records,
  projectId: string,
  target: PictureTarget,
  videos: readonly PreparedVideo[],
  projectPath: string,
  slate: SlateNumbers = NO_SLATE_NUMBERS,
  now = new Date(),
): PlacedFiles {
  return placeFiles(records, projectId, target, videos.map((video) => ({ kind: 'video', video })), projectPath, slate, now);
}

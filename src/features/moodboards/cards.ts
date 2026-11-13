import { mediaFields } from '../../core/media/store';
import { frameTimecode } from '../../core/media/timecode';
import { videoFields } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import { mediaChildOf, posterOf } from './itemMedia';
import type { ItemFields } from './items';

// What a picture or video card draws, worked out from its records: plain data, so the drawing stays a drawing.

type Records = Readonly<Record<string, SbdRecord>>;

export interface CardInfo {
  /** The stored picture to draw (the picture itself, or a video's poster); null when its record is gone. */
  sha256: string | null;
  /** A picture's original file name; a video's file name. */
  name: string;
  /** A video's length as timecode; '' for a picture. */
  duration: string;
  /** A video whose file isn't where the project says. */
  missing: boolean;
  /** The video's media record, which the Player plays and Relink points again. */
  videoId: string | null;
}

export function cardInfo(records: Records, itemId: string, fields: ItemFields, missingVideos: Readonly<Record<string, true>>): CardInfo | null {
  if (fields.kind === 'picture') {
    const media = mediaChildOf(records, itemId, 'image');
    const picture = media ? mediaFields(media.props) : null;
    return { sha256: picture?.sha256 ?? null, name: picture?.sourceName ?? '', duration: '', missing: false, videoId: null };
  }
  if (fields.kind === 'video') {
    const media = mediaChildOf(records, itemId, 'video');
    const video = media ? videoFields(media.props) : null;
    const poster = media ? posterOf(records, media) : undefined;
    const still = poster ? mediaFields(poster.props) : null;
    return {
      sha256: still?.sha256 ?? null,
      name: video?.sourceName ?? '',
      duration: video ? frameTimecode(video.durationFrames, video.fps, null) : '',
      missing: media ? missingVideos[media.id] === true : false,
      videoId: media?.id ?? null,
    };
  }
  return null;
}

/** The item's original file name for the properties strip, and whether a path is kept to show it by. */
export function originalOf(records: Records, itemId: string): { name: string; path: string; sha256: string } | null {
  const media = mediaChildOf(records, itemId, 'image');
  const picture = media ? mediaFields(media.props) : null;
  return picture ? { name: picture.sourceName, path: picture.sourcePath, sha256: picture.sha256 } : null;
}

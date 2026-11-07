import { isTauriApp } from '../../app/fileAccess';
import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { videoDriver, type VideoFile } from '../../app/video';
import { videoFileKept } from '../../app/videoFiles';
import { t } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import type { PreparedImage } from '../../core/media/store';
import { lutForCopy, lutName } from '../../core/media/lut';
import { frameTimecode } from '../../core/media/timecode';
import { clipProp, fromVideoProp, readClip, resolveSourcePath, videoFields, type VideoFields } from '../../core/media/video';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import type { Statement } from '../../core/storage/driver';
import { setCrop, setPicture } from '../storyboard/framePictures';

// Still capture (2.7): the frame showing in the Player, grabbed from the original (never the playback copy), graded
// with the video's LUT, becomes the frame's picture. The whole frame is kept, framed by the clip's crop (2.6), so the
// picture shows what the frame's window showed and can be framed again later with nothing lost. `from_video` records
// where it came from, so the same frame can be grabbed again after a relink or a LUT change. One edit, one undo step.

type Records = Readonly<Record<string, SbdRecord>>;

/** The frame's video as it is now: its record and fields, if the frame still plays it. */
function liveClip(records: Records, shotId: string, videoId: string) {
  const shot = records[shotId];
  const clip = shot?.type === 'shot' && shot.trashedAt === null ? readClip(shot.props) : null;
  const record = clip?.videoId === videoId ? records[videoId] : undefined;
  const video = record?.type === 'media' && record.trashedAt === null ? videoFields(record.props) : null;
  return clip && video ? { clip, video } : null;
}

/**
 * The edit that makes a grabbed still the frame's picture: the old picture to the Trash, the clip kept, and the
 * picture framed by the clip's crop. Nothing when the frame no longer plays that video (changed while it was grabbed).
 */
export function stillEdit(
  records: Records,
  shotId: string,
  videoId: string,
  frame: number,
  image: PreparedImage,
  lut: { id: string; name: string } | null,
  projectPath: string,
  now = new Date(),
): { changes: Change[]; alsoWrite: Statement[] } {
  const live = liveClip(records, shotId, videoId);
  if (!live) return { changes: [], alsoWrite: [] };
  const { clip, video } = live;
  const edit = setPicture(
    records,
    shotId,
    {
      image,
      source: { name: video.sourceName, ...(video.sourcePath ? { path: video.sourcePath } : {}) },
      fromVideo: fromVideoProp(videoId, video, frame, lut),
      clip: clipProp(clip),
    },
    projectPath,
    now,
  );
  // Framed as the window was: the same crop model (1.11, 2.6), for the same take in the same frame.
  return { changes: [...edit.changes, setCrop(shotId, clip.crop)], alsoWrite: edit.alsoWrite };
}

/** Where the still is read from: the original as the project links it (desktop), or the file kept for the page. */
function originalOf(videoId: string, video: VideoFields, projectPath: string): VideoFile {
  if (isTauriApp) return { name: video.sourceName, path: resolveSourcePath(video.sourcePath, projectPath) };
  const file = videoFileKept(videoId);
  return { name: video.sourceName, ...(file ? { file: new File([file], video.sourceName) } : {}) };
}

/** Grabs frame `frame` of the frame's video into the frame, as its picture. Says why when it can't. */
export async function grabStill(shotId: string, frame: number): Promise<boolean> {
  const { project, records } = projectStore.getState();
  const shot = records[shotId];
  const videoId = shot?.type === 'shot' ? readClip(shot.props)?.videoId : undefined;
  if (!project || !videoId) return false;
  const live = liveClip(records, shotId, videoId);
  if (!live) return false;
  const { video } = live;
  try {
    const lut = video.lutId ? await lutForCopy(project.file, video.lutId) : null;
    // Named but not stored: no still without the grade it should have.
    if (video.lutId && !lut) throw new Error(t('error.lutMissing'));
    const name = video.lutId ? await lutName(project.file, video.lutId) : null;
    const png = await videoDriver.still(originalOf(videoId, video, project.file.path), frame, video.fps, project.file.nativeHandle, lut);
    const timecode = frameTimecode(frame, video.fps, video.startTimecode).replaceAll(':', '-');
    const image = await prepareImage(new File([png], `${video.sourceName} ${timecode}.png`, { type: 'image/png' }));
    // Another project open since: this still isn't its.
    if (projectStore.getState().project !== project) return false;
    return await projectStore
      .getState()
      .applyWith((now) => stillEdit(now, shotId, videoId, frame, image, video.lutId && name ? { id: video.lutId, name } : null, project.file.path));
  } catch (error) {
    showNotice(error);
    return false;
  }
}

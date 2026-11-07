import { invoke } from '@tauri-apps/api/core';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo, showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { cropWindow } from '../../core/media/crop';
import { lutForCopy } from '../../core/media/lut';
import { displayAspect, readClip, resolveSourcePath, videoFields } from '../../core/media/video';
import { aspectRatioValue, projectStoryboard, sceneFields, shotFields } from '../../core/model/storyboard';
import { frameFileName } from '../export/names';

// Save clip as file (2.8b): the frame's clip, in to out, rendered from the original (never the playback copy) as an
// H.264 MP4, framed as the frame is, graded with the video's LUT, with its first sound track (src-tauri/src/video.rs
// save_clip). It's named as the frame's picture exports are, `SC004_4A.mp4`, so an editor matches it to the slate, and
// it goes only where the person chooses, through the export Save dialog. The browser build has no ffmpeg to make it.

/** The file name a frame's clip is saved under: as its picture's export, with `.mp4`. */
export function clipFileName(sceneNumber: string, shotNumber: string): string {
  return frameFileName(sceneNumber, shotNumber, 'mp4');
}

/** Asks where, then saves the frame's clip there; says when it's saved, or why it couldn't be. */
export async function saveClip(shotId: string): Promise<boolean> {
  const { project, records } = projectStore.getState();
  const shot = records[shotId];
  const clip = shot?.type === 'shot' && shot.trashedAt === null ? readClip(shot.props) : null;
  const record = clip ? records[clip.videoId] : undefined;
  const video = record?.type === 'media' && record.trashedAt === null ? videoFields(record.props) : null;
  const scene = shot?.parentId ? records[shot.parentId] : undefined;
  if (!project || !shot || !clip || !video || !scene) return false;
  if (!isTauriApp) {
    showNotice(new Error(t('saveClip.desktopOnly')));
    return false;
  }
  const name = clipFileName(sceneFields(scene.props).number, shotFields(shot.props).number);
  try {
    const dest = await invoke<string | null>('export_choose_file', { name });
    if (dest === null) return false;
    const lut = video.lutId ? await lutForCopy(project.file, video.lutId) : null;
    if (video.lutId && !lut) throw new Error(t('error.lutMissing'));
    const frameAspect = aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio);
    const box = cropWindow(clip.crop, displayAspect(video), frameAspect);
    const chosen = dest.split(/[/\\]/).pop() ?? name;
    showInfo(t('saveClip.saving', { name: chosen }));
    await invoke('clip_save', {
      path: resolveSourcePath(video.sourcePath, project.file.path),
      handle: project.file.nativeHandle ?? null,
      inFrame: clip.inFrame,
      outFrame: clip.outFrame,
      fpsNum: video.fps.num,
      fpsDen: video.fps.den,
      window: { left: box.left / 100, top: box.top / 100, width: box.width / 100, height: box.height / 100 },
      lut,
      dest,
    });
    showInfo(t('saveClip.saved', { name: chosen }));
    return true;
  } catch (error) {
    showNotice(error);
    return false;
  }
}

import { isTauriApp } from '../../app/fileAccess';
import { videoDriver, type VideoFile } from '../../app/video';
import { t } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import type { PreparedVideo } from './linkVideos';

// Reading a video the person handed over (2.2b): ffprobe's facts, and its first frame grabbed from the original and
// prepared like any picture. Only a file dropped or chosen gets here, so a poster is never made from a file the app
// can read only because it sits in the project's folder.

/** A file's size: the browser build knows it; the desktop app asks Rust. Null when it can't be told. */
async function sizeOf(file: VideoFile, handle: number | undefined): Promise<number | null> {
  if (file.size !== undefined) return file.size;
  if (!file.path) return null;
  const [status] = await videoDriver.status([file.path], handle);
  return status?.size ?? null;
}

export async function prepareVideo(file: VideoFile, handle: number | undefined): Promise<PreparedVideo> {
  // A video pasted in the desktop app arrives as bytes without a path, and a link needs the file where it is.
  if (isTauriApp && !file.path) throw new Error(t('videos.dropOrChoose'));
  const probe = await videoDriver.probe(file, handle);
  const png = await videoDriver.still(file, 0, { num: probe.fpsNum, den: probe.fpsDen }, handle);
  const still = await prepareImage(new File([png], `${file.name}.png`, { type: 'image/png' }));
  // Its size, to tell it from another clip with its name when relinking.
  const size = await sizeOf(file, handle);
  return {
    probe,
    still,
    source: { name: file.name, ...(file.path ? { path: file.path } : {}), ...(size !== null ? { size } : {}) },
    ...(!isTauriApp && file.file ? { file: file.file } : {}),
  };
}

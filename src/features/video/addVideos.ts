import type { VideoFile } from '../../app/video';
import { addFiles } from '../storyboard/addPictures';
import type { PictureTarget } from '../storyboard/framePictures';

// Videos from Link video… (2.2b): the same path as any drop, so pictures and videos always land as one edit.

export function addVideos(files: readonly VideoFile[], target: PictureTarget): Promise<void> {
  return addFiles(
    files.map((file) => ({ kind: 'video', file })),
    target,
  );
}

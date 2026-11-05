import { cropBox } from '../../../core/media/crop';
import { mediaFields, readThumbnail } from '../../../core/media/store';
import type { SbdRecord } from '../../../core/model/record';
import { shotFields } from '../../../core/model/storyboard';
import type { ProjectFile } from '../../../core/storage/driver';
import type { Lab } from '../../../ui/theme/generator/color';
import { framePixels } from './extract';

// The pixels of a scene's frames, as each is framed (polish PP). Read from the stored thumbnails, drawn with the frame's
// crop at the project's aspect ratio onto a small canvas. A Display P3 picture is drawn onto an sRGB canvas, which the
// engine converts colour-managed, as it does to show it: the palette's hex values are the colours on screen.

/** The long edge each frame is read at: plenty to find a scene's colours, quick to cluster. */
const READ_EDGE = 96;

type Records = Readonly<Record<string, SbdRecord>>;

/** The live frames in a scene that have a picture, in no particular order (the palette doesn't depend on it). */
export function framesWithPictures(records: Records, sceneId: string): { sha256: string; crop: ReturnType<typeof shotFields>['crop']; aspect: number }[] {
  return Object.values(records).flatMap((record) => {
    if (record.type !== 'shot' || record.parentId !== sceneId || record.trashedAt !== null) return [];
    const fields = shotFields(record.props);
    const media = fields.mediaId ? records[fields.mediaId] : undefined;
    const picture = media && media.trashedAt === null ? mediaFields(media.props) : null;
    return picture ? [{ sha256: picture.sha256, crop: fields.crop, aspect: picture.width / picture.height }] : [];
  });
}

/** One frame's pixels as framed, or null when its picture can't be read (missing from the file, say). */
async function readFrame(file: ProjectFile, sha256: string, crop: ReturnType<typeof shotFields>['crop'], frameAspect: number): Promise<Lab[] | null> {
  const stored = await readThumbnail(file, sha256);
  if (!stored) return null;
  const bitmap = await createImageBitmap(new Blob([stored.bytes as BlobPart], { type: stored.mime }));
  try {
    const width = frameAspect >= 1 ? READ_EDGE : Math.max(1, Math.round(READ_EDGE * frameAspect));
    const height = frameAspect >= 1 ? Math.max(1, Math.round(READ_EDGE / frameAspect)) : READ_EDGE;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const box = cropBox(crop, bitmap.width / bitmap.height, frameAspect);
    ctx.drawImage(bitmap, (box.left / 100) * width, (box.top / 100) * height, (box.width / 100) * width, (box.height / 100) * height);
    return framePixels({ data: ctx.getImageData(0, 0, width, height).data, width, height });
  } finally {
    bitmap.close();
  }
}

/** The pixels of every frame in a scene that has a picture; a picture that can't be read is left out. */
export async function scenePixels(file: ProjectFile, records: Records, sceneId: string, frameAspect: number): Promise<Lab[][]> {
  const frames = framesWithPictures(records, sceneId);
  const read = await Promise.all(frames.map((f) => readFrame(file, f.sha256, f.crop, frameAspect).catch(() => null)));
  return read.filter((pixels): pixels is Lab[] => pixels !== null);
}

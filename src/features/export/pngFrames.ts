import { canvasBlob } from '../../core/media/canvas';
import { aspectRatioValue, projectStoryboard } from '../../core/model/storyboard';
import { exportName, frameFileName, uniqueNames } from './names';
import type { ExportFormat } from './registry';
import { renderFrame } from './renderFrame';
import { scenesIn } from './scope';
import { watermarkFor } from './watermark';

/** The long edge of an exported frame, in pixels: full HD for 16:9. */
export const PNG_LONG_EDGE = 1920;

export function pngSize(aspect: number): { width: number; height: number } {
  return aspect >= 1
    ? { width: PNG_LONG_EDGE, height: Math.round(PNG_LONG_EDGE / aspect) }
    : { width: Math.round(PNG_LONG_EDGE * aspect), height: PNG_LONG_EDGE };
}

export const pngFrames: ExportFormat = {
  id: 'png-frames',
  label: 'Frames (PNG)',
  description: 'One image per frame, named by scene and shot number as on the slate (SC004_4A.png), in a new folder.',
  output: 'folder',
  watermark: 'png',
  name: (title, scene) => exportName(title, scene, 'frames'),
  run: async ({ records, projectId, scope, file, target, progress, signal }) => {
    const props = records[projectId]?.props;
    const size = pngSize(aspectRatioValue(projectStoryboard(props).aspectRatio));
    const watermark = watermarkFor(props, 'png');
    const frames = scenesIn(records, projectId, scope).flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
    const unique = uniqueNames();
    // Named when it's done: a frame whose picture the file has lost goes out marked, never as a quiet blank.
    const missing: string[] = [];
    let done = 0;
    progress(done, frames.length);
    for (const { scene, shot } of frames) {
      // Stopped: the frames written so far stay, in the export's own new folder.
      signal.throwIfAborted();
      const { canvas, pictureMissing } = await renderFrame(records, file, shot.record, size, watermark);
      const blob = await canvasBlob(canvas, 'image/png');
      if (!blob) throw new Error(`This computer couldn’t save frame ${shot.fields.number || String(done + 1)} as a PNG.`);
      // And once drawn: a frame being drawn when the person pressed Stop isn't written after it.
      signal.throwIfAborted();
      const name = unique(frameFileName(scene.fields.number, shot.fields.number || String(done + 1)));
      await target.write(name, new Uint8Array(await blob.arrayBuffer()));
      if (pictureMissing) missing.push(name.replace(/\.png$/, ''));
      done += 1;
      progress(done, frames.length);
    }
    const what = `${String(done)} ${done === 1 ? 'frame' : 'frames'}`;
    return missing.length === 0 ? { what } : { what, warning: missingWarning(missing) };
  },
};

/** How many frames went out with their picture missing, and which, by the names they were written under. */
export function missingWarning(names: readonly string[]): string {
  const shown = names.slice(0, MISSING_LISTED);
  const more = names.length - shown.length;
  const which = more > 0 ? `${shown.join(', ')} and ${String(more)} more` : shown.join(', ');
  return `${String(names.length)} ${names.length === 1 ? 'has' : 'have'} a missing picture: ${which}.`;
}

/** Enough names to find them in the folder, without a notice that fills the window. */
const MISSING_LISTED = 10;

import { aspectRatioValue, projectStoryboard } from '../../core/model/storyboard';
import { exportName, frameFileName } from './names';
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
  run: async ({ records, projectId, scope, file, target, progress }) => {
    const props = records[projectId]?.props;
    const size = pngSize(aspectRatioValue(projectStoryboard(props).aspectRatio));
    const watermark = watermarkFor(props, 'png');
    const frames = scenesIn(records, projectId, scope).flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
    let done = 0;
    for (const { scene, shot } of frames) {
      const canvas = await renderFrame(records, file, shot.record, size, watermark);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await target.write(frameFileName(scene.fields.number, shot.fields.number || String(done + 1)), new Uint8Array(await blob.arrayBuffer()));
      done += 1;
      progress(done, frames.length);
    }
    return `${String(done)} ${done === 1 ? 'frame' : 'frames'}`;
  },
};

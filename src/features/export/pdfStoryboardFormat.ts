import { aspectRatioValue, projectStoryboard } from '../../core/model/storyboard';
import { exportName } from './names';
import type { ExportFormat } from './registry';
import { renderFrame } from './renderFrame';
import { scenesIn } from './scope';
import { watermarkFor } from './watermark';

// The PDF storyboard in the registry (1.25). pdf-lib and the fonts load only when a PDF is exported; the layout is in
// pdfStoryboard.ts.

/** Frames go into the PDF at this width: sharp in print at the page's three-a-row size. */
const FRAME_WIDTH = 1200;

async function fontBytes(load: () => Promise<{ default: string }>): Promise<Uint8Array> {
  const { default: url } = await load();
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

export const pdfStoryboard: ExportFormat = {
  id: 'pdf-storyboard',
  label: 'Storyboard (PDF)',
  description: 'Three frames a row with their numbers, specs, action and dialogue, scene by scene, on US Letter.',
  output: 'file',
  watermark: 'pdf',
  name: (title, scene) => exportName(title, scene, 'storyboard', 'pdf'),
  run: async ({ records, projectId, scope, file, target, title, progress }) => {
    const [{ storyboardPdf }, sans, sansSemiBold, sansBold, mono, monoBold] = await Promise.all([
      import('./pdfStoryboard'),
      fontBytes(() => import('./fonts/InterTight-Regular.ttf?url')),
      fontBytes(() => import('./fonts/InterTight-SemiBold.ttf?url')),
      fontBytes(() => import('./fonts/InterTight-Bold.ttf?url')),
      fontBytes(() => import('./fonts/JetBrainsMono-Regular.ttf?url')),
      fontBytes(() => import('./fonts/JetBrainsMono-Bold.ttf?url')),
    ]);
    const props = records[projectId]?.props;
    const aspect = aspectRatioValue(projectStoryboard(props).aspectRatio);
    const scenes = scenesIn(records, projectId, scope);
    const total = scenes.reduce((n, s) => n + s.shots.length, 0);
    let done = 0;
    const bytes = await storyboardPdf({
      title,
      scenes,
      aspect,
      watermark: watermarkFor(props, 'pdf'),
      fonts: { sans, sansSemiBold, sansBold, mono, monoBold },
      frame: async (sceneIndex, shotIndex) => {
        const shot = scenes[sceneIndex]?.shots[shotIndex];
        if (!shot) return null;
        const canvas = await renderFrame(records, file, shot.record, { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH / aspect) }, null);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
        done += 1;
        progress(done, total);
        return new Uint8Array(await blob.arrayBuffer());
      },
    });
    const scene = scope.kind === 'scene' ? (scenes[0]?.fields.number ?? null) : null;
    await target.write(exportName(title, scene, 'storyboard', 'pdf'), bytes);
    return `${String(total)} ${total === 1 ? 'frame' : 'frames'}`;
  },
};

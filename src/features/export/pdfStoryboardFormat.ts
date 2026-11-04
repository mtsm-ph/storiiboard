import { canvasBlob } from '../../core/media/canvas';
import { aspectRatioValue, projectStoryboard } from '../../core/model/storyboard';
import { exportName } from './names';
import { missingWarning } from './pngFrames';
import type { ExportFormat } from './registry';
import { renderFrame } from './renderFrame';
import { scenesIn } from './scope';
import { watermarkFor } from './watermark';

// The PDF storyboard in the registry (1.25). pdf-lib and the fonts load only when a PDF is exported; the layout is in
// pdfStoryboard.ts.

/** Frames go into the PDF at this width: sharp in print at the page's three-a-row size. */
const FRAME_WIDTH = 1200;

/** Said when some text printed as ?, so a blank in the PDF isn't taken for a lost word. */
export const REPLACED_WARNING = 'Characters its fonts don’t have (emoji; Chinese, Japanese or Korean) print as ?.';

async function fontBytes(load: () => Promise<{ default: string }>): Promise<Uint8Array> {
  const { default: url } = await load();
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

export const pdfStoryboard: ExportFormat = {
  id: 'pdf-storyboard',
  label: 'Storyboard (PDF)',
  description: 'Three frames a row with their numbers, status, specs, action and dialogue, scene by scene, on US Letter. Board notes stay out.',
  output: 'file',
  watermark: 'pdf',
  name: (title, scene) => exportName(title, scene, 'storyboard', 'pdf'),
  run: async ({ records, projectId, scope, file, target, title, progress, signal }) => {
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
    progress(done, total);
    const pdf = await storyboardPdf({
      title,
      scenes,
      aspect,
      watermark: watermarkFor(props, 'pdf'),
      fonts: { sans, sansSemiBold, sansBold, mono, monoBold },
      signal,
      frame: async (sceneIndex, shotIndex) => {
        const shot = scenes[sceneIndex]?.shots[shotIndex];
        if (!shot) return null;
        try {
          const { canvas, pictureMissing } = await renderFrame(records, file, shot.record, { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH / aspect) }, null);
          const blob = await canvasBlob(canvas, 'image/jpeg', 0.88);
          return blob ? { jpeg: new Uint8Array(await blob.arrayBuffer()), pictureMissing } : null;
        } finally {
          done += 1;
          progress(done, total);
        }
      },
    });
    const scene = scope.kind === 'scene' ? (scenes[0]?.fields.number ?? null) : null;
    await target.write(exportName(title, scene, 'storyboard', 'pdf'), pdf.bytes);
    const warnings = [pdf.missing.length > 0 ? missingWarning(pdf.missing) : '', pdf.replaced ? REPLACED_WARNING : ''].filter((w) => w !== '');
    const what = `${String(total)} ${total === 1 ? 'frame' : 'frames'}`;
    return warnings.length === 0 ? { what } : { what, warning: warnings.join(' ') };
  },
};

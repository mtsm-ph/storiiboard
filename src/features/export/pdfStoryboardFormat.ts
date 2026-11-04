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

/**
 * Pixels per point a frame goes into the PDF at: three is 216 ppi, sharp in print at its size on the page. A fixed
 * 1200 px was 370 ppi and about 190 KB a frame, so a feature's 1500 frames made a PDF of over 200 MB, too big to send
 * crew and held several times over in the webview's memory while it was written.
 */
export const FRAME_PIXELS_PER_POINT = 3;

/** The status while the PDF is put together and written, after the last frame: seconds for a long board. */
export const WRITING_STATUS = 'Writing the PDF…';

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
    const [{ storyboardPdf, frameBox }, sans, sansSemiBold, sansBold, mono, monoBold] = await Promise.all([
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
    const box = frameBox(aspect);
    const size = { width: Math.round(box.width * FRAME_PIXELS_PER_POINT), height: Math.round(box.height * FRAME_PIXELS_PER_POINT) };
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
          const { canvas, pictureMissing } = await renderFrame(records, file, shot.record, size, null);
          const blob = await canvasBlob(canvas, 'image/jpeg', 0.88);
          return blob ? { jpeg: new Uint8Array(await blob.arrayBuffer()), pictureMissing } : null;
        } finally {
          done += 1;
          progress(done, total, done === total ? WRITING_STATUS : undefined);
        }
      },
    });
    const scene = scope.kind === 'scene' ? (scenes[0]?.fields.number ?? null) : null;
    // A Stop pressed while the PDF was saved: nothing goes to disk, so a file chosen to be replaced is left as it was.
    signal.throwIfAborted();
    await target.write(exportName(title, scene, 'storyboard', 'pdf'), pdf.bytes);
    const warnings = [pdf.missing.length > 0 ? missingWarning(pdf.missing) : '', pdf.replaced ? REPLACED_WARNING : ''].filter((w) => w !== '');
    const what = `${String(total)} ${total === 1 ? 'frame' : 'frames'}`;
    return warnings.length === 0 ? { what } : { what, warning: warnings.join(' ') };
  },
};

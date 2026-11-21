// An image's pixels, shrunk for reading its colours (1.14). Its own module, shared by the page and the worker, so the
// worker never imports the module that starts it (Vite refuses that circle in a build). Its canvas comes from the
// import-free makeCanvas.ts, never canvas.ts, whose translations would land in the worker's bundle.
import { makeCanvas } from '../../../core/media/makeCanvas';

/** The side the image is shrunk to before its colours are read: enough to find a logo's colours, quick to cluster. */
export const SAMPLE_SIZE = 96;

/**
 * The four calls that can fail, in order (6.27q): decoding the image, making the canvas and its 2d context, drawing,
 * reading the pixels back. A failure carries its stage as `stage` on the error, never in its words, so the launch check
 * can say where a webview failed while the message a person may read stays the engine's own.
 */
export const SAMPLE_STAGES = ['decode', 'canvas', 'draw', 'read'] as const;
export type SampleStage = (typeof SAMPLE_STAGES)[number];

/** The stage a failure carries, if it carries one of the four. */
export function stageOf(error: unknown): SampleStage | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const stage = (error as { stage?: unknown }).stage;
  return SAMPLE_STAGES.find((known) => known === stage);
}

/**
 * The same error with its stage beside it. Something thrown that isn't an object, or a frozen error, is passed on as
 * it is: losing the stage is better than changing what a caller gets.
 */
function staged(error: unknown, stage: SampleStage): unknown {
  if (typeof error === 'object' && error !== null && Object.isExtensible(error)) {
    (error as { stage?: SampleStage }).stage = stage;
  }
  return error;
}

/** `work`'s result, or its failure rethrown with `stage`. */
function at<T>(stage: SampleStage, work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw staged(error, stage);
  }
}

/** An image's pixels at about 96px, as RGBA. */
export async function samplePixels(image: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch (error) {
    throw staged(error, 'decode');
  }
  try {
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    // A <canvas> where there's no OffscreenCanvas (macOS 13.0 to 13.2); in a worker there with no document either,
    // makeCanvas throws here, the worker reports it, and the page does the work (extract.ts).
    const ctx = at('canvas', () => {
      const context = makeCanvas(width, height).ctx;
      if (!context) throw new Error('This computer can’t read the image’s colors.');
      return context;
    });
    // The best downscale the engine has, so WebKit and WebView2 read an image as nearly alike as they can.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    at('draw', () => {
      ctx.drawImage(bitmap, 0, 0, width, height);
    });
    return { data: at('read', () => ctx.getImageData(0, 0, width, height).data), width, height };
  } finally {
    bitmap.close();
  }
}

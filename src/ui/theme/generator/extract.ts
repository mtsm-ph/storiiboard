import { accentCandidates } from './generate';

// Reading an image's accents (1.14): decoded and shrunk to about 96px, then clustered (generate.ts). It runs in a Web
// Worker so a large key image never holds up the window; a webview without module workers does the same work here.

/** The side the image is shrunk to before its colours are read: enough to find a logo's colours, quick to cluster. */
export const SAMPLE_SIZE = 96;

/** An image's pixels at about 96px, as RGBA. */
export async function samplePixels(image: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This computer can’t read the image’s colours.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
}

/** The accents an image offers, most saturated first; empty for a grey one. */
export async function extractAccents(image: Blob): Promise<string[]> {
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ accents?: string[]; error?: string }>) => {
          worker.terminate();
          if (event.data.accents) resolve(event.data.accents);
          else reject(new Error(event.data.error ?? 'The image’s colours couldn’t be read.'));
        };
        worker.onerror = () => {
          worker.terminate();
          reject(new Error('worker failed'));
        };
        worker.postMessage(image);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'worker failed') throw error;
      // Fall through to the page.
    }
  }
  const { data, width, height } = await samplePixels(image);
  return accentCandidates(data, width, height);
}

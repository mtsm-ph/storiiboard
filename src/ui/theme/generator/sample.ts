// An image's pixels, shrunk for reading its colours (1.14). Its own module, shared by the page and the worker, so the
// worker never imports the module that starts it (Vite refuses that circle in a build).

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
    // The best downscale the engine has, so WebKit and WebView2 read an image as nearly alike as they can.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
}

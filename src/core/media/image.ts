import type { PreparedImage } from './store';

// Turning a picture into what the .sbd stores (Kevin's calls, Nov 2): at most 2560px on the long edge, its colour
// kept, its orientation applied, and a thumbnail for the board. Runs in the page: the webview's own decoders read
// every format the OS can (JPEG, PNG, WebP; HEIC on a Mac), and its colour management converts any embedded profile.
//
// Colour: everything is drawn into a Display P3 canvas and saved with the Display P3 profile. iPhone photos are
// Display P3 and keep their full colour; sRGB fits inside P3, so it loses nothing; other profiles (Adobe RGB) are
// converted by the decoder. A webview that can't keep P3 saves sRGB instead, and the stored colour space says which.

export const MAX_LONG_EDGE = 2560;
export const THUMBNAIL_LONG_EDGE = 640;
const ORIGINAL_QUALITY = 0.88;
const THUMBNAIL_QUALITY = 0.82;

/** A picture the webview can't read; the message says what to do. */
export class ImageError extends Error {
  override name = 'ImageError';
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function prepared<C extends OffscreenCanvas | HTMLCanvasElement>(canvas: C, ctx: Canvas2D | null) {
  if (!ctx) throw new ImageError('This computer can’t draw images for the board.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } {
  const settings: CanvasRenderingContext2DSettings = { colorSpace: 'display-p3', alpha: true };
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return prepared(canvas, canvas.getContext('2d', settings));
  }
  // A detached <canvas> on a webview without OffscreenCanvas (Safari before 16.4).
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return prepared(canvas, canvas.getContext('2d', settings));
}

async function encode(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new ImageError('The image couldn’t be saved.'));
            },
            type,
            quality,
          );
        });
  return new Uint8Array(await blob.arrayBuffer());
}

/** The size that fits within `longEdge` on its long side, never larger than the picture itself. */
export function fitWithin(width: number, height: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Draws a bitmap at a smaller size in halving steps, so a 12MP photo shrinks to 640px without the shimmer a single
 * big step leaves on fine detail (fabric, foliage, hair).
 */
function drawScaled(source: ImageBitmap, width: number, height: number) {
  let current: CanvasImageSource = source;
  let w = source.width;
  let h = source.height;
  while (w / 2 >= width && h / 2 >= height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = makeCanvas(w, h);
    step.ctx.drawImage(current, 0, 0, w, h);
    current = step.canvas;
  }
  const out = makeCanvas(width, height);
  out.ctx.drawImage(current, 0, 0, width, height);
  return out;
}

/** Whether any pixel is see-through: then the picture keeps PNG, so a logo's transparent ground survives. */
function hasTransparency(ctx: Canvas2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  return false;
}

// The profile's name as an ICC v2 description (plain ASCII) and as a v4 one (UTF-16, big-endian).
const P3_NAMES = ['Display P3', 'Display P3'.replace(/./g, '\u0000$&')];

/** Whether saved bytes carry the Display P3 profile: the webview kept the colour, or fell back to sRGB. */
export function isTaggedP3(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  return P3_NAMES.some((name) => head.includes(name));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function looksLikeHeic(file: Blob & { name?: string }): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '');
}

/** Decodes, caps, keeps the colour and makes the thumbnail. Throws ImageError with what to do for an unreadable file. */
export async function prepareImage(file: Blob & { name?: string }): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    // EXIF orientation applied, so a phone photo taken upright stays upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari on a Mac reads HEIC; Edge WebView2 on Windows doesn't (decided Nov 2: say so, decode in Rust later).
    throw new ImageError(
      looksLikeHeic(file)
        ? 'This is an HEIC photo, which Storiiboard can’t read on this computer yet. Convert it to JPEG first.'
        : 'This file isn’t an image Storiiboard can read. JPEG, PNG and WebP work.',
    );
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, MAX_LONG_EDGE);
    const original = drawScaled(bitmap, size.width, size.height);
    const thumbSize = fitWithin(bitmap.width, bitmap.height, THUMBNAIL_LONG_EDGE);
    const thumb = drawScaled(bitmap, thumbSize.width, thumbSize.height);
    // Checked on the thumbnail, a fraction of the pixels; a single see-through pixel the shrink averages away
    // doesn't need a PNG.
    const mime = hasTransparency(thumb.ctx, thumbSize.width, thumbSize.height) ? 'image/png' : 'image/jpeg';
    const [bytes, thumbBytes] = await Promise.all([
      encode(original.canvas, mime, ORIGINAL_QUALITY),
      encode(thumb.canvas, mime, THUMBNAIL_QUALITY),
    ]);
    return {
      original: {
        sha256: await sha256(bytes),
        bytes,
        mime,
        width: size.width,
        height: size.height,
        colorSpace: isTaggedP3(bytes) ? 'display-p3' : 'srgb',
      },
      thumbnail: { bytes: thumbBytes, mime, width: thumbSize.width, height: thumbSize.height, longEdge: THUMBNAIL_LONG_EDGE },
    };
  } finally {
    bitmap.close();
  }
}

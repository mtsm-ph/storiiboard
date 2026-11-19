import { t } from '../i18n';
import { cleanPictureOrWhy, type CleanRefusal } from './cleanPicture';

// A canvas to draw on away from the page, for the picture pipeline (image.ts) and exports (src/features/export).
// OffscreenCanvas where the webview has it; a detached <canvas> where it doesn't: WKWebView before Safari 16.4, which
// is macOS 13.0 to 13.2, a system the app still supports (tauri.conf.json, minimumSystemVersion).

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A canvas `width` by `height` and its 2D context, or a null context when the webview can't give one. */
export function makeCanvas(
  width: number,
  height: number,
  settings?: CanvasRenderingContext2DSettings,
): { canvas: AnyCanvas; ctx: Canvas2D | null } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d', settings) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', settings) };
}

/**
 * The clean refused what the webview's encoder wrote (cleanPicture.ts): nothing is stored or exported, and the person
 * is told the picture couldn't be saved, and why: it couldn't be read as a picture (`error.pictureUnreadable`), or it
 * holds more than a picture and its colour profile (`error.pictureNotSaved`, the words sbd.rs refuses with too).
 */
export class PictureNotSavedError extends Error {
  override name = 'PictureNotSavedError';
  readonly why: CleanRefusal;
  constructor(why: CleanRefusal) {
    super(t(why === 'unreadable' ? 'error.pictureUnreadable' : 'error.pictureNotSaved'));
    this.why = why;
  }
}

/**
 * The canvas encoded as `type`, cleaned: only the picture's own data and its colour profile (cleanPicture.ts), so every
 * picture the page stores or exports carries nothing else, whatever the webview's encoder writes. Every encode in the
 * app comes through here. Null when the webview couldn't encode it; PictureNotSavedError when what it encoded can't be
 * cleaned.
 */
export async function canvasBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  const encoded = await encodeCanvas(canvas, type, quality);
  if (!encoded) return null;
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let clean: Uint8Array | CleanRefusal;
  try {
    clean = cleanPictureOrWhy(bytes);
  } catch {
    // The clean is written never to throw; should it, the picture is refused all the same, never let through.
    clean = 'unreadable';
  }
  if (typeof clean === 'string') throw new PictureNotSavedError(clean);
  return new Blob([clean as Uint8Array<ArrayBuffer>], { type: encoded.type || type });
}

function encodeCanvas(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/** A cleaned blob as a data URL, for what keeps a picture as text (a company profile's logo). */
export async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  // In slices, so a large picture never makes one huge argument list.
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(text)}`;
}

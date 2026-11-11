import { invoke } from '@tauri-apps/api/core';
import { canvasBlob, makeCanvas, type AnyCanvas, type Canvas2D } from '../../core/media/canvas';
import { fitWithin } from '../../core/media/image';
import { readOriginal, readThumbnail } from '../../core/media/store';
import type { ProjectFile } from '../../core/storage/driver';
import type { PictureLoader } from './deckPdfWriter';

// The pictures a deck's PDF prints (5.6a, decision 4): the picture's original file where the project points at one the app can
// still read (a new read-only Rust command, src-tauri/src/originals.rs, which takes the open project and the picture's SHA-256,
// never a path from the page), else the copy the project keeps (at most 2560 px). Either is decoded in the webview and redrawn
// on an sRGB canvas, as the call sheet's logo is: a Display P3 photo would otherwise print in the wrong colours. At most 6000 px
// on the long edge and never more than the printed size needs at 300 dpi, then JPEG at 0.92, or PNG when it has transparency.

/**
 * A picture with room for transparency is redrawn and scanned on the main thread, and a PNG of it is encoded there: kept to this
 * many pixels on the long edge so the window stays responsive. A logo or a cut-out needs no more.
 */
export const TRANSPARENT_LONG_EDGE = 3000;

/** How far the original's shape may differ from the stored copy's (a half of one percent: rounding of the stored size). */
export const ASPECT_TOLERANCE = 0.005;
/** The size, on the long edge, both pictures are drawn at to be compared. */
export const COMPARE_EDGE = 48;
/**
 * The most the original and the project's thumbnail may differ, as the mean absolute difference of their red, green and blue (0 to
 * 255), once both are drawn at COMPARE_EDGE. Calibrated on the five fixture pictures in e2e/fixtures/images (sRGB, Adobe RGB, Display
 * P3, EXIF-rotated, transparent): each against its own stored copy measured 0 to 1.4; each against every other fixture resampled to
 * its shape, 59 to 149. Two real photographs of one shape (e2e/fixtures/images/photo-a.jpg and photo-b.jpg, e2e/deckExport.spec.ts) are held to under half
 * the threshold against their own copy and over it against each other. 12 sits well between, with room for a photograph's finer detail (resampling and the P3 to sRGB step).
 */
export const MATCH_THRESHOLD = 12;

/** Whether two shapes (width over height) agree to within ASPECT_TOLERANCE. */
export const aspectMatches = (aw: number, ah: number, bw: number, bh: number): boolean =>
  aw > 0 && ah > 0 && bw > 0 && bh > 0 && Math.abs(aw / ah / (bw / bh) - 1) <= ASPECT_TOLERANCE;

/** The mean absolute difference of two pictures' red, green and blue bytes (alpha left out); Infinity when they aren't the same size. */
export function meanAbsDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c += 1) sum += Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
    count += 3;
  }
  return sum / count;
}

/** JPEG quality for a printed picture. */
export const PRINT_JPEG_QUALITY = 0.92;

/** The size a picture is redrawn at: its own size, or smaller to fit `longEdge`; never larger. */
export const printSize = (width: number, height: number, longEdge: number): { width: number; height: number } => fitWithin(width, height, longEdge);

/** Whether a file's first bytes say its type can hold transparency (PNG, WebP, GIF, AVIF, HEIC, TIFF); a JPEG or a BMP can't. */
export function mayHaveTransparency(bytes: Uint8Array): boolean {
  const head = (n: number) => String.fromCharCode(...bytes.subarray(0, n));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return false;
  if (head(2) === 'BM') return false;
  return true;
}

/** Whether any pixel is see-through, looked at a band of rows at a time so a large picture isn't held as pixels twice over. */
function hasTransparency(ctx: Canvas2D, width: number, height: number): boolean {
  const band = Math.max(1, Math.floor(4_000_000 / Math.max(1, width)));
  for (let y = 0; y < height; y += band) {
    const { data } = ctx.getImageData(0, y, width, Math.min(band, height - y));
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  }
  return false;
}

/**
 * Draws a bitmap on an sRGB canvas `width` by `height`, in halving steps for a big reduction (a single big step shimmers on fine
 * detail). Every step is sRGB, asked for outright: a Mac's webview would otherwise draw in P3, the very thing being undone.
 */
function redrawn(bitmap: ImageBitmap, width: number, height: number): { canvas: AnyCanvas; ctx: Canvas2D } | null {
  let source: CanvasImageSource = bitmap;
  let w = bitmap.width;
  let h = bitmap.height;
  while (w / 2 >= width && h / 2 >= height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = makeCanvas(w, h, { colorSpace: 'srgb' });
    if (!step.ctx) return null;
    step.ctx.imageSmoothingQuality = 'high';
    step.ctx.drawImage(source, 0, 0, w, h);
    source = step.canvas;
  }
  const out = makeCanvas(width, height, { colorSpace: 'srgb' });
  if (!out.ctx) return null;
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.drawImage(source, 0, 0, width, height);
  return { canvas: out.canvas, ctx: out.ctx };
}

/** A decoded picture as the page prints it, or null when the webview can't decode or redraw it. */
export async function printablePicture(
  bytes: Uint8Array,
  mime: string | null,
  longEdge: number,
  verify?: (bitmap: ImageBitmap) => Promise<boolean>,
): Promise<{ bytes: Uint8Array; kind: 'jpeg' | 'png' } | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], mime ? { type: mime } : {}), { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    if (verify && !(await verify(bitmap))) return null;
    const size = printSize(bitmap.width, bitmap.height, mayHaveTransparency(bytes) ? Math.min(longEdge, TRANSPARENT_LONG_EDGE) : longEdge);
    const drawn = redrawn(bitmap, size.width, size.height);
    if (!drawn) return null;
    const transparent = mayHaveTransparency(bytes) && hasTransparency(drawn.ctx, size.width, size.height);
    const blob = await canvasBlob(drawn.canvas, transparent ? 'image/png' : 'image/jpeg', transparent ? undefined : PRINT_JPEG_QUALITY);
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), kind: transparent ? 'png' : 'jpeg' } : null;
  } finally {
    bitmap.close();
  }
}

/** The original file's bytes through Rust, or null when there is none to read (or it was refused, or this isn't the desktop app). */
async function originalBytes(file: ProjectFile, sha256: string): Promise<Uint8Array | null> {
  if (file.nativeHandle === undefined) return null;
  try {
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('picture_original', { handle: file.nativeHandle, sha256 }));
    return bytes.length === 0 ? null : bytes;
  } catch {
    return null;
  }
}

/**
 * The loader a deck's PDF takes its pictures from. The original first; where it is missing, refused, can't be decoded, or there
 * is none (a pasted picture), the copy the project keeps, which the writer counts and the export's notice says.
 */
export function pictureLoader(file: ProjectFile): PictureLoader {
  return async (sha256, longEdge, signal) => {
    signal?.throwIfAborted();
    const original = await originalBytes(file, sha256);
    signal?.throwIfAborted();
    if (original) {
      // Only the picture the deck shows: a path that now leads to another picture is not printed.
      const printed = await printablePicture(original, null, longEdge, (bitmap) => isTheStoredPicture(file, sha256, bitmap));
      if (printed) return { ...printed, original: true };
    }
    signal?.throwIfAborted();
    const stored = await readOriginal(file, sha256).catch(() => null);
    if (!stored) return null;
    const printed = await printablePicture(stored.bytes, stored.mime, longEdge);
    return printed ? { ...printed, original: false } : null;
  };
}

/**
 * A bitmap as pixels `width` by `height` on an sRGB canvas, reduced through `redrawn`'s halving steps: one drawImage from a
 * 6000 px original to 48 px would shimmer on fine detail, and the original and its (smaller) copy would then shimmer differently.
 */
function pixelsOf(source: ImageBitmap, width: number, height: number): Uint8ClampedArray | null {
  const small = redrawn(source, width, height);
  return small ? small.ctx.getImageData(0, 0, width, height).data : null;
}

/**
 * How far an original, decoded, is from the picture the project stored under this hash: Infinity when its shape isn't the stored
 * copy's (media_files' width and height, to within ASPECT_TOLERANCE) or nothing is stored to compare with, else the mean absolute
 * difference from the stored thumbnail, both drawn small.
 */
export async function storedDifference(file: ProjectFile, sha256: string, bitmap: ImageBitmap): Promise<number> {
  try {
    const [row] = await file.query('SELECT width, height FROM media_files WHERE sha256 = ?', [sha256]);
    if (!row || !aspectMatches(bitmap.width, bitmap.height, Number(row.width), Number(row.height))) return Infinity;
    const thumbnail = await readThumbnail(file, sha256);
    if (!thumbnail) return Infinity;
    const small = await createImageBitmap(new Blob([thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: thumbnail.mime }));
    try {
      const size = fitWithin(bitmap.width, bitmap.height, COMPARE_EDGE);
      const a = pixelsOf(bitmap, size.width, size.height);
      const b = pixelsOf(small, size.width, size.height);
      return a !== null && b !== null ? meanAbsDifference(a, b) : Infinity;
    } finally {
      small.close();
    }
  } catch {
    return Infinity;
  }
}

/** Whether an original is the picture the project stored under this hash (storedDifference within MATCH_THRESHOLD). */
export async function isTheStoredPicture(file: ProjectFile, sha256: string, bitmap: ImageBitmap): Promise<boolean> {
  return (await storedDifference(file, sha256, bitmap)) <= MATCH_THRESHOLD;
}

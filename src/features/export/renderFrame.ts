import { makeCanvas, type AnyCanvas, type Canvas2D } from '../../core/media/canvas';
import { cropBox, type Crop } from '../../core/media/crop';
import { readOriginal } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import { shotFields } from '../../core/model/storyboard';
import type { ProjectFile } from '../../core/storage/driver';
import { pictureView } from '../storyboard/framePictures';
import { arrowHead, pressureOutline, strokesOf, type Stroke } from '../storyboard/sketch/strokes';
import type { Watermark } from './watermark';

// A frame drawn as the board shows it (1.24), for PNG and PDF exports: its picture framed as the person framed it,
// its sketch over it, and the watermark when the export carries one. Drawn at the size asked for, from the full-size
// stored picture, never the board's thumbnail, on src/core/media/canvas.ts's canvas, so a Mac whose webview has no
// OffscreenCanvas still exports.

type Records = Readonly<Record<string, SbdRecord>>;

/** Paper and ink for an export: white and the kit's ink, so frames print as they read. */
const PAPER = '#FFFFFF';
const INK = '#16150F';

function strokePath(ctx: Canvas2D, points: readonly number[]) {
  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x = 0, y = 0] = [points[i], points[i + 1]];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawStroke(ctx: Canvas2D, stroke: Stroke, width: number, height: number) {
  // At least a pixel and a half, so a fine pencil line survives on a small export, as on the cards.
  const base = Math.max(stroke.width, 1.5 / height);
  const line = base * height;
  const p = stroke.points.map((n, i) => (i % 2 === 0 ? n * width : n * height));
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'box') {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    return;
  }
  if (stroke.tool === 'arrow') {
    strokePath(ctx, p.slice(0, 4));
    ctx.stroke();
    strokePath(ctx, arrowHead(stroke.points, width, height, base));
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (stroke.pressures) {
    strokePath(ctx, pressureOutline(stroke.points, stroke.pressures, width, height, base, 1.5));
    ctx.closePath();
    ctx.fill();
    return;
  }
  strokePath(ctx, p);
  ctx.stroke();
}

const WATERMARK_FONT = (size: number) => `600 ${String(size)}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;

/**
 * The watermark's type size: 4.5% of the frame's short edge, so a tall frame gets the size a wide one does, then
 * smaller still until the text fits between the margins. Without the second step a long line, or any line on a 9:16
 * frame, ran off the picture and the watermark lost its point.
 */
export function watermarkSize(measure: (font: string) => number, width: number, height: number): number {
  const margin = Math.round(Math.min(width, height) * 0.03);
  const room = width - 2 * margin;
  let size = Math.max(10, Math.round(Math.min(width, height) * 0.045));
  const measured = measure(WATERMARK_FONT(size));
  if (measured > room) size = Math.max(1, Math.floor((size * room) / measured));
  // Text width isn't quite proportional to size (hinting, rounding): step down until it truly fits.
  while (size > 1 && measure(WATERMARK_FONT(size)) > room) size -= 1;
  return size;
}

/** Where the watermark goes, inside a margin of 3% of the frame's short edge. */
function drawWatermark(ctx: Canvas2D, watermark: Watermark, width: number, height: number) {
  const margin = Math.round(Math.min(width, height) * 0.03);
  const size = watermarkSize(
    (font) => {
      ctx.font = font;
      return ctx.measureText(watermark.text).width;
    },
    width,
    height,
  );
  ctx.save();
  ctx.globalAlpha = watermark.opacity;
  ctx.font = WATERMARK_FONT(size);
  ctx.textBaseline = watermark.position === 'center' ? 'middle' : watermark.position.startsWith('top') ? 'top' : 'bottom';
  const x = watermark.position === 'center' ? width / 2 : watermark.position.endsWith('left') ? margin : width - margin;
  const y = watermark.position === 'center' ? height / 2 : watermark.position.startsWith('top') ? margin : height - margin;
  ctx.textAlign = watermark.position === 'center' ? 'center' : watermark.position.endsWith('left') ? 'left' : 'right';
  // Ink with a paper outline, so it reads over a night exterior as well as on white: ink alone over a dark picture
  // all but vanished, and the frame went out unmarked. maxWidth too, as a last guard: the canvas squeezes the line
  // rather than cut it.
  ctx.lineJoin = 'round';
  ctx.lineWidth = watermarkOutline(size);
  ctx.strokeStyle = PAPER;
  ctx.strokeText(watermark.text, x, y, width - 2 * margin);
  ctx.fillStyle = INK;
  ctx.fillText(watermark.text, x, y, width - 2 * margin);
  ctx.restore();
}

/** The paper outline round the watermark's letters: a sixth of the type size, never under a pixel and a half. */
export function watermarkOutline(size: number): number {
  return Math.max(1.5, size / 6);
}

/**
 * Said on a frame whose picture the file no longer holds, or holds too damaged to decode, as the board says it, so a
 * blank frame isn't mistaken for one.
 */
function drawPictureMissing(ctx: Canvas2D, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `600 ${String(Math.max(10, Math.round(Math.min(width, height) * 0.04)))}px "JetBrains Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PICTURE MISSING', width / 2, height / 2, width * 0.9);
  ctx.restore();
}

/**
 * What a frame's export draws, as the board shows it: its live strokes, and its live picture's full-size bytes with
 * the crop; 'missing' when the frame has a picture the file no longer holds (an old or damaged file), null for a
 * frame with none. Trashed strokes and pictures never go out.
 */
export interface FrameContent {
  strokes: Stroke[];
  picture: { bytes: Uint8Array; mime: string; crop: Crop } | 'missing' | null;
}

export async function frameContent(records: Records, file: ProjectFile, shot: SbdRecord): Promise<FrameContent> {
  const strokes = strokesOf(records, shot.id);
  const view = pictureView(records, shotFields(shot.props));
  if (!view) return { strokes, picture: null };
  const original = await readOriginal(file, view.sha256);
  return { strokes, picture: original ? { ...original, crop: view.crop } : 'missing' };
}

/** A drawn frame, and whether its picture was missing, so the export can name those frames when it's done. */
export interface RenderedFrame {
  canvas: AnyCanvas;
  pictureMissing: boolean;
}

/** One frame as an image `width` by `height`, ready to encode. */
export async function renderFrame(
  records: Records,
  file: ProjectFile,
  shot: SbdRecord,
  size: { width: number; height: number },
  watermark: Watermark | null,
): Promise<RenderedFrame> {
  const { width, height } = size;
  const { canvas, ctx } = makeCanvas(width, height);
  if (!ctx) throw new Error('This computer can’t draw the frames for export.');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const { strokes, picture } = await frameContent(records, file, shot);
  const pictureMissing = picture === 'missing' || (picture !== null && !(await drawPicture(ctx, picture, width, height)));
  if (pictureMissing) drawPictureMissing(ctx, width, height);

  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const stroke of strokes) drawStroke(ctx, stroke, width, height);
  if (watermark) drawWatermark(ctx, watermark, width, height);
  return { canvas, pictureMissing };
}

/**
 * Draws the picture with the person's crop; false when its stored bytes won't decode (a truncated or damaged blob in
 * an old or damaged file). That frame then goes out marked like a lost picture, and the export goes on: thrown, one
 * bad picture ended the whole export there, with no word of which frame it was.
 */
async function drawPicture(
  ctx: Canvas2D,
  picture: { bytes: Uint8Array; mime: string; crop: Crop },
  width: number,
  height: number,
): Promise<boolean> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([picture.bytes as Uint8Array<ArrayBuffer>], { type: picture.mime }));
  } catch {
    return false;
  }
  try {
    const box = cropBox(picture.crop, bitmap.width / bitmap.height, width / height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, (box.left / 100) * width, (box.top / 100) * height, (box.width / 100) * width, (box.height / 100) * height);
    return true;
  } finally {
    bitmap.close();
  }
}

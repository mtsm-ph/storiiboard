import { cropBox, readCrop } from '../../core/media/crop';
import { mediaFields, readOriginal } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import type { ProjectFile } from '../../core/storage/driver';
import { arrowHead, pressureOutline, strokesOf, type Stroke } from '../storyboard/sketch/strokes';
import type { Watermark } from './watermark';

// A frame drawn as the board shows it (1.24), for PNG and PDF exports: its picture framed as the person framed it,
// its sketch over it, and the watermark when the export carries one. Drawn on an OffscreenCanvas at the size asked
// for, from the full-size stored picture, never the board's thumbnail.

type Records = Readonly<Record<string, SbdRecord>>;

/** Paper and ink for an export: white and the kit's ink, so frames print as they read. */
const PAPER = '#FFFFFF';
const INK = '#16150F';

function strokePath(ctx: OffscreenCanvasRenderingContext2D, points: readonly number[]) {
  ctx.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x = 0, y = 0] = [points[i], points[i + 1]];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawStroke(ctx: OffscreenCanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
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

/** Where the watermark goes, its size from the frame's height, inside a margin of 3% of the frame. */
function drawWatermark(ctx: OffscreenCanvasRenderingContext2D, watermark: Watermark, width: number, height: number) {
  const size = Math.max(10, Math.round(height * 0.045));
  const margin = Math.round(Math.min(width, height) * 0.03);
  ctx.save();
  ctx.globalAlpha = watermark.opacity;
  ctx.fillStyle = INK;
  ctx.font = `600 ${String(size)}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = watermark.position === 'center' ? 'middle' : watermark.position.startsWith('top') ? 'top' : 'bottom';
  const x = watermark.position === 'center' ? width / 2 : watermark.position.endsWith('left') ? margin : width - margin;
  const y = watermark.position === 'center' ? height / 2 : watermark.position.startsWith('top') ? margin : height - margin;
  ctx.textAlign = watermark.position === 'center' ? 'center' : watermark.position.endsWith('left') ? 'left' : 'right';
  ctx.fillText(watermark.text, x, y);
  ctx.restore();
}

/** One frame as an image `width` by `height`, ready to encode. */
export async function renderFrame(
  records: Records,
  file: ProjectFile,
  shot: SbdRecord,
  size: { width: number; height: number },
  watermark: Watermark | null,
): Promise<OffscreenCanvas> {
  const { width, height } = size;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This computer can’t draw the frames for export.');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const mediaId = typeof shot.props.media_id === 'string' ? shot.props.media_id : null;
  const media = mediaId ? records[mediaId] : undefined;
  const fields = media && media.trashedAt === null ? mediaFields(media.props) : null;
  const original = fields ? await readOriginal(file, fields.sha256) : null;
  if (fields && original) {
    const bitmap = await createImageBitmap(new Blob([original.bytes as Uint8Array<ArrayBuffer>], { type: original.mime }));
    try {
      const box = cropBox(readCrop(shot.props), bitmap.width / bitmap.height, width / height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, (box.left / 100) * width, (box.top / 100) * height, (box.width / 100) * width, (box.height / 100) * height);
    } finally {
      bitmap.close();
    }
  }

  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const stroke of strokesOf(records, shot.id)) drawStroke(ctx, stroke, width, height);
  if (watermark) drawWatermark(ctx, watermark, width, height);
  return canvas;
}

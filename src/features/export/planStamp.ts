import type { Rect, Size } from '../../ui/canvas/types';
import type { WatermarkPosition } from './watermark';

// The watermark on a plan's page (Kevin, Nov 15): its corner, or the centre, taken inside the plan box, inset from the
// box's frame line, so the stamp never covers the legend, the header or the title. One function gives the stamp's box,
// in the page's points; the PDF writer (deckPdfWriter.ts) and the PNG painter (planExport.ts) both draw it there.

/** Where a plan page's stamp may go, page points: the plan box, and the foot band's rule it stays above. */
export interface WatermarkRoom {
  box: Rect;
  /** The foot band's rule (its top): the scale, its words and the page's notes are under it, never under the stamp. */
  footTop: number;
}

/** The stamp, page points with y down: its box (outline included), its type size, and where its text starts. */
export interface StampBox {
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
  /** The text's start and baseline. */
  textX: number;
  baseline: number;
}

/** Inter Tight's hhea ascent and descent, fractions of the size (1984 and 494 of 2048 units an em: pdfStoryboard.ts). */
const ASCENT = 1984 / 2048;
const DESCENT = 494 / 2048;
const MM = 72 / 25.4;

/** The paper outline round the letters (renderFrame.ts watermarkOutline): half of it shows outside them. */
const outlineOf = (size: number): number => Math.max(1.5, size / 6);

/**
 * The inset from the frame line: the storyboard's rule from a page's edge (3% of the page's short edge, as the PNG frames
 * and the deck's PDF take it), never under 4 mm of paper.
 */
export const stampInset = (page: Size): number => Math.max(4 * MM, Math.min(page.width, page.height) * 0.03);

/**
 * The stamp's box on a plan page: the size the storyboard's rule gives (4.5% of the page's short edge, at least 8 pt),
 * in its corner or the centre of the plan box less the inset, above the foot band's rule (so a bottom-left stamp sits
 * above the scale bar, never on it). A stamp wider or taller than that room is set smaller until it fits whole: it is
 * never cut. `widthAt` is the text's advance at a size, points.
 */
export function planStampBox(room: WatermarkRoom, page: Size, position: WatermarkPosition, widthAt: (size: number) => number): StampBox {
  const inset = stampInset(page);
  const left = room.box.x + inset;
  const right = room.box.x + room.box.width - inset;
  const top = room.box.y + inset;
  const bottom = Math.min(room.box.y + room.box.height, room.footTop) - inset;
  const roomW = Math.max(0, right - left);
  const roomH = Math.max(0, bottom - top);
  const most = Math.max(8, Math.min(page.width, page.height) * 0.045);
  const outer = (size: number) => ({ width: widthAt(size) + outlineOf(size), height: size * (ASCENT + DESCENT) + outlineOf(size) });
  const fits = (size: number) => {
    const o = outer(size);
    return o.width <= roomW + 1e-9 && o.height <= roomH + 1e-9;
  };
  // Too big for the room: the largest size that fits, found by halving (the outline's floor of 1.5 pt keeps the stamp's
  // box from growing quite in proportion to its size, so a single ratio would leave it short or over).
  let size = most;
  if (!fits(size)) {
    let low = 0;
    let high = most;
    for (let step = 0; step < 50; step += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    size = Math.max(low, 0.01);
  }
  const { width, height } = outer(size);
  const x = position === 'center' ? left + (roomW - width) / 2 : position.endsWith('left') ? left : right - width;
  const y = position === 'center' ? top + (roomH - height) / 2 : position.startsWith('top') ? top : bottom - height;
  const pad = outlineOf(size) / 2;
  return { x, y, width, height, size, textX: x + pad, baseline: y + pad + size * ASCENT };
}

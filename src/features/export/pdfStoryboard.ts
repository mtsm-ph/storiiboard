import fontkit from '@pdf-lib/fontkit';
import {
  degrees,
  LineJoinStyle,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setGraphicsState,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { watermarkOutline } from './renderFrame';
import { pageLabel, sceneLabel, specLine } from '../../core/model/storyboard';
import { SHOT_STATUS_LABELS, type ShotStatus } from '../../core/model/shotStatus';
import type { BoardScene } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import type { Watermark } from './watermark';
import { t } from '../../core/i18n';

// The PDF storyboard (1.25): US Letter, landscape, three frames a row with their number, specs, action and dialogue,
// each scene starting on a fresh row under its heading. pdf-lib draws real text and lines and embeds each frame as a
// JPEG, so the file stays small and searchable (an editor can find "4B"). Free of the page: the frames come in as
// JPEG bytes and the fonts as bytes, so it builds the same in the app and in the tests.

export interface PdfFonts {
  sans: Uint8Array;
  sansSemiBold: Uint8Array;
  sansBold: Uint8Array;
  mono: Uint8Array;
  monoBold: Uint8Array;
}

/** A frame drawn as a JPEG; `pictureMissing` when the drawing already says PICTURE MISSING (renderFrame.ts). */
export interface FrameImage {
  jpeg: Uint8Array;
  pictureMissing?: boolean;
}

export interface StoryboardInput {
  title: string;
  scenes: readonly BoardScene[];
  /** The project's frame shape, width over height. */
  aspect: number;
  watermark: Watermark | null;
  fonts: PdfFonts;
  /** A frame drawn as a JPEG. Null, or a throw, prints the frame's box as PICTURE MISSING. */
  frame: (sceneIndex: number, shotIndex: number) => Promise<FrameImage | null>;
  now?: Date;
  /** Checked before each frame: a stopped export ends there and writes nothing. */
  signal?: AbortSignal;
  /** Each scene's palette colours as hex, by scene index, to print in its heading (polish PP); none when left out. */
  palettes?: readonly (readonly string[])[];
}

export interface StoryboardPdf {
  bytes: Uint8Array;
  /** Frames that went out without their picture, by shot number, in board order. */
  missing: string[];
  /** Whether some text had characters the fonts don't have, printed as ?. */
  replaced: boolean;
}

/** Points: US Letter landscape, a half-inch margin. */
export const PAGE = { width: 792, height: 612 };
export const MARGIN = 36;
const GAP = 12;
const COLUMNS = 3;
export const INK = rgb(0x16 / 255, 0x15 / 255, 0x0f / 255);
export const MUTED = rgb(0x5e / 255, 0x5a / 255, 0x52 / 255);
/** The kit's 1.5px rules. */
const RULE = 1.5;
/** Where the header's rule sits: everything on the page is drawn under it, but a top-corner watermark. */
const HEADER_RULE = PAGE.height - MARGIN - 20;
/** The kit's mono labels are tracked 0.08em (design/DESIGN.md). */
const LABEL_TRACKING = 0.08;

interface Fonts {
  sans: PDFFont;
  semi: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

/**
 * Words to lines no wider than `width`, at most `max` of them; the last ends in … when it runs on. A word wider than
 * the line (a URL, a location's long name) is cut where it reaches the edge: left whole, it ran over the next frame
 * and off the page.
 */
export function wrap(text: string, font: PDFFont, size: number, width: number, max: number): string[] {
  if (max <= 0) return [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  let cut = false;
  words: for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line !== '') {
      if (lines.length === max) {
        cut = true;
        break;
      }
      lines.push(line);
      line = '';
    }
    let rest = word;
    while (!fits(rest)) {
      if (lines.length === max) {
        cut = true;
        break words;
      }
      // By code point, so an accented letter or a surrogate pair is never split; at least one, so it always ends.
      const chars = Array.from(rest);
      let n = 1;
      while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n += 1;
      lines.push(chars.slice(0, n).join(''));
      rest = chars.slice(n).join('');
    }
    line = rest;
  }
  if (line !== '') {
    if (lines.length < max) lines.push(line);
    else cut = true;
  }
  if (cut) {
    let last = lines[max - 1] ?? '';
    while (last !== '' && !fits(`${last}…`)) last = Array.from(last).slice(0, -1).join('').trimEnd();
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

/** How tall a frame's caption is: number and spec, then up to three lines of action and two of dialogue. */
const CAPTION = { number: 10, spec: 7.5, text: 8, leading: 10 };
const ACTION_LINES = 3;
const DIALOGUE_LINES = 2;
const CAPTION_HEIGHT = CAPTION.leading * (2 + ACTION_LINES + DIALOGUE_LINES) + 4;
/** A scene heading's line. */
const HEADING = 22;
/** A palette swatch in a scene heading, and the gap after it. */
const SWATCH = 9;
const SWATCH_GAP = 1.5;

/** A palette colour for pdf-lib. */
function pdfColour(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}
/** The frames' band: under the header, over the footer. */
const TOP = PAGE.height - MARGIN - 28;
const BOTTOM = MARGIN + 18;
const CELL_WIDTH = (PAGE.width - 2 * MARGIN - (COLUMNS - 1) * GAP) / COLUMNS;

/**
 * A frame's size in its cell: the cell's width, unless that makes a row too tall for two rows to fit on a page under
 * a heading. A 9:16 frame a cell wide is 412pt tall and its row ran off the foot; a 4:3 one fits but makes a row of
 * 260pt, so a 4:3, 1:1 or 4:5 board went out a row a page, twice the pages of a 16:9 one. Capped at 150pt, a taller
 * frame is narrower instead, and every aspect prints six frames a page.
 */
export function frameBox(aspect: number): { width: number; height: number } {
  const most = (TOP - BOTTOM - HEADING) / 2 - CAPTION_HEIGHT - GAP;
  const height = Math.min(CELL_WIDTH / aspect, most);
  return { width: height * aspect, height };
}

/** The shapes the kit gives shot status, in JetBrains Mono, which has all three; the word beside it. */
const STATUS_SHAPE: Readonly<Record<ShotStatus, string>> = { have: '■', need: '□', source: '◩' };

/** YYYY-MM-DD on this computer's calendar: from toISOString, an evening export in the US was dated tomorrow. */
export function localDate(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * Text the font can print: a run of characters it has no glyph for (emoji; Chinese, Japanese or Korean, which Inter
 * Tight and JetBrains Mono don't cover) becomes one ?. Left as they were, they printed as blank boxes and came out
 * of the text layer as \0. `replaced` says whether any did, so the export can say so.
 */
export function printer() {
  const sets = new Map<PDFFont, Set<number>>();
  const state = { replaced: false };
  const printable = (font: PDFFont, text: string): string => {
    let set = sets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      sets.set(font, set);
    }
    let out = '';
    let lacking = false;
    // Line breaks and tabs, as typed into Action and Dialogue, are spaces on one line: the fonts have no glyph for
    // them, so they came out as ? and the export warned of emoji that weren't there.
    for (const char of text.replace(/\s+/g, ' ')) {
      if (set.has(char.codePointAt(0) ?? 0)) {
        out += char;
        lacking = false;
      } else {
        if (!lacking) out += '?';
        lacking = true;
        state.replaced = true;
      }
    }
    return out;
  };
  return { printable, state };
}

export async function storyboardPdf(input: StoryboardInput): Promise<StoryboardPdf> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const now = input.now ?? new Date();
  pdf.setTitle(t('export.pdf.docTitle', { title: input.title }));
  pdf.setCreator('Storiiboard');
  pdf.setProducer('Storiiboard');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const fonts: Fonts = {
    sans: await pdf.embedFont(input.fonts.sans, { subset: true }),
    semi: await pdf.embedFont(input.fonts.sansSemiBold, { subset: true }),
    bold: await pdf.embedFont(input.fonts.sansBold, { subset: true }),
    mono: await pdf.embedFont(input.fonts.mono, { subset: true }),
    monoBold: await pdf.embedFont(input.fonts.monoBold, { subset: true }),
  };
  const { printable, state } = printer();
  const missing: string[] = [];

  const frame = frameBox(input.aspect);
  const rowHeight = frame.height + CAPTION_HEIGHT + GAP;

  let y = TOP;
  const pages: PDFPage[] = [];
  const newPage = (): PDFPage => {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    // The header: the project's title, and what this is, as the kit's tracked mono label.
    const label = printable(fonts.mono, t('export.pdf.header'));
    const tracking = LABEL_TRACKING * 8;
    const labelWidth = fonts.mono.widthOfTextAtSize(label, 8) + tracking * (label.length - 1);
    const [title = ''] = wrap(printable(fonts.bold, input.title), fonts.bold, 14, PAGE.width - 2 * MARGIN - labelWidth - 16, 1);
    page.drawText(title, { x: MARGIN, y: PAGE.height - MARGIN - 12, size: 14, font: fonts.bold, color: INK });
    page.pushOperators(setCharacterSpacing(tracking));
    page.drawText(label, { x: PAGE.width - MARGIN - labelWidth, y: PAGE.height - MARGIN - 10, size: 8, font: fonts.mono, color: MUTED });
    page.pushOperators(setCharacterSpacing(0));
    page.drawLine({ start: { x: MARGIN, y: HEADER_RULE }, end: { x: PAGE.width - MARGIN, y: HEADER_RULE }, thickness: RULE, color: INK });
    y = TOP;
    return page;
  };

  for (const [sceneIndex, scene] of input.scenes.entries()) {
    // A scene starts under its heading, on a page with room for the heading and a row of frames: never a heading
    // alone at the foot of a page.
    const last = pages.at(-1);
    let current: PDFPage = !last || y - HEADING - rowHeight < BOTTOM ? newPage() : last;
    const heading = (continued: boolean) => {
      const number = printable(fonts.monoBold, sceneLabel(scene.fields.number));
      current.drawText(number, { x: MARGIN, y: y - 12, size: 11, font: fonts.monoBold, color: INK });
      const after = MARGIN + fonts.monoBold.widthOfTextAtSize(number, 11) + 10;
      const length = scene.fields.pageEighths === null ? '' : pageLabel(scene.fields.pageEighths);
      const lengthWidth = length ? fonts.mono.widthOfTextAtSize(length, 8) : 0;
      if (length) current.drawText(length, { x: PAGE.width - MARGIN - lengthWidth, y: y - 11, size: 8, font: fonts.mono, color: MUTED });
      // The scene's palette (polish PP): a swatch per colour before the length, each ruled in ink so a pale one shows
      // on paper.
      const palette = input.palettes?.[sceneIndex] ?? [];
      const swatchesWidth = palette.length > 0 ? palette.length * (SWATCH + SWATCH_GAP) + 8 : 0;
      const swatchesRight = PAGE.width - MARGIN - lengthWidth - (length ? 8 : 0);
      palette.forEach((hex, i) => {
        current.drawRectangle({
          x: swatchesRight - swatchesWidth + 8 + i * (SWATCH + SWATCH_GAP),
          y: y - 13,
          width: SWATCH,
          height: SWATCH,
          color: pdfColour(hex),
          borderColor: INK,
          borderWidth: 0.5,
        });
      });
      // The suffix gets its room first and the heading is cut to what's left: wrapped together, a long location's
      // name cut " (continued)" off with …, and the carried-on page no longer said it was one.
      const suffix = continued ? t('export.pdf.continued') : '';
      const room = PAGE.width - MARGIN - after - lengthWidth - swatchesWidth - 12 - fonts.semi.widthOfTextAtSize(suffix, 11);
      const [text = ''] = wrap(printable(fonts.semi, headingOf(scene.fields)), fonts.semi, 11, room, 1);
      current.drawText(`${text}${suffix}`, { x: after, y: y - 12, size: 11, font: fonts.semi, color: INK });
      y -= HEADING;
    };
    heading(false);
    for (let start = 0; start < scene.shots.length; start += COLUMNS) {
      if (y - rowHeight < BOTTOM) {
        current = newPage();
        heading(true);
      }
      const row = scene.shots.slice(start, start + COLUMNS);
      for (const [column, shot] of row.entries()) {
        const x = MARGIN + column * (CELL_WIDTH + GAP);
        const frameTop = y;
        const f = shot.fields;
        const box = { x, y: frameTop - frame.height, width: frame.width, height: frame.height };
        // One frame that won't draw (a damaged picture) goes out marked, and the rest of the storyboard with it.
        input.signal?.throwIfAborted();
        let drawn = false;
        let pictureMissing = false;
        try {
          const image = await input.frame(sceneIndex, start + column);
          if (image) {
            current.drawImage(await pdf.embedJpg(image.jpeg), box);
            drawn = true;
            pictureMissing = image.pictureMissing === true;
          }
        } catch (error) {
          if (input.signal?.aborted) throw error;
        }
        // The PDF's own 8pt label in both cases: the one drawn into a small frame's JPEG prints at 3 to 5pt.
        if (!drawn || pictureMissing) {
          const said = printable(fonts.monoBold, t('export.pictureMissing'));
          const width = fonts.monoBold.widthOfTextAtSize(said, 8);
          current.drawText(said, { x: x + (frame.width - width) / 2, y: frameTop - frame.height / 2 - 3, size: 8, font: fonts.monoBold, color: INK });
          missing.push(f.number || String(start + column + 1));
        }
        current.drawRectangle({ ...box, borderColor: INK, borderWidth: RULE });
        let line = frameTop - frame.height - CAPTION.leading - 2;
        current.drawText(printable(fonts.monoBold, f.number), { x, y: line, size: CAPTION.number, font: fonts.monoBold, color: INK });
        // Status as the board shows it, a shape (it reads in black and white and for colour-blind crew), and its name.
        const status = SHOT_STATUS_LABELS[f.status];
        const shape = STATUS_SHAPE[f.status];
        const statusWidth = fonts.sans.widthOfTextAtSize(status, CAPTION.spec);
        const shapeWidth = fonts.mono.widthOfTextAtSize(shape, CAPTION.spec);
        const statusX = x + CELL_WIDTH - statusWidth;
        current.drawText(shape, { x: statusX - 3 - shapeWidth, y: line, size: CAPTION.spec, font: fonts.mono, color: INK });
        current.drawText(status, { x: statusX, y: line, size: CAPTION.spec, font: fonts.sans, color: MUTED });
        line -= CAPTION.leading;
        const [spec = ''] = wrap(printable(fonts.mono, specLine(f)), fonts.mono, CAPTION.spec, CELL_WIDTH, 1);
        if (spec) current.drawText(spec, { x, y: line, size: CAPTION.spec, font: fonts.mono, color: MUTED });
        line -= CAPTION.leading;
        for (const text of wrap(printable(fonts.sans, f.action), fonts.sans, CAPTION.text, CELL_WIDTH, ACTION_LINES)) {
          current.drawText(text, { x, y: line, size: CAPTION.text, font: fonts.sans, color: INK });
          line -= CAPTION.leading;
        }
        const dialogue = f.dialogue === '' ? '' : `“${f.dialogue}”`;
        for (const text of wrap(printable(fonts.sans, dialogue), fonts.sans, CAPTION.text, CELL_WIDTH, DIALOGUE_LINES)) {
          current.drawText(text, { x, y: line, size: CAPTION.text, font: fonts.sans, color: MUTED });
          line -= CAPTION.leading;
        }
      }
      y -= rowHeight;
    }
    y -= 6;
  }
  if (pages.length === 0) newPage();

  // Footers last, when the number of pages is known; the watermark on every page, over everything else.
  const watermark = input.watermark ? { ...input.watermark, text: printable(fonts.semi, input.watermark.text) } : null;
  const date = localDate(now);
  for (const [index, each] of pages.entries()) {
    const label = t('export.pdf.page', { page: index + 1, pages: pages.length });
    each.drawText(label, { x: PAGE.width - MARGIN - fonts.mono.widthOfTextAtSize(label, 8), y: MARGIN - 4, size: 8, font: fonts.mono, color: MUTED });
    each.drawText(date, { x: MARGIN, y: MARGIN - 4, size: 8, font: fonts.mono, color: MUTED });
    if (watermark) drawWatermark(pdf, each, watermark, fonts.semi);
  }
  input.signal?.throwIfAborted();
  return { bytes: await pdf.save(), missing, replaced: state.replaced };
}

/**
 * The watermark as the PNG frames draw it (renderFrame.ts): Inter Tight SemiBold in ink with a paper outline, both at
 * the watermark's strength, drawn last so it lies over the pictures. Ink alone over a dark picture all but vanished.
 * The outline is a stroke-only pass under the fill, as the canvas's strokeText then fillText; its own graphics state
 * sets the stroke's opacity, which pdf-lib's `opacity` leaves at full.
 */
function drawWatermark(pdf: PDFDocument, page: PDFPage, watermark: Watermark, font: PDFFont) {
  const at = watermarkPlacement(watermark, font);
  const text = { x: at.x, y: at.y, size: at.size, font, rotate: degrees(at.angle) };
  const strength = page.node.newExtGState('Watermark', pdf.context.obj({ Type: 'ExtGState', CA: watermark.opacity, ca: watermark.opacity }));
  page.pushOperators(
    pushGraphicsState(),
    setGraphicsState(strength),
    setTextRenderingMode(TextRenderingMode.Outline),
    setStrokingRgbColor(1, 1, 1),
    setLineWidth(watermarkOutline(at.size)),
    // Round, as the PNG's lineJoin: PDF's default mitre drew white spikes past the points of A, V and W.
    setLineJoin(LineJoinStyle.Round),
  );
  page.drawText(watermark.text, { ...text, color: rgb(1, 1, 1) });
  page.pushOperators(popGraphicsState());
  page.drawText(watermark.text, { ...text, color: INK, opacity: watermark.opacity });
}

/** A centred watermark sits across the page at a slight angle, as a stamp would. */
const STAMP_ANGLE = 15;

/**
 * Where the watermark goes on a page: its baseline's start, type size and angle. Centred, it is turned about its own
 * middle onto the page's, and made smaller until the turned text fits inside the margins. In a corner it sits in the
 * margin above the header (top) or between the last row and the footer (bottom), so it never crosses a frame's rules
 * or the header's text, and shrinks to fit between the side margins.
 */
/**
 * The watermark font's ascent and descent as fractions of its size, from Inter Tight's hhea table (1984 and 494 of
 * its 2048 units an em). pdf-lib's heightAtSize takes every font as 1000 units an em, which put a centred watermark
 * about a quarter of its size above the page's middle.
 */
export const WATERMARK_METRICS = { ascent: 1984 / 2048, descent: 494 / 2048 } as const;

export function watermarkPlacement(watermark: Watermark, font: PDFFont): { x: number; y: number; size: number; angle: number } {
  const roomWidth = PAGE.width - 2 * MARGIN;
  if (watermark.position === 'center') {
    const angle = STAMP_ANGLE;
    const turn = (angle * Math.PI) / 180;
    const at = (size: number) => {
      const width = font.widthOfTextAtSize(watermark.text, size);
      const ascent = size * WATERMARK_METRICS.ascent;
      const descent = size * WATERMARK_METRICS.descent;
      return { width, ascent, descent, height: ascent + descent };
    };
    const most = 48;
    const big = at(most);
    const spanX = big.width * Math.cos(turn) + big.height * Math.sin(turn);
    const spanY = big.width * Math.sin(turn) + big.height * Math.cos(turn);
    const size = Math.min(most, (most * roomWidth) / spanX, (most * (PAGE.height - 2 * MARGIN)) / spanY);
    const m = at(size);
    // The text's own middle, from its baseline's start, turned by the angle.
    const cx = m.width / 2;
    const cy = (m.ascent - m.descent) / 2;
    return {
      x: PAGE.width / 2 - (cx * Math.cos(turn) - cy * Math.sin(turn)),
      y: PAGE.height / 2 - (cx * Math.sin(turn) + cy * Math.cos(turn)),
      size,
      angle,
    };
  }
  // As big as the band between the footer's type and the frames holds (16pt, letters and descenders).
  const most = 12;
  const size = Math.min(most, (most * roomWidth) / font.widthOfTextAtSize(watermark.text, most));
  const width = font.widthOfTextAtSize(watermark.text, size);
  const descent = size * WATERMARK_METRICS.descent;
  const x = watermark.position.endsWith('left') ? MARGIN : PAGE.width - MARGIN - width;
  const y = watermark.position.startsWith('top') ? PAGE.height - MARGIN + descent : MARGIN + 3 + descent;
  return { x, y, size, angle: 0 };
}

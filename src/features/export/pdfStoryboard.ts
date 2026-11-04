import fontkit from '@pdf-lib/fontkit';
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { pageLabel, sceneLabel, specLine } from '../../core/model/storyboard';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import type { BoardScene } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import type { Watermark } from './watermark';

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

export interface StoryboardInput {
  title: string;
  scenes: readonly BoardScene[];
  /** The project's frame shape, width over height. */
  aspect: number;
  watermark: Watermark | null;
  fonts: PdfFonts;
  /** A frame drawn as a JPEG, or null for one that couldn't be drawn. */
  frame: (sceneIndex: number, shotIndex: number) => Promise<Uint8Array | null>;
  now?: Date;
}

/** Points: US Letter landscape, a half-inch margin, the kit's 8px gap as 8pt. */
const PAGE = { width: 792, height: 612 };
const MARGIN = 36;
const GAP = 12;
const COLUMNS = 3;
const INK = rgb(0x16 / 255, 0x15 / 255, 0x0f / 255);
const MUTED = rgb(0x5e / 255, 0x5a / 255, 0x52 / 255);
/** The kit's 1.5px rules. */
const RULE = 1.5;

interface Fonts {
  sans: PDFFont;
  semi: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

/** Words to lines no wider than `width`, at most `max` of them; the last ends in … when it runs on. */
export function wrap(text: string, font: PDFFont, size: number, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line !== '') lines.push(line);
    line = word;
    if (lines.length === max) break;
  }
  if (line !== '' && lines.length < max) lines.push(line);
  if (lines.length === max && words.join(' ') !== lines.join(' ')) {
    let last = lines[max - 1] ?? '';
    while (last !== '' && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1).trimEnd();
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

/** How tall a frame's caption is: number and spec, then up to three lines of action and two of dialogue. */
const CAPTION = { number: 10, spec: 7.5, text: 8, leading: 10 };
const ACTION_LINES = 3;
const DIALOGUE_LINES = 2;

export async function storyboardPdf(input: StoryboardInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const now = input.now ?? new Date();
  pdf.setTitle(`${input.title} storyboard`);
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

  const cellWidth = (PAGE.width - 2 * MARGIN - (COLUMNS - 1) * GAP) / COLUMNS;
  const frameHeight = cellWidth / input.aspect;
  const captionHeight = CAPTION.leading * (2 + ACTION_LINES + DIALOGUE_LINES) + 4;
  const rowHeight = frameHeight + captionHeight + GAP;
  const top = PAGE.height - MARGIN - 28;
  const bottom = MARGIN + 18;

  let y = top;
  const pages: PDFPage[] = [];
  const newPage = (): PDFPage => {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    // The header: the project's title, and what this is.
    page.drawText(input.title, { x: MARGIN, y: PAGE.height - MARGIN - 12, size: 14, font: fonts.bold, color: INK });
    const label = 'STORYBOARD';
    page.drawText(label, { x: PAGE.width - MARGIN - fonts.mono.widthOfTextAtSize(label, 8), y: PAGE.height - MARGIN - 10, size: 8, font: fonts.mono, color: MUTED });
    page.drawLine({ start: { x: MARGIN, y: PAGE.height - MARGIN - 20 }, end: { x: PAGE.width - MARGIN, y: PAGE.height - MARGIN - 20 }, thickness: RULE, color: INK });
    y = top;
    return page;
  };

  for (const [sceneIndex, scene] of input.scenes.entries()) {
    // A scene starts under its heading, on a page with room for the heading and a row of frames.
    const last = pages.at(-1);
    let current: PDFPage = !last || y - 22 - rowHeight < bottom ? newPage() : last;
    const heading = (continued: boolean) => {
      const number = sceneLabel(scene.fields.number);
      current.drawText(number, { x: MARGIN, y: y - 12, size: 11, font: fonts.monoBold, color: INK });
      const after = MARGIN + fonts.monoBold.widthOfTextAtSize(number, 11) + 10;
      current.drawText(`${headingOf(scene.fields)}${continued ? ' (continued)' : ''}`, { x: after, y: y - 12, size: 11, font: fonts.semi, color: INK });
      const length = scene.fields.pageEighths === null ? '' : pageLabel(scene.fields.pageEighths);
      if (length) current.drawText(length, { x: PAGE.width - MARGIN - fonts.mono.widthOfTextAtSize(length, 8), y: y - 11, size: 8, font: fonts.mono, color: MUTED });
      y -= 22;
    };
    heading(false);
    for (let start = 0; start < scene.shots.length; start += COLUMNS) {
      if (y - rowHeight < bottom) {
        current = newPage();
        heading(true);
      }
      const row = scene.shots.slice(start, start + COLUMNS);
      for (const [column, shot] of row.entries()) {
        const x = MARGIN + column * (cellWidth + GAP);
        const frameTop = y;
        const jpeg = await input.frame(sceneIndex, start + column);
        if (jpeg) {
          const image = await pdf.embedJpg(jpeg);
          current.drawImage(image, { x, y: frameTop - frameHeight, width: cellWidth, height: frameHeight });
        }
        current.drawRectangle({ x, y: frameTop - frameHeight, width: cellWidth, height: frameHeight, borderColor: INK, borderWidth: RULE });
        let line = frameTop - frameHeight - CAPTION.leading - 2;
        const f = shot.fields;
        current.drawText(f.number, { x, y: line, size: CAPTION.number, font: fonts.monoBold, color: INK });
        const status = SHOT_STATUS_LABELS[f.status];
        current.drawText(status, { x: x + cellWidth - fonts.sans.widthOfTextAtSize(status, CAPTION.spec), y: line, size: CAPTION.spec, font: fonts.sans, color: MUTED });
        line -= CAPTION.leading;
        const spec = specLine(f);
        if (spec) current.drawText(spec, { x, y: line, size: CAPTION.spec, font: fonts.mono, color: MUTED });
        line -= CAPTION.leading;
        for (const text of wrap(f.action, fonts.sans, CAPTION.text, cellWidth, ACTION_LINES)) {
          current.drawText(text, { x, y: line, size: CAPTION.text, font: fonts.sans, color: INK });
          line -= CAPTION.leading;
        }
        for (const text of wrap(f.dialogue === '' ? '' : `“${f.dialogue}”`, fonts.sans, CAPTION.text, cellWidth, DIALOGUE_LINES)) {
          current.drawText(text, { x, y: line, size: CAPTION.text, font: fonts.sans, color: MUTED });
          line -= CAPTION.leading;
        }
      }
      y -= rowHeight;
    }
    y -= 6;
  }
  if (pages.length === 0) newPage();

  // Footers last, when the number of pages is known; the watermark on every page.
  for (const [index, each] of pages.entries()) {
    const label = `${String(index + 1)} / ${String(pages.length)}`;
    each.drawText(label, { x: PAGE.width - MARGIN - fonts.mono.widthOfTextAtSize(label, 8), y: MARGIN - 4, size: 8, font: fonts.mono, color: MUTED });
    const date = now.toISOString().slice(0, 10);
    each.drawText(date, { x: MARGIN, y: MARGIN - 4, size: 8, font: fonts.mono, color: MUTED });
    if (input.watermark) drawWatermark(each, input.watermark, fonts.bold);
  }
  return pdf.save();
}

function drawWatermark(page: PDFPage, watermark: Watermark, font: PDFFont) {
  const size = watermark.position === 'center' ? 48 : 18;
  const width = font.widthOfTextAtSize(watermark.text, size);
  const inset = MARGIN + 8;
  const x = watermark.position === 'center' ? (PAGE.width - width * Math.cos(Math.PI / 12)) / 2 : watermark.position.endsWith('left') ? inset : PAGE.width - inset - width;
  const y = watermark.position === 'center' ? PAGE.height / 2 - size / 3 : watermark.position.startsWith('top') ? PAGE.height - inset - 28 - size : inset + 10;
  page.drawText(watermark.text, {
    x,
    y,
    size,
    font,
    color: INK,
    opacity: watermark.opacity,
    // A centred watermark sits across the page at a slight angle, as a stamp would.
    rotate: degrees(watermark.position === 'center' ? 15 : 0),
  });
}

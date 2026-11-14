import fontkit from '@pdf-lib/fontkit';
import {
  appendBezierCurve,
  beginMarkedContent,
  beginText,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endMarkedContent,
  endPath,
  endText,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFDocument,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setCharacterSpacing,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  TextRenderingMode,
  type PDFFont,
  type PDFImage,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import type { PageFormat, PageOrientation } from '../moodboards/pageFormats';
import { cardUrl } from '../moodboards/links';
import { apply, followed, parseColour, type DisplayOp, type Matrix, type Segment } from './deckDisplay';
import { embedRule, FALLBACK_FAMILY, fsTypeOfFont } from './deckFontRules';
import type { Watermark } from './watermark';
import { watermarkOutline } from './renderFrame';

// A deck as a PDF (5.6a): one page per page frame, in the deck's order, drawn from the display list of what Present shows
// (deckDisplay.ts). Shapes and connectors are PDF paths; text is real text in its own font, laid out with the line breaks the
// canvas used and each line placed with the PDF font's own widths; link cards are link annotations; pictures are the originals
// where the app could read them (deckPictures.ts), redrawn in sRGB. Free of the page and of Konva: the fonts and the pictures
// come in through two small functions, so it builds the same in the app and in the tests.

/** Points a page is, by its format (decision 3; 9:16 and 4:5 for social decks, A4 and Letter turned for landscape). */
const PAGE_POINTS: Readonly<Record<PageFormat, { width: number; height: number }>> = {
  '16:9': { width: 960, height: 540 },
  '9:16': { width: 540, height: 960 },
  '4:5': { width: 540, height: 675 },
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export function pdfPageSize(format: PageFormat, orientation: PageOrientation): { width: number; height: number } {
  const size = PAGE_POINTS[format];
  const paper = format === 'a4' || format === 'letter';
  return paper && orientation === 'landscape' ? { width: size.height, height: size.width } : { ...size };
}

/** One page, ready to write: its format, its size in the canvas's units, its background and what it draws. */
export interface PrintPage {
  format: PageFormat;
  orientation: PageOrientation;
  width: number;
  height: number;
  /** `#RRGGBB`. */
  background: string;
  ops: readonly DisplayOp[];
}

/** A font file for a face: what `key` names is one file, embedded once. The faces a file doesn't have are made: bold by a thin outline, italic by a slant. */
export interface FontFile {
  key: string;
  bytes: Uint8Array;
  synthBold: boolean;
  synthItalic: boolean;
}
export type FontLoader = (family: string, weight: number, italic: boolean) => Promise<FontFile | null>;

/** A picture redrawn for the page: JPEG, or PNG when it has transparency; `original` when it came from the picture's own file. */
export interface PictureData {
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
  original: boolean;
}
/** `longEdge`: the most pixels the picture's long edge needs where it is printed (300 dpi, at most 6000). */
export type PictureLoader = (sha256: string, longEdge: number, signal?: AbortSignal) => Promise<PictureData | null>;

export type FontNoteReason = 'restricted' | 'bitmap' | 'missing' | 'unreadable' | 'glyphs';
export interface FontNote {
  family: string;
  reason: FontNoteReason;
}

export interface DeckPdfInput {
  title: string;
  pageCount: number;
  /** Page `index` (0-based), drawn when its turn comes: a page is made one at a time. */
  page: (index: number) => Promise<PrintPage>;
  fonts: FontLoader;
  pictures: PictureLoader;
  watermark: Watermark | null;
  /** Called after each page is written. */
  progress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface DeckPdf {
  bytes: Uint8Array;
  /** Fonts that were not used for what they were asked for, each family and reason once. */
  fontNotes: FontNote[];
  /** How many pictures were printed from the copy the project keeps, not from their original files. */
  storedCopies: number;
  /** How many pictures could not be printed at all: neither copy could be read or embedded. */
  unprintable: number;
}

/** The pixels per inch a picture is printed at, and the most a long edge ever has. */
export const PRINT_DPI = 300;
export const MAX_LONG_EDGE = 6000;
/** Sizes a picture is asked for in, so one used at two sizes isn't embedded a dozen times over. */
const EDGE_STEP = 256;

/** The long edge in pixels a picture needs where it is printed `widthPt` by `heightPt` points: 300 dpi, never over 6000. */
export function longEdgeFor(widthPt: number, heightPt: number): number {
  const needed = Math.ceil((Math.max(widthPt, heightPt) / 72) * PRINT_DPI);
  return Math.min(MAX_LONG_EDGE, Math.max(EDGE_STEP, Math.ceil(needed / EDGE_STEP) * EDGE_STEP));
}

interface Face {
  font: PDFFont;
  synthBold: boolean;
  synthItalic: boolean;
}

const rgbOf = (colour: string): [number, number, number] => parseColour(colour) ?? [0, 0, 0];

/** The matrix scale along each axis, for sizes that go through a transform. */
const scaleOf = (m: Matrix): { x: number; y: number } => ({ x: Math.hypot(m[0], m[1]), y: Math.hypot(m[2], m[3]) });

const CAPS = { butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting } as const;
const JOINS = { miter: LineJoinStyle.Miter, round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel } as const;

/** A thin outline on a font that has no bold of its own: a twentieth of the type size or so, drawn in the text's own colour. */
const SYNTH_BOLD_WIDTH = 0.03;
/** The slant of a font that has no italic of its own: about 11 degrees. */
const SYNTH_ITALIC_SKEW = 0.2;

export async function writeDeckPdf(input: DeckPdfInput): Promise<DeckPdf> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // The deck's name and the app's, nothing of the person's: no author.
  pdf.setTitle(input.title);
  pdf.setCreator('Storiiboard');
  pdf.setProducer('Storiiboard');
  const notes = new Map<string, FontNote>();
  const note = (family: string, reason: FontNoteReason) => {
    notes.set(`${family}\n${reason}`, { family, reason });
  };

  // Fonts: one embedded font per file, a face resolved once per family, weight and slant.
  const embedded = new Map<string, Promise<PDFFont | null>>();
  const faces = new Map<string, Promise<Face>>();
  const embedFile = (file: FontFile, family: string): Promise<PDFFont | null> => {
    let font = embedded.get(file.key);
    if (!font) {
      font = (async () => {
        const rule = embedRule(fsTypeOfFont(file.bytes));
        if (!rule.embed) {
          note(family, rule.reason);
          return null;
        }
        try {
          return await pdf.embedFont(file.bytes, { subset: rule.subset });
        } catch {
          note(family, 'unreadable');
          return null;
        }
      })();
      embedded.set(file.key, font);
    }
    return font;
  };
  const face = (family: string, weight: number, italic: boolean): Promise<Face> => {
    const key = `${family}\n${String(weight)}\n${String(italic)}`;
    let made = faces.get(key);
    if (!made) {
      made = (async (): Promise<Face> => {
        const file = family === FALLBACK_FAMILY ? null : await input.fonts(family, weight, italic).catch(() => null);
        if (family !== FALLBACK_FAMILY && file === null) note(family, 'missing');
        const font = file ? await embedFile(file, family) : null;
        if (file && font) return { font, synthBold: file.synthBold, synthItalic: file.synthItalic };
        // Inter Tight, the app's own font, in the weight and slant asked for.
        const fallback = await input.fonts(FALLBACK_FAMILY, weight, italic);
        const fallbackFont = fallback ? await embedFile(fallback, FALLBACK_FAMILY) : null;
        if (!fallback || !fallbackFont) throw new Error(`The app's own font ${FALLBACK_FAMILY} could not be embedded.`);
        return { font: fallbackFont, synthBold: fallback.synthBold, synthItalic: fallback.synthItalic };
      })();
      faces.set(key, made);
    }
    return made;
  };

  // Pictures: embedded once per picture and size asked for.
  const images = new Map<string, Promise<PDFImage | null>>();
  const storedCopy = new Set<string>();
  const unprintable = new Set<string>();
  let blank = 0;
  const image = (sha256: string, longEdge: number): Promise<PDFImage | null> => {
    const key = `${sha256}:${String(longEdge)}`;
    let made = images.get(key);
    if (!made) {
      made = (async () => {
        const data = await input.pictures(sha256, longEdge, input.signal).catch((error: unknown) => {
          // A Stop ends the export; any other failure is a picture that can't be printed.
          if (input.signal?.aborted) throw error;
          return null;
        });
        if (!data) {
          unprintable.add(sha256);
          return null;
        }
        if (!data.original) storedCopy.add(sha256);
        try {
          return data.kind === 'png' ? await pdf.embedPng(data.bytes) : await pdf.embedJpg(data.bytes);
        } catch {
          unprintable.add(sha256);
          return null;
        }
      })();
      images.set(key, made);
    }
    return made;
  };

  for (let index = 0; index < input.pageCount; index += 1) {
    input.signal?.throwIfAborted();
    const source = await input.page(index);
    input.signal?.throwIfAborted();
    await drawPage(pdf, source, face, image, input.watermark, input.signal, note, () => {
      blank += 1;
    });
    input.progress?.(index + 1, input.pageCount);
  }
  return { bytes: await pdf.save(), fontNotes: [...notes.values()], storedCopies: storedCopy.size, unprintable: unprintable.size + blank };
}

interface Stacked {
  /** Where the page's units are on the page, so far. */
  m: Matrix;
}

async function drawPage(
  pdf: PDFDocument,
  source: PrintPage,
  face: (family: string, weight: number, italic: boolean) => Promise<Face>,
  image: (sha256: string, longEdge: number) => Promise<PDFImage | null>,
  watermark: Watermark | null,
  signal: AbortSignal | undefined,
  note: (family: string, reason: FontNoteReason) => void,
  blankPicture: () => void,
): Promise<void> {
  const size = pdfPageSize(source.format, source.orientation);
  const page = pdf.addPage([size.width, size.height]);
  // The page's units to points, turned over so the page's y runs down as the canvas's does. Text is turned back (below).
  const scale = size.width / source.width;
  const base: Matrix = [scale, 0, 0, -scale, 0, size.height];
  const out: PDFOperator[] = [];
  const flush = () => {
    if (out.length > 0) page.pushOperators(...out.splice(0));
  };
  // The background is filled in points, before the page's units are set up: in them its edge could stop a hair short of the paper's.
  out.push(pushGraphicsState(), setFillingRgbColor(...rgbOf(source.background)), rectangle(0, 0, size.width, size.height), fill(), concatTransformationMatrix(...base));

  const stack: Stacked[] = [{ m: [1, 0, 0, 1, 0, 0] }];
  let opacity = 1;
  const opacities: number[] = [];
  const states = new Map<string, PDFName>();
  const fontKeys = new Map<PDFFont, PDFName>();
  const keyOf = (font: PDFFont): PDFName => {
    let key = fontKeys.get(font);
    if (!key) {
      key = page.node.newFontDictionary(font.name, font.ref);
      fontKeys.set(font, key);
    }
    return key;
  };
  const imageKeys = new Map<PDFImage, PDFName>();
  const current = () => stack[stack.length - 1] ?? { m: [1, 0, 0, 1, 0, 0] as Matrix };

  for (const op of source.ops) {
    switch (op.op) {
      case 'save':
        stack.push({ m: current().m });
        opacities.push(opacity);
        out.push(pushGraphicsState());
        break;
      case 'restore':
        if (stack.length > 1) {
          stack.pop();
          opacity = opacities.pop() ?? 1;
          out.push(popGraphicsState());
        }
        break;
      case 'concat':
        stack[stack.length - 1] = { m: followed(op.m, current().m) };
        out.push(concatTransformationMatrix(...op.m));
        break;
      case 'opacity': {
        opacity *= op.value;
        const value = Math.round(opacity * 1000) / 1000;
        const key = String(value);
        let state = states.get(key);
        if (!state) {
          state = page.node.newExtGState('Opacity', pdf.context.obj({ Type: 'ExtGState', CA: value, ca: value }));
          states.set(key, state);
        }
        out.push(setGraphicsState(state));
        break;
      }
      case 'clip':
        out.push(rectangle(op.x, op.y, op.width, op.height), clip(), endPath());
        break;
      case 'shape':
        out.push(...shapeOperators(op, current().m));
        break;
      case 'text': {
        const used = await face(op.family, op.weight, op.italic);
        const runs = await runsOf(op, used, face, note);
        out.push(...textOperators(op, runs, keyOf));
        break;
      }
      case 'image': {
        signal?.throwIfAborted();
        if (op.sha256 === '') {
          // A picture on the page with nothing saying which: it can't be printed.
          blankPicture();
          break;
        }
        const total = followed(current().m, base);
        const printed = scaleOf(total);
        const picture = await image(op.sha256, longEdgeFor(op.width * printed.x, op.height * printed.y));
        if (!picture) break;
        let key = imageKeys.get(picture);
        if (!key) {
          key = page.node.newXObject('Image', picture.ref);
          imageKeys.set(picture, key);
        }
        // The picture's unit square, turned over to stand upright under the page's flipped y.
        out.push(pushGraphicsState(), concatTransformationMatrix(op.width, 0, 0, -op.height, 0, op.height), drawObject(key), popGraphicsState());
        break;
      }
      case 'link':
        addLink(pdf, page, op.url, followed(current().m, base), op.width, op.height);
        break;
    }
    if (out.length > 400) flush();
  }
  // Anything left open is closed: the page's own save is the last.
  while (stack.length > 1) {
    stack.pop();
    out.push(popGraphicsState());
  }
  out.push(popGraphicsState());
  flush();
  if (watermark) await drawWatermark(pdf, page, size, watermark, face);
}

function pathOperators(path: readonly Segment[]): PDFOperator[] {
  return path.map((segment) => {
    if ('m' in segment) return moveTo(segment.m[0], segment.m[1]);
    if ('l' in segment) return lineTo(segment.l[0], segment.l[1]);
    if ('c' in segment) return appendBezierCurve(...segment.c);
    return closePath();
  });
}

function shapeOperators(op: Extract<DisplayOp, { op: 'shape' }>, m: Matrix): PDFOperator[] {
  const filled = op.fill === null ? null : parseColour(op.fill);
  const stroked = op.stroke === null ? null : parseColour(op.stroke);
  if (!filled && !stroked) return [];
  const out: PDFOperator[] = [];
  // A width the canvas keeps whatever the scale (its strokeScaleEnabled false) is divided by what the transform scales by.
  const determinant = Math.abs(m[0] * m[3] - m[1] * m[2]);
  const unit = op.fixedStroke && determinant > 0 ? 1 / Math.sqrt(determinant) : 1;
  if (filled) out.push(setFillingRgbColor(...filled));
  if (stroked) {
    out.push(setStrokingRgbColor(...stroked), setLineWidth(op.strokeWidth * unit), setLineCap(CAPS[op.cap]), setLineJoin(JOINS[op.join]));
    out.push(setDashPattern(op.dash.map((d) => d * unit), 0));
  }
  out.push(...pathOperators(op.path));
  out.push(filled && stroked ? fillAndStroke() : filled ? fill() : stroke());
  return out;
}

/** A face's characters, worked out once. */
const charSets = new WeakMap<PDFFont, Set<number>>();
function covers(font: PDFFont, codePoint: number): boolean {
  let set = charSets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charSets.set(font, set);
  }
  return set.has(codePoint);
}

interface Run {
  text: string;
  face: Face;
}

/**
 * A line's text as runs, each in a face that has its characters: the face asked for, else Inter Tight, else JetBrains Mono. A
 * character none has stays in the face asked for, as its empty box, and the font is named in the notice. Spaces go with the
 * run they are in.
 */
async function runsOf(
  op: Extract<DisplayOp, { op: 'text' }>,
  primary: Face,
  face: (family: string, weight: number, italic: boolean) => Promise<Face>,
  note: (family: string, reason: FontNoteReason) => void,
): Promise<Run[][]> {
  const lines = op.lines.map((line) => Array.from(line.text));
  const missing = lines.some((chars) => chars.some((c) => (c.codePointAt(0) ?? 0) > 0x20 && !covers(primary.font, c.codePointAt(0) ?? 0)));
  if (!missing) return op.lines.map((line) => [{ text: line.text, face: primary }]);
  const candidates = [primary, await face(FALLBACK_FAMILY, op.weight, op.italic)];
  const stillMissing = (c: string) => (c.codePointAt(0) ?? 0) > 0x20 && !candidates.some((f) => covers(f.font, c.codePointAt(0) ?? 0));
  if (op.family !== MONO_FAMILY && lines.some((chars) => chars.some(stillMissing))) candidates.push(await face(MONO_FAMILY, op.weight, op.italic));
  const out: Run[][] = [];
  for (const chars of lines) {
    const runs: Run[] = [];
    let last: Face = primary;
    for (const c of chars) {
      const cp = c.codePointAt(0) ?? 0;
      let chosen: Face | undefined = cp <= 0x20 ? last : candidates.find((f) => covers(f.font, cp));
      if (!chosen) {
        chosen = primary;
        note(op.family, 'glyphs');
      }
      last = chosen;
      const tail = runs[runs.length - 1];
      if (tail && tail.face === chosen) tail.text += c;
      else runs.push({ text: c, face: chosen });
    }
    out.push(runs);
  }
  return out;
}

const MONO_FAMILY = 'JetBrains Mono';

function textOperators(op: Extract<DisplayOp, { op: 'text' }>, lines: readonly (readonly Run[])[], keyOf: (font: PDFFont) => PDFName): PDFOperator[] {
  const colour = rgbOf(op.fill);
  const out: PDFOperator[] = [pushGraphicsState(), setFillingRgbColor(...colour)];
  if (op.letterSpacing !== 0) out.push(setCharacterSpacing(op.letterSpacing));
  op.lines.forEach((line, n) => {
    const runs = lines[n] ?? [];
    if (line.text === '') return;
    // Placed by the PDF fonts' own widths, not the canvas's: aligned text stays aligned when the two differ by a hair. The canvas
    // spaces letters, not the end of the line, so the line is one spacing fewer than its letters.
    const letters = Array.from(line.text).length;
    const width = runs.reduce((sum, run) => sum + run.face.font.widthOfTextAtSize(run.text, op.size), 0) + op.letterSpacing * Math.max(0, letters - 1);
    let x = op.align === 'right' ? op.width - op.padding - width : op.align === 'center' ? op.padding + (op.width - width - op.padding * 2) / 2 : op.padding;
    for (const run of runs) {
      const used = run.face;
      out.push(setFontAndSize(keyOf(used.font), op.size));
      if (used.synthBold) out.push(setTextRenderingMode(TextRenderingMode.FillAndOutline), setStrokingRgbColor(...colour), setLineWidth(op.size * SYNTH_BOLD_WIDTH), setLineJoin(LineJoinStyle.Round));
      else out.push(setTextRenderingMode(TextRenderingMode.Fill));
      const skew = used.synthItalic ? SYNTH_ITALIC_SKEW : 0;
      // The text matrix turns the page's flipped y back, so the letters stand upright.
      out.push(beginText(), setTextMatrix(1, 0, skew, -1, x, line.baseline), showText(used.font.encodeText(run.text)), endText());
      x += used.font.widthOfTextAtSize(run.text, op.size) + op.letterSpacing * Array.from(run.text).length;
    }
  });
  out.push(popGraphicsState());
  return out;
}

/**
 * An address as a PDF string can hold it: parentheses and backslashes, which a string reads as its own marks, and anything
 * outside printable ASCII, are written as percent codes (UTF-8), so a ")" in an address can't end the string early and start
 * a dictionary entry of someone's making.
 */
export function escapedUri(url: string): string {
  const encoder = new TextEncoder();
  return url.replace(/[^\x21-\x7e]|[()\\]/gu, (c) =>
    Array.from(encoder.encode(c))
      .map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(''),
  );
}

function addLink(pdf: PDFDocument, page: PDFPage, url: string, m: Matrix, width: number, height: number): void {
  // The same check a link card applies when it is made, and the opener's: http and https only. javascript:, file: and the rest get no link.
  const safe = cardUrl(url);
  if (safe === null || !/^https?:\/\//i.test(safe)) return;
  const corners = [apply(m, 0, 0), apply(m, width, 0), apply(m, width, height), apply(m, 0, height)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      Border: [0, 0, 0],
      // Printed with the page.
      F: 4,
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(escapedUri(safe)) },
    }),
  );
  page.node.addAnnot(annotation);
}

/** The watermark: the project's text in Inter Tight, ink with a white outline so it reads over a picture, in its corner or the middle. */
async function drawWatermark(
  pdf: PDFDocument,
  page: PDFPage,
  size: { width: number; height: number },
  watermark: Watermark,
  face: (family: string, weight: number, italic: boolean) => Promise<Face>,
): Promise<void> {
  const { font } = await face(FALLBACK_FAMILY, 600, false);
  const short = Math.min(size.width, size.height);
  const margin = short * 0.03;
  const room = size.width - 2 * margin;
  let type = Math.max(8, short * 0.045);
  const widthAt = (s: number) => font.widthOfTextAtSize(watermark.text, s);
  if (widthAt(type) > room) type = Math.max(1, (type * room) / widthAt(type));
  const width = widthAt(type);
  // Inter Tight's hhea metrics, 1984 and 494 of 2048 units an em (pdfStoryboard.ts WATERMARK_METRICS).
  const ascent = type * (1984 / 2048);
  const descent = type * (494 / 2048);
  const x = watermark.position === 'center' ? (size.width - width) / 2 : watermark.position.endsWith('left') ? margin : size.width - margin - width;
  const y =
    watermark.position === 'center'
      ? (size.height - (ascent - descent)) / 2 - 0
      : watermark.position.startsWith('top')
        ? size.height - margin - ascent
        : margin + descent;
  const state = page.node.newExtGState('Watermark', pdf.context.obj({ Type: 'ExtGState', CA: watermark.opacity, ca: watermark.opacity }));
  const key = page.node.newFontDictionary(font.name, font.ref);
  const text = font.encodeText(watermark.text);
  const ink = rgbOf('#16150F');
  page.pushOperators(
    pushGraphicsState(),
    setGraphicsState(state),
    setFontAndSize(key, type),
    setTextRenderingMode(TextRenderingMode.FillAndOutline),
    // The outline is the page's decoration, not its words: marked as an artifact so a reader's text extraction finds the watermark once.
    beginMarkedContent('Artifact'),
    setFillingRgbColor(1, 1, 1),
    setStrokingRgbColor(1, 1, 1),
    setLineWidth(watermarkOutline(type)),
    setLineJoin(LineJoinStyle.Round),
    beginText(),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(text),
    endText(),
    endMarkedContent(),
    // Then the ink over the outline's inner half.
    setTextRenderingMode(TextRenderingMode.Fill),
    setFillingRgbColor(...ink),
    beginText(),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(text),
    endText(),
    popGraphicsState(),
  );
}

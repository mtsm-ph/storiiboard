import Konva from 'konva';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { loadPicture } from '../../core/media/decoded';
import type { ProjectFile } from '../../core/storage/driver';
import { PageStage } from '../../ui/canvas/PageStage';
import { INK, PAPER, RAISED } from '../../ui/canvas/paperColours';
import type { CanvasColours, CanvasItem, Rect } from '../../ui/canvas/types';
import { ensureFont } from '../moodboards/fonts';
import { apply, displayOps, followed, IDENTITY, type DisplayOp, type Matrix, type Segment } from './deckDisplay';
import type { PrintPage } from './deckPdfWriter';
import { deckFontLoader } from './deckFonts';
import { snapshot } from './deckRender';
import { FACE_FONTS, FOOT_BAND, fontMeasure, HEADER_HEIGHT, SHEET, LEGEND_TITLE, PAGE_MARGIN, type Measure, type PlanArea, type PlanFace, type PlanPage } from './planPages';
import { t } from '../../core/i18n';
import { WATERMARK_FONT } from './renderFrame';

// A plan's page drawn (6.10): the plan through the canvas's own renderer (PageStage) with the plan's own drawings, the
// same ones the screen draws, in print mode, read back from Konva as vector display operations (deckDisplay.ts); then the
// header, the legend, the grid, the scale bar and the scale in words as operations of their own, in points. The PDF is
// those operations through the deck's writer (deckPdfWriter.ts); the PNG is the same operations painted at 200 dpi
// (displayPaint.ts), so the two are one drawing.

/** The plan's colours on paper: ink, and the sheet itself for paper (a door's gap is the paper it's printed on). */
export const PRINT_COLOURS: CanvasColours = { ink: INK, paper: SHEET, raised: RAISED };
const WHITE = SHEET;

/** Plan labels on paper (decision 14 brief): 7 pt, where the screen sets them at 11 px; every size the plan reckons in screen pixels follows. */
export const LABEL_POINTS = 7;
const SCREEN_LABEL_PIXELS = 11;
/** A label's paper halo on paper, points of stroke (half of it shows round each letter). */
export const HALO_POINTS = 1.5;

/** The page's boxes, and the plan's own lines: the kit's 1.5 px at 0.6 pt, a thinner line a hairline. */
export const BOX_RULE = 1;
export const KIT_LINE = 0.6;
export const HAIRLINE = 0.25;

/** The zoom a plan is drawn for on paper: points per world unit, so a size the plan gives in pixels lands in points, scaled so its labels are 7 pt. */
export const printZoom = (pointsPerUnit: number): number => pointsPerUnit * (SCREEN_LABEL_PIXELS / LABEL_POINTS);

/** What a line the screen draws `px` pixels wide prints at (decision 14 brief: 1.5 px lines at 0.6 pt, thinner ones as hairlines). */
export const printedWeight = (px: number): number => (px >= 1.5 - 1e-9 ? px * (KIT_LINE / 1.5) : HAIRLINE);

const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/**
 * A plan's operations with paper's weights (decision 14 brief, the print path's fourth gap): a fixed-width line (the
 * screen's pixels) takes its printed weight and its dashes scale with it; a label's halo is HALO_POINTS of the sheet's
 * own white, whatever zoom it was made for. Walls are filled to scale already, and fills keep their opacity.
 */
export function printWeights(ops: readonly DisplayOp[]): DisplayOp[] {
  const stack: Matrix[] = [IDENTITY];
  const now = () => stack[stack.length - 1] ?? IDENTITY;
  return ops.map((op): DisplayOp => {
    switch (op.op) {
      case 'save':
        stack.push(now());
        return op;
      case 'restore':
        if (stack.length > 1) stack.pop();
        return op;
      case 'concat':
        stack[stack.length - 1] = followed(op.m, now());
        return op;
      case 'shape': {
        if (!op.fixedStroke || op.stroke === null) return op;
        const width = printedWeight(op.strokeWidth);
        const ratio = op.strokeWidth > 0 ? width / op.strokeWidth : 1;
        return { ...op, strokeWidth: width, dash: op.dash.map((d) => d * ratio) };
      }
      case 'text': {
        if (!op.stroke) return op;
        const scale = scaleOf(now());
        const colour = op.stroke.colour.toUpperCase() === PAPER ? WHITE : op.stroke.colour;
        return { ...op, stroke: { colour, width: scale > 0 ? HALO_POINTS / scale : op.stroke.width } };
      }
      default:
        return op;
    }
  });
}

/** The faces the page is set in, loaded before it is measured or painted. */
export async function preparePlanFonts(): Promise<void> {
  await Promise.all(Object.values(FACE_FONTS).map((face) => ensureFont(face.family, face.weight, false)));
  await document.fonts.ready;
}

/**
 * The watermark's face for a plan's PNG (6.20 review): Inter Tight at 600, the bundled face, loaded the way the page's
 * other faces are (ensureFont), then asked of the page by the very font string the stamp is measured and painted in,
 * so the canvas never measures it in a fallback while the face is still on its way. Never throws.
 */
export async function preparePlanStampFont(text: string): Promise<void> {
  // A page with no font loading to ask (a test's stand-in document) measures with what it has.
  if (typeof document === 'undefined' || typeof (document as Partial<Document>).fonts?.load !== 'function') return;
  await ensureFont('Inter Tight', 600, false);
  await document.fonts.load(WATERMARK_FONT(24), text).catch(() => undefined);
}

/**
 * The page's measure: the bundled faces' own files, the ones the PDF embeds (fontMeasure), so a legend line's runs in
 * Inter Tight and JetBrains Mono meet exactly in the PDF.
 */
export async function bundledMeasure(): Promise<Measure> {
  const files: Partial<Record<PlanFace, Uint8Array>> = {};
  for (const [face, font] of Object.entries(FACE_FONTS) as [PlanFace, { family: string; weight: number }][]) {
    const file = await deckFontLoader(font.family, font.weight, false);
    if (file) files[face] = file.bytes;
  }
  return fontMeasure(files);
}

/**
 * The underlays' pictures a page draws, loaded at their stored size first, so the stage has them when it is drawn. Says
 * how many could be read at neither size: the canvas draws those as a placeholder, which the export counts with the
 * pictures it couldn't print (6.10 review), as the deck export does.
 */
export async function preparePlanPictures(file: ProjectFile, shas: readonly string[]): Promise<number> {
  let unreadable = 0;
  for (const sha of shas) {
    const small = await loadPicture(file, sha, 'thumbnail');
    const full = await loadPicture(file, sha, 'original');
    if (small.status !== 'ok' && full.status !== 'ok') unreadable += 1;
  }
  return unreadable;
}

/** The plan area's drawing: the canvas's own, in print mode, in points from the box's top left corner. */
export async function planDrawing(area: PlanArea): Promise<DisplayOp[]> {
  const host = document.createElement('div');
  const root = createRoot(host);
  const page: CanvasItem = { id: 'sb-plan-page', ...area.world, rotation: 0, label: '', draw: () => null };
  flushSync(() => {
    root.render(<PageStage page={page} items={area.items} links={[]} size={{ width: area.drawing.width, height: area.drawing.height }} colours={PRINT_COLOURS} print drawZoom={printZoom(area.pointsPerUnit)} />);
  });
  const find = () => Konva.stages.find((stage) => host.contains(stage.container()));
  const wanted = area.items.length + 1;
  for (let tries = 0; tries < 200; tries += 1) {
    const stage = find();
    if (stage && stage.find('.stage-item').length >= wanted) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  const stage = find();
  try {
    if (!stage) throw new Error(t('export.plan.cantDraw'));
    const layer = stage.getLayers()[0];
    const node = layer ? snapshot(layer) : null;
    return printWeights(node ? displayOps(node) : []);
  } finally {
    flushSync(() => {
      root.unmount();
    });
  }
}

// The page's own drawing, in points.

const rect = (x: number, y: number, width: number, height: number): Segment[] => [{ m: [x, y] }, { l: [x + width, y] }, { l: [x + width, y + height] }, { l: [x, y + height] }, { z: true }];

function box(r: Rect, fill: string | null, stroke: string | null, width = BOX_RULE): DisplayOp {
  return { op: 'shape', path: rect(r.x, r.y, r.width, r.height), fill, stroke, strokeWidth: width, fixedStroke: false, dash: [], cap: 'butt', join: 'miter' };
}

function line(points: readonly [number, number][], stroke: string, width: number): DisplayOp {
  return { op: 'shape', path: points.map((p, i): Segment => (i === 0 ? { m: p } : { l: p })), fill: null, stroke, strokeWidth: width, fixedStroke: false, dash: [], cap: 'butt', join: 'miter' };
}

/** One line of text at a baseline, left, centred or right of `x`. */
export function text(x: number, baseline: number, words: string, face: PlanFace, size: number, align: 'left' | 'center' | 'right' = 'left'): DisplayOp[] {
  if (words === '') return [];
  const font = FACE_FONTS[face];
  return [
    { op: 'save' },
    { op: 'concat', m: [1, 0, 0, 1, x, 0] },
    { op: 'text', lines: [{ text: words, baseline }], align, padding: 0, width: 0, family: font.family, weight: font.weight, italic: false, size, fill: INK, letterSpacing: 0 },
    { op: 'restore' },
  ];
}

/** Words cut to a width with an ellipsis: a header line's names (the legend's lines are wrapped, never cut). */
function fitted(words: string, face: PlanFace, size: number, width: number, measure: Measure): string {
  if (measure(words, face, size) <= width) return words;
  let cut = Array.from(words);
  while (cut.length > 1 && measure(`${cut.join('')}…`, face, size) > width) cut = cut.slice(0, -1);
  return `${cut.join('').trimEnd()}…`;
}

/** The header box: the project (and company), the scene's slate and heading, the setup and its days; the page and the date at its right. */
function headerOps(page: PlanPage, measure: Measure): DisplayOp[] {
  const { header } = page;
  const r: Rect = { x: PAGE_MARGIN, y: PAGE_MARGIN, width: page.size.width - 2 * PAGE_MARGIN, height: HEADER_HEIGHT };
  const right = r.x + r.width - 8;
  const room = r.width - 16 - 150;
  const ops: DisplayOp[] = [box(r, null, INK)];
  const project = fitted(header.project, 'sansBold', 13, room * 0.7, measure);
  ops.push(...text(r.x + 8, r.y + 17, project, 'sansBold', 13));
  if (header.company) {
    const at = r.x + 8 + measure(project, 'sansBold', 13) + 8;
    ops.push(...text(at, r.y + 17, fitted(header.company, 'sans', 9, r.x + 8 + room - at, measure), 'sans', 9));
  }
  if (header.continued !== null) {
    ops.push(...text(r.x + 8, r.y + 32, fitted(header.continued, 'monoBold', 10, room, measure), 'monoBold', 10));
  } else {
    const slate = fitted(header.slate, 'monoBold', 10, header.setup ? room * 0.65 : room, measure);
    ops.push(...text(r.x + 8, r.y + 32, slate, 'monoBold', 10));
    if (header.setup) {
      const at = r.x + 8 + measure(slate, 'monoBold', 10) + 12;
      ops.push(...text(at, r.y + 32, fitted(header.setup, 'sansBold', 10, r.x + 8 + room - at, measure), 'sansBold', 10));
    }
  }
  if (header.days) ops.push(...text(r.x + 8, r.y + 44, fitted(header.days, 'mono', 8, room, measure), 'mono', 8));
  ops.push(...text(right, r.y + 17, header.page, 'mono', 8, 'right'), ...text(right, r.y + 32, header.printed, 'mono', 8, 'right'));
  return ops;
}

/** The light grid over the drawing (decision 14 brief): hairlines at every step, through the world origin, as the screen's. */
function gridOps(area: PlanArea): DisplayOp[] {
  if (area.grid === null) return [];
  const step = area.grid;
  const ppu = area.pointsPerUnit;
  const ops: DisplayOp[] = [];
  for (let x = Math.ceil(area.world.x / step) * step; x <= area.world.x + area.world.width; x += step) {
    const at = (x - area.world.x) * ppu;
    ops.push(line([[at, 0], [at, area.drawing.height]], RAISED, HAIRLINE));
  }
  for (let y = Math.ceil(area.world.y / step) * step; y <= area.world.y + area.world.height; y += step) {
    const at = (y - area.world.y) * ppu;
    ops.push(line([[0, at], [area.drawing.width, at]], RAISED, HAIRLINE));
  }
  return ops;
}

/** Where the plan box's foot band is on the page, points: under the drawing, inside the box (FOOT_BAND tall). */
export const footBand = (area: PlanArea): Rect => ({ x: area.box.x, y: area.drawing.y + area.drawing.height, width: area.box.width, height: FOOT_BAND });

/**
 * The foot band (6.10 review): under a rule, the scale in words and "Print at actual size (100%)" over a bar of a round
 * length at its left, and the note, when there is one ("No room drawn"), at its right. It is a strip of its own, so
 * nothing on it ever covers the plan, whatever the scale.
 */
function footOps(area: PlanArea, words: PlanPageWords, measure: Measure): DisplayOp[] {
  const band = footBand(area);
  const length = area.bar.length * area.pointsPerUnit;
  const x0 = band.x + 8;
  const barY = band.y + 19;
  const ops: DisplayOp[] = [
    line([[band.x, band.y], [band.x + band.width, band.y]], INK, BOX_RULE),
    ...text(x0, band.y + 12, words.scale, 'mono', 7.5),
    ...text(x0 + measure(words.scale, 'mono', 7.5) + 10, band.y + 12, words.actualSize, 'sans', 7),
    box({ x: x0, y: barY, width: length / 2, height: 3.5 }, INK, INK, KIT_LINE),
    box({ x: x0 + length / 2, y: barY, width: length / 2, height: 3.5 }, WHITE, INK, KIT_LINE),
    ...text(x0, barY + 13, '0', 'mono', 7, 'center'),
    ...text(x0 + length, barY + 13, area.bar.label, 'mono', 7, 'center'),
  ];
  if (area.noRoom) ops.push(...text(band.x + band.width - 8, band.y + 12, words.noRoom, 'sans', 8, 'right'));
  return ops;
}

/** The plan box: the grid and the drawing, clipped to the drawing's area; the foot band under it; the box's outline. */
function planBoxOps(area: PlanArea, drawing: readonly DisplayOp[], words: PlanPageWords, measure: Measure): DisplayOp[] {
  const d = area.drawing;
  return [
    { op: 'save' },
    { op: 'concat', m: [1, 0, 0, 1, d.x, d.y] },
    { op: 'clip', x: 0, y: 0, width: d.width, height: d.height },
    ...gridOps(area),
    ...drawing,
    { op: 'restore' },
    ...footOps(area, words, measure),
    box(area.box, null, INK),
  ];
}

/** The legend's box with its title band, and its rows. */
function legendOps(page: PlanPage, title: string): DisplayOp[] {
  const b = page.legend.box;
  const ops: DisplayOp[] = [box(b, null, INK), line([[b.x, b.y + LEGEND_TITLE], [b.x + b.width, b.y + LEGEND_TITLE]], INK, BOX_RULE), ...text(b.x + 8, b.y + 11, title.toLocaleUpperCase(), 'monoBold', 7)];
  for (const row of page.legend.rows) for (const piece of row.pieces) ops.push(...text(row.x + piece.x, row.baseline, piece.text, piece.face, row.size));
  return ops;
}

export interface PlanPageWords {
  scale: string;
  /** "Print at actual size (100%)", next to the scale: a viewer's fit-to-page would print the plan off its scale. */
  actualSize: string;
  noRoom: string;
  legend: string;
}

/** A page as the PDF writer takes it: points, landscape, on white. `drawing` is the plan area's, from planDrawing. */
export function planPrintPage(page: PlanPage, drawing: readonly DisplayOp[] | null, words: PlanPageWords, measure: Measure): PrintPage {
  const ops: DisplayOp[] = [...headerOps(page, measure)];
  if (page.plan) ops.push(...planBoxOps(page.plan, drawing ?? [], words, measure));
  ops.push(...legendOps(page, words.legend));
  // A watermark goes inside the plan box (Kevin, Nov 15: planStamp.ts), above its foot band; a legend's own page has none.
  const watermarkRoom = page.plan ? { box: page.plan.box, footTop: footBand(page.plan).y } : null;
  return { format: page.paper, orientation: 'landscape', width: page.size.width, height: page.size.height, background: WHITE, ops, watermarkRoom };
}

/** Where a world point of a plan page lands on the page, points (for the tests: a wall's ends on paper). */
export function onPage(area: PlanArea, x: number, y: number): { x: number; y: number } {
  return apply([area.pointsPerUnit, 0, 0, area.pointsPerUnit, area.drawing.x - area.world.x * area.pointsPerUnit, area.drawing.y - area.world.y * area.pointsPerUnit], x, y);
}

import type * as Fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import { formatDate, t, tn } from '../../core/i18n';
import { focalLabel, frameLens, isPrime } from '../../core/model/cameraGear';
import { sheetFrames } from '../../core/model/callsheet';
import { fieldOfView, oneDecimal } from '../../core/model/fieldOfView';
import { FEET_TO_METRES, roundLengthLabel, formatLength, type PlanUnit } from '../../core/model/length';
import type { Paper } from '../../core/model/paper';
import { PLAN_LAYERS, sceneRoomId, shownItems, type PlanLayer, type ShownItem } from '../../core/model/plan';
import { cameraBody, cameraSetupFrames, cameraTitle, frameCamera, setupCameras } from '../../core/model/planCamera';
import { LAYER_ORDER, layerOfItem } from '../../core/model/planLayers';
import { planLegend, type LegendGroup } from '../../core/model/planLegend';
import type { SbdRecord } from '../../core/model/record';
import { scenesOfFrames } from '../../core/model/schedule';
import { modeLabel } from '../../core/model/sensorModes';
import { frameSetupId, sceneSetups, setupLabel } from '../../core/model/setup';
import { dayLabel, frameDayId, projectShootDays } from '../../core/model/shootDay';
import { aspectRatioValue, projectStoryboard, sceneFields, sceneLabel, SHOT_SIZE_LABEL, shotFields } from '../../core/model/storyboard';
import { fitBoundsOf } from '../../ui/canvas/hitTest';
import { INK } from '../../ui/canvas/paperColours';
import type { CanvasItem, Rect, Size } from '../../ui/canvas/types';
import { unionBounds } from '../../ui/canvas/viewport';
import { cameraLooks } from '../birdseye/plan/cameraLooks';
import { frameItemLabel, iconLabel } from '../birdseye/plan/iconWords';
import { heightText, printedRoomLines, roomLineParts, totalWatts } from '../birdseye/plan/LegendView';
import { groupName } from '../birdseye/plan/library';
import { lightLooks, wattsLabel } from '../birdseye/plan/lightLooks';
import { blockingLooks, characterTitle } from '../birdseye/plan/markLooks';
import { planItemsBuilder } from '../birdseye/plan/planItems';
import { sightsKeeper } from '../birdseye/plan/planSights';
import { planScale, UNITS_PER_METRE } from '../birdseye/plan/planScale';
import { degreesText } from '../birdseye/plan/selectionFields';
import { sunLooks } from '../birdseye/plan/sunLooks';
import { underlayPictures } from '../birdseye/plan/underlayEdits';
import { sheetCompany } from '../callsheets/sheetCompany';
import { board } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';

// A setup's plan on paper (6.10, docs/PHASE6_DECISIONS.md 14), as a model of its pages: worked out from the records,
// pure, so the scale, the layout, the words and the order of a packet's pages are tested without a canvas. The page
// is landscape Letter or A4 in points. A header boxed across the top; under it the plan area, boxed, at the largest
// round scale that shows the setup's extent; a legend column at its right (or a band along its foot when the plan is
// much wider than tall) with the legend by department and the setup's frames and lenses. Legend text that doesn't fit
// goes on to pages of its own, never smaller than 7 pt and never cut. planRender.tsx draws these pages.

type Records = Readonly<Record<string, SbdRecord>>;

/** Landscape paper, points. */
export const LANDSCAPE: Readonly<Record<Paper, Size>> = {
  a4: { width: 841.89, height: 595.28 },
  letter: { width: 792, height: 612 },
};

export const PT_PER_MM = 72 / 25.4;

/** The printed sheet's own white: the page's ground, a door's gap and a label's halo on paper (planRender.tsx). */
export const SHEET = '#FFFFFF';

/** The page's frame, points: the margin round it, the header's height and the gap between boxes. */
export const PAGE_MARGIN = 28;
export const HEADER_HEIGHT = 50;
export const BOX_GAP = 8;
/** A legend column's width, and a legend band's height, points. */
export const LEGEND_WIDTH = 196;
export const LEGEND_BAND_HEIGHT = 156;
/** The title band a legend box has, as a tile's title bar, and the padding inside it, points. */
export const LEGEND_TITLE = 16;
export const LEGEND_PAD = 8;
/** How much wider than tall a plan's extent is before its legend goes along its foot. */
export const WIDE_PLAN = 2.2;
/** The room round the extent, world units (cm): what the edge of the drawing never touches. */
export const EXTENT_MARGIN = 50;
/**
 * The least room round the extent on paper, points, whatever the scale (6.10 review): 50 cm of the room is 28 pt at 1:50
 * but under 3 pt at 1:500, so a margin in world units alone let the drawing run to the box's edge on a large plan.
 */
export const PAPER_MARGIN = 12;
/** The plan box's foot band, points: the scale in words, the bar and any note, under a rule, never over the drawing. */
export const FOOT_BAND = 44;
/** The smallest type on the page, points. */
export const MIN_TYPE = 7;

// The scales (decision 14): the largest that fits. A feet scale is inches of paper to a foot of the room.
export interface PlanPrintScale {
  /** Paper to real: 50 for 1:50, 48 for 1/4" = 1'-0". */
  ratio: number;
  /** As the page prints it: "1:50", 1/4" = 1'-0". */
  label: string;
}

export const METRIC_SCALES: readonly PlanPrintScale[] = [20, 25, 50, 75, 100, 150, 200, 250, 500, 1000].map((ratio) => ({ ratio, label: `1:${String(ratio)}` }));
export const FEET_SCALES: readonly PlanPrintScale[] = (
  [
    ['1"', 12],
    ['3/4"', 16],
    ['1/2"', 24],
    ['3/8"', 32],
    ['1/4"', 48],
    ['3/16"', 64],
    ['1/8"', 96],
    ['1/16"', 192],
    ['1/32"', 384],
  ] as const
).map(([inch, ratio]) => ({ ratio, label: `${inch} = 1'-0"` }));

/** Points of paper per world unit (1 cm of the room) at a scale. */
export const pointsPerUnit = (ratio: number): number => (10 / ratio) * PT_PER_MM;

/**
 * The largest scale from the unit's list at which `extent` (world units) fits `area` (points) with `margin` points (at
 * that scale's points per unit) on every side; the smallest scale on the list when none does (a lot drawn larger than
 * 1:1000 allows is printed at 1:1000, its edges cut by the plan's box, and the export says so: `scaleFits`).
 */
export function chooseScale(extent: Size, area: Size, unit: PlanUnit, margin: (ppu: number) => number = () => 0): PlanPrintScale {
  const list = unit === 'metres' ? METRIC_SCALES : FEET_SCALES;
  return list.find((scale) => scaleFits(extent, area, scale, margin)) ?? (list[list.length - 1] as PlanPrintScale);
}

/** Whether `extent` (world units) fits `area` (points) at a scale, with `margin` points round it. */
export function scaleFits(extent: Size, area: Size, scale: PlanPrintScale, margin: (ppu: number) => number = () => 0): boolean {
  const ppu = pointsPerUnit(scale.ratio);
  const room = 2 * margin(ppu);
  return extent.width * ppu + room <= area.width + 1e-6 && extent.height * ppu + room <= area.height + 1e-6;
}

/** The margin round a plan's extent on paper at `ppu` points per unit: EXTENT_MARGIN of the room, never under PAPER_MARGIN. */
export const marginOnPaper = (ppu: number): number => Math.max(PAPER_MARGIN, EXTENT_MARGIN * ppu);

/** "Scale 1:50", or "Scale 1/4" = 1'-0"". */
export const scaleWords = (scale: PlanPrintScale): string => t('export.plan.scale', { scale: scale.label });

/** What the drawing of a view takes in (world units): every item's box and fit extent, never its far `beyond` reach. */
export function planExtent(items: readonly CanvasItem[]): Rect | null {
  return unionBounds(items.map((item) => fitBoundsOf(item)));
}

/** What a view with nothing drawn shows: 4 m round the origin (5 m with its margin, as before the margin went on paper). */
const EMPTY_EXTENT: Rect = { x: -200, y: -200, width: 400, height: 400 };

/** The extent with its margin in world units (the plan's shape, for whether its legend goes along its foot); a view with nothing drawn shows 5 m round the origin. */
export function paddedExtent(extent: Rect | null): Rect {
  const e = extent ?? EMPTY_EXTENT;
  return { x: e.x - EXTENT_MARGIN, y: e.y - EXTENT_MARGIN, width: e.width + 2 * EXTENT_MARGIN, height: e.height + 2 * EXTENT_MARGIN };
}

// The words.

export type PlanFace = 'sans' | 'sansBold' | 'mono' | 'monoBold';
export const FACE_FONTS: Readonly<Record<PlanFace, { family: string; weight: number }>> = {
  sans: { family: 'Inter Tight', weight: 400 },
  sansBold: { family: 'Inter Tight', weight: 700 },
  mono: { family: 'JetBrains Mono', weight: 400 },
  monoBold: { family: 'JetBrains Mono', weight: 700 },
};

export interface Part {
  text: string;
  face: PlanFace;
}

/** How wide a text is set in a face at a size, points. The app measures with the bundled faces; tests may pass any rule. */
export type Measure = (text: string, face: PlanFace, size: number) => number;

/**
 * Text measured with the very font files the PDF embeds, as pdf-lib measures them (each glyph's advance, no kerning), so a
 * line's runs sit where the PDF sets them: a run in one face ends exactly where the next begins. A face with no file
 * falls back to an estimate (a mono advance of 0.6 em). fontkit is loaded here, when a plan is printed, and never with
 * the export registry, which the app loads at start (6.10 review: exportLazy.test.ts).
 */
export async function fontMeasure(files: Partial<Readonly<Record<PlanFace, Uint8Array>>>): Promise<Measure> {
  // Its build's one export is its default, which its types leave out (they name `create` alone).
  const fontkit = ((await import('@pdf-lib/fontkit')) as unknown as { default: typeof Fontkit }).default;
  const fonts = new Map<PlanFace, Font>();
  for (const [face, bytes] of Object.entries(files) as [PlanFace, Uint8Array | undefined][]) if (bytes) fonts.set(face, fontkit.create(bytes));
  return (text, face, size) => {
    const font = fonts.get(face);
    if (!font) return Array.from(text).length * size * 0.6;
    const advance = font.layout(text).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
    return (advance * size) / font.unitsPerEm;
  };
}

export type LegendKind = 'heading' | 'subheading' | 'line' | 'total' | 'note';

export interface LegendEntry {
  kind: LegendKind;
  parts: readonly Part[];
}

/** Each kind of legend line: its type size, its row's height, and the space before it (not at a column's top), points. */
export const LEGEND_STYLE: Readonly<Record<LegendKind, { size: number; row: number; before: number }>> = {
  heading: { size: 7, row: 10, before: 7 },
  subheading: { size: 8, row: 11, before: 3 },
  line: { size: 8, row: 10.5, before: 0 },
  total: { size: 8, row: 11, before: 7 },
  note: { size: 8, row: 10.5, before: 0 },
};

/** A wrapped line runs on indented this far, points. */
const RUN_ON = 8;

const sans = (text: string): Part => ({ text, face: 'sans' });
const mono = (text: string): Part => ({ text, face: 'mono' });

/**
 * The setup's legend (planLegend), as the Selection tile's reads (LegendView.tsx), line by line. A department's print
 * (6.17) lists only what it draws: the room's lines, then that department's alone (the watts' total with lighting's).
 */
export function legendEntries(records: Records, sceneId: string, setupId: string | null, unit: PlanUnit, department?: PlanLayer): LegendEntry[] {
  const legend = planLegend(records, sceneId, setupId, iconLabel, (fields) => frameItemLabel(fields, unit));
  const out: LegendEntry[] = [];
  const rooms = printedRoomLines(legend.room, unit);
  if (rooms.length > 0 || legend.north !== undefined) {
    out.push({ kind: 'heading', parts: [{ text: t('legend.room'), face: 'monoBold' }] });
    if (legend.north !== undefined) out.push({ kind: 'line', parts: [sans(t('legend.north')), mono(` · ${degreesText(legend.north)}`)] });
    for (const line of rooms) out.push({ kind: 'line', parts: roomLineParts(line).map((part) => (part.mono ? mono(part.text) : sans(part.text))) });
  }
  const groups = PLAN_LAYERS.flatMap((layer): LegendGroup[] => {
    if (department !== undefined && layer !== department) return [];
    const group = legend.groups.find((g) => g.layer === layer);
    if (group) return [group];
    return layer === 'cast' && legend.cast.length > 0 ? [{ layer, lines: [] }] : [];
  });
  for (const group of groups) {
    out.push({ kind: 'heading', parts: [{ text: groupName(group.layer), face: 'monoBold' }] });
    if (group.layer === 'cast') for (const line of legend.cast) out.push({ kind: 'line', parts: [sans(characterTitle(records, line.characterId)), mono(` · ${tn('legend.positions', line.positions)}`)] });
    for (const line of group.lines) {
      const parts: Part[] = [sans(line.label)];
      if (line.count > 1) parts.push(mono(` ${t('legend.count', { count: line.count })}`));
      if (line.height) parts.push(mono(` · ${heightText(line.height, unit)}`));
      if (line.watts !== undefined) parts.push(mono(` · ${line.watts === null ? t('legend.wattsNone') : wattsLabel(line.watts)}`));
      if (line.move !== undefined) parts.push(mono(` · ${t('legend.moves', { length: formatLength(line.move, unit) })}`));
      out.push({ kind: 'line', parts });
    }
  }
  if (legend.watts.lights > 0 && (department === undefined || department === 'lighting')) out.push({ kind: 'total', parts: [{ text: `${t('legend.total')} `, face: 'sansBold' }, { text: totalWatts(legend.watts), face: 'monoBold' }] });
  if (out.length === 0) out.push({ kind: 'note', parts: [sans(t('legend.empty'))] });
  return out;
}

/** A frame's lens as the page prints it: "35 mm", "24–70 at 50 mm", with ", 2×" for a squeeze; null with none. */
export function frameLensText(records: Records, shot: SbdRecord): string | null {
  const fields = shotFields(shot.props);
  const lens = frameLens(records, shot);
  const range = lens?.fields.range ?? null;
  let text: string | null = null;
  if (range && !isPrime(lens?.fields ?? { range: null, squeeze: 1 })) text = fields.lensMm === null ? focalLabel(range) : t('export.plan.zoomAt', { from: range.min, to: range.max, mm: fields.lensMm });
  else if (fields.lensMm !== null) text = t('lens.prime', { mm: fields.lensMm });
  else if (range) text = focalLabel(range);
  const squeeze = lens?.fields.squeeze ?? 1;
  return text !== null && squeeze !== 1 ? t('export.plan.squeezed', { lens: text, squeeze }) : text;
}

/** One frame's line: its shot number as on the slate, its size, its lens and, shot from a camera with a body, its field of view. */
function frameLine(records: Records, shot: SbdRecord, fov: number | null): LegendEntry {
  const fields = shotFields(shot.props);
  const parts: Part[] = [{ text: fields.number, face: 'monoBold' }];
  const lens = frameLensText(records, shot);
  for (const value of [fields.size ? SHOT_SIZE_LABEL[fields.size] : null, lens, fov === null ? null : t('plan.degrees', { value: oneDecimal(fov) })]) if (value) parts.push(mono(` · ${value}`));
  return { kind: 'line', parts };
}

/**
 * The setup's frames by camera (decision 14): each camera's letter and body ("A · Sony FX3, Full frame 16:9"), then its
 * frames in board order, each with its size, lens and field of view; then the setup's frames no camera shoots.
 */
export function frameEntries(records: Records, projectId: string, setupId: string | null): LegendEntry[] {
  if (setupId === null) return [];
  const frames = cameraSetupFrames(records, setupId);
  if (frames.length === 0) return [];
  const aspect = aspectRatioValue(projectStoryboard(records[projectId]?.props).aspectRatio);
  const out: LegendEntry[] = [{ kind: 'heading', parts: [{ text: t('export.plan.frames'), face: 'monoBold' }] }];
  const held = new Map(frames.map((shot) => [shot.id, frameCamera(records, shot.id)]));
  for (const camera of setupCameras(records, setupId)) {
    const own = frames.filter((shot) => held.get(shot.id) === camera.record.id);
    if (own.length === 0) continue;
    const body = cameraBody(records, camera.record);
    const bodyName = typeof body?.record.props.name === 'string' ? body.record.props.name.trim() : '';
    const parts: Part[] = [];
    if (!body) parts.push({ text: `${cameraTitle(records, camera.record.id, iconLabel)} · ${t('plan.camera.noBody')}`, face: 'sansBold' });
    else {
      if (body.fields.letter) parts.push({ text: `${body.fields.letter} · `, face: 'monoBold' });
      parts.push({ text: bodyName === '' ? cameraTitle(records, camera.record.id, iconLabel) : bodyName, face: 'sansBold' });
      if (body.fields.sensorMode !== '') parts.push(sans(`, ${modeLabel(body.fields.sensorMode)}`));
    }
    out.push({ kind: 'subheading', parts });
    for (const shot of own) {
      const fields = shotFields(shot.props);
      const view = body
        ? fieldOfView({
            sensorWidthMm: body.fields.sensorWidthMm,
            sensorHeightMm: body.fields.sensorHeightMm,
            squeeze: frameLens(records, shot)?.fields.squeeze ?? 1,
            focalMm: fields.lensMm,
            aspect,
            onSide: camera.fields.onSide,
          })
        : null;
      out.push(frameLine(records, shot, view?.degrees ?? null));
    }
  }
  const loose = frames.filter((shot) => held.get(shot.id) === null || held.get(shot.id) === undefined);
  if (loose.length > 0) {
    out.push({ kind: 'subheading', parts: [{ text: t('export.plan.noCamera'), face: 'sansBold' }] });
    for (const shot of loose) out.push(frameLine(records, shot, null));
  }
  return out;
}

// Laying the legend out.

export interface PlacedPiece {
  text: string;
  face: PlanFace;
  /** From the row's left, points. */
  x: number;
}

export interface LegendRow {
  kind: LegendKind;
  size: number;
  height: number;
  before: number;
  pieces: readonly PlacedPiece[];
  /** A heading's or a camera's row: never left alone at the foot of a column. */
  keepWithNext: boolean;
}

/** What a heading reads as on the page: mono capitals, as the kit's labels. */
const printedText = (kind: LegendKind, text: string): string => (kind === 'heading' ? text.toLocaleUpperCase() : text);

/** An entry broken into rows `width` wide, by words; a word longer than a row is broken between its letters, so nothing is cut. */
export function wrapEntry(entry: LegendEntry, width: number, measure: Measure): LegendRow[] {
  const style = LEGEND_STYLE[entry.kind];
  const rows: PlacedPiece[][] = [[]];
  let x = 0;
  const newRow = () => {
    rows.push([]);
    x = RUN_ON;
  };
  const place = (text: string, face: PlanFace) => {
    const row = rows[rows.length - 1] as PlacedPiece[];
    const last = row[row.length - 1];
    // Runs of one face stay one piece, so a line is set as the words were written, kerning and all.
    if (last && last.face === face) last.text += text;
    else row.push({ text, face, x });
    x += measure(text, face, style.size);
  };
  for (const part of entry.parts) {
    const text = printedText(entry.kind, part.text);
    for (const token of text.split(/(\s+)/)) {
      if (token === '') continue;
      const blank = /^\s+$/.test(token);
      const w = measure(token, part.face, style.size);
      const row = rows[rows.length - 1] as PlacedPiece[];
      if (blank) {
        // A space at the start of a run-on row is dropped.
        if (row.length > 0 && x + w <= width) place(token, part.face);
        else if (row.length > 0) newRow();
        continue;
      }
      if (x + w > width + 1e-6 && row.length > 0) newRow();
      if (x + w <= width + 1e-6) {
        place(token, part.face);
        continue;
      }
      // Longer than a whole row: letter by letter.
      for (const letter of Array.from(token)) {
        const lw = measure(letter, part.face, style.size);
        if (x + lw > width + 1e-6 && (rows[rows.length - 1] as PlacedPiece[]).length > 0) newRow();
        place(letter, part.face);
      }
    }
  }
  const kept = rows.filter((row) => row.length > 0);
  return (kept.length > 0 ? kept : [[]]).map((pieces, i) => ({
    kind: entry.kind,
    size: style.size,
    height: style.row,
    before: i === 0 ? style.before : 0,
    pieces: trimEnd(pieces),
    keepWithNext: entry.kind === 'heading' || entry.kind === 'subheading' || i < kept.length - 1,
  }));
}

/** A row's pieces with the spaces at its end taken off. */
function trimEnd(pieces: readonly PlacedPiece[]): PlacedPiece[] {
  const out = pieces.map((p) => ({ ...p }));
  const last = out[out.length - 1];
  if (last) last.text = last.text.replace(/\s+$/, '');
  return out.filter((p) => p.text !== '');
}

export interface PlacedRow extends LegendRow {
  /** Where its baseline is on the page, and its left edge, points. */
  x: number;
  baseline: number;
}

/**
 * Rows flowed down columns (page points), each column filled before the next; a heading never ends a column with
 * nothing of its own under it. Returns the rows each column took and what is left.
 */
export function flowRows(rows: readonly LegendRow[], columns: readonly Rect[]): { placed: PlacedRow[][]; rest: LegendRow[] } {
  const placed: PlacedRow[][] = columns.map(() => []);
  let at = 0;
  for (let c = 0; c < columns.length && at < rows.length; c += 1) {
    const column = columns[c] as Rect;
    let used = 0;
    const into = placed[c] as PlacedRow[];
    while (at < rows.length) {
      const row = rows[at] as LegendRow;
      const before = into.length === 0 ? 0 : row.before;
      // A row kept with the next one goes only where the next fits too (a heading with its first line), and on down a
      // chain of them: "FRAMES", then a camera's subheading, then its first frame, so no heading ends a column alone.
      // A chain taller than a whole column can't be kept together: then only the next row is. A whole column is a fresh
      // one, where the chain has no space before it (6.10 review, round two): measured with it, a chain that fits the
      // next column whole was split here, its heading and subheading at this column's foot.
      let need = before + row.height;
      for (let k = at; (rows[k] as LegendRow).keepWithNext && k + 1 < rows.length; k += 1) {
        const next = rows[k + 1] as LegendRow;
        need += next.before + next.height;
      }
      if (need - before > column.height + 1e-6 && row.keepWithNext) {
        const next = rows[at + 1];
        need = before + row.height + (next ? next.before + next.height : 0);
      }
      // An empty column always takes a row, so a row taller than any column still prints (and the flow always ends).
      if (used + need > column.height + 1e-6 && into.length > 0) break;
      used += before;
      into.push({ ...row, x: column.x, baseline: column.y + used + row.height * 0.72 });
      used += row.height;
      at += 1;
    }
  }
  return { placed, rest: rows.slice(at) };
}

// The pages.

export interface PlanView {
  sceneId: string;
  setupId: string | null;
  /** The day a shoot-day packet prints for: its header names it. */
  dayId?: string | null;
  /** A department's print (6.17): the room, and that department's items alone. Absent: everything, as before. */
  department?: PlanLayer;
}

export interface PlanHeader {
  project: string;
  company: string | null;
  /** "SC 04 · INT. DINER — DAY". */
  slate: string;
  /** "Setup 2 · Window side"; null for a scene with no setup. */
  setup: string | null;
  /** "Day 2 · Tue, Nov 17", several joined; null for none. */
  days: string | null;
  /** "Printed Nov 14, 2026". */
  printed: string;
  /** "Page 1 of 3", once the whole PDF's pages are known. */
  page: string;
  /** "SC 04 · Setup 2 legend, continued" on a legend's own page; null on a plan's page. */
  continued: string | null;
}

export interface PlanArea {
  /** The plan's box on the page, points: the drawing over its foot band. */
  box: Rect;
  /** Where the drawing is on the page, points: the box above its foot band (FOOT_BAND), so nothing on the band covers the plan. */
  drawing: Rect;
  /** What of the room it shows: the drawing's size at the scale, centred on the extent, world units. */
  world: Rect;
  scale: PlanPrintScale;
  pointsPerUnit: number;
  /** The view's items for the page: every layer, nothing selected, the underlay dimmed (or left out). */
  items: readonly CanvasItem[];
  /** The scale bar's round length, world units, and its label ("2 m"). */
  bar: { length: number; label: string };
  /** The grid's step, world units: 1 m or 1 ft, wider where that would print closer than GRID_LEAST_MM; null without a grid. */
  grid: number | null;
  /** A view whose scene has no room drawn (its items print, with the note). */
  noRoom: boolean;
  /** The extent is larger than the page at the smallest scale: its edges are cut by the box, and the export says so. */
  cut: boolean;
}

export interface PlanPage {
  paper: Paper;
  size: Size;
  header: PlanHeader;
  plan: PlanArea | null;
  /** The legend's box and the rows it holds on this page (the whole content area on a legend's own page). */
  legend: { box: Rect; rows: readonly PlacedRow[] };
  /** The view's legend ran past MAX_LEGEND_PAGES pages of its own: what is left isn't printed, and the export says so. */
  legendCut: boolean;
}

/** How many pages of its own a view's legend may run on to; past it the export stops and warns, never silently. */
export const MAX_LEGEND_PAGES = 50;

export interface PlanPrintOptions {
  paper: Paper;
  unit: PlanUnit;
  /** Print the room's underlay, dimmed (an export choice, on by default). */
  underlay: boolean;
  /** Print the light 1 m (1 ft) grid (an export choice, on by default). */
  grid: boolean;
  /** The project's title, as the files are named. */
  title: string;
  now: Date;
  /** Each sun path's location's zone where it has none of its own, by sun id (as the plan reads them); none known: "No time zone". */
  zones: ReadonlyMap<string, string | null>;
  measure: Measure;
  /** How many pages of its own a legend may run on to (MAX_LEGEND_PAGES; fewer in a test). */
  maxLegendPages?: number;
}

/** The least spacing a grid prints at, mm: closer than this, its step is widened (2, 5, 10…). */
export const GRID_LEAST_MM = 2.5;

/** The grid's step, world units, at a scale: 1 m (or 1 ft), widened by 2, 5, 10… until its lines are GRID_LEAST_MM apart. */
export function gridStep(unit: PlanUnit, ppu: number): number {
  const base = unit === 'metres' ? UNITS_PER_METRE : FEET_TO_METRES * UNITS_PER_METRE;
  for (const times of [1, 2, 5, 10, 20, 50, 100]) if (base * times * ppu >= GRID_LEAST_MM * PT_PER_MM) return base * times;
  return base * 100;
}

/** The scale bar's length: the longest round length no longer than a quarter of the plan's box, and no more than 150 pt. */
export function scaleBar(unit: PlanUnit, ppu: number, boxWidth: number): { length: number; label: string } {
  const rounds = planScale(unit).rounds;
  const room = Math.min(boxWidth / 4, 150);
  const fit = [...rounds].reverse().find((r) => r * ppu <= room) ?? rounds[0] ?? 100;
  return { length: fit, label: roundLengthLabel(fit / UNITS_PER_METRE, unit) };
}

/** A view's items as the page draws them: as the screen's, with every layer, nothing selected, the underlay dimmed or left out. */
export function printItems(records: Records, view: PlanView, unit: PlanUnit, zones: ReadonlyMap<string, string | null>, underlay: boolean): readonly CanvasItem[] {
  const all = departmentItems(records, shownItems(records, view.sceneId, view.setupId), view.department);
  const shown: readonly ShownItem[] = underlay ? all : all.filter((item) => item.fields.kind !== 'underlay');
  const none: readonly string[] = [];
  const planView = { sceneId: view.sceneId, setupId: view.setupId };
  const looks = cameraLooks(records, shown, unit, none);
  const lights = lightLooks(records, shown, unit, none);
  const blocking = blockingLooks(records, planView, shown, unit, none);
  // Walls stop cones and beams on paper as on the screen (6.18), from the same shapes: the room's walls print in every
  // department's print (they are the room), and they cut there too.
  const sights = sightsKeeper()(shown, shown, looks, lights, blocking.marks);
  const items = planItemsBuilder()(shown, unit, INK, undefined, looks, lights, sunLooks(records, shown, zones, none), blocking, undefined, underlayPictures(records, shown), sights);
  // Layers are this computer's focus view (6.8): none is read; the underlay is drawn dimmed, as a traced plan prints. On a
  // department's print (Kevin, Nov 15) the set pieces, the cameras and the cast marks another department's page shows as
  // context are dimmed too, by the canvas core's one dim (DIM_OPACITY), cones, paths and labels with them.
  const byId = new Map(shown.map((s) => [s.record.id, s]));
  return items.map((item) => {
    const own = byId.get(item.id);
    const dimmed = own !== undefined && (own.fields.kind === 'underlay' || isDimmedContext(records, own, view.department));
    return dimmed ? { ...item, dim: true } : item;
  });
}

/** The days a view's frames are in, in the days' order ("Day 2 · Tue, Nov 17"); the packet's own day alone for a day's packet. */
function viewDays(records: Records, projectId: string, view: PlanView): string | null {
  const days = projectShootDays(records, projectId);
  if (view.dayId) {
    const day = days.find((d) => d.record.id === view.dayId);
    return day ? dayLabel(day) : null;
  }
  if (view.setupId === null) return null;
  const ids = new Set(cameraSetupFrames(records, view.setupId).flatMap((shot) => frameDayId(records, shot) ?? []));
  const labels = days.filter((d) => ids.has(d.record.id)).map((d) => dayLabel(d));
  return labels.length === 0 ? null : labels.join('; ');
}

/** The header's words for a view, the page number still to come. */
export function planHeader(records: Records, projectId: string, view: PlanView, title: string, now: Date): PlanHeader {
  const scene = records[view.sceneId];
  const fields = sceneFields(scene?.props ?? {});
  const setup = view.setupId === null ? undefined : sceneSetups(records, view.sceneId).find((s) => s.record.id === view.setupId);
  const company = sheetCompany(records, projectId)?.name ?? '';
  return {
    project: title,
    company: company === '' ? null : company,
    slate: `${sceneLabel(fields.number)} · ${headingOf(fields)}`,
    // A department's print names it after the setup (6.17): "Setup 2 · Lighting"; a scene with no setup, by itself.
    setup: view.department === undefined ? (setup ? setupLabel(setup) : null) : setup ? `${setupLabel(setup)} · ${groupName(view.department)}` : groupName(view.department),
    days: viewDays(records, projectId, view),
    printed: t('export.plan.printed', { date: formatDate(now, { year: 'numeric', month: 'short', day: 'numeric' }) }),
    page: '',
    continued: null,
  };
}

/** The content area under the header, points. */
const contentOf = (size: Size): Rect => ({
  x: PAGE_MARGIN,
  y: PAGE_MARGIN + HEADER_HEIGHT + BOX_GAP,
  width: size.width - 2 * PAGE_MARGIN,
  height: size.height - 2 * PAGE_MARGIN - HEADER_HEIGHT - BOX_GAP,
});

/** The columns of LEGEND_WIDTH a box holds, each its inner area under the title band. */
function columnsIn(box: Rect): Rect[] {
  const inner = { x: box.x + LEGEND_PAD, y: box.y + LEGEND_TITLE + LEGEND_PAD / 2, width: box.width - 2 * LEGEND_PAD, height: box.height - LEGEND_TITLE - LEGEND_PAD };
  const width = LEGEND_WIDTH - 2 * LEGEND_PAD;
  const count = Math.max(1, Math.floor((inner.width + 2 * LEGEND_PAD) / (width + 2 * LEGEND_PAD)));
  return Array.from({ length: count }, (_, i) => ({ x: inner.x + i * (width + 2 * LEGEND_PAD), y: inner.y, width, height: inner.height }));
}

/** One view's pages: its plan's, then as many of its legend's own as what didn't fit needs. Page numbers come later. */
export function viewPages(records: Records, projectId: string, view: PlanView, options: PlanPrintOptions): PlanPage[] {
  const size = LANDSCAPE[options.paper];
  const content = contentOf(size);
  const items = printItems(records, view, options.unit, options.zones, options.underlay);
  const drawn = planExtent(items) ?? EMPTY_EXTENT;
  const padded = paddedExtent(drawn);
  const wide = padded.width / padded.height > WIDE_PLAN;
  const planBox: Rect = wide
    ? { x: content.x, y: content.y, width: content.width, height: content.height - LEGEND_BAND_HEIGHT - BOX_GAP }
    : { x: content.x, y: content.y, width: content.width - LEGEND_WIDTH - BOX_GAP, height: content.height };
  const legendBox: Rect = wide
    ? { x: content.x, y: planBox.y + planBox.height + BOX_GAP, width: content.width, height: LEGEND_BAND_HEIGHT }
    : { x: planBox.x + planBox.width + BOX_GAP, y: content.y, width: LEGEND_WIDTH, height: content.height };
  // The drawing takes the box above its foot band; the extent is fitted into that, with its margin on paper.
  const drawing: Rect = { x: planBox.x, y: planBox.y, width: planBox.width, height: planBox.height - FOOT_BAND };
  const scale = chooseScale(drawn, drawing, options.unit, marginOnPaper);
  const ppu = pointsPerUnit(scale.ratio);
  const world = {
    width: drawing.width / ppu,
    height: drawing.height / ppu,
    x: drawn.x + drawn.width / 2 - drawing.width / ppu / 2,
    y: drawn.y + drawn.height / 2 - drawing.height / ppu / 2,
  };
  const header = planHeader(records, projectId, view, options.title, options.now);
  // The frames and their lenses are the camera department's: on its print and on everything's, never on another's (6.17).
  const frames = view.department === undefined || view.department === 'camera' ? frameEntries(records, projectId, view.setupId) : [];
  const entries = [...legendEntries(records, view.sceneId, view.setupId, options.unit, view.department), ...frames];
  const rows = entries.flatMap((entry) => wrapEntry(entry, LEGEND_WIDTH - 2 * LEGEND_PAD, options.measure));
  const first = flowRows(rows, columnsIn(legendBox));
  const pages: PlanPage[] = [
    {
      paper: options.paper,
      size,
      header,
      plan: {
        box: planBox,
        drawing,
        world,
        scale,
        pointsPerUnit: ppu,
        items,
        bar: scaleBar(options.unit, ppu, planBox.width),
        grid: options.grid ? gridStep(options.unit, ppu) : null,
        noRoom: sceneRoomId(records, records[view.sceneId]) === null,
        // Cut only when the extent itself doesn't fit the drawing (6.10 review, round two): the paper margin is
        // wanted room round it, not part of it, so a lot that fits without its margin is printed whole.
        cut: !scaleFits(drawn, drawing, scale),
      },
      legend: { box: legendBox, rows: first.placed.flat() },
      legendCut: false,
    },
  ];
  let rest = first.rest;
  const what = header.setup === null ? sceneLabel(sceneFields(records[view.sceneId]?.props ?? {}).number) : `${sceneLabel(sceneFields(records[view.sceneId]?.props ?? {}).number)} · ${header.setup}`;
  // Whatever didn't fit goes on, page after page, in columns across the whole content area: never shrunk, never cut.
  // A legend longer than MAX_LEGEND_PAGES pages (thousands of lines) stops there, marked, so the export warns.
  const most = options.maxLegendPages ?? MAX_LEGEND_PAGES;
  for (let guard = 0; rest.length > 0 && guard < most; guard += 1) {
    const flowed = flowRows(rest, columnsIn(content));
    if (flowed.rest.length === rest.length) break;
    pages.push({ paper: options.paper, size, header: { ...header, continued: t('export.plan.legendContinued', { what }) }, plan: null, legend: { box: content, rows: flowed.placed.flat() }, legendCut: false });
    rest = flowed.rest;
  }
  if (rest.length > 0) {
    const last = pages[pages.length - 1] as PlanPage;
    pages[pages.length - 1] = { ...last, legendCut: true };
  }
  return pages;
}

/** Every view's pages in order, numbered "Page n of m" across the whole PDF. */
export function planPages(records: Records, projectId: string, views: readonly PlanView[], options: PlanPrintOptions): PlanPage[] {
  const pages = views.flatMap((view) => viewPages(records, projectId, view, options));
  return pages.map((page, i) => ({ ...page, header: { ...page.header, page: t('export.plan.page', { page: i + 1, pages: pages.length }) } }));
}

// The packets.

/**
 * Whether a view has a page to print (6.10 review, round two: one rule everywhere): something drawn (its scene's room,
 * or an item the view shows) or a frame to list. Only a page with neither is left out, so forty scenes with three plans
 * aren't forty blank pages, while a setup with frames and no room still prints its frames, "No room drawn" on it.
 */
export function viewHasPage(records: Records, view: PlanView): boolean {
  const scene = records[view.sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return false;
  if (sceneRoomId(records, scene) !== null || shownItems(records, view.sceneId, view.setupId).length > 0) return true;
  return view.setupId !== null && cameraSetupFrames(records, view.setupId).length > 0;
}

/** What a packet left out by viewHasPage: setups, and scenes with no setup, with nothing drawn and no frames. */
export interface LeftOut {
  setups: number;
  scenes: number;
}

/** The views with a page to print, in order, and how many were left out (the export says so). */
export function printableViews(records: Records, candidates: readonly PlanView[]): { views: PlanView[]; leftOut: LeftOut } {
  const views: PlanView[] = [];
  const leftOut: LeftOut = { setups: 0, scenes: 0 };
  for (const view of candidates) {
    if (viewHasPage(records, view)) views.push(view);
    else if (view.setupId === null) leftOut.scenes += 1;
    else leftOut.setups += 1;
  }
  return { views, leftOut };
}

/** A scene's possible pages (decision 14): one per live setup in setup order; a scene with no setup, one of its room and blocking. */
export function sceneCandidates(records: Records, sceneId: string): PlanView[] {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return [];
  const setups = sceneSetups(records, sceneId);
  return setups.length === 0 ? [{ sceneId, setupId: null }] : setups.map((setup) => ({ sceneId, setupId: setup.record.id }));
}

/** A scene's packet: its possible pages with a page to print (viewHasPage). */
export const scenePlanViews = (records: Records, sceneId: string): PlanView[] => printableViews(records, sceneCandidates(records, sceneId)).views;

/** Every scene's possible pages in scene order (Export Project's whole project). */
export const projectCandidates = (records: Records, projectId: string): PlanView[] => board(records, projectId).flatMap((scene) => sceneCandidates(records, scene.record.id));

/** Every scene's packet in scene order, the pages with nothing drawn and no frames left out. */
export const projectPlanViews = (records: Records, projectId: string): PlanView[] => printableViews(records, projectCandidates(records, projectId)).views;

/**
 * A shoot day's packet (decision 14): every setup with a Need-to-shoot frame on the day, in the order the call sheet
 * lists the day's scenes (sheetFrames, scenesOfFrames: board order), then by setup number; each page names the day.
 * Every one prints (Kevin: "every setup with a frame that day"): it has frames to list, drawn or not.
 */
export function dayPlanViews(records: Records, projectId: string, dayId: string): PlanView[] {
  const frames = sheetFrames(records, projectId, dayId);
  const inDay = new Set(frames.flatMap(({ shot }) => frameSetupId(records, shot) ?? []));
  return scenesOfFrames(frames).flatMap((scene) =>
    sceneSetups(records, scene.id)
      .filter((setup) => inDay.has(setup.record.id))
      .map((setup): PlanView => ({ sceneId: scene.id, setupId: setup.record.id, dayId })),
  );
}

// Per-department prints (6.17, Kevin, Nov 14).

/** What the Departments choice prints: everything (as before), one department's print, or each department's. */
export type PlanDepartments = 'everything' | 'each' | PlanLayer;

/** The departments a plan can print for, in the Layers tile's order (call-sheet order): every layer the model has. */
export const PRINT_DEPARTMENTS: readonly PlanLayer[] = LAYER_ORDER;

/**
 * The room's own items a department's print always shows, in full: its walls, doors and windows, its underlay (drawn
 * dimmed as a traced plan prints, in printItems), north and the sun path (isContext). The set pieces, the cameras and
 * the cast marks every other department's page shows dimmed (DIMMED_CONTEXT). Everything else prints only on its own
 * department's page.
 */
const ROOM_CONTEXT: ReadonlySet<string> = new Set(['wall', 'door', 'window', 'underlay', 'north', 'sun']);

const isRoomContext = (item: ShownItem): boolean => ROOM_CONTEXT.has(item.fields.kind);

/**
 * An item every department's print shows as context, in full: the room's own (ROOM_CONTEXT), and (6.17 review) an item
 * with no layer (layerOfItem null: an icon a newer version wrote), which the screen always draws, so no page leaves it
 * out. Context never gives a department a page (departmentHasItems), and the legend of another department's print lists
 * none of it (legendEntries keeps to the department's own group).
 */
const isContext = (records: Records, item: ShownItem): boolean => isRoomContext(item) || layerOfItem(records, item.record) === null;

/**
 * The layers every department's print shows as dimmed context: the cameras with their cones and the cast marks with their
 * paths (Kevin, Nov 15), and the set pieces, wherever they sit, room plan or one setup only (Kevin, Nov 15 night). On their
 * own department's print (camera, cast, set-art) they are its items, in full. Like the rest of the context they never give
 * a department a page.
 */
const DIMMED_CONTEXT: ReadonlySet<string> = new Set<PlanLayer>(['camera', 'cast', 'set-art']);

/** Whether an item prints dimmed on a department's print: a camera, a cast mark or a set piece on another department's page. */
function isDimmedContext(records: Records, item: ShownItem, department: PlanLayer | undefined): boolean {
  if (department === undefined || isRoomContext(item)) return false;
  const layer = layerOfItem(records, item.record);
  return layer !== null && layer !== department && DIMMED_CONTEXT.has(layer);
}

/**
 * A view's items for a department's print: the context (isContext), the set pieces, cameras and cast marks as dimmed
 * context (isDimmedContext), and the items whose layer is the department's, by the very function the Layers tile goes by
 * (layerOfItem); the others left out entirely. No department: all of them.
 */
export function departmentItems(records: Records, shown: readonly ShownItem[], department: PlanLayer | undefined): readonly ShownItem[] {
  if (department === undefined) return shown;
  return shown.filter((item) => isContext(records, item) || isDimmedContext(records, item, department) || layerOfItem(records, item.record) === department);
}

/** Whether a department has anything of its own in a view (the room's items aside): a department with nothing is skipped. */
export function departmentHasItems(records: Records, view: PlanView, department: PlanLayer): boolean {
  return shownItems(records, view.sceneId, view.setupId).some((item) => !isRoomContext(item) && layerOfItem(records, item.record) === department);
}

/**
 * The views a Departments choice prints, from the views everything would print: the same views for everything; for one
 * department, each view it has something in; for each department, every view's departments with something in it, view
 * by view in the layers' order, and no "everything" page.
 */
export function departmentViews(records: Records, views: readonly PlanView[], departments: PlanDepartments): PlanView[] {
  if (departments === 'everything') return [...views];
  const wanted = departments === 'each' ? PRINT_DEPARTMENTS : [departments];
  return views.flatMap((view) => wanted.filter((department) => departmentHasItems(records, view, department)).map((department): PlanView => ({ ...view, department })));
}

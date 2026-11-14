import fontkit from '@pdf-lib/fontkit';
import { formatDate, t, tn } from '../../core/i18n';
import { focalLabel, frameLens, isPrime } from '../../core/model/cameraGear';
import { sheetFrames } from '../../core/model/callsheet';
import { fieldOfView, oneDecimal } from '../../core/model/fieldOfView';
import { FEET_TO_METRES, roundLengthLabel, formatLength, type PlanUnit } from '../../core/model/length';
import type { Paper } from '../../core/model/paper';
import { PLAN_LAYERS, sceneRoomId, shownItems, type ShownItem } from '../../core/model/plan';
import { cameraBody, cameraSetupFrames, cameraTitle, frameCamera, setupCameras } from '../../core/model/planCamera';
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
 * The largest scale from the unit's list at which `extent` (world units) fits `area` (points); the smallest scale on the
 * list when none does (a lot drawn larger than 1:1000 allows is printed at 1:1000, its edges cut by the plan's box).
 */
export function chooseScale(extent: Size, area: Size, unit: PlanUnit): PlanPrintScale {
  const list = unit === 'metres' ? METRIC_SCALES : FEET_SCALES;
  const fits = list.find((scale) => extent.width * pointsPerUnit(scale.ratio) <= area.width + 1e-6 && extent.height * pointsPerUnit(scale.ratio) <= area.height + 1e-6);
  return fits ?? (list[list.length - 1] as PlanPrintScale);
}

/** "Scale 1:50", or "Scale 1/4" = 1'-0"". */
export const scaleWords = (scale: PlanPrintScale): string => t('export.plan.scale', { scale: scale.label });

/** What the drawing of a view takes in (world units): every item's box and fit extent, never its far `beyond` reach. */
export function planExtent(items: readonly CanvasItem[]): Rect | null {
  return unionBounds(items.map((item) => fitBoundsOf(item)));
}

/** The extent with its margin; a view with nothing drawn shows 5 m round the origin. */
export function paddedExtent(extent: Rect | null): Rect {
  if (!extent) return { x: -250, y: -250, width: 500, height: 500 };
  return { x: extent.x - EXTENT_MARGIN, y: extent.y - EXTENT_MARGIN, width: extent.width + 2 * EXTENT_MARGIN, height: extent.height + 2 * EXTENT_MARGIN };
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
 * falls back to an estimate (a mono advance of 0.6 em).
 */
export function fontMeasure(files: Partial<Readonly<Record<PlanFace, Uint8Array>>>): Measure {
  const fonts = new Map<PlanFace, ReturnType<typeof fontkit.create>>();
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

/** The setup's legend (planLegend), as the Selection tile's reads (LegendView.tsx), line by line. */
export function legendEntries(records: Records, sceneId: string, setupId: string | null, unit: PlanUnit): LegendEntry[] {
  const legend = planLegend(records, sceneId, setupId, iconLabel, (fields) => frameItemLabel(fields, unit));
  const out: LegendEntry[] = [];
  const rooms = printedRoomLines(legend.room, unit);
  if (rooms.length > 0 || legend.north !== undefined) {
    out.push({ kind: 'heading', parts: [{ text: t('legend.room'), face: 'monoBold' }] });
    if (legend.north !== undefined) out.push({ kind: 'line', parts: [sans(t('legend.north')), mono(` · ${degreesText(legend.north)}`)] });
    for (const line of rooms) out.push({ kind: 'line', parts: roomLineParts(line).map((part) => (part.mono ? mono(part.text) : sans(part.text))) });
  }
  const groups = PLAN_LAYERS.flatMap((layer): LegendGroup[] => {
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
  if (legend.watts.lights > 0) out.push({ kind: 'total', parts: [{ text: `${t('legend.total')} `, face: 'sansBold' }, { text: totalWatts(legend.watts), face: 'monoBold' }] });
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
      // A row kept with the next one goes only where the next fits too (a heading with its first line).
      let need = before + row.height;
      if (row.keepWithNext) {
        const next = rows[at + 1];
        if (next) need += next.before + next.height;
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
  /** The plan's box on the page, points. */
  box: Rect;
  /** What of the room it shows: the box's size at the scale, centred on the extent, world units. */
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
}

export interface PlanPage {
  paper: Paper;
  size: Size;
  header: PlanHeader;
  plan: PlanArea | null;
  /** The legend's box and the rows it holds on this page (the whole content area on a legend's own page). */
  legend: { box: Rect; rows: readonly PlacedRow[] };
}

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
  const all = shownItems(records, view.sceneId, view.setupId);
  const shown: ShownItem[] = underlay ? all : all.filter((item) => item.fields.kind !== 'underlay');
  const none: readonly string[] = [];
  const planView = { sceneId: view.sceneId, setupId: view.setupId };
  const items = planItemsBuilder()(
    shown,
    unit,
    INK,
    undefined,
    cameraLooks(records, shown, unit, none),
    lightLooks(records, shown, unit, none),
    sunLooks(records, shown, zones, none),
    blockingLooks(records, planView, shown, unit, none),
    undefined,
    underlayPictures(records, shown),
  );
  // Layers are this computer's focus view (6.8): none is read; the underlay is drawn dimmed, as a traced plan prints.
  return items.map((item) => (shown.find((s) => s.record.id === item.id)?.fields.kind === 'underlay' ? { ...item, dim: true } : item));
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
    setup: setup ? setupLabel(setup) : null,
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
  const extent = paddedExtent(planExtent(items));
  const wide = extent.width / extent.height > WIDE_PLAN;
  const planBox: Rect = wide
    ? { x: content.x, y: content.y, width: content.width, height: content.height - LEGEND_BAND_HEIGHT - BOX_GAP }
    : { x: content.x, y: content.y, width: content.width - LEGEND_WIDTH - BOX_GAP, height: content.height };
  const legendBox: Rect = wide
    ? { x: content.x, y: planBox.y + planBox.height + BOX_GAP, width: content.width, height: LEGEND_BAND_HEIGHT }
    : { x: planBox.x + planBox.width + BOX_GAP, y: content.y, width: LEGEND_WIDTH, height: content.height };
  const scale = chooseScale(extent, planBox, options.unit);
  const ppu = pointsPerUnit(scale.ratio);
  const world = {
    width: planBox.width / ppu,
    height: planBox.height / ppu,
    x: extent.x + extent.width / 2 - planBox.width / ppu / 2,
    y: extent.y + extent.height / 2 - planBox.height / ppu / 2,
  };
  const header = planHeader(records, projectId, view, options.title, options.now);
  const entries = [...legendEntries(records, view.sceneId, view.setupId, options.unit), ...frameEntries(records, projectId, view.setupId)];
  const rows = entries.flatMap((entry) => wrapEntry(entry, LEGEND_WIDTH - 2 * LEGEND_PAD, options.measure));
  const first = flowRows(rows, columnsIn(legendBox));
  const pages: PlanPage[] = [
    {
      paper: options.paper,
      size,
      header,
      plan: {
        box: planBox,
        world,
        scale,
        pointsPerUnit: ppu,
        items,
        bar: scaleBar(options.unit, ppu, planBox.width),
        grid: options.grid ? gridStep(options.unit, ppu) : null,
        noRoom: sceneRoomId(records, records[view.sceneId]) === null,
      },
      legend: { box: legendBox, rows: first.placed.flat() },
    },
  ];
  let rest = first.rest;
  const what = header.setup === null ? sceneLabel(sceneFields(records[view.sceneId]?.props ?? {}).number) : `${sceneLabel(sceneFields(records[view.sceneId]?.props ?? {}).number)} · ${header.setup}`;
  // Whatever didn't fit goes on, page after page, in columns across the whole content area: never shrunk, never cut.
  for (let guard = 0; rest.length > 0 && guard < 50; guard += 1) {
    const flowed = flowRows(rest, columnsIn(content));
    if (flowed.rest.length === rest.length) break;
    pages.push({ paper: options.paper, size, header: { ...header, continued: t('export.plan.legendContinued', { what }) }, plan: null, legend: { box: content, rows: flowed.placed.flat() } });
    rest = flowed.rest;
  }
  return pages;
}

/** Every view's pages in order, numbered "Page n of m" across the whole PDF. */
export function planPages(records: Records, projectId: string, views: readonly PlanView[], options: PlanPrintOptions): PlanPage[] {
  const pages = views.flatMap((view) => viewPages(records, projectId, view, options));
  return pages.map((page, i) => ({ ...page, header: { ...page.header, page: t('export.plan.page', { page: i + 1, pages: pages.length }) } }));
}

// The packets.

/** A scene's packet (decision 14): a page per live setup in setup order; a scene with no setup, one of its room and blocking. */
export function scenePlanViews(records: Records, sceneId: string): PlanView[] {
  const setups = sceneSetups(records, sceneId);
  return setups.length === 0 ? [{ sceneId, setupId: null }] : setups.map((setup) => ({ sceneId, setupId: setup.record.id }));
}

/**
 * Every scene's packet in scene order (Export Project's whole project). A scene with no setup and nothing drawn has no
 * plan to print and is left out, so forty scenes with three plans aren't forty pages.
 */
export function projectPlanViews(records: Records, projectId: string): PlanView[] {
  return board(records, projectId).flatMap((scene) => {
    const id = scene.record.id;
    if (sceneSetups(records, id).length === 0 && shownItems(records, id, null).length === 0) return [];
    return scenePlanViews(records, id);
  });
}

/**
 * A shoot day's packet (decision 14): every setup with a Need-to-shoot frame on the day, in the order the call sheet
 * lists the day's scenes (sheetFrames, scenesOfFrames: board order), then by setup number; each page names the day.
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

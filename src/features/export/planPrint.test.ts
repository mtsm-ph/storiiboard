import { readFileSync } from 'node:fs';
import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { sceneRoomId, shownItems, startRoomChanges, type PlanLayer } from '../../core/model/plan';
import { PLAIN_MARK_SIZE, placeMarkChanges } from '../../core/model/planBlocking';
import { assignFrameChanges, cameraBodyChanges } from '../../core/model/planCamera';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { DIM_OPACITY } from '../../ui/canvas/ItemNodes';
import { RAISED } from '../../ui/canvas/paperColours';
import type { CanvasItem } from '../../ui/canvas/types';
import { iconShapesOf } from '../birdseye/plan/iconDraw';
import { setLayerShow, showAllLayers } from '../birdseye/plan/layersStore';
import { drawWallsChanges, openingProps, placeIconChanges } from '../birdseye/plan/planItems';
import { arcCubics, displayOps, parsePathData, parsePaint, wedgeTurn, type DisplayOp, type Matrix, type PrintNode, type Segment } from './deckDisplay';
import { paintOps } from './displayPaint';
import { leftOutWords, planDayPdf, planExportName, planPageWarnings, planScenePdf, planSetupPdf, planSetupPng, type PlanTarget } from './planExport';
import { writeDeckPdf, type FontLoader, type PictureLoader, type PrintPage } from './deckPdfWriter';
import {
  chooseScale,
  dayPlanViews,
  departmentViews,
  flowRows,
  fontMeasure,
  HEADER_HEIGHT,
  LANDSCAPE,
  LEGEND_STYLE,
  marginOnPaper,
  PAGE_MARGIN,
  PAPER_MARGIN,
  planExtent,
  projectPlanViews,
  planPages,
  pointsPerUnit,
  PT_PER_MM,
  scaleFits,
  scenePlanViews,
  wrapEntry,
  type LegendRow,
  type PlanArea,
  type PlanPage,
  type PlanPrintOptions,
  type PlanView,
} from './planPages';
import { footBand, HALO_POINTS, HAIRLINE, KIT_LINE, onPage, planPrintPage, printWeights, printZoom, PRINT_COLOURS } from './planRender';
import { planStampBox, stampInset } from './planStamp';
import { drawPlanStamp } from './renderFrame';
import { POSITIONS, type Watermark, type WatermarkPosition } from './watermark';

// Plans on paper (6.10): the scale chosen, a wall measured on the page, the page's words and legend, packets' order, and
// the print path's six gaps (arcs and quadratics, rgba paint, icon text, weights, drawings past an item's box, label
// halos), read from display lists and from the written PDF. The canvas isn't here (no Konva in Node): a plan's drawing is
// read from the plan's own React elements by a small stand-in for PageStage below, the same transforms Konva applies.
// What Konva itself draws is read back in the browser by e2e/planExport.spec.ts.

const font = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const FILES = { sans: font('InterTight-Regular'), sansBold: font('InterTight-Bold'), mono: font('JetBrainsMono-Regular'), monoBold: font('JetBrainsMono-Bold') };
const measure = await fontMeasure(FILES);
const fonts: FontLoader = (family, weight) => {
  const bytes = family === 'Inter Tight' ? (weight >= 600 ? FILES.sansBold : FILES.sans) : family === 'JetBrains Mono' ? (weight >= 600 ? FILES.monoBold : FILES.mono) : null;
  return Promise.resolve(bytes ? { key: `${family}|${String(weight >= 600)}`, bytes, synthBold: false, synthItalic: false } : null);
};
const noPictures: PictureLoader = () => Promise.resolve(null);

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  showAllLayers();
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const apply = (changes: Change[]) => store.getState().apply(changes);

const options = (extra: Partial<PlanPrintOptions> = {}): PlanPrintOptions => ({
  paper: 'a4',
  unit: 'metres',
  underlay: true,
  grid: true,
  title: 'Bey County',
  now: new Date('2026-11-14T12:00:00Z'),
  zones: new Map(),
  measure,
  ...extra,
});

/**
 * SC 04 INT. DINER — DAY with two setups; Setup 1 holds 1A (MS, 35 mm) and 1B; a room with a free-standing 4.00 m wall
 * and an 8 m one 6 m below it (so the plan prints at 1:50 on A4), a camera on the Sony FX3 shooting both frames, a
 * 650 W fresnel 2.40 m up and a 4×4 flag.
 */
async function furnished() {
  const p = project.projectId;
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const bodyId = crypto.randomUUID();
  await apply([
    { kind: 'create', record: { id: bodyId, type: 'gear_item', parentId: p, sortKey: 'a', props: { name: 'Sony FX3', kind: 'camera_body', camera_letter: 'A', sensor_mode: 'Full frame 16:9', sensor_width_mm: 35.6, sensor_height_mm: 20 } } },
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: p, sortKey: '1', props: { number: '4', name: 'Diner', int_ext: 'INT', day_night: 'DAY' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: otherId, type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: 'Window side' } } },
    { kind: 'create', record: { id: 'f1', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, size: 'MS', lens_mm: 35 } } },
    { kind: 'create', record: { id: 'f2', type: 'shot', parentId: sceneId, sortKey: 'b', props: { number: '1B', setup_id: setupId, size: 'CU' } } },
  ]);
  await apply(startRoomChanges(records(), p, sceneId));
  expect(sceneRoomId(records(), records()[sceneId])).not.toBeNull();
  const wall = drawWallsChanges(records(), sceneId, [
    { x: -200, y: -300 },
    { x: 200, y: -300 },
  ]);
  await apply(wall.changes);
  await apply(drawWallsChanges(records(), sceneId, [
    { x: -400, y: 300 },
    { x: 400, y: 300 },
  ]).changes);
  const view = { sceneId, setupId };
  const camera = crypto.randomUUID();
  const light = crypto.randomUUID();
  const flag = crypto.randomUUID();
  await apply(placeIconChanges(records(), view, 'camera/camera', { x: 0, y: 1 }, camera));
  await apply(placeIconChanges(records(), view, 'lighting/fresnel', { x: 2, y: -1 }, light));
  await apply(placeIconChanges(records(), view, 'grip/flag', { x: 1, y: 0 }, flag));
  await apply([{ kind: 'update', id: light, set: { watts: 650, height_m: 2.4 } }]);
  await apply(cameraBodyChanges(records(), camera, bodyId));
  await apply(assignFrameChanges(records(), 'f1', camera));
  await apply(assignFrameChanges(records(), 'f2', camera));
  return { sceneId, setupId, otherId, camera, light, flag, wallId: wall.ids[0] ?? '' };
}

// A stand-in for PageStage: the plan's React elements as Konva would make them, as PrintNodes.

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (first: Matrix, second: Matrix): Matrix => {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
};

/** Konva's transform for a node's attributes: its offset, scale, rotation, then its place. */
function konvaMatrix(a: Record<string, unknown>): Matrix {
  const n = (k: string, d: number) => {
    const v = a[k];
    return typeof v === 'number' ? v : d;
  };
  const r = (n('rotation', 0) * Math.PI) / 180;
  let m: Matrix = [1, 0, 0, 1, -n('offsetX', 0), -n('offsetY', 0)];
  m = mul(m, [n('scaleX', 1), 0, 0, n('scaleY', 1), 0, 0]);
  m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
  return mul(m, [1, 0, 0, 1, n('x', 0), n('y', 0)]);
}

const KINDS: Readonly<Record<string, PrintNode['kind']>> = { Group: 'group', Rect: 'rect', Line: 'line', Path: 'path', Text: 'text', Circle: 'ellipse', Wedge: 'wedge', Shape: 'glyph', Image: 'image' };

function nodesOf(element: ReactNode): PrintNode[] {
  if (Array.isArray(element)) return element.flatMap((e: ReactNode) => nodesOf(e));
  if (!isValidElement(element)) return [];
  const el = element as ReactElement<Record<string, unknown>>;
  const props = el.props;
  if (el.type === Fragment) return nodesOf(props.children as ReactNode);
  if (typeof el.type === 'function') {
    const fn = el.type as ((p: unknown) => ReactNode) & { name: string };
    // The two drawings with hooks: an icon's text (its Shape carries the part) and a picture (its image carries its hash).
    const part = props.part as { kind?: string } | undefined;
    if (part?.kind === 'text') return [{ kind: 'glyph', matrix: IDENTITY, opacity: 1, visible: true, attrs: { sbText: part }, children: [] }];
    if (fn.name === 'PictureNode') return [{ kind: 'image', matrix: IDENTITY, opacity: 1, visible: true, attrs: { sbSha: props.sha256 ?? '', width: props.width, height: props.height }, children: [] }];
    return nodesOf(fn(props));
  }
  const kind = typeof el.type === 'string' ? KINDS[el.type] : undefined;
  if (!kind) return [];
  const attrs: Record<string, unknown> = { ...props };
  const node: PrintNode = {
    kind,
    matrix: konvaMatrix(attrs),
    opacity: typeof attrs.opacity === 'number' ? attrs.opacity : 1,
    visible: attrs.visible !== false,
    attrs,
    children: kind === 'group' ? nodesOf(props.children as ReactNode) : [],
  };
  if (kind === 'text') {
    const size = typeof attrs.fontSize === 'number' ? attrs.fontSize : 12;
    return [{ ...node, layout: { lines: [{ text: typeof attrs.text === 'string' ? attrs.text : '' }], width: typeof attrs.width === 'number' ? attrs.width : 0, height: size, baselineShift: size * 0.35 } }];
  }
  return [node];
}

/** The plan area as PageStage draws it in print mode: page fitted to the box, each item's drawing past its box under it, a dimmed one dimmed. */
function stageOf(area: PlanArea): PrintNode {
  const s = Math.min(area.box.width / area.world.width, area.box.height / area.world.height);
  const context = { colours: PRINT_COLOURS, zoom: printZoom(area.pointsPerUnit), inView: true, present: true, print: true };
  const itemNode = (item: CanvasItem): PrintNode => {
    const place = konvaMatrix({ x: item.x + item.width / 2, y: item.y + item.height / 2, offsetX: item.width / 2, offsetY: item.height / 2, rotation: item.rotation });
    const children: PrintNode[] = [];
    if (item.beyond) children.push({ kind: 'group', matrix: place, opacity: 1, visible: true, attrs: {}, children: nodesOf(item.beyond.draw({ width: item.width, height: item.height, rotation: item.rotation, ...context })) });
    children.push({ kind: 'group', matrix: place, opacity: 1, visible: true, attrs: {}, children: nodesOf(item.draw?.({ width: item.width, height: item.height, ...context })) });
    return { kind: 'group', matrix: IDENTITY, opacity: item.dim ? DIM_OPACITY : 1, visible: true, attrs: {}, children };
  };
  const offX = (area.box.width - area.world.width * s) / 2 - area.world.x * s;
  const offY = (area.box.height - area.world.height * s) / 2 - area.world.y * s;
  return { kind: 'group', matrix: [s, 0, 0, s, offX, offY], opacity: 1, visible: true, attrs: {}, children: area.items.map(itemNode) };
}

/** A plan page's display list, as planRender makes it (its drawing through printWeights). */
const printed = (page: PlanPage): PrintPage => planPrintPage(page, page.plan ? printWeights(displayOps(stageOf(page.plan))) : null, { scale: page.plan ? `Scale ${page.plan.scale.label}` : '', actualSize: 'Print at actual size (100%)', noRoom: 'No room drawn', legend: 'Legend' }, measure);

/** Every filled path's points on the page (points), with its fill, from a display list. */
function pagePaths(ops: readonly DisplayOp[]): { fill: string | null; points: { x: number; y: number }[] }[] {
  const stack: Matrix[] = [IDENTITY];
  const out: { fill: string | null; points: { x: number; y: number }[] }[] = [];
  for (const op of ops) {
    const m = stack[stack.length - 1] ?? IDENTITY;
    if (op.op === 'save') stack.push(m);
    else if (op.op === 'restore') stack.pop();
    else if (op.op === 'concat') stack[stack.length - 1] = mul(op.m, m);
    else if (op.op === 'shape') {
      const points = op.path.flatMap((s: Segment) => ('m' in s ? [s.m] : 'l' in s ? [s.l] : [])).map(([x, y]) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }));
      out.push({ fill: op.fill, points });
    }
  }
  return out;
}

const widthOf = (points: readonly { x: number }[]) => Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));

/** Every filled path in a PDF page's content stream, its points in PDF points, read by following q, Q and cm. */
async function pdfFilledPaths(bytes: Uint8Array): Promise<{ x: number; y: number }[][]> {
  const pdf = await PDFDocument.load(bytes);
  const out: { x: number; y: number }[][] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Type')) || object.dict.get(PDFName.of('Subtype'))) continue;
    const text = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
    if (!text.includes(' cm\n')) continue;
    const stack: Matrix[] = [IDENTITY];
    let numbers: number[] = [];
    let path: { x: number; y: number }[] = [];
    for (const token of text.split(/\s+/)) {
      const m = stack[stack.length - 1] ?? IDENTITY;
      if (/^-?[\d.]+$/.test(token)) numbers.push(Number(token));
      else {
        if (token === 'q') stack.push(m);
        else if (token === 'Q') stack.pop();
        else if (token === 'cm') stack[stack.length - 1] = mul(numbers.slice(-6) as unknown as Matrix, m);
        else if (token === 'm' || token === 'l') {
          const [x = 0, y = 0] = numbers.slice(-2);
          path.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
        } else if (token === 'f' || token === 'B') {
          out.push(path);
          path = [];
        } else if (token === 'S' || token === 'n') path = [];
        numbers = [];
      }
    }
  }
  return out;
}

const write = (pages: readonly PrintPage[], pictures: PictureLoader = noPictures) =>
  writeDeckPdf({ title: 'Plan', pageCount: pages.length, page: (i) => Promise.resolve(pages[i] as PrintPage), fonts, pictures, watermark: null });

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) out.push((await (await pdf.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  await pdf.destroy();
  return out;
}

describe('the scale (6.10)', () => {
  const A4_BOX = { width: 560, height: 470 };
  const LETTER_BOX = { width: 510, height: 490 };
  it('is the largest metric scale at which the extent fits, on A4 and on Letter', () => {
    // A 2 m prop table fits at 1:20; 9 m at 1:50; a 40 m stage at 1:250; a 300 m lot only at 1:1000, cut by the box.
    expect(chooseScale({ width: 200, height: 150 }, A4_BOX, 'metres').label).toBe('1:20');
    expect(chooseScale({ width: 900, height: 700 }, A4_BOX, 'metres').label).toBe('1:50');
    expect(chooseScale({ width: 900, height: 700 }, LETTER_BOX, 'metres').label).toBe('1:75');
    expect(chooseScale({ width: 4000, height: 2000 }, A4_BOX, 'metres').label).toBe('1:250');
    expect(chooseScale({ width: 30000, height: 30000 }, A4_BOX, 'metres').label).toBe('1:1000');
  });

  it('is in inches to the foot when the plan shows feet', () => {
    expect(chooseScale({ width: 200, height: 150 }, A4_BOX, 'feet').label).toBe('1" = 1\'-0"');
    expect(chooseScale({ width: 900, height: 700 }, A4_BOX, 'feet').label).toBe('1/4" = 1\'-0"');
    expect(chooseScale({ width: 2000, height: 1500 }, LETTER_BOX, 'feet').label).toBe('1/16" = 1\'-0"');
    expect(chooseScale({ width: 100000, height: 100 }, A4_BOX, 'feet').label).toBe('1/32" = 1\'-0"');
  });

  it('maps a world unit (1 cm of the room) to its paper size', () => {
    expect(pointsPerUnit(50) / PT_PER_MM).toBeCloseTo(0.2, 9);
    expect(pointsPerUnit(48) * 30.48).toBeCloseTo(18, 6);
  });
});

describe('a setup’s page (6.10)', () => {
  it('prints a 4.00 m wall 80.0 mm long at 1:50, in the display list and in the written PDF', async () => {
    const { sceneId, setupId } = await furnished();
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    if (!page?.plan) throw new Error('no plan');
    expect(page.plan.scale.label).toBe('1:50');
    const list = printed(page);
    const walls = pagePaths(list.ops).filter((p) => p.fill === '#16150F' && p.points.length === 4);
    const mm = walls.map((p) => Math.round((widthOf(p.points) / PT_PER_MM) * 10) / 10);
    expect(mm).toContain(80);
    const pdf = await write([list]);
    const inPdf = (await pdfFilledPaths(pdf.bytes)).filter((p) => p.length === 4).map((p) => Math.round((widthOf(p) / PT_PER_MM) * 10) / 10);
    expect(inPdf).toContain(80);
  });

  it('heads the page with the project, the slate and heading, the setup, the day and the page; its legend by department and its frames', async () => {
    const { sceneId, setupId } = await furnished();
    const p = project.projectId;
    const dayId = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: dayId, type: 'shoot_day', parentId: p, sortKey: 'a', props: { date: '2026-11-17' } } },
      { kind: 'update', id: 'f1', set: { shoot_day_id: dayId } },
    ]);
    const [page] = planPages(records(), p, [{ sceneId, setupId }], options());
    expect(page?.header).toEqual({
      project: 'Bey County',
      company: null,
      slate: 'SC 04 · INT. DINER — DAY',
      setup: 'Setup 1',
      days: 'Day 1 · Tue, Nov 17',
      printed: 'Printed Nov 14, 2026',
      page: 'Page 1 of 1',
      continued: null,
    });
    const lines = (page?.legend.rows ?? []).map((row) => row.pieces.map((piece) => piece.text).join(''));
    expect(lines).toEqual([
      'CAMERA',
      'A · Camera',
      'LIGHTING',
      'Fresnel · 2.40 m · 650 W',
      'GRIP',
      'Flag · 2×3',
      'Total 650 W',
      'FRAMES',
      'A · Sony FX3, Full frame 16:9',
      '1A · MS · 35 mm · 53.9°',
      '1B · CU',
    ]);
    // Every word is real text in the PDF, set in the bundled faces, embedded.
    const pdf = await write([printed(page as PlanPage)]);
    const [text] = await pdfText(pdf.bytes);
    for (const words of ['Bey County', 'SC 04 · INT. DINER — DAY', 'Setup 1', 'Day 1 · Tue, Nov 17', 'Page 1 of 1', 'Scale 1:50', 'Fresnel', '650 W', '35 mm', '53.9°']) expect(text).toContain(words);
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPages().map((pg) => [pg.getWidth(), pg.getHeight()])).toEqual([[841.89, 595.28]]);
    const fontNames: string[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) if (object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('FontDescriptor')) fontNames.push(String(object.get(PDFName.of('FontName'))));
    expect(fontNames.some((n) => n.includes('InterTight'))).toBe(true);
    expect(fontNames.some((n) => n.includes('JetBrainsMono'))).toBe(true);
  });

  it('is landscape Letter when asked, and the legend runs on to pages of its own, never smaller than 7 pt', async () => {
    const { sceneId, setupId } = await furnished();
    const changes: Change[] = [];
    for (let i = 0; i < 70; i += 1) changes.push(...placeIconChanges(records(), { sceneId, setupId }, 'set-art/chair', { x: (i % 10) * 0.5, y: 2 }, `chair${String(i)}`));
    await apply(changes);
    await apply(Array.from({ length: 70 }, (_, i): Change => ({ kind: 'update', id: `chair${String(i)}`, set: { name: `Chair number ${String(i)} by the long counter`, height_m: 0.45 + i / 100 } })));
    const pages = planPages(records(), project.projectId, [{ sceneId, setupId }], options({ paper: 'letter' }));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.size).toEqual(LANDSCAPE.letter);
    expect(pages[1]?.plan).toBeNull();
    expect(pages[1]?.header.continued).toBe('SC 04 · Setup 1 legend, continued');
    expect(pages.map((pg) => pg.header.page)).toEqual(pages.map((_, i) => `Page ${String(i + 1)} of ${String(pages.length)}`));
    const rows = pages.flatMap((pg) => pg.legend.rows);
    expect(Math.min(...rows.map((row) => row.size))).toBeGreaterThanOrEqual(7);
    // Nothing cut: every chair's line is there, whole.
    const text = rows.map((row) => row.pieces.map((piece) => piece.text).join('')).join(' ');
    for (let i = 0; i < 70; i += 1) expect(text).toContain(`Chair number ${String(i)} by the long counter`);
    const doc = await PDFDocument.load((await write(pages.map(printed))).bytes);
    expect(doc.getPageCount()).toBe(pages.length);
    expect(doc.getPages().map((pg) => [pg.getWidth(), pg.getHeight()])[0]).toEqual([792, 612]);
  });

  it('wraps a long line by words, running on indented, and breaks a word longer than a row between its letters', () => {
    const rows = wrapEntry({ kind: 'line', parts: [{ text: 'A very long name for a flag that runs on', face: 'sans' }, { text: ' · 2.40 m', face: 'mono' }] }, 80, measure);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.slice(1).every((row) => (row.pieces[0]?.x ?? 0) === 8)).toBe(true);
    expect(rows.map((row) => row.pieces.map((p) => p.text).join('')).join(' ')).toBe('A very long name for a flag that runs on · 2.40 m');
    const long = wrapEntry({ kind: 'line', parts: [{ text: 'Supercalifragilisticexpialidocious', face: 'mono' }] }, 60, measure);
    expect(long.map((row) => row.pieces.map((p) => p.text).join('')).join('')).toBe('Supercalifragilisticexpialidocious');
    for (const row of long) expect(row.pieces.reduce((w, p) => Math.max(w, p.x + measure(p.text, p.face, row.size)), 0)).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('prints every layer whatever the Layers tile says, nothing selected, and a room-less view says so', async () => {
    const { sceneId, setupId, camera, light } = await furnished();
    setLayerShow('camera', 'hidden');
    setLayerShow('lighting', 'hidden');
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const ids = page?.plan?.items.map((item) => item.id) ?? [];
    expect(ids).toContain(camera);
    expect(ids).toContain(light);
    expect(page?.plan?.items.every((item) => item.locked !== true)).toBe(true);
    expect(page?.plan?.noRoom).toBe(false);
  });

  it('draws the camera’s cone, the light’s beam and the sun path in the display list', async () => {
    const { sceneId, setupId } = await furnished();
    const p = project.projectId;
    const loc = crypto.randomUUID();
    const day = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: loc, type: 'location', parentId: p, sortKey: 'a', props: { name: 'Diner', map_name: 'Diner', latitude: 40.7128, longitude: -74.006, time_zone: 'America/New_York' } } },
      { kind: 'create', record: { id: day, type: 'shoot_day', parentId: p, sortKey: 'a', props: { date: '2026-11-17' } } },
      { kind: 'update', id: sceneId, set: { location_id: loc } },
      { kind: 'update', id: 'f1', set: { shoot_day_id: day } },
    ]);
    // The sun needs the room's north to know which way it goes round.
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'production/north', { x: -3, y: -2 }));
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'lighting/sun-path', { x: -2, y: 0 }));
    const [page] = planPages(records(), p, [{ sceneId, setupId }], options());
    const ops = printed(page as PlanPage).ops;
    // The cone: ink at 8%; the beam: a wedge in the lighting colour at 18%.
    expect(ops.some((op) => op.op === 'opacity' && op.value === 0.08)).toBe(true);
    expect(ops.some((op) => op.op === 'opacity' && op.value === 0.18)).toBe(true);
    // The sun's arc's hours and its rise and set, as words.
    const words = ops.flatMap((op) => (op.op === 'text' ? op.lines.map((l) => l.text) : []));
    expect(words.some((w) => w.startsWith('Rise'))).toBe(true);
    expect(words.some((w) => w.startsWith('Set'))).toBe(true);
    // Its golden stretch, gold over ink.
    expect(ops.some((op) => op.op === 'shape' && op.stroke === '#FFB162')).toBe(true);
  });

  it('prints the underlay dimmed, from its picture, and the PDF asks for its original', async () => {
    const { sceneId, setupId } = await furnished();
    const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
    const sha = 'a'.repeat(64);
    await apply([
      { kind: 'create', record: { id: 'm1', type: 'media', parentId: roomId, sortKey: 'a', props: { kind: 'image', file: sha, width: 800, height: 600 } } },
      { kind: 'create', record: { id: 'u1', type: 'plan_item', parentId: roomId, sortKey: '0', props: { kind: 'underlay', media_id: 'm1', x: -4, y: -3, width: 8, height: 6, rotation: 0, scaled: true } } },
    ]);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    expect(page?.plan?.items.find((item) => item.id === 'u1')?.dim).toBe(true);
    const ops = printed(page as PlanPage).ops;
    const at = ops.findIndex((op) => op.op === 'image');
    expect(at).toBeGreaterThan(-1);
    expect(ops[at]).toMatchObject({ op: 'image', sha256: sha });
    expect(ops.slice(0, at).some((op) => op.op === 'opacity' && op.value === DIM_OPACITY)).toBe(true);
    const asked: string[] = [];
    const jpeg = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url)));
    const pdf = await write([printed(page as PlanPage)], (s) => {
      asked.push(s);
      return Promise.resolve({ bytes: jpeg, kind: 'jpeg', original: true });
    });
    expect(asked).toEqual([sha]);
    expect(pdf.storedCopies).toBe(0);
    // Turned off, it isn't printed.
    const [without] = planPages(records(), project.projectId, [{ sceneId, setupId }], options({ underlay: false }));
    expect(without?.plan?.items.some((item) => item.id === 'u1')).toBe(false);
  });
});

describe('packets (6.10)', () => {
  it('prints a scene’s setups in setup order, a scene with none as one page of its room, and a scene with no plan not at all', async () => {
    const { sceneId, setupId, otherId } = await furnished();
    expect(scenePlanViews(records(), sceneId)).toEqual([
      { sceneId, setupId },
      { sceneId, setupId: otherId },
    ]);
    const pages = planPages(records(), project.projectId, scenePlanViews(records(), sceneId), options());
    expect(pages.map((pg) => pg.header.setup)).toEqual(['Setup 1', 'Setup 2 · Window side']);
    // A scene with no room and nothing drawn has no plan (6.10 review: one rule everywhere); with its room started, one page.
    await apply([{ kind: 'create', record: { id: 'bare', type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '5' } } }]);
    expect(scenePlanViews(records(), 'bare')).toEqual([]);
    await apply(startRoomChanges(records(), project.projectId, 'bare'));
    const bare = planPages(records(), project.projectId, scenePlanViews(records(), 'bare'), options());
    expect(bare.map((pg) => [pg.header.setup, pg.plan?.noRoom])).toEqual([[null, false]]);
  });

  it('prints a day’s setups with a frame to shoot, in the call sheet’s scene order, each page naming the day', async () => {
    const { sceneId, setupId, otherId } = await furnished();
    const p = project.projectId;
    const day = crypto.randomUUID();
    const first = crypto.randomUUID();
    const firstSetup = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: day, type: 'shoot_day', parentId: p, sortKey: 'a', props: { date: '2026-11-17' } } },
      // A scene before SC 04 on the board, with a setup and a frame on the day.
      { kind: 'create', record: { id: first, type: 'scene', parentId: p, sortKey: '0', props: { number: '2' } } },
      { kind: 'create', record: { id: firstSetup, type: 'setup', parentId: first, sortKey: 'a', props: { name: '' } } },
      { kind: 'create', record: { id: 'g1', type: 'shot', parentId: first, sortKey: 'a', props: { number: '2A', setup_id: firstSetup, shoot_day_id: day } } },
      { kind: 'update', id: 'f2', set: { shoot_day_id: day } },
      // A frame of Setup 2 on the day, but in hand: not shot, so not printed.
      { kind: 'create', record: { id: 'f3', type: 'shot', parentId: sceneId, sortKey: 'c', props: { number: '1C', setup_id: otherId, shoot_day_id: day, status: 'have' } } },
      // A scene after SC 04 with a setup and frames on the day but no room and nothing drawn: printed all the same (6.10
      // review, round two: "every setup with a frame that day"), "No room drawn" on it and its frames listed.
      { kind: 'create', record: { id: 'empty', type: 'scene', parentId: p, sortKey: '3', props: { number: '9' } } },
      { kind: 'create', record: { id: 'emptySetup', type: 'setup', parentId: 'empty', sortKey: 'a', props: { name: '' } } },
      { kind: 'create', record: { id: 'e1', type: 'shot', parentId: 'empty', sortKey: 'a', props: { number: '9A', setup_id: 'emptySetup', shoot_day_id: day, size: 'WS', lens_mm: 24 } } },
      { kind: 'create', record: { id: 'e2', type: 'shot', parentId: 'empty', sortKey: 'b', props: { number: '9B', setup_id: 'emptySetup', shoot_day_id: day, size: 'CU' } } },
    ]);
    // SC 2 has its room started, so it has a plan to print.
    await apply(startRoomChanges(records(), p, first));
    const views = dayPlanViews(records(), p, day);
    expect(views).toEqual<PlanView[]>([
      { sceneId: first, setupId: firstSetup, dayId: day },
      { sceneId, setupId, dayId: day },
      { sceneId: 'empty', setupId: 'emptySetup', dayId: day },
    ]);
    const pages = planPages(records(), p, views, options());
    expect(pages.map((pg) => pg.header.days)).toEqual(['Day 1 · Tue, Nov 17', 'Day 1 · Tue, Nov 17', 'Day 1 · Tue, Nov 17']);
    const sc09 = pages[2];
    expect(sc09?.header.slate.startsWith('SC 09')).toBe(true);
    expect(sc09?.plan?.noRoom).toBe(true);
    expect((sc09?.legend.rows ?? []).map((row) => row.pieces.map((piece) => piece.text).join(''))).toEqual(['Nothing on this plan yet.', 'FRAMES', 'No camera', '9A · WS · 24 mm', '9B · CU']);
    // Nothing is left out of a day's packet, so its result says nothing of it.
    expect(planDayPdf.planLeftOut?.(records(), p, { kind: 'day', dayId: day }, { kind: 'project' })).toEqual({ setups: 0, scenes: 0 });
    expect(planDayPdf.planViews?.(records(), p, { kind: 'day', dayId: day }, { kind: 'project' })).toHaveLength(3);
    expect(dayPlanViews(records(), p, 'none')).toEqual([]);
  });
});

/** An SVG arc's centre, radii and angles from its endpoints, as SVG 1.1 appendix F.6.5 and F.6.6 define them. */
function svgArc(x1: number, y1: number, rx0: number, ry0: number, degrees: number, large: boolean, sweep: boolean, x2: number, y2: number) {
  const phi = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const x1p = (c * (x1 - x2)) / 2 + (s * (y1 - y2)) / 2;
  const y1p = (-s * (x1 - x2)) / 2 + (c * (y1 - y2)) / 2;
  // F.6.6: radii too small are scaled up by the square root of lambda.
  const lambda = (x1p * x1p) / (rx0 * rx0) + (y1p * y1p) / (ry0 * ry0);
  const rx = lambda > 1 ? Math.sqrt(lambda) * rx0 : rx0;
  const ry = lambda > 1 ? Math.sqrt(lambda) * ry0 : ry0;
  const root = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const sign = large === sweep ? -1 : 1;
  const cxp = (sign * root * rx * y1p) / ry;
  const cyp = (sign * root * -ry * x1p) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2;
  const cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.sign(ux * vy - uy * vx || 1) * Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry) % (2 * Math.PI);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta, delta };
}

/** A path's one arc, read as cubics, keeps to the ellipse SVG defines, the right way round, from its start to its end. */
function expectSvgArc(data: string, arc: Parameters<typeof svgArc>) {
  const want = svgArc(...arc);
  const cubics = parsePathData(data).flatMap((seg) => ('c' in seg ? [seg.c] : []));
  expect(cubics.length).toBeGreaterThan(0);
  let from = { x: arc[0], y: arc[1] };
  const turned = (x: number, y: number) => {
    const dx = x - want.cx;
    const dy = y - want.cy;
    return { u: (Math.cos(want.phi) * dx + Math.sin(want.phi) * dy) / want.rx, v: (-Math.sin(want.phi) * dx + Math.cos(want.phi) * dy) / want.ry };
  };
  for (const c of cubics) {
    for (let k = 0; k <= 20; k += 1) {
      const t = k / 20;
      const u = 1 - t;
      const x = u * u * u * from.x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * c[4];
      const y = u * u * u * from.y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5];
      const p = turned(x, y);
      expect(Math.abs(Math.hypot(p.u, p.v) - 1)).toBeLessThan(0.001);
      // On the arc's own stretch of the ellipse, not the other one.
      const along = (((Math.atan2(p.v, p.u) - want.theta) * Math.sign(want.delta)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.min(along, 2 * Math.PI - along) < 1e-6 || along <= Math.abs(want.delta) + 1e-6).toBe(true);
    }
    from = { x: c[4], y: c[5] };
  }
  expect(from.x).toBeCloseTo(arc[7], 9);
  expect(from.y).toBeCloseTo(arc[8], 9);
}

describe('the print path’s gaps (6.10)', () => {
  it('turns arcs into cubics that keep to the circle, within 0.01 of its radius', () => {
    const r = 9;
    const path = parsePathData('M25 16A9 9 0 0 1 7 16A9 9 0 0 1 25 16Z');
    const cubics = path.flatMap((s) => ('c' in s ? [s.c] : []));
    expect(cubics.length).toBeGreaterThanOrEqual(4);
    let from = { x: 25, y: 16 };
    for (const c of cubics) {
      for (let k = 0; k <= 20; k += 1) {
        const t = k / 20;
        const u = 1 - t;
        const x = u * u * u * from.x + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t * c[4];
        const y = u * u * u * from.y + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5];
        expect(Math.abs(Math.hypot(x - 16, y - 16) - r)).toBeLessThan(0.001 * r);
      }
      from = { x: c[4], y: c[5] };
    }
    expect(from.x).toBeCloseTo(25, 9);
    // A relative arc, a quadratic and its smooth follower, H and V, all read.
    expect(parsePathData('M0 0 h10 v10 a5 5 0 0 1 -10 0 Q0 20 10 20 T20 20 Z').filter((s) => 'z' in s)).toHaveLength(1);
    const quad = parsePathData('M0 0 Q10 10 20 0').find((s): s is { c: readonly [number, number, number, number, number, number] } => 'c' in s);
    expect(quad?.c.map((v) => Math.round(v * 1000) / 1000)).toEqual([6.667, 6.667, 13.333, 6.667, 20, 0]);
    expect(arcCubics(0, 0, 0, 5, 0, false, true, 10, 0)).toBe('line');
    // The large arc the other way round, a turned ellipse, and radii too small for their ends (grown until they reach), each
    // against the arc SVG defines (F.6.5), within 0.001 of its radius.
    expectSvgArc('M0 0 A 5 5 0 1 0 8 0', [0, 0, 5, 5, 0, true, false, 8, 0]);
    expectSvgArc('M0 0 A 5 3 30 0 1 6 2', [0, 0, 5, 3, 30, false, true, 6, 2]);
    expectSvgArc('M0 0 A 1 1 0 0 1 20 0', [0, 0, 1, 1, 0, false, true, 20, 0]);
  });

  it('carries rgba paint and opacity through to the PDF as transparency', async () => {
    expect(parsePaint('rgba(22, 21, 15, 0.5)')).toEqual({ rgb: [22 / 255, 21 / 255, 15 / 255], alpha: 0.5 });
    expect(parsePaint('#16150F')?.alpha).toBe(1);
    expect(parsePaint('rgba(0, 0, 0, 0)')).toBeNull();
    const ops = displayOps({ kind: 'rect', matrix: IDENTITY, opacity: 0.5, visible: true, attrs: { width: 100, height: 100, fill: 'rgba(22, 21, 15, 0.4)' }, children: [] });
    const page: PrintPage = { format: 'a4', orientation: 'landscape', ...LANDSCAPE.a4, background: '#FFFFFF', ops };
    const doc = await PDFDocument.load((await write([page])).bytes);
    const alphas: number[] = [];
    const states = doc.getPages()[0]?.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
    for (const [, state] of states?.entries() ?? []) {
      const dict = doc.context.lookup(state, PDFDict);
      alphas.push(Number(String(dict.get(PDFName.of('ca')))));
    }
    // The node's 50%, and its paint's 40% on top of it.
    expect(alphas.sort()).toEqual([0.2, 0.5]);
  });

  it('prints an icon’s text as real text in JetBrains Mono at its baseline', async () => {
    const part = iconShapesOf('production/parking')?.find((p) => p.kind === 'text');
    expect(part).toMatchObject({ text: 'P', family: 'JetBrains Mono' });
    const ops = displayOps({ kind: 'glyph', matrix: IDENTITY, opacity: 1, visible: true, attrs: { sbText: part }, children: [] });
    expect(ops.find((op) => op.op === 'text')).toMatchObject({ op: 'text', family: 'JetBrains Mono', weight: 700, align: 'center', lines: [{ text: 'P', baseline: 21 }] });
    const pdf = await write([{ format: 'a4', orientation: 'landscape', ...LANDSCAPE.a4, background: '#FFFFFF', ops }]);
    expect((await pdfText(pdf.bytes))[0]).toContain('P');
    const doc = await PDFDocument.load(pdf.bytes);
    const names: string[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) if (object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('FontDescriptor')) names.push(String(object.get(PDFName.of('FontName'))));
    expect(names.some((n) => n.includes('JetBrainsMono-Bold'))).toBe(true);
  });

  it('prints the screen’s weights at paper’s: 1.5 px at 0.6 pt, thinner as hairlines, dashes with them, and halos of 1.5 pt white', () => {
    const shape = (strokeWidth: number, dash: number[]): DisplayOp => ({ op: 'shape', path: [], fill: null, stroke: '#16150F', strokeWidth, fixedStroke: true, dash, cap: 'butt', join: 'miter' });
    const out = printWeights([shape(1.5, [6, 4]), shape(1, [4, 3]), shape(5, []), { op: 'save' }, { op: 'concat', m: [0.5, 0, 0, 0.5, 0, 0] }, { op: 'text', lines: [{ text: 'A', baseline: 0 }], align: 'left', padding: 0, width: 0, family: 'JetBrains Mono', weight: 400, italic: false, size: 14, fill: '#16150F', letterSpacing: 0, stroke: { colour: '#EEE9DF', width: 0.3 } }, { op: 'restore' }]);
    const weights = (op: DisplayOp | undefined) => (op?.op === 'shape' ? [op.strokeWidth, ...op.dash].map((n) => Math.round(n * 1000) / 1000) : []);
    expect(weights(out[0])).toEqual([KIT_LINE, 2.4, 1.6]);
    expect(weights(out[1])).toEqual([HAIRLINE, 1, 0.75]);
    expect(weights(out[2])).toEqual([2]);
    // In units at half scale, 3 units is 1.5 pt; the paper's halo is the sheet's white.
    expect(out[5]).toMatchObject({ stroke: { colour: '#FFFFFF', width: HALO_POINTS / 0.5 } });
  });

  it('draws a halo as the letters’ outlines stroked under the text, the letters over it, read once', async () => {
    const ops: DisplayOp[] = [{ op: 'text', lines: [{ text: 'Fresnel', baseline: 100 }], align: 'left', padding: 0, width: 0, family: 'JetBrains Mono', weight: 400, italic: false, size: 7, fill: '#16150F', letterSpacing: 0, stroke: { colour: '#FFFFFF', width: 1.5 } }];
    const pdf = await write([{ format: 'a4', orientation: 'landscape', ...LANDSCAPE.a4, background: '#FFFFFF', ops }]);
    const doc = await PDFDocument.load(pdf.bytes);
    let content = '';
    for (const [, object] of doc.context.enumerateIndirectObjects()) if (object instanceof PDFRawStream && !object.dict.get(PDFName.of('Subtype'))) content += new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
    // White outlines stroked 1.5 wide, then the text in ink.
    const halo = content.indexOf('1 1 1 RG');
    const strokeAt = content.indexOf('\nS\n', halo);
    const text = content.indexOf('BT', halo);
    expect(halo).toBeGreaterThan(-1);
    expect(content.slice(halo, strokeAt)).toContain('1.5 w');
    expect(strokeAt).toBeGreaterThan(halo);
    expect(text).toBeGreaterThan(strokeAt);
    // Read once, not twice.
    expect((await pdfText(pdf.bytes))[0]?.match(/Fresnel/g)).toHaveLength(1);
  });

  it('draws what an item draws past its box, under the item, as PageStage now does', async () => {
    const { sceneId, setupId, camera } = await furnished();
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const item = page?.plan?.items.find((i) => i.id === camera);
    expect(item?.beyond).toBeDefined();
    const node = stageOf({ ...(page?.plan as PlanArea), items: item ? [item] : [] });
    const groups = node.children[0]?.children ?? [];
    // The cone's group first, then the camera's own.
    expect(groups).toHaveLength(2);
    expect(JSON.stringify(groups[0])).toContain('"opacity":0.08');
  });
});

// 6.10's review: the scale bar and notes in a band of their own, a plan too large for the page said so, the legend's
// headings kept with what follows, a legend too long said so, each format's plans and names from one function, one rule
// for an empty scene, a wedge turned the other way, the path tokenizer, and the PNG's painter.

/** A setup whose room is `widthM` by `heightM` (two walls), a flag at its bottom-left corner. */
async function sized(widthM: number, heightM: number) {
  const p = project.projectId;
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: p, sortKey: '1', props: { number: '7', name: 'Lot', int_ext: 'EXT', day_night: 'DAY' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
  ]);
  await apply(startRoomChanges(records(), p, sceneId));
  const w = (widthM * 100) / 2;
  const h = (heightM * 100) / 2;
  await apply(drawWallsChanges(records(), sceneId, [{ x: -w, y: -h }, { x: w, y: -h }]).changes);
  await apply(drawWallsChanges(records(), sceneId, [{ x: -w, y: h }, { x: w, y: h }]).changes);
  const corner = crypto.randomUUID();
  await apply(placeIconChanges(records(), { sceneId, setupId }, 'grip/flag', { x: -widthM / 2, y: heightM / 2 }, corner));
  return { sceneId, setupId, corner };
}

const textsOf = (ops: readonly DisplayOp[]) => ops.flatMap((op) => (op.op === 'text' ? op.lines.map((l) => l.text) : []));

describe('the plan box’s foot band (6.10 review)', () => {
  it('keeps the extent’s bottom-left corner clear of the band, with 12 pt of paper round it, at 1:100 and at 1:500', async () => {
    for (const [width, height, label] of [
      [18, 10, '1:100'],
      [90, 50, '1:500'],
    ] as const) {
      const { sceneId, setupId, corner } = await sized(width, height);
      const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
      const area = page?.plan;
      if (!area) throw new Error('no plan');
      expect(area.scale.label).toBe(label);
      expect(area.cut).toBe(false);
      const band = footBand(area);
      // The band is the box's foot, under the drawing.
      expect(band.y).toBeCloseTo(area.drawing.y + area.drawing.height, 9);
      expect(band.y + band.height).toBeCloseTo(area.box.y + area.box.height, 9);
      const extent = planExtent(area.items);
      if (!extent) throw new Error('no extent');
      const bottomLeft = onPage(area, extent.x, extent.y + extent.height);
      expect(bottomLeft.y).toBeLessThanOrEqual(band.y - PAPER_MARGIN + 1e-6);
      expect(bottomLeft.x).toBeGreaterThanOrEqual(area.box.x + PAPER_MARGIN - 1e-6);
      // The flag in that corner is drawn above the band.
      const flag = area.items.find((item) => item.id === corner);
      if (!flag) throw new Error('no flag');
      expect(onPage(area, flag.x, flag.y + flag.height).y).toBeLessThan(band.y);
      // The scale's words and "Print at actual size (100%)" are on the band, under the plan.
      const ops = printed(page).ops;
      expect(textsOf(ops)).toContain(`Scale ${label}`);
      expect(textsOf(ops)).toContain('Print at actual size (100%)');
    }
  });

  it('says so when a plan is larger than the page at 1:1000, and prints its edges cut', async () => {
    const { sceneId, setupId } = await sized(400, 300);
    const pages = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    expect(pages[0]?.plan?.scale.label).toBe('1:1000');
    expect(pages[0]?.plan?.cut).toBe(true);
    expect(planPageWarnings(pages)).toEqual(['This plan is larger than the page at 1:1000: its edges are cut.']);
    const { sceneId: s2, setupId: u2 } = await sized(18, 10);
    expect(planPageWarnings(planPages(records(), project.projectId, [{ sceneId: s2, setupId: u2 }], options()))).toEqual([]);
  });

  it('prints "No room drawn" on the band, not over the plan', async () => {
    const sceneId = crypto.randomUUID();
    const setupId = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '8' } } },
      { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    ]);
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'camera/camera', { x: 0, y: 0 }));
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    if (!page?.plan) throw new Error('no plan');
    expect(page.plan.noRoom).toBe(true);
    const band = footBand(page.plan);
    // Where each text sits on the page: the note's baseline is inside the band.
    const stack: Matrix[] = [IDENTITY];
    let noteAt: number | null = null;
    for (const op of printed(page).ops) {
      const m = stack[stack.length - 1] ?? IDENTITY;
      if (op.op === 'save') stack.push(m);
      else if (op.op === 'restore') stack.pop();
      else if (op.op === 'concat') stack[stack.length - 1] = mul(op.m, m);
      else if (op.op === 'text' && op.lines[0]?.text === 'No room drawn') noteAt = m[3] * op.lines[0].baseline + m[5];
    }
    expect(noteAt).not.toBeNull();
    expect(noteAt ?? 0).toBeGreaterThan(band.y);
    expect(noteAt ?? 0).toBeLessThan(band.y + band.height);
  });
});

describe('the legend’s flow (6.10 review)', () => {
  const row = (kind: LegendRow['kind'], keepWithNext: boolean, text: string): LegendRow => ({ kind, size: LEGEND_STYLE[kind].size, height: LEGEND_STYLE[kind].row, before: LEGEND_STYLE[kind].before, pieces: [{ text, face: 'mono', x: 0 }], keepWithNext });

  it('never leaves a heading alone at a column’s foot when its subheading and first line don’t fit under it', () => {
    // Three lines (31.5 pt), then FRAMES, a camera and its first frame: FRAMES and the camera fit the 65 pt column, the frame doesn't.
    const rows = [row('line', false, 'one'), row('line', false, 'two'), row('line', false, 'three'), row('heading', true, 'FRAMES'), row('subheading', true, 'A · FX3'), row('line', false, '1A · 35 mm')];
    const columns = [
      { x: 0, y: 0, width: 180, height: 65 },
      { x: 200, y: 0, width: 180, height: 65 },
    ];
    const { placed, rest } = flowRows(rows, columns);
    expect(rest).toEqual([]);
    expect(placed.map((column) => column.map((r) => r.pieces[0]?.text))).toEqual([
      ['one', 'two', 'three'],
      ['FRAMES', 'A · FX3', '1A · 35 mm'],
    ]);
  });

  it('stops a legend too long to print whole, and says so', async () => {
    const { sceneId, setupId } = await furnished();
    const changes: Change[] = [];
    for (let i = 0; i < 70; i += 1) changes.push(...placeIconChanges(records(), { sceneId, setupId }, 'set-art/chair', { x: (i % 10) * 0.5, y: 2 }, `chair${String(i)}`));
    await apply(changes);
    await apply(Array.from({ length: 70 }, (_, i): Change => ({ kind: 'update', id: `chair${String(i)}`, set: { name: `Chair number ${String(i)} by the long counter` } })));
    const whole = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    expect(whole.some((pg) => pg.legendCut)).toBe(false);
    expect(planPageWarnings(whole)).toEqual([]);
    // With no pages of its own allowed, what the plan's page can't hold is left out, never silently.
    const short = planPages(records(), project.projectId, [{ sceneId, setupId }], options({ maxLegendPages: 0 }));
    expect(short).toHaveLength(1);
    expect(short[0]?.legendCut).toBe(true);
    expect(planPageWarnings(short)).toEqual(['The legend is too long to print whole.']);
  });
});

describe('each plan format’s plans and name, from one function (6.10 review)', () => {
  const count = (format: typeof planSetupPdf, target: PlanTarget | undefined, scope: { kind: 'project' } | { kind: 'scene'; sceneId: string } = { kind: 'project' }) =>
    (format.planViews?.(records(), project.projectId, target, scope) ?? []).length;
  const name = (format: typeof planSetupPdf, target: PlanTarget | undefined, scope: { kind: 'project' } | { kind: 'scene'; sceneId: string } = { kind: 'project' }) =>
    planExportName(format, { title: 'Bey County', records: records(), scope, ...(target ? { plan: target } : {}) });

  it('prints and names what each format says for the setup shown, whichever entry the window was opened from', async () => {
    const { sceneId, setupId, otherId } = await furnished();
    const shown: PlanTarget = { kind: 'setup', sceneId, setupId: otherId };
    expect(planSetupPdf.planViews?.(records(), project.projectId, shown, { kind: 'project' })).toEqual([{ sceneId, setupId: otherId }]);
    expect(name(planSetupPdf, shown)).toBe('Bey County SC004 Setup 2 plan.pdf');
    expect(count(planSetupPng, shown)).toBe(1);
    expect(name(planSetupPng, shown)).toBe('Bey County SC004 Setup 2 plan.png');
    // Scene plans from the same setup: the whole scene, a page per setup.
    expect(planScenePdf.planViews?.(records(), project.projectId, shown, { kind: 'project' })).toEqual([
      { sceneId, setupId },
      { sceneId, setupId: otherId },
    ]);
    expect(name(planScenePdf, shown)).toBe('Bey County SC004 plans.pdf');
    // A scene shown with no setup: its room, named for the scene.
    const scene: PlanTarget = { kind: 'scene', sceneId };
    expect(planSetupPdf.planViews?.(records(), project.projectId, scene, { kind: 'project' })).toEqual([{ sceneId, setupId: null }]);
    expect(name(planSetupPdf, scene)).toBe('Bey County SC004 plan.pdf');
    expect(count(planScenePdf, scene)).toBe(2);
    // Export Project: the scene in scope, or every scene with a plan.
    expect(count(planScenePdf, undefined, { kind: 'scene', sceneId })).toBe(2);
    expect(name(planScenePdf, undefined, { kind: 'scene', sceneId })).toBe('Bey County SC004 plans.pdf');
    expect(count(planScenePdf, undefined)).toBe(2);
    expect(name(planScenePdf, undefined)).toBe('Bey County plans.pdf');
    // A setup that isn't the scene's (trashed, or another's) prints nothing.
    expect(count(planSetupPdf, { kind: 'setup', sceneId, setupId: 'gone' })).toBe(0);
  });

  it('prints a day’s plans for the day, and nothing for a day with none', async () => {
    const { sceneId, setupId } = await furnished();
    const day = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: day, type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2026-11-17' } } },
      { kind: 'update', id: 'f1', set: { shoot_day_id: day } },
    ]);
    const target: PlanTarget = { kind: 'day', dayId: day };
    expect(planDayPdf.planViews?.(records(), project.projectId, target, { kind: 'project' })).toEqual([{ sceneId, setupId, dayId: day }]);
    expect(name(planDayPdf, target)).toBe('Bey County Day 1 plans.pdf');
    expect(count(planDayPdf, { kind: 'day', dayId: 'none' })).toBe(0);
  });

  it('leaves a scene with no room and nothing drawn out of every format, so the export has nothing to print', async () => {
    await apply([
      { kind: 'create', record: { id: 'bare', type: 'scene', parentId: project.projectId, sortKey: '1', props: { number: '1' } } },
      { kind: 'create', record: { id: 'bareSetup', type: 'setup', parentId: 'bare', sortKey: 'a', props: { name: '' } } },
    ]);
    for (const target of [{ kind: 'setup', sceneId: 'bare', setupId: 'bareSetup' }, { kind: 'scene', sceneId: 'bare' }] as const) {
      expect(count(planSetupPdf, target)).toBe(0);
      expect(count(planSetupPng, target)).toBe(0);
      expect(count(planScenePdf, target)).toBe(0);
    }
    expect(projectPlanViews(records(), project.projectId)).toEqual([]);
    expect(count(planScenePdf, undefined)).toBe(0);
  });
});

describe('a wedge and the path tokenizer (6.10 review)', () => {
  it('turns a wedge the way Konva draws it: its angle clockwise, or with `clockwise` set the long way round', () => {
    expect(wedgeTurn(90, false)).toBeCloseTo(Math.PI / 2, 12);
    expect(wedgeTurn(90, true)).toBeCloseTo(-1.5 * Math.PI, 12);
    // A full 360° is the whole circle either way, as the canvas draws it (round two: it was no arc at all); 0° is none.
    expect(wedgeTurn(360, true)).toBeCloseTo(-2 * Math.PI, 12);
    expect(wedgeTurn(360, false)).toBeCloseTo(2 * Math.PI, 12);
    expect(wedgeTurn(0, true)).toBe(0);
    const full = displayOps({ kind: 'wedge', matrix: IDENTITY, opacity: 1, visible: true, attrs: { radius: 10, angle: 360, clockwise: true, fill: '#16150F' }, children: [] }).find((o) => o.op === 'shape');
    const fullEnds = full?.op === 'shape' ? full.path.flatMap((seg) => ('c' in seg ? [[Math.round(seg.c[4]) + 0, Math.round(seg.c[5]) + 0]] : [])) : [];
    expect(fullEnds).toEqual([
      [0, -10],
      [-10, 0],
      [0, 10],
      [10, 0],
    ]);
    const ends = (clockwise: boolean) => {
      const op = displayOps({ kind: 'wedge', matrix: IDENTITY, opacity: 1, visible: true, attrs: { radius: 10, angle: 90, clockwise, fill: '#16150F' }, children: [] }).find((o) => o.op === 'shape');
      return op?.op === 'shape' ? op.path.flatMap((seg) => ('c' in seg ? [[seg.c[4], seg.c[5]]] : [])) : [];
    };
    // Without it, from (10, 0) down to (0, 10) on the page; with it, up and round through (0, -10) and (-10, 0) to (0, 10).
    expect(ends(false).map(([x, y]) => [Math.round(x ?? 0) + 0, Math.round(y ?? 0) + 0])).toEqual([[0, 10]]);
    expect(ends(true).map(([x, y]) => [Math.round(x ?? 0) + 0, Math.round(y ?? 0) + 0])).toEqual([
      [0, -10],
      [-10, 0],
      [0, 10],
    ]);
  });

  it('reads an upper-case exponent, a leading plus and arc flags run together', () => {
    expect(parsePathData('M1E1 0 L+5 2E-0 l1e-3 +.5')).toEqual([{ m: [10, 0] }, { l: [5, 2] }, { l: [5.001, 2.5] }]);
    expect(parsePathData('M0 0 a5 5 0 105 5')).toEqual(parsePathData('M0 0 a5 5 0 1 0 5 5'));
    expect(parsePathData('M0 0a5 5 0 1110 0')).toEqual(parsePathData('M0 0 a5 5 0 1 1 10 0'));
    expect(parsePathData('M0 0 A5 5 0 0 1 10 0 5 5 0 0 1 20 0').filter((seg) => 'c' in seg).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the PNG’s painter (6.10 review)', () => {
  /** A 2D context that records what is done to it, and a Path2D that records its segments. */
  function recorder() {
    const calls: string[] = [];
    class RecordedPath {
      parts: string[] = [];
      moveTo(x: number, y: number) {
        this.parts.push(`M${String(x)},${String(y)}`);
      }
      lineTo(x: number, y: number) {
        this.parts.push(`L${String(x)},${String(y)}`);
      }
      bezierCurveTo(...v: number[]) {
        this.parts.push(`C${v.join(',')}`);
      }
      closePath() {
        this.parts.push('Z');
      }
    }
    const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', fontKerning: 'auto', textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter' };
    const saved: (typeof state)[] = [];
    const ctx = {
      ...state,
      save() {
        saved.push({ ...state, globalAlpha: ctx.globalAlpha });
        calls.push('save');
      },
      restore() {
        const back = saved.pop();
        if (back) ctx.globalAlpha = back.globalAlpha;
        calls.push('restore');
      },
      setTransform(...m: number[]) {
        calls.push(`transform ${m.map((v) => Math.round(v * 1000) / 1000).join(' ')}`);
      },
      beginPath() {},
      rect() {},
      clip() {
        calls.push('clip');
      },
      setLineDash(dash: number[]) {
        calls.push(`dash ${dash.map((v) => Math.round(v * 1000) / 1000).join(' ')}`);
      },
      fill(path: RecordedPath) {
        calls.push(`fill ${ctx.fillStyle} alpha ${String(ctx.globalAlpha)} ${path.parts.join(' ')}`);
      },
      stroke(path: RecordedPath) {
        calls.push(`stroke ${ctx.strokeStyle} width ${String(Math.round(ctx.lineWidth * 1000) / 1000)} ${path.parts.join(' ')}`);
      },
      measureText(text: string) {
        return { width: text.length * 5 };
      },
      strokeText(text: string, x: number, y: number) {
        calls.push(`strokeText ${text} ${ctx.strokeStyle} ${String(ctx.lineWidth)} at ${String(x)},${String(y)}`);
      },
      fillText(text: string, x: number, y: number) {
        calls.push(`fillText ${text} ${ctx.fillStyle} ${ctx.font} kerning ${ctx.fontKerning} at ${String(x)},${String(y)}`);
      },
      drawImage() {
        calls.push('drawImage');
      },
    };
    return { ctx, calls, RecordedPath };
  }

  it('paints paths, transparency, fixed-width lines, halos under text and pictures, unkerned, and counts a picture it can’t paint', () => {
    const { ctx, calls, RecordedPath } = recorder();
    const real = (globalThis as { Path2D?: unknown }).Path2D;
    (globalThis as { Path2D?: unknown }).Path2D = RecordedPath;
    try {
      const ops: DisplayOp[] = [
        { op: 'save' },
        { op: 'concat', m: [2, 0, 0, 2, 10, 0] },
        { op: 'opacity', value: 0.5 },
        { op: 'shape', path: [{ m: [0, 0] }, { l: [10, 0] }, { c: [10, 5, 5, 10, 0, 10] }, { z: true }], fill: 'rgba(22, 21, 15, 0.08)', stroke: '#16150F', strokeWidth: 0.6, fixedStroke: true, dash: [2, 1], cap: 'butt', join: 'miter' },
        { op: 'restore' },
        { op: 'text', lines: [{ text: 'A · 35 mm', baseline: 20 }], align: 'left', padding: 0, width: 0, family: 'JetBrains Mono', weight: 400, italic: false, size: 7, fill: '#16150F', letterSpacing: 0, stroke: { colour: '#FFFFFF', width: 1.5 } },
        { op: 'image', sha256: 'a'.repeat(64), width: 40, height: 30 },
        { op: 'image', sha256: 'b'.repeat(64), width: 40, height: 30 },
      ];
      const out = paintOps(ctx as unknown as CanvasRenderingContext2D, ops, [3, 0, 0, 3, 0, 0], (sha) => (sha.startsWith('a') ? ({} as CanvasImageSource) : null));
      expect(out).toEqual({ unprintable: 1 });
      expect(calls).toContain('transform 6 0 0 6 30 0');
      // The cone's paint at its own alpha, under the node's 50%; its fixed 0.6 pt line is 0.6 pt whatever the shape's scale of 2.
      expect(calls).toContain('fill rgba(22, 21, 15, 0.08) alpha 0.5 M0,0 L10,0 C10,5,5,10,0,10 Z');
      expect(calls).toContain('stroke #16150F width 0.3 M0,0 L10,0 C10,5,5,10,0,10 Z');
      expect(calls).toContain('dash 1 0.5');
      // The halo first, then the letters over it, set with no kerning.
      const halo = calls.indexOf('strokeText A · 35 mm #FFFFFF 1.5 at 0,20');
      const letters = calls.indexOf('fillText A · 35 mm #16150F 400 7px "JetBrains Mono" kerning none at 0,20');
      expect(halo).toBeGreaterThan(-1);
      expect(letters).toBeGreaterThan(halo);
      expect(calls.filter((c) => c === 'drawImage')).toHaveLength(1);
      expect(calls.filter((c) => c === 'save').length).toBe(calls.filter((c) => c === 'restore').length);
    } finally {
      (globalThis as { Path2D?: unknown }).Path2D = real;
    }
  });
});

// 6.10's review, round two: a page is left out only when it has nothing drawn and no frames to list, and the export
// says how many; a plan cut only when its extent doesn't fit; the clip and the grid at the drawing; the keep-with-next
// chain measured against a fresh column.

describe('what a packet leaves out (6.10 review, round two)', () => {
  /** SC 08 with no room and nothing drawn: Setup 1 holds 8A, Setup 2 nothing; and SC 05, bare, with no setup. */
  async function sparse() {
    const p = project.projectId;
    await apply([
      { kind: 'create', record: { id: 'sc8', type: 'scene', parentId: p, sortKey: '3', props: { number: '8' } } },
      { kind: 'create', record: { id: 'withFrames', type: 'setup', parentId: 'sc8', sortKey: 'a', props: { name: '' } } },
      { kind: 'create', record: { id: 'without', type: 'setup', parentId: 'sc8', sortKey: 'b', props: { name: '' } } },
      { kind: 'create', record: { id: 'h1', type: 'shot', parentId: 'sc8', sortKey: 'a', props: { number: '8A', setup_id: 'withFrames', size: 'MCU', lens_mm: 50 } } },
      { kind: 'create', record: { id: 'sc5', type: 'scene', parentId: p, sortKey: '2', props: { number: '5' } } },
    ]);
  }
  type Scope = { kind: 'project' } | { kind: 'scene'; sceneId: string };
  const views = (format: typeof planSetupPdf, target: PlanTarget | undefined, scope: Scope = { kind: 'project' }) => format.planViews?.(records(), project.projectId, target, scope) ?? [];
  const leftOut = (format: typeof planSetupPdf, target: PlanTarget | undefined, scope: Scope = { kind: 'project' }) => format.planLeftOut?.(records(), project.projectId, target, scope);

  it('prints a setup with frames and nothing drawn, its frames listed under "No room drawn", and leaves out one with neither', async () => {
    const { sceneId, setupId, otherId } = await furnished();
    await sparse();
    expect(scenePlanViews(records(), 'sc8')).toEqual([{ sceneId: 'sc8', setupId: 'withFrames' }]);
    const [page] = planPages(records(), project.projectId, scenePlanViews(records(), 'sc8'), options());
    expect(page?.plan?.noRoom).toBe(true);
    expect((page?.legend.rows ?? []).map((row) => row.pieces.map((piece) => piece.text).join(''))).toContain('8A · MCU · 50 mm');
    // The scene's packet, from the Plan tile's scene or setup and from Export Project's scene: one page, one setup left out.
    const entries: [PlanTarget | undefined, Scope][] = [
      [{ kind: 'scene', sceneId: 'sc8' }, { kind: 'project' }],
      [{ kind: 'setup', sceneId: 'sc8', setupId: 'without' }, { kind: 'project' }],
      [undefined, { kind: 'scene', sceneId: 'sc8' }],
    ];
    for (const [target, scope] of entries) {
      expect(views(planScenePdf, target, scope)).toEqual([{ sceneId: 'sc8', setupId: 'withFrames' }]);
      expect(leftOut(planScenePdf, target, scope)).toEqual({ setups: 1, scenes: 0 });
    }
    // The whole project: SC 04's two setups (its room drawn) and SC 08's Setup 1; SC 08's Setup 2 and the bare SC 05 left out.
    expect(views(planScenePdf, undefined)).toEqual([
      { sceneId, setupId },
      { sceneId, setupId: otherId },
      { sceneId: 'sc8', setupId: 'withFrames' },
    ]);
    expect(leftOut(planScenePdf, undefined)).toEqual({ setups: 1, scenes: 1 });
    expect(leftOutWords(leftOut(planScenePdf, undefined))).toEqual(['1 setup left out: nothing drawn and no frames.', '1 scene with no setup left out: nothing drawn and no frames.']);
    expect(leftOutWords({ setups: 2, scenes: 0 })).toEqual(['2 setups left out: nothing drawn and no frames.']);
    expect(leftOutWords({ setups: 0, scenes: 0 })).toEqual([]);
    setLocale('es');
    expect(leftOutWords({ setups: 2, scenes: 1 })).toEqual(['2 emplazamientos omitidos: nada dibujado y ningún cuadro.', '1 escena sin emplazamiento omitida: nada dibujado y ningún cuadro.']);
    setLocale('en');
    // The dialog's count is the pages written.
    expect(planPages(records(), project.projectId, views(planScenePdf, undefined), options())).toHaveLength(views(planScenePdf, undefined).length);
  });

  it('prints a single setup with frames or something drawn, and nothing for one with neither', async () => {
    await sparse();
    for (const format of [planSetupPdf, planSetupPng]) {
      expect(views(format, { kind: 'setup', sceneId: 'sc8', setupId: 'withFrames' })).toEqual([{ sceneId: 'sc8', setupId: 'withFrames' }]);
      expect(views(format, { kind: 'setup', sceneId: 'sc8', setupId: 'without' })).toEqual([]);
      // The scene shown with no setup: nothing drawn and no frames of its own.
      expect(views(format, { kind: 'scene', sceneId: 'sc8' })).toEqual([]);
      expect(views(format, { kind: 'scene', sceneId: 'sc5' })).toEqual([]);
    }
    // Something drawn for Setup 2 alone puts its page back, frames or not (written as records: the Plan tile places
    // nothing in a scene with no room, but an import or an older file can hold it).
    await apply([
      { kind: 'create', record: { id: 'withoutPlan', type: 'plan', parentId: 'without', sortKey: 'a', props: { kind: 'setup' } } },
      { kind: 'create', record: { id: 'flag8', type: 'plan_item', parentId: 'withoutPlan', sortKey: 'a', props: { kind: 'icon', icon: 'grip/flag', x: 0, y: 0, width: 1.2, height: 0.1, rotation: 0 } } },
    ]);
    expect(shownItems(records(), 'sc8', 'without').map((item) => item.record.id)).toEqual(['flag8']);
    expect(views(planSetupPdf, { kind: 'setup', sceneId: 'sc8', setupId: 'without' })).toEqual([{ sceneId: 'sc8', setupId: 'without' }]);
    expect(scenePlanViews(records(), 'sc8')).toEqual([
      { sceneId: 'sc8', setupId: 'withFrames' },
      { sceneId: 'sc8', setupId: 'without' },
    ]);
    expect(leftOut(planScenePdf, { kind: 'scene', sceneId: 'sc8' })).toEqual({ setups: 0, scenes: 0 });
  });
});

describe('a plan cut, the clip and the grid (6.10 review, round two)', () => {
  it('is not cut when its extent fits the drawing at 1:1000 but not with the paper’s margin round it', async () => {
    const { sceneId, setupId } = await sized(199, 149);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const area = page?.plan;
    if (!area) throw new Error('no plan');
    expect(area.scale.label).toBe('1:1000');
    const extent = planExtent(area.items);
    if (!extent) throw new Error('no extent');
    // The case itself: it fits the drawing, but not with 12 pt round it.
    expect(scaleFits(extent, area.drawing, area.scale)).toBe(true);
    expect(scaleFits(extent, area.drawing, area.scale, marginOnPaper)).toBe(false);
    expect(area.cut).toBe(false);
    expect(planPageWarnings([page])).toEqual([]);
  });

  it('clips the drawing to the drawing’s rect, above the foot band, and stops the grid there', async () => {
    const { sceneId, setupId } = await furnished();
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    if (!page?.plan) throw new Error('no plan');
    const d = page.plan.drawing;
    expect(d.height).toBeLessThan(page.plan.box.height);
    const ops = printed(page).ops;
    const at = ops.findIndex((op) => op.op === 'clip');
    expect(ops[at - 1]).toEqual({ op: 'concat', m: [1, 0, 0, 1, d.x, d.y] });
    expect(ops[at]).toEqual({ op: 'clip', x: 0, y: 0, width: d.width, height: d.height });
    // The grid's hairlines follow the clip, before the drawing.
    const grid: { x: number; y: number }[][] = [];
    for (const op of ops.slice(at + 1)) {
      if (op.op !== 'shape' || op.stroke !== RAISED) break;
      grid.push(op.path.flatMap((s: Segment) => ('m' in s ? [s.m] : 'l' in s ? [s.l] : [])).map(([x, y]) => ({ x, y })));
    }
    const vertical = grid.filter(([a, b]) => a?.x === b?.x);
    const horizontal = grid.filter(([a, b]) => a?.y === b?.y);
    expect(vertical.length).toBeGreaterThan(0);
    expect(horizontal.length).toBeGreaterThan(0);
    for (const [a, b] of vertical) expect([a?.y, b?.y]).toEqual([0, d.height]);
    for (const [a, b] of horizontal) expect([a?.x, b?.x]).toEqual([0, d.width]);
  });
});

describe('the legend’s flow, measured against a fresh column (6.10 review, round two)', () => {
  const row = (kind: LegendRow['kind'], keepWithNext: boolean, text: string, height = LEGEND_STYLE[kind].row): LegendRow => ({ kind, size: LEGEND_STYLE[kind].size, height, before: LEGEND_STYLE[kind].before, pieces: [{ text, face: 'mono', x: 0 }], keepWithNext });

  it('moves a heading, its subheading and first line to the next column whole when they fit a column but not what is left of this one', () => {
    // A 2 pt row, then FRAMES (10 pt, 7 before), a camera (11, 3 before) and its first frame (10.5): 34.5 pt in a fresh
    // 38 pt column, 41.5 with the space before it here. Measured with that space, the chain was taken as too tall for any
    // column, and FRAMES was placed alone at this column's foot.
    const rows = [row('line', false, 'tiny', 2), row('heading', true, 'FRAMES'), row('subheading', true, 'A · FX3'), row('line', false, '1A · 35 mm')];
    const columns = [
      { x: 0, y: 0, width: 180, height: 38 },
      { x: 200, y: 0, width: 180, height: 38 },
    ];
    const { placed, rest } = flowRows(rows, columns);
    expect(rest).toEqual([]);
    expect(placed.map((column) => column.map((r) => r.pieces[0]?.text))).toEqual([['tiny'], ['FRAMES', 'A · FX3', '1A · 35 mm']]);
  });
});

describe('a symbol icon on paper (6.17)', () => {
  /** Every stroked path in a PDF page's content stream, its points in PDF points: pdfFilledPaths's reading, for `S`. */
  async function pdfStrokedPaths(bytes: Uint8Array): Promise<{ x: number; y: number }[][]> {
    const pdf = await PDFDocument.load(bytes);
    const out: { x: number; y: number }[][] = [];
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Type')) || object.dict.get(PDFName.of('Subtype'))) continue;
      const text = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode());
      if (!text.includes(' cm\n')) continue;
      const stack: Matrix[] = [IDENTITY];
      let numbers: number[] = [];
      let path: { x: number; y: number }[] = [];
      for (const token of text.split(/\s+/)) {
        const m = stack[stack.length - 1] ?? IDENTITY;
        if (/^-?[\d.]+$/.test(token)) numbers.push(Number(token));
        else {
          if (token === 'q') stack.push(m);
          else if (token === 'Q') stack.pop();
          else if (token === 'cm') stack[stack.length - 1] = mul(numbers.slice(-6) as unknown as Matrix, m);
          else if (token === 'm' || token === 'l') {
            const [x = 0, y = 0] = numbers.slice(-2);
            path.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
          } else if (token === 'S' || token === 'B') {
            out.push(path);
            path = [];
          } else if (token === 'f' || token === 'n') path = [];
          numbers = [];
        }
      }
    }
    return out;
  }
  const heightOf = (points: readonly { y: number }[]) => Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
  const mmOf = (points: readonly { x: number; y: number }[]) => [Math.round((widthOf(points) / PT_PER_MM) * 10) / 10, Math.round((heightOf(points) / PT_PER_MM) * 10) / 10];

  it('prints a 6 × 2.5 m Parking’s outline 120 × 50 mm at 1:50, the P’s square inside it square, in the list and the PDF', async () => {
    const { sceneId, setupId } = await furnished();
    const parking = crypto.randomUUID();
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'production/parking', { x: 0, y: 1.5 }, parking));
    await apply([{ kind: 'update', id: parking, set: { x: -3, y: 0.25, width: 6, height: 2.5 } }]);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    if (!page?.plan) throw new Error('no plan');
    expect(page.plan.scale.label).toBe('1:50');
    const list = printed(page);
    const outlines = pagePaths(list.ops).filter((p) => p.fill === null && p.points.length === 4).map((p) => mmOf(p.points));
    expect(outlines).toContainEqual([120, 50]);
    // The kit's own square round the P, at its natural 1:1, as tall as the outline less its margins (2.5 m less 2 × 8 %).
    expect(outlines).toContainEqual([42, 42]);
    const inPdf = (await pdfStrokedPaths((await write([list])).bytes)).filter((p) => p.length === 4).map(mmOf);
    expect(inPdf).toContainEqual([120, 50]);
    expect(inPdf).toContainEqual([42, 42]);
  });
});

describe('per-department prints (6.17)', () => {
  const rowsOf = (page: PlanPage | undefined) => (page?.legend.rows ?? []).map((row) => row.pieces.map((piece) => piece.text).join(''));
  /** The fill alphas of a written PDF's first page (its ExtGStates' `ca`). */
  async function alphasOf(bytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(bytes);
    const states = doc.getPages()[0]?.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
    const out: number[] = [];
    for (const [, state] of states?.entries() ?? []) out.push(Number(String(doc.context.lookup(state, PDFDict).get(PDFName.of('ca')))));
    return out;
  }

  it('prints one department: the room and its own items, its legend alone, the department named after the setup', async () => {
    const { sceneId, setupId, camera, light, flag, wallId } = await furnished();
    const views = departmentViews(records(), [{ sceneId, setupId }], 'lighting');
    expect(views).toEqual([{ sceneId, setupId, department: 'lighting' }]);
    const [page, more] = planPages(records(), project.projectId, views, options());
    expect(more).toBeUndefined();
    const ids = page?.plan?.items.map((item) => item.id) ?? [];
    // The room as context (its walls), the light; the camera as context, dimmed (Kevin, Nov 15); the flag left out entirely.
    expect(ids).toContain(wallId);
    expect(ids).toContain(light);
    expect(ids).toContain(camera);
    expect(ids).not.toContain(flag);
    expect(page?.plan?.items.filter((item) => item.dim === true).map((item) => item.id)).toEqual([camera]);
    expect(page?.header.setup).toBe('Setup 1 · Lighting');
    // Only what is drawn: lighting's line and its total; no camera, no grip, no frames.
    expect(rowsOf(page)).toEqual(['LIGHTING', 'Fresnel · 2.40 m · 650 W', 'Total 650 W']);
    // Everything (the default) is the very view list it always was.
    expect(departmentViews(records(), [{ sceneId, setupId }], 'everything')).toEqual([{ sceneId, setupId }]);
  });

  it('prints each department with something in the setup, in the layers’ order, and nothing for one with nothing', async () => {
    const { sceneId, setupId, otherId } = await furnished();
    // The art department has only the room's walls here: nothing of its own, so no page. Setup 2 has nothing at all.
    const views = departmentViews(records(), [{ sceneId, setupId }, { sceneId, setupId: otherId }], 'each');
    expect(views.map((v) => [v.setupId, v.department])).toEqual([
      [setupId, 'camera'],
      [setupId, 'lighting'],
      [setupId, 'grip'],
    ]);
    const pages = planPages(records(), project.projectId, views, options());
    expect(pages.map((pg) => pg.header.setup)).toEqual(['Setup 1 · Camera', 'Setup 1 · Lighting', 'Setup 1 · Grip']);
    expect(pages.map((pg) => pg.header.page)).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
    // The camera's page lists its frames and lenses; the grip's its flag alone.
    expect(rowsOf(pages[0])).toEqual(['CAMERA', 'A · Camera', 'FRAMES', 'A · Sony FX3, Full frame 16:9', '1A · MS · 35 mm · 53.9°', '1B · CU']);
    expect(rowsOf(pages[2])).toEqual(['GRIP', 'Flag · 2×3']);
    // A department asked for alone with nothing in a setup prints nothing there.
    expect(departmentViews(records(), [{ sceneId, setupId: otherId }], 'lighting')).toEqual([]);
    // Art's print is the room and its set pieces: once a sofa is placed, it has a page with the walls and the sofa.
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'set-art/sofa', { x: 0, y: 2 }, 'sofa'));
    const [art] = departmentViews(records(), [{ sceneId, setupId }], 'set-art');
    expect(art?.department).toBe('set-art');
    const [artPage] = planPages(records(), project.projectId, art ? [art] : [], options());
    const kinds = (artPage?.plan?.items ?? []).map((item) => item.id);
    expect(kinds).toContain('sofa');
    expect(artPage?.header.setup).toBe('Setup 1 · Set and art');
  });

  it('prints an item with no layer (an icon a newer version wrote) on every department’s page, as context (6.17 review)', async () => {
    const { sceneId, setupId, camera } = await furnished();
    const newer = crypto.randomUUID();
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'set-art/sofa', { x: 0, y: 2 }, newer));
    await apply([{ kind: 'update', id: newer, set: { icon: 'vfx/smoke-machine' } }]);
    expect(shownItems(records(), sceneId, setupId).some((item) => item.record.id === newer)).toBe(true);
    const views = departmentViews(records(), [{ sceneId, setupId }], 'each');
    // It gives no department a page of its own: the same three as before.
    expect(views.map((v) => v.department)).toEqual(['camera', 'lighting', 'grip']);
    const pages = planPages(records(), project.projectId, views, options());
    for (const page of pages) expect(page.plan?.items.map((item) => item.id), page.header.setup ?? '').toContain(newer);
    // The camera is on every page (Kevin, Nov 15): in full on the camera's, dimmed as context on the others.
    expect(pages.map((page) => page.plan?.items.find((item) => item.id === camera)?.dim === true)).toEqual([false, true, true]);
    expect(pages.map((page) => page.plan?.items.some((item) => item.id === camera))).toEqual([true, true, true]);
  });

  it('writes the lighting print’s PDF with the light’s beam and without the camera’s cone', async () => {
    const { sceneId, setupId } = await furnished();
    const [everything] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const [lighting] = planPages(records(), project.projectId, departmentViews(records(), [{ sceneId, setupId }], 'lighting'), options());
    // Everything's page has both: the cone, ink at 8%, and the beam, the lighting colour at 18%.
    const both = await alphasOf((await write([printed(everything as PlanPage)])).bytes);
    expect(both).toContain(0.08);
    expect(both).toContain(0.18);
    const pdf = await write([printed(lighting as PlanPage)]);
    const alphas = await alphasOf(pdf.bytes);
    expect(alphas).toContain(0.18);
    expect(alphas).not.toContain(0.08);
    const [text] = await pdfText(pdf.bytes);
    expect(text).toContain('Setup 1 · Lighting');
    expect(text).toContain('Fresnel');
    expect(text).not.toContain('Sony FX3');
  });
});

// 6.18: walls stop cones and beams on paper, from the same shapes as the screen. furnished()'s camera stands at (0, 1)
// facing up, its 35 mm on the FX3 about 54° wide; a 10 m wall across at y = -0.5 (its near face at -0.45, 1.45 m from
// the camera) with a 0.9 m door in its middle stops it there, and the door's strip carries on to the free-standing 4 m
// wall at y = -3 (face -2.95), as wide there as the rays through the door's far corners (±0.45, -0.55) make it:
// ±0.45 × 3.95 / 1.55 = ±1.147, inside that wall's ±2.
describe('walls stop the cone on paper (6.18)', () => {
  /** The world (metres) to the PDF's points, from two walls' filled outlines: a scale of `s` per metre, maybe flipped in y. */
  function mapping(paths: readonly { x: number; y: number }[][], s: number) {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const box = (p: readonly { x: number; y: number }[]) => ({ minX: Math.min(...p.map((q) => q.x)), maxX: Math.max(...p.map((q) => q.x)), minY: Math.min(...p.map((q) => q.y)), maxY: Math.max(...p.map((q) => q.y)) });
    const across = paths.map(box).find((b) => near(b.maxX - b.minX, 10 * s) && near(b.maxY - b.minY, 0.1 * s));
    const lower = paths.map(box).find((b) => near(b.maxX - b.minX, 8 * s) && near(b.maxY - b.minY, 0.1 * s));
    if (!across || !lower) throw new Error('no walls on the page');
    // The 8 m wall is at y = 3, the 10 m one at y = -0.5: which way is down on the page.
    const flip = lower.minY < across.minY ? -1 : 1;
    const midY = (across.minY + across.maxY) / 2;
    const midX = (across.minX + across.maxX) / 2;
    return { toWorld: (p: { x: number; y: number }) => ({ x: (p.x - midX) / s, y: -0.5 + (flip * (p.y - midY)) / s }) };
  }

  it('prints the cone ending at the wall’s face, and through its door to the next wall', async () => {
    const { sceneId, setupId } = await furnished();
    const across = drawWallsChanges(records(), sceneId, [
      { x: -500, y: -50 },
      { x: 500, y: -50 },
    ]);
    await apply(across.changes);
    const wallId = across.ids[0] ?? '';
    const roomId = records()[wallId]?.parentId ?? '';
    await apply([{ kind: 'create', record: { id: 'door', type: 'plan_item', parentId: roomId, sortKey: 'z', props: openingProps('door', wallId, 5) } }]);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const s = (page?.plan?.pointsPerUnit ?? 0) * 100;
    const paths = await pdfFilledPaths((await write([printed(page as PlanPage)])).bytes);
    const { toWorld } = mapping(paths, s);
    // The cone: the filled path with a corner at the camera's middle.
    const cone = paths.map((p) => p.map(toWorld)).find((p) => p.some((q) => Math.hypot(q.x, q.y - 1) < 0.01) && p.length > 3);
    if (!cone) throw new Error('no cone');
    const others = cone.filter((q) => Math.hypot(q.x, q.y - 1) > 0.01);
    // Nothing past the 4 m wall's face; corners on the near wall's face, and through the door on the far one.
    for (const q of others) expect(q.y).toBeGreaterThan(-2.95 - 0.01);
    expect(others.some((q) => Math.abs(q.y + 0.45) < 0.01 && Math.abs(q.x) > 0.6)).toBe(true);
    const through = others.filter((q) => Math.abs(q.y + 2.95) < 0.01);
    expect(through.length).toBeGreaterThan(1);
    expect(Math.max(...through.map((q) => Math.abs(q.x)))).toBeCloseTo(1.147, 1);
    // Past the near wall, only the door's strip.
    for (const q of others.filter((p) => p.y < -0.55 - 0.01)) expect(Math.abs(q.x)).toBeLessThan(1.147 + 0.02);
  });

  it('prints a cut all-round light’s glow as bands, each its circle cut flat at the wall (6.18 second review, item 2)', async () => {
    // A china ball (all round, 4 m) at (3, 0.5), under the 10 m wall across at y = -0.5 (face -0.45, 0.95 m above it) and
    // over furnished()'s 8 m wall at y = 3 (face 2.95, 2.45 m below). Its 8 bands are 0.5 m to 4 m. The 0.5 m band meets
    // no wall: a whole circle. The 1.5 m band is cut flat at the near face (nothing above y = -0.45) and is its circle
    // elsewhere: before the review every band's corners were the shape's own brought in, a flat chord in every band.
    const { sceneId, setupId } = await furnished();
    await apply(
      drawWallsChanges(records(), sceneId, [
        { x: -500, y: -50 },
        { x: 500, y: -50 },
      ]).changes,
    );
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'lighting/china-ball', { x: 3, y: 0.5 }, 'ball'));
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const s = (page?.plan?.pointsPerUnit ?? 0) * 100;
    const paths = await pdfFilledPaths((await write([printed(page as PlanPage)])).bytes);
    const { toWorld } = mapping(paths, s);
    const from = (q: { x: number; y: number }) => Math.hypot(q.x - 3, q.y - 0.5);
    const bands = paths.map((p) => p.map(toWorld)).filter((p) => p.length > 100 && p.every((q) => from(q) < 4.02));
    const reach = (p: readonly { x: number; y: number }[]) => Math.max(...p.map(from));
    expect(bands).toHaveLength(8);
    const smallest = bands.find((p) => Math.abs(reach(p) - 0.5) < 0.01);
    if (!smallest) throw new Error('no 0.5 m band');
    for (const q of smallest) expect(Math.abs(from(q) - 0.5)).toBeLessThan(0.005);
    const third = bands.find((p) => Math.abs(reach(p) - 1.5) < 0.01);
    if (!third) throw new Error('no 1.5 m band');
    for (const q of third) expect(q.y).toBeGreaterThan(-0.45 - 0.01);
    expect(third.some((q) => Math.abs(q.y + 0.45) < 0.01)).toBe(true);
    for (const q of third.filter((p) => p.y > -0.4)) expect(Math.abs(from(q) - 1.5)).toBeLessThan(0.005);
  });

  it('prints the whole cone with Stop at walls off', async () => {
    const { sceneId, setupId, camera } = await furnished();
    await apply(drawWallsChanges(records(), sceneId, [
      { x: -500, y: -50 },
      { x: 500, y: -50 },
    ]).changes);
    await apply([{ kind: 'update', id: camera, set: { stop_at_walls: false } }]);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options());
    const s = (page?.plan?.pointsPerUnit ?? 0) * 100;
    const paths = await pdfFilledPaths((await write([printed(page as PlanPage)])).bytes);
    const { toWorld } = mapping(paths, s);
    // The three corners of the whole cone: the middle and its far ends 6 m out, past both walls.
    const cone = paths.map((p) => p.map(toWorld)).find((p) => p.length === 3 && p.some((q) => Math.hypot(q.x, q.y - 1) < 0.01));
    if (!cone) throw new Error('no cone');
    expect(Math.min(...cone.map((q) => q.y))).toBeLessThan(-4);
  });
});

// Kevin, Nov 15: a department's print shows the cameras with their cones and the cast marks as context, dimmed by the
// canvas core's one dim, that department's own items in full; the legend lists its own lines alone.
describe('what a department print shows (Kevin, Nov 15)', () => {
  const rowsOf = (page: PlanPage | undefined) => (page?.legend.rows ?? []).map((row) => row.pieces.map((piece) => piece.text).join(''));
  const round = (value: number) => Math.round(value * 1000) / 1000;
  /** The opacity each shape of a display list is drawn at, its groups' opacities multiplied, as the PDF writer sets them. */
  function shapeOpacities(ops: readonly DisplayOp[]): number[] {
    const stack: number[] = [];
    let now = 1;
    const out: number[] = [];
    for (const op of ops) {
      if (op.op === 'save') stack.push(now);
      else if (op.op === 'restore') now = stack.pop() ?? 1;
      else if (op.op === 'opacity') now *= op.value;
      else if (op.op === 'shape') out.push(round(now));
    }
    return out;
  }
  /** The opacities of one item's shapes, drawn alone on its page. */
  const itemOpacities = (page: PlanPage, id: string): number[] => {
    const area = page.plan;
    if (!area) throw new Error('no plan');
    const items = area.items.filter((item) => item.id === id);
    expect(items).toHaveLength(1);
    return shapeOpacities(displayOps(stageOf({ ...area, items })));
  };
  const withMark = async () => {
    const made = await furnished();
    const mark = 'tape';
    await apply(placeMarkChanges(records(), { sceneId: made.sceneId, setupId: made.setupId }, { x: -1, y: 1 }, PLAIN_MARK_SIZE, null, mark));
    return { ...made, mark };
  };
  const pageOf = (sceneId: string, setupId: string, department: PlanLayer) => {
    const [view] = departmentViews(records(), [{ sceneId, setupId }], department);
    if (!view) throw new Error('no view');
    return planPages(records(), project.projectId, [view], options())[0] as PlanPage;
  };

  it('prints the camera’s body and cone and a cast mark dimmed on lighting’s page, the light in full, and lighting’s legend alone', async () => {
    const { sceneId, setupId, camera, light, mark, flag } = await withMark();
    const page = pageOf(sceneId, setupId, 'lighting');
    const ids = page.plan?.items.map((item) => item.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([camera, light, mark]));
    expect(ids).not.toContain(flag);
    // The camera: its body at the dim, its cone (ink at 8%) at 8% of the dim.
    const cameraAt = itemOpacities(page, camera);
    expect(cameraAt).toContain(round(DIM_OPACITY));
    expect(cameraAt).toContain(round(DIM_OPACITY * 0.08));
    expect(Math.max(...cameraAt)).toBe(round(DIM_OPACITY));
    expect(Math.max(...itemOpacities(page, mark))).toBe(round(DIM_OPACITY));
    // The light in full: its body at 1, its beam at 18%.
    const lightAt = itemOpacities(page, light);
    expect(lightAt).toContain(1);
    expect(lightAt).toContain(0.18);
    // The legend: lighting's lines only, no camera, cast or frames.
    expect(rowsOf(page)).toEqual(['LIGHTING', 'Fresnel · 2.40 m · 650 W', 'Total 650 W']);
    // The written PDF carries the dimmed cone as real transparency.
    const doc = await PDFDocument.load((await write([printed(page)])).bytes);
    const states = doc.getPages()[0]?.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
    const alphas = [...(states?.entries() ?? [])].map(([, state]) => Number(String(doc.context.lookup(state, PDFDict).get(PDFName.of('ca')))));
    expect(alphas).toContain(round(DIM_OPACITY * 0.08));
    expect(alphas).toContain(0.18);
  });

  it('prints the camera’s page with its cameras in full and the marks dimmed, and the cast blocking page the other way round', async () => {
    const { sceneId, setupId, camera, mark } = await withMark();
    const cameraPage = pageOf(sceneId, setupId, 'camera');
    expect(cameraPage.plan?.items.find((item) => item.id === camera)?.dim).not.toBe(true);
    expect(cameraPage.plan?.items.find((item) => item.id === mark)?.dim).toBe(true);
    expect(Math.max(...itemOpacities(cameraPage, camera))).toBe(1);
    expect(itemOpacities(cameraPage, camera)).toContain(0.08);
    expect(Math.max(...itemOpacities(cameraPage, mark))).toBe(round(DIM_OPACITY));
    const castPage = pageOf(sceneId, setupId, 'cast');
    expect(castPage.plan?.items.find((item) => item.id === mark)?.dim).not.toBe(true);
    expect(castPage.plan?.items.find((item) => item.id === camera)?.dim).toBe(true);
    expect(Math.max(...itemOpacities(castPage, mark))).toBe(1);
    expect(Math.max(...itemOpacities(castPage, camera))).toBe(round(DIM_OPACITY));
  });

  it('gives a department whose setup holds only cameras and marks as context no page', async () => {
    const p = project.projectId;
    const sceneId = crypto.randomUUID();
    const setupId = crypto.randomUUID();
    await apply([
      { kind: 'create', record: { id: sceneId, type: 'scene', parentId: p, sortKey: '1', props: { number: '9' } } },
      { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    ]);
    await apply(startRoomChanges(records(), p, sceneId));
    await apply(drawWallsChanges(records(), sceneId, [{ x: -300, y: -300 }, { x: 300, y: -300 }]).changes);
    await apply(placeIconChanges(records(), { sceneId, setupId }, 'camera/camera', { x: 0, y: 1 }));
    await apply(placeMarkChanges(records(), { sceneId, setupId }, { x: 1, y: 0 }, PLAIN_MARK_SIZE));
    expect(departmentViews(records(), [{ sceneId, setupId }], 'each').map((view) => view.department)).toEqual(['camera', 'cast']);
    expect(departmentViews(records(), [{ sceneId, setupId }], 'lighting')).toEqual([]);
    expect(departmentViews(records(), [{ sceneId, setupId }], 'grip')).toEqual([]);
  });
});

// Kevin, Nov 15: a plan's watermark goes inside its plan box, inset from the frame line, never over the legend, the
// header or the scale bar; the PDF and the PNG take its box from one function.
describe('the watermark inside the plan box (Kevin, Nov 15)', () => {
  type Box = { x: number; y: number; width: number; height: number };
  const stamp = (text: string, position: WatermarkPosition): Watermark => ({ text, position, opacity: 0.35, appliesTo: ['pdf', 'png'] });
  /** The text's width as the test's PDF writer measures it: its fonts give Inter Tight Bold for weight 600. */
  const widthAt = (text: string) => (size: number) => measure(text, 'sansBold', size);
  const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** A plan page on the paper: the legend at the right (a room 8 by 6 m) or as a band at its foot (30 by 4 m). */
  const layout = async (paper: 'a4' | 'letter', wide: boolean) => {
    const { sceneId, setupId } = await sized(wide ? 30 : 8, wide ? 4 : 6);
    const [page] = planPages(records(), project.projectId, [{ sceneId, setupId }], options({ paper }));
    if (!page?.plan) throw new Error('no plan');
    return page;
  };

  it('puts every position inside the plan box less the inset, clear of the legend, the header and the foot band, on A4 and Letter', async () => {
    for (const paper of ['a4', 'letter'] as const) {
      for (const wide of [false, true]) {
        const page = await layout(paper, wide);
        const area = page.plan as PlanArea;
        // The legend where the layout puts it.
        if (wide) expect(page.legend.box.y).toBeGreaterThan(area.box.y + area.box.height);
        else expect(page.legend.box.x).toBeGreaterThan(area.box.x + area.box.width);
        const room = printed(page).watermarkRoom;
        if (!room) throw new Error('no room for the stamp');
        expect(room.box).toEqual(area.box);
        const inset = stampInset(page.size);
        expect(inset).toBeGreaterThanOrEqual(4 * PT_PER_MM);
        const band = footBand(area);
        const header = { x: PAGE_MARGIN, y: PAGE_MARGIN, width: page.size.width - 2 * PAGE_MARGIN, height: HEADER_HEIGHT };
        const most = Math.max(8, Math.min(page.size.width, page.size.height) * 0.045);
        for (const position of POSITIONS) {
          const box = planStampBox(room, page.size, position, widthAt('DRAFT STAMP'));
          const what = `${paper} ${wide ? 'band' : 'column'} ${position}`;
          expect(box.size, what).toBeCloseTo(most, 9);
          expect(box.x, what).toBeGreaterThanOrEqual(area.box.x + inset - 1e-9);
          expect(box.x + box.width, what).toBeLessThanOrEqual(area.box.x + area.box.width - inset + 1e-9);
          expect(box.y, what).toBeGreaterThanOrEqual(area.box.y + inset - 1e-9);
          expect(box.y + box.height, what).toBeLessThanOrEqual(band.y - inset + 1e-9);
          expect(meets(box, page.legend.box), what).toBe(false);
          expect(meets(box, header), what).toBe(false);
          expect(meets(box, band), what).toBe(false);
          // Its corner, inset from the frame line (the bottom ones from the foot band's rule), or the box's middle.
          if (position.endsWith('left')) expect(box.x, what).toBeCloseTo(area.box.x + inset, 9);
          if (position.endsWith('right')) expect(box.x + box.width, what).toBeCloseTo(area.box.x + area.box.width - inset, 9);
          if (position.startsWith('top')) expect(box.y, what).toBeCloseTo(area.box.y + inset, 9);
          if (position.startsWith('bottom')) expect(box.y + box.height, what).toBeCloseTo(band.y - inset, 9);
          if (position === 'center') expect(box.x + box.width / 2, what).toBeCloseTo(area.box.x + area.box.width / 2, 9);
        }
      }
    }
  });

  it('sets an oversized stamp smaller so it fits whole, never cut', async () => {
    const page = await layout('a4', false);
    const area = page.plan as PlanArea;
    const room = printed(page).watermarkRoom;
    if (!room) throw new Error('no room for the stamp');
    const inset = stampInset(page.size);
    const long = 'FOR REVIEW ONLY · NOT FOR DISTRIBUTION · '.repeat(4);
    for (const position of POSITIONS) {
      const box = planStampBox(room, page.size, position, widthAt(long));
      expect(box.size, position).toBeLessThan(Math.min(page.size.width, page.size.height) * 0.045);
      // The whole text and its outline in the box: its width as measured at the size it is set.
      expect(box.width, position).toBeCloseTo(widthAt(long)(box.size) + Math.max(1.5, box.size / 6), 9);
      expect(box.x, position).toBeGreaterThanOrEqual(area.box.x + inset - 1e-9);
      expect(box.x + box.width, position).toBeLessThanOrEqual(area.box.x + area.box.width - inset + 1e-9);
      expect(box.width, position).toBeGreaterThan(area.box.width - 2 * inset - 2);
    }
  });

  it('sits a bottom-left stamp above the scale bar, never on it', async () => {
    const page = await layout('letter', false);
    const area = page.plan as PlanArea;
    const room = printed(page).watermarkRoom;
    if (!room) throw new Error('no room for the stamp');
    const box = planStampBox(room, page.size, 'bottom-left', widthAt('DRAFT STAMP'));
    const band = footBand(area);
    // The bar is drawn 19 pt into the band, its words above it: all of it under the band's rule.
    const bar = { x: band.x + 8, y: band.y + 19, width: area.bar.length * area.pointsPerUnit, height: 3.5 };
    expect(meets(box, bar)).toBe(false);
    expect(box.y + box.height).toBeLessThan(band.y);
  });

  it('writes the PDF’s stamp in that box on every plan page, none on a legend’s own page, and paints the PNG’s in the same box', async () => {
    const page = await layout('a4', false);
    const room = printed(page).watermarkRoom;
    if (!room) throw new Error('no room for the stamp');
    const legendOnly: PlanPage = { ...page, plan: null };
    expect(printed(legendOnly).watermarkRoom).toBeNull();
    const watermark = stamp('DRAFT STAMP', 'bottom-right');
    const bytes = (await writeDeckPdf({ title: 'Plan', pageCount: 3, page: (i) => Promise.resolve(printed(i === 1 ? legendOnly : page)), fonts, pictures: noPictures, watermark })).bytes;
    const texts = await pdfText(bytes);
    expect(texts.map((text) => text.includes('DRAFT STAMP'))).toEqual([true, false, true]);
    // Where pdf.js finds its text: the box's text start and baseline (the PDF's y up), at its size.
    const box = planStampBox(room, page.size, 'bottom-right', widthAt('DRAFT STAMP'));
    const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const found = (await (await doc.getPage(1)).getTextContent()).items.flatMap((item) => ('str' in item && item.str.includes('DRAFT') ? [item.transform as number[]] : []));
    await doc.destroy();
    expect(found.length).toBeGreaterThan(0);
    for (const transform of found) {
      expect(transform[4] ?? 0).toBeCloseTo(box.textX, 1);
      expect(transform[5] ?? 0).toBeCloseTo(page.size.height - box.baseline, 1);
      expect(transform[0] ?? 0).toBeCloseTo(box.size, 3);
    }
    // The PNG: the same box, from the same function, at the picture's pixels a point.
    const scale = 200 / 72;
    const drawn: { x: number; y: number }[] = [];
    const ctx = {
      font: '',
      save: () => undefined,
      restore: () => undefined,
      measureText(text: string) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 0);
        return { width: measure(text, 'sansBold', px / scale) * scale };
      },
      strokeText(_text: string, x: number, y: number) {
        drawn.push({ x, y });
      },
      fillText(_text: string, x: number, y: number) {
        drawn.push({ x, y });
      },
    };
    drawPlanStamp(ctx as unknown as Parameters<typeof drawPlanStamp>[0], watermark, room, page.size, scale);
    expect(drawn).toHaveLength(2);
    for (const at of drawn) {
      expect(at.x).toBeCloseTo(box.textX * scale, 6);
      expect(at.y).toBeCloseTo(box.baseline * scale, 6);
    }
  });
});

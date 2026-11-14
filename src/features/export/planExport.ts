import { isTauriApp } from '../../app/fileAccess';
import { planUnitNow } from '../../app/planUnits';
import { paperNow } from '../../app/paper';
import { timeZoneAt } from '../../app/timeZone';
import { canvasBlob } from '../../core/media/canvas';
import { decodedPicture } from '../../core/media/decoded';
import { t, tn } from '../../core/i18n';
import { isSun, shownItems } from '../../core/model/plan';
import { sunZonePoint } from '../../core/model/planSun';
import type { SbdRecord } from '../../core/model/record';
import { sceneSetups } from '../../core/model/setup';
import { projectShootDays } from '../../core/model/shootDay';
import { sceneFields } from '../../core/model/storyboard';
import type { ProjectFile } from '../../core/storage/driver';
import { underlayPictures } from '../birdseye/plan/underlayEdits';
import { deckPdfWarnings } from './deckPdf';
import { deckFontLoader } from './deckFonts';
import { pictureLoader } from './deckPictures';
import type { PrintPage } from './deckPdfWriter';
import { paintOps } from './displayPaint';
import { paddedScene, safeName } from './names';
import { writingStatus } from './pdfStoryboardFormat';
import { dayPlanViews, planPages, projectPlanViews, scaleWords, scenePlanViews, type PlanPage, type PlanView } from './planPages';
import { bundledMeasure, planDrawing, planPrintPage, preparePlanFonts, preparePlanPictures } from './planRender';
import type { ExportContext, ExportFormat, ExportResult } from './registry';
import type { ExportScope } from './scope';

// Plans on paper (6.10, docs/PHASE6_DECISIONS.md 14) as export formats: a setup's plan as a PDF and as a PNG, a scene's
// plans and a shoot day's as one PDF each. The pages are planPages.ts's; each is drawn (planRender.tsx) when its turn
// comes, written by the deck's PDF writer or painted at 200 dpi. Never themed and never this computer's view: every
// layer prints, nothing is selected, and the paper is Letter or A4 by region, as call sheets (or as chosen).

type Records = Readonly<Record<string, SbdRecord>>;

/** What a plan export is for, from where it was asked: the Plan tile's setup or scene, or a day in Shoot days. */
export type PlanTarget = { kind: 'setup'; sceneId: string; setupId: string | null } | { kind: 'scene'; sceneId: string } | { kind: 'day'; dayId: string };

/** The PNG's resolution (decision 14 brief). */
export const PNG_DPI = 200;

/** The views a plan export prints, in order: from its target, else (Export Project) the scene in scope or every scene. */
export function planViewsFor(records: Records, projectId: string, target: PlanTarget | undefined, scope: ExportScope): PlanView[] {
  if (target?.kind === 'setup') return records[target.sceneId]?.trashedAt === null ? [{ sceneId: target.sceneId, setupId: target.setupId }] : [];
  if (target?.kind === 'scene') return records[target.sceneId]?.trashedAt === null ? scenePlanViews(records, target.sceneId) : [];
  if (target?.kind === 'day') return dayPlanViews(records, projectId, target.dayId);
  return scope.kind === 'scene' ? scenePlanViews(records, scope.sceneId) : projectPlanViews(records, projectId);
}

/** Each sun path's zone, looked up as the Plan tile looks it up: by Rust on the desktop; the browser build has none ("No time zone"). */
async function zonesFor(records: Records, views: readonly PlanView[]): Promise<Map<string, string | null>> {
  const zones = new Map<string, string | null>();
  for (const view of views) {
    for (const item of shownItems(records, view.sceneId, view.setupId)) {
      if (!isSun(item.fields)) continue;
      const point = sunZonePoint(records, item.record.id);
      if (!point || zones.has(point.id)) continue;
      zones.set(point.id, isTauriApp ? await timeZoneAt(point.latitude, point.longitude) : null);
    }
  }
  return zones;
}

/** The pictures the views' underlays draw, by hash. */
const underlayShas = (records: Records, views: readonly PlanView[]): string[] => [...new Set(views.flatMap((view) => [...underlayPictures(records, shownItems(records, view.sceneId, view.setupId)).values()]))];

interface Made {
  pages: PlanPage[];
  draw: (index: number) => Promise<PrintPage>;
}

/** The pages laid out, and a way to draw each as the writer takes it. */
async function makePages(context: ExportContext, views: readonly PlanView[]): Promise<Made> {
  const { records, projectId, file } = context;
  await preparePlanFonts();
  const measure = await bundledMeasure();
  const zones = await zonesFor(records, views);
  const underlay = context.planUnderlay ?? true;
  if (underlay) await preparePlanPictures(file, underlayShas(records, views));
  const pages = planPages(records, projectId, views, {
    paper: context.paper ?? paperNow(),
    unit: planUnitNow(),
    underlay,
    grid: context.planGrid ?? true,
    title: context.title,
    now: new Date(),
    zones,
    measure,
  });
  return {
    pages,
    draw: async (index) => {
      const page = pages[index];
      if (!page) throw new Error(t('export.cantDraw'));
      const drawing = page.plan ? await planDrawing(page.plan) : null;
      return planPrintPage(page, drawing, { scale: page.plan ? scaleWords(page.plan.scale) : '', noRoom: t('export.plan.noRoom'), legend: t('legend.title') }, measure);
    },
  };
}

/** The views, or the reason there is nothing to print. */
function viewsOrRefuse(context: ExportContext): PlanView[] {
  const views = planViewsFor(context.records, context.projectId, context.plan, context.scope);
  if (views.length === 0) throw new Error(t('export.plan.nothing'));
  return views;
}

/** The pages as one PDF, written to the target under `name`. */
async function writePlanPdf(context: ExportContext, name: string): Promise<ExportResult> {
  const views = viewsOrRefuse(context);
  const { pages, draw } = await makePages(context, views);
  context.progress(0, pages.length);
  // pdf-lib loads only when a plan is exported, as for the deck's PDF.
  const { writeDeckPdf } = await import('./deckPdfWriter');
  const pdf = await writeDeckPdf({
    title: name.replace(/\.pdf$/i, ''),
    pageCount: pages.length,
    page: draw,
    fonts: deckFontLoader,
    pictures: pictureLoader(context.file),
    watermark: null,
    progress: (done, total) => {
      context.progress(done, total, done === total ? writingStatus() : undefined);
    },
    signal: context.signal,
  });
  // A Stop pressed while the PDF was put together: nothing goes to disk.
  context.signal.throwIfAborted();
  await context.target.write(name, pdf.bytes);
  const warnings = deckPdfWarnings(pdf.fontNotes, pdf.storedCopies, pdf.unprintable);
  const what = tn('count.pages', pages.length);
  return warnings.length === 0 ? { what } : { what, warning: warnings.join(' ') };
}

/** A page painted at PNG_DPI on white, as PNG bytes; its pictures at the size the project stores them. */
export async function paintPage(page: PrintPage, file: ProjectFile): Promise<Uint8Array> {
  const scale = PNG_DPI / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error(t('export.cantDraw'));
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  paintOps(ctx, page.ops, [scale, 0, 0, scale, 0, 0], (sha) => decodedPicture(file, sha, 'original') ?? decodedPicture(file, sha, 'thumbnail') ?? null);
  const blob = await canvasBlob(canvas, 'image/png');
  if (!blob) throw new Error(t('export.cantDraw'));
  return new Uint8Array(await blob.arrayBuffer());
}

// The names (decision 14 brief): "Bey County SC004 Setup 2 plan.pdf", "Bey County SC004 plans.pdf", "Bey County Day 2
// plans.pdf", the words and their order the language's (export.fileName), the scene number padded as a frame's file is.

const named = (name: string, what: string, extension: string): string => `${safeName(t('export.fileName', { name, what }))}.${extension}`;

/** "SC004": the scene's slate in a file's name, the same in every language, as frames' files are named. */
const sceneSlate = (records: Records, sceneId: string): string => `SC${paddedScene(sceneFields(records[sceneId]?.props ?? {}).number)}`;

export function planFileName(title: string, records: Records, target: PlanTarget, extension: 'pdf' | 'png'): string {
  if (target.kind === 'day') {
    const day = projectShootDays(records, records[target.dayId]?.parentId ?? '').find((d) => d.record.id === target.dayId);
    return named(`${title} ${t('shootDay.label', { number: day?.number ?? 0 })}`, t('export.plan.packetWord'), extension);
  }
  const scene = `${title} ${sceneSlate(records, target.sceneId)}`;
  if (target.kind === 'scene') return named(scene, t('export.plan.packetWord'), extension);
  const setup = target.setupId === null ? undefined : sceneSetups(records, target.sceneId).find((s) => s.record.id === target.setupId);
  return named(setup ? `${scene} ${t('setup.label', { number: setup.number })}` : scene, t('export.plan.fileWord'), extension);
}

/** Export Project's name for the scene packet: the scene's, or the project's for every scene. */
function packetName(title: string, records: Records, scope: ExportScope): string {
  return scope.kind === 'scene' ? planFileName(title, records, { kind: 'scene', sceneId: scope.sceneId }, 'pdf') : named(title, t('export.plan.packetWord'), 'pdf');
}

export const planSetupPdf: ExportFormat = {
  id: 'plan-setup-pdf',
  get label() {
    return t('export.plan.setupPdf.label');
  },
  get description() {
    return t('export.plan.setupPdf.description');
  },
  output: 'file',
  plans: 'view',
  options: { plan: true },
  name: (title) => named(title, t('export.plan.fileWord'), 'pdf'),
  planName: (title, records, target) => planFileName(title, records, target.kind === 'scene' ? { kind: 'setup', sceneId: target.sceneId, setupId: null } : target, 'pdf'),
  run: (context) => writePlanPdf(context, context.plan ? planFileName(context.title, context.records, context.plan, 'pdf') : named(context.title, t('export.plan.fileWord'), 'pdf')),
};

export const planSetupPng: ExportFormat = {
  id: 'plan-setup-png',
  get label() {
    return t('export.plan.setupPng.label');
  },
  get description() {
    return t('export.plan.setupPng.description');
  },
  output: 'file',
  plans: 'view',
  options: { plan: true },
  name: (title) => named(title, t('export.plan.fileWord'), 'png'),
  planName: (title, records, target) => planFileName(title, records, target, 'png'),
  run: async (context): Promise<ExportResult> => {
    const views = viewsOrRefuse(context).slice(0, 1);
    const { pages, draw } = await makePages(context, views);
    context.progress(0, 1);
    const printed = await draw(0);
    context.signal.throwIfAborted();
    const bytes = await paintPage(printed, context.file);
    context.signal.throwIfAborted();
    await context.target.write(context.plan ? planFileName(context.title, context.records, context.plan, 'png') : named(context.title, t('export.plan.fileWord'), 'png'), bytes);
    context.progress(1, 1);
    // A legend too long for the one page goes on in the PDF; the picture says so rather than cutting it short silently.
    return pages.length > 1 ? { what: t('export.plan.png.what'), warning: t('export.plan.png.legendGoesOn') } : { what: t('export.plan.png.what') };
  },
};

export const planScenePdf: ExportFormat = {
  id: 'plan-scene-pdf',
  get label() {
    return t('export.plan.scenePdf.label');
  },
  get description() {
    return t('export.plan.scenePdf.description');
  },
  output: 'file',
  options: { plan: true },
  name: (title, sceneNumber) => (sceneNumber === null ? named(title, t('export.plan.packetWord'), 'pdf') : named(`${title} SC${paddedScene(sceneNumber)}`, t('export.plan.packetWord'), 'pdf')),
  planName: (title, records, target) => planFileName(title, records, target.kind === 'setup' ? { kind: 'scene', sceneId: target.sceneId } : target, 'pdf'),
  run: (context) => {
    const target: PlanTarget | undefined = context.plan?.kind === 'setup' ? { kind: 'scene', sceneId: context.plan.sceneId } : context.plan;
    const name = target ? planFileName(context.title, context.records, target, 'pdf') : packetName(context.title, context.records, context.scope);
    return writePlanPdf({ ...context, ...(target ? { plan: target } : {}) }, name);
  },
};

export const planDayPdf: ExportFormat = {
  id: 'plan-day-pdf',
  get label() {
    return t('export.plan.dayPdf.label');
  },
  get description() {
    return t('export.plan.dayPdf.description');
  },
  output: 'file',
  plans: 'day',
  options: { plan: true },
  name: (title) => named(title, t('export.plan.packetWord'), 'pdf'),
  planName: (title, records, target) => planFileName(title, records, target, 'pdf'),
  run: (context) => writePlanPdf(context, context.plan ? planFileName(context.title, context.records, context.plan, 'pdf') : named(context.title, t('export.plan.packetWord'), 'pdf')),
};

/** How many pages' worth of views an export would print, for the dialog: none says there is nothing to print. */
export const planViewCount = (records: Records, projectId: string, target: PlanTarget | undefined, scope: ExportScope): number => planViewsFor(records, projectId, target, scope).length;


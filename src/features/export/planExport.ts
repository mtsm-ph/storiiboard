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
import { dayPlanViews, planPages, projectPlanViews, sceneHasPlan, scaleWords, scenePlanViews, type PlanPage, type PlanView } from './planPages';
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

/** Setup plan (PDF, PNG): the setup shown, or a scene shown with no setup; nothing for a scene with no plan (sceneHasPlan). */
export function setupPlanViews(records: Records, target: PlanTarget | undefined): PlanView[] {
  if (!target || target.kind === 'day') return [];
  const setupId = target.kind === 'setup' ? target.setupId : null;
  if (!sceneHasPlan(records, target.sceneId)) return [];
  if (setupId !== null && !sceneSetups(records, target.sceneId).some((s) => s.record.id === setupId)) return [];
  return [{ sceneId: target.sceneId, setupId }];
}

/** Scene plans (PDF): the scene of the setup or scene shown, else (Export Project) the scene in scope or every scene. */
export function scenePacketViews(records: Records, projectId: string, target: PlanTarget | undefined, scope: ExportScope): PlanView[] {
  if (target?.kind === 'day') return dayPlanViews(records, projectId, target.dayId);
  if (target) return scenePlanViews(records, target.sceneId);
  return scope.kind === 'scene' ? scenePlanViews(records, scope.sceneId) : projectPlanViews(records, projectId);
}

/** Shoot day plans (PDF): the day's. */
export const dayPacketViews = (records: Records, projectId: string, target: PlanTarget | undefined): PlanView[] => (target?.kind === 'day' ? dayPlanViews(records, projectId, target.dayId) : []);

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
  /** Underlay pictures read at neither size, drawn as a placeholder: pictures the export couldn't print. */
  unreadable: number;
}

/** The pages laid out, and a way to draw each as the writer takes it. */
async function makePages(context: ExportContext, views: readonly PlanView[]): Promise<Made> {
  const { records, projectId, file } = context;
  await preparePlanFonts();
  const measure = await bundledMeasure();
  const zones = await zonesFor(records, views);
  const underlay = context.planUnderlay ?? true;
  const unreadable = underlay ? await preparePlanPictures(file, underlayShas(records, views)) : 0;
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
    unreadable,
    draw: async (index) => {
      const page = pages[index];
      if (!page) throw new Error(t('export.plan.cantDraw'));
      const drawing = page.plan ? await planDrawing(page.plan) : null;
      const words = { scale: page.plan ? scaleWords(page.plan.scale) : '', actualSize: t('export.plan.actualSize'), noRoom: t('export.plan.noRoom'), legend: t('legend.title') };
      return planPrintPage(page, drawing, words, measure);
    },
  };
}

/** The views a format prints for an export, or the reason there is nothing to print: the very list the dialog counted. */
function viewsOrRefuse(format: ExportFormat, context: ExportContext): readonly PlanView[] {
  const views = format.planViews?.(context.records, context.projectId, context.plan, context.scope) ?? [];
  if (views.length === 0) throw new Error(t('export.plan.nothing'));
  return views;
}

/** What a plan's pages went out short of, in words (6.10 review): a plan cut by the box at the smallest scale, a legend cut short. */
export function planPageWarnings(pages: readonly PlanPage[]): string[] {
  const out: string[] = [];
  for (const label of new Set(pages.flatMap((page) => (page.plan?.cut ? [page.plan.scale.label] : [])))) out.push(t('export.plan.cut', { scale: label }));
  if (pages.some((page) => page.legendCut)) out.push(t('export.plan.legendCut'));
  return out;
}

/** The file's name for an export: the plan target's when it has one, else Export Project's for the scope. The dialog shows this very name. */
export function planExportName(format: ExportFormat, context: Pick<ExportContext, 'title' | 'records' | 'plan' | 'scope'>): string {
  if (context.plan && format.planName) return format.planName(context.title, context.records, context.plan);
  const scene = context.scope.kind === 'scene' ? sceneFields(context.records[context.scope.sceneId]?.props ?? {}).number : null;
  return format.name(context.title, scene);
}

/** The pages as one PDF, written to the target under the format's name. */
async function writePlanPdf(format: ExportFormat, context: ExportContext): Promise<ExportResult> {
  const name = planExportName(format, context);
  const views = viewsOrRefuse(format, context);
  const { pages, draw, unreadable } = await makePages(context, views);
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
  const warnings = [...planPageWarnings(pages), ...deckPdfWarnings(pdf.fontNotes, pdf.storedCopies, pdf.unprintable + unreadable)];
  const what = tn('count.pages', pages.length);
  return warnings.length === 0 ? { what } : { what, warning: warnings.join(' ') };
}

/** A page painted at PNG_DPI on white, as PNG bytes, and how many of its pictures couldn't be painted; its pictures at the size the project stores them. */
export async function paintPage(page: PrintPage, file: ProjectFile): Promise<{ bytes: Uint8Array; unprintable: number }> {
  const scale = PNG_DPI / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error(t('export.plan.cantDraw'));
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { unprintable } = paintOps(ctx, page.ops, [scale, 0, 0, scale, 0, 0], (sha) => decodedPicture(file, sha, 'original') ?? decodedPicture(file, sha, 'thumbnail') ?? null);
  const blob = await canvasBlob(canvas, 'image/png');
  if (!blob) throw new Error(t('export.plan.cantDraw'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), unprintable };
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

/** A setup's file is named for the setup shown; a scene shown with no setup, for the scene ("Bey County SC004 plan.pdf"). */
const setupFileName = (title: string, records: Records, target: PlanTarget, extension: 'pdf' | 'png'): string =>
  target.kind === 'day' ? named(title, t('export.plan.fileWord'), extension) : planFileName(title, records, { kind: 'setup', sceneId: target.sceneId, setupId: target.kind === 'setup' ? target.setupId : null }, extension);

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
  planName: (title, records, target) => setupFileName(title, records, target, 'pdf'),
  planViews: (records, _projectId, target) => setupPlanViews(records, target),
  run: (context) => writePlanPdf(planSetupPdf, context),
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
  planName: (title, records, target) => setupFileName(title, records, target, 'png'),
  planViews: (records, _projectId, target) => setupPlanViews(records, target),
  run: async (context): Promise<ExportResult> => {
    const name = planExportName(planSetupPng, context);
    const views = viewsOrRefuse(planSetupPng, context).slice(0, 1);
    const { pages, draw, unreadable } = await makePages(context, views);
    // The picture is the plan's page alone: a legend that runs on is in the PDF, and the page says so, not "Page 1 of 3".
    const first = pages[0];
    if (first && pages.length > 1) pages[0] = { ...first, header: { ...first.header, page: t('export.plan.pngPage', { pages: pages.length }) } };
    context.progress(0, 1);
    const printed = await draw(0);
    context.signal.throwIfAborted();
    const painted = await paintPage(printed, context.file);
    context.signal.throwIfAborted();
    await context.target.write(name, painted.bytes);
    context.progress(1, 1);
    const missing = painted.unprintable + unreadable;
    const warnings = [...(pages.length > 1 ? [t('export.plan.png.legendGoesOn')] : []), ...planPageWarnings(pages.slice(0, 1)), ...(missing > 0 ? [tn('export.deck.unprintable', missing)] : [])];
    return warnings.length === 0 ? { what: t('export.plan.png.what') } : { what: t('export.plan.png.what'), warning: warnings.join(' ') };
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
  planViews: (records, projectId, target, scope) => scenePacketViews(records, projectId, target, scope),
  run: (context) => writePlanPdf(planScenePdf, context),
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
  planViews: (records, projectId, target) => dayPacketViews(records, projectId, target),
  run: (context) => writePlanPdf(planDayPdf, context),
};

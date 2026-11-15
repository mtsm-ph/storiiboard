import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { sceneRoomId, startRoomChanges } from '../../core/model/plan';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import type { ProjectFile } from '../../core/storage/driver';
import type { ExportTarget } from '../../core/storage/exportFiles';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { drawWallsChanges, placeIconChanges } from '../birdseye/plan/planItems';
import type { DisplayOp } from './deckDisplay';
import type { PlanPage } from './planPages';
import type { ExportContext, ExportFormat } from './registry';

// 6.10's review, round two: what a plan export's result says, from the run itself. The page's drawing needs a canvas
// (Konva), so the plan's own drawing is left empty here and the fonts are the bundled files; everything else is the
// app's own path: the views, the pages, the underlays' loading, the PDF writer and the result's words. The drawing on
// paper is read in the browser by e2e/planExport.spec.ts.

const seen = vi.hoisted(() => ({ pages: [] as unknown[], painted: [] as unknown[] }));

const fontFile = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));

vi.mock('./planRender', async (importOriginal) => {
  const real = await importOriginal<typeof import('./planRender')>();
  const { fontMeasure } = await import('./planPages');
  const files = { sans: fontFile('InterTight-Regular'), sansBold: fontFile('InterTight-Bold'), mono: fontFile('JetBrainsMono-Regular'), monoBold: fontFile('JetBrainsMono-Bold') };
  return {
    ...real,
    preparePlanFonts: () => Promise.resolve(),
    bundledMeasure: () => fontMeasure(files),
    planDrawing: () => Promise.resolve([]),
    planPrintPage: (...args: Parameters<typeof real.planPrintPage>) => {
      seen.pages.push(args[0]);
      return real.planPrintPage(...args);
    },
  };
});
// Every underlay's picture is unreadable at both sizes: the export counts it as a picture it couldn't print.
vi.mock('../../core/media/decoded', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/media/decoded')>()),
  loadPicture: () => Promise.resolve({ status: 'error' }),
  decodedPicture: () => undefined,
}));
vi.mock('./deckFonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deckFonts')>()),
  deckFontLoader: (family: string, weight: number) => {
    const bold = weight >= 600;
    const name = family === 'Inter Tight' ? (bold ? 'InterTight-Bold' : 'InterTight-Regular') : family === 'JetBrains Mono' ? (bold ? 'JetBrainsMono-Bold' : 'JetBrainsMono-Regular') : null;
    return Promise.resolve(name ? { key: `${family}|${String(bold)}`, bytes: fontFile(name), synthBold: false, synthItalic: false } : null);
  },
}));
vi.mock('./deckPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deckPictures')>()),
  pictureLoader: () => () => Promise.resolve(null),
}));
// The PNG's painter records what it was asked to paint.
vi.mock('./displayPaint', () => ({
  paintOps: (_ctx: unknown, ops: unknown) => {
    seen.painted.push(ops);
    return { unprintable: 0 };
  },
}));
vi.mock('../../core/media/canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/media/canvas')>()),
  canvasBlob: () => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])])),
}));

const { planScenePdf, planSetupPdf, planSetupPng } = await import('./planExport');

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  seen.pages.length = 0;
  seen.painted.length = 0;
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const apply = (changes: Change[]) => store.getState().apply(changes);

async function run(format: ExportFormat, extra: Partial<ExportContext>) {
  const written: string[] = [];
  const target: ExportTarget = { label: 'Plans', write: (name) => (written.push(name), Promise.resolve()) };
  const result = await format.run({
    records: records(),
    projectId: project.projectId,
    title: 'Bey County',
    scope: { kind: 'project' },
    file: {} as ProjectFile,
    target,
    progress: () => undefined,
    signal: new AbortController().signal,
    paper: 'a4',
    ...extra,
  });
  return { result, written };
}

/** SC 04 with its room `widthM` by `heightM` (two walls) and Setup 1 holding 1A. */
async function scene(widthM: number, heightM: number) {
  const p = project.projectId;
  const sceneId = crypto.randomUUID();
  const setupId = crypto.randomUUID();
  await apply([
    { kind: 'create', record: { id: sceneId, type: 'scene', parentId: p, sortKey: '1', props: { number: '4', name: 'Diner', int_ext: 'INT', day_night: 'DAY' } } },
    { kind: 'create', record: { id: setupId, type: 'setup', parentId: sceneId, sortKey: 'a', props: { name: '' } } },
    { kind: 'create', record: { id: 'f1', type: 'shot', parentId: sceneId, sortKey: 'a', props: { number: '1A', setup_id: setupId, size: 'MS', lens_mm: 35 } } },
  ]);
  await apply(startRoomChanges(records(), p, sceneId));
  const w = (widthM * 100) / 2;
  const h = (heightM * 100) / 2;
  await apply(drawWallsChanges(records(), sceneId, [{ x: -w, y: -h }, { x: w, y: -h }]).changes);
  await apply(drawWallsChanges(records(), sceneId, [{ x: -w, y: h }, { x: w, y: h }]).changes);
  return { sceneId, setupId };
}

describe('a plan export’s result (6.10 review, round two)', () => {
  it('counts an underlay it couldn’t read with the pictures it couldn’t print', async () => {
    const { sceneId, setupId } = await scene(8, 6);
    const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
    await apply([
      { kind: 'create', record: { id: 'm1', type: 'media', parentId: roomId, sortKey: 'a', props: { kind: 'image', file: 'a'.repeat(64), width: 800, height: 600 } } },
      { kind: 'create', record: { id: 'u1', type: 'plan_item', parentId: roomId, sortKey: '0', props: { kind: 'underlay', media_id: 'm1', x: -4, y: -3, width: 8, height: 6, rotation: 0, scaled: true } } },
    ]);
    const plan = { kind: 'setup', sceneId, setupId } as const;
    const { result, written } = await run(planSetupPdf, { plan });
    expect(written).toEqual(['Bey County SC004 Setup 1 plan.pdf']);
    expect(result.warning).toContain('1 picture couldn’t be printed.');
    // With the underlay turned off, nothing is read and nothing is said.
    const without = await run(planSetupPdf, { plan, planUnderlay: false });
    expect(without.result.warning).toBeUndefined();
  });

  it('says a plan was cut at the smallest scale (planPageWarnings), in the PDF’s result', async () => {
    const { sceneId, setupId } = await scene(400, 300);
    const { result } = await run(planSetupPdf, { plan: { kind: 'setup', sceneId, setupId } });
    expect(result.what).toBe('1 page');
    expect(result.warning).toMatch(/^This plan is larger than the page at .+: its edges are cut\.$/);
  });

  it('says how many setups and scenes a packet left out, and refuses when it left out everything', async () => {
    const { sceneId, setupId } = await scene(8, 6);
    await apply([
      // SC 04's Setup 2: nothing drawn for it, but the room is the scene's, so it prints.
      { kind: 'create', record: { id: 'second', type: 'setup', parentId: sceneId, sortKey: 'b', props: { name: '' } } },
      // SC 09: no room, nothing drawn; Setup 1 with no frames, Setup 2 with 9A.
      { kind: 'create', record: { id: 'sc9', type: 'scene', parentId: project.projectId, sortKey: '2', props: { number: '9' } } },
      { kind: 'create', record: { id: 'nine1', type: 'setup', parentId: 'sc9', sortKey: 'a', props: { name: '' } } },
      { kind: 'create', record: { id: 'nine2', type: 'setup', parentId: 'sc9', sortKey: 'b', props: { name: '' } } },
      { kind: 'create', record: { id: 'g1', type: 'shot', parentId: 'sc9', sortKey: 'a', props: { number: '9A', setup_id: 'nine2' } } },
      // SC 10 with neither a setup nor anything drawn.
      { kind: 'create', record: { id: 'sc10', type: 'scene', parentId: project.projectId, sortKey: '3', props: { number: '10' } } },
    ]);
    expect(planScenePdf.planViews?.(records(), project.projectId, undefined, { kind: 'project' })).toEqual([
      { sceneId, setupId },
      { sceneId, setupId: 'second' },
      { sceneId: 'sc9', setupId: 'nine2' },
    ]);
    const whole = await run(planScenePdf, {});
    expect(whole.written).toEqual(['Bey County plans.pdf']);
    expect(whole.result.what).toBe('3 pages');
    expect(whole.result.warning).toBe('1 setup left out: nothing drawn and no frames. 1 scene with no setup left out: nothing drawn and no frames.');
    // SC 09's own packet: one page, one setup left out; in Spanish too.
    setLocale('es');
    const nine = await run(planScenePdf, { plan: { kind: 'scene', sceneId: 'sc9' } });
    expect(nine.result.warning).toBe('1 emplazamiento omitido: nada dibujado y ningún cuadro.');
    setLocale('en');
    // SC 04's packet leaves nothing out and says nothing.
    expect((await run(planScenePdf, { plan: { kind: 'scene', sceneId } })).result.warning).toBeUndefined();
    // SC 10's: everything left out, so nothing to print.
    await expect(run(planScenePdf, { plan: { kind: 'scene', sceneId: 'sc10' } })).rejects.toThrow('Nothing to print here');
  });

  it('heads the PNG "Page 1 of N (the PDF holds the rest)" when the legend runs on, and paints that header', async () => {
    const { sceneId, setupId } = await scene(8, 6);
    const changes: Change[] = [];
    for (let i = 0; i < 70; i += 1) changes.push(...placeIconChanges(records(), { sceneId, setupId }, 'set-art/chair', { x: (i % 10) * 0.5, y: 2 }, `chair${String(i)}`));
    await apply(changes);
    await apply(Array.from({ length: 70 }, (_, i): Change => ({ kind: 'update', id: `chair${String(i)}`, set: { name: `Chair number ${String(i)} by the long counter` } })));
    const fakeCanvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => undefined }) };
    vi.stubGlobal('document', { createElement: () => fakeCanvas });
    const { result, written } = await run(planSetupPng, { plan: { kind: 'setup', sceneId, setupId } });
    expect(written).toEqual(['Bey County SC004 Setup 1 plan.png']);
    expect(result.warning).toContain('The legend runs past this page: the PDF holds all of it.');
    const [page] = seen.pages as PlanPage[];
    const header = page?.header.page ?? '';
    expect(header).toMatch(/^Page 1 of (\d+) \(the PDF holds the rest\)$/);
    expect(Number(/of (\d+)/.exec(header)?.[1])).toBeGreaterThan(1);
    // What was painted carries those words.
    const ops = (seen.painted[0] ?? []) as DisplayOp[];
    expect(ops.flatMap((op) => (op.op === 'text' ? op.lines.map((l) => l.text) : []))).toContain(header);
  });
});

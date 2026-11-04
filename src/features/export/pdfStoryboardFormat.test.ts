import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProjectStore } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import type { ExportTarget } from '../../core/storage/exportFiles';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { pdfStoryboard, REPLACED_WARNING } from './pdfStoryboardFormat';
import { watermarkProp, type WatermarkUse } from './watermark';

// The PDF format as the Export dialog runs it: the project's watermark taken for the PDF (or not, as Watermark
// Settings' Applies to says) and the warning it ends with. The layout itself is pdfStoryboard.test.ts's. Node has no
// canvas, so the frame drawing is a stand-in that says a frame's picture is missing when its shot is in
// `lostPictures`, as renderFrame does (renderFrame.test.ts), and every frame is the same JPEG.
const drawn = vi.hoisted(() => ({ lostPictures: new Set<string>() }));
vi.mock('./renderFrame', async (original) => ({
  ...(await original<typeof import('./renderFrame')>()),
  renderFrame: (_records: unknown, _file: unknown, shot: SbdRecord) =>
    Promise.resolve({ canvas: {}, pictureMissing: drawn.lostPictures.has(shot.id) }),
}));
const jpeg = readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url));
vi.mock('../../core/media/canvas', () => ({
  canvasBlob: () => Promise.resolve(new Blob([jpeg])),
}));

/** The fonts as the app fetches them: Vite's `?url` gives a path from the repo root, read here from disk. */
const root = fileURLToPath(new URL('../../../', import.meta.url));
function fetchFromDisk(url: string): Promise<Response> {
  const path = url.replace(/^\/@fs\//, '/').replace(/^\//, '');
  const bytes = readFileSync(/^[A-Za-z]:/.test(path) || path.startsWith('/') ? path : root + path);
  return Promise.resolve(new Response(bytes));
}

/** Each page's text, as a PDF reader finds it. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await pdf.destroy();
  return texts;
}

describe('the PDF storyboard export', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchFromDisk);
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    drawn.lostPictures.clear();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await store.getState().close();
    folder.remove();
  });

  async function scene(id: string, number: string, frames: number) {
    await store.getState().apply([
      { kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey: number.padStart(4, '0'), props: { number, name: 'Diner' } } },
    ]);
    const shots: string[] = [];
    for (let i = 0; i < frames; i += 1) {
      const added = addShot(store.getState().records, project.projectId, id);
      await store.getState().apply(added.changes);
      shots.push(added.shotId);
    }
    return shots;
  }

  async function watermark(text: string, appliesTo: WatermarkUse[]) {
    await store
      .getState()
      .apply([{ kind: 'update', id: project.projectId, set: { watermark: watermarkProp({ text, position: 'center', opacity: 0.3, appliesTo }) } }]);
  }

  /** Runs the export as the dialog does; resolves to what it said and the one file it wrote. */
  async function exportPdf() {
    const written: { name: string; bytes: Uint8Array }[] = [];
    const target: ExportTarget = {
      label: 'Bey County storyboard.pdf',
      write: (name, bytes) => {
        written.push({ name, bytes });
        return Promise.resolve();
      },
    };
    const said = await pdfStoryboard.run({
      records: store.getState().records,
      projectId: project.projectId,
      title: 'Bey County',
      scope: { kind: 'project' },
      file: project.file,
      target,
      progress: () => undefined,
      signal: new AbortController().signal,
    });
    expect(written.map((w) => w.name)).toEqual(['Bey County storyboard.pdf']);
    return { ...said, bytes: written[0]?.bytes ?? new Uint8Array() };
  }

  it('carries the project’s watermark on every page when Applies to has PDF', async () => {
    // Enough frames for two pages, so the second is checked too.
    await scene('sc4', '4', 13);
    await watermark('DRAFT', ['pdf', 'png']);
    const texts = await pageTexts((await exportPdf()).bytes);
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) expect(text).toContain('DRAFT');
  });

  it('carries none when Applies to leaves PDF unticked, though the PNG frames still would', async () => {
    await scene('sc4', '4', 2);
    await watermark('DRAFT', ['png']);
    const texts = await pageTexts((await exportPdf()).bytes);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toContain('DRAFT');
  });

  it('ends with no warning when every frame went out whole', async () => {
    await scene('sc4', '4', 2);
    const said = await exportPdf();
    expect(said.what).toBe('2 frames');
    expect(said.warning).toBeUndefined();
  });

  it('names the frames whose picture is missing in its warning', async () => {
    const [, b = ''] = await scene('sc4', '4', 3);
    drawn.lostPictures.add(b);
    const said = await exportPdf();
    expect(said.what).toBe('3 frames');
    expect(said.warning).toBe('1 has a missing picture: 4B.');
  });

  it('says text printed as ?, after the missing pictures, when some did', async () => {
    const [a = '', b = ''] = await scene('sc4', '4', 2);
    drawn.lostPictures.add(b);
    await store.getState().apply([{ kind: 'update', id: a, set: { action: 'Mary waves 👋 at the door.' } }]);
    const said = await exportPdf();
    expect(said.warning).toBe(`1 has a missing picture: 4B. ${REPLACED_WARNING}`);
  });
});

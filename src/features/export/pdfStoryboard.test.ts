import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { createProjectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { storyboardPdf, type PdfFonts } from './pdfStoryboard';
import { scenesIn } from './scope';

const font = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const fonts: PdfFonts = {
  sans: font('InterTight-Regular'),
  sansSemiBold: font('InterTight-SemiBold'),
  sansBold: font('InterTight-Bold'),
  mono: font('JetBrainsMono-Regular'),
  monoBold: font('JetBrainsMono-Bold'),
};
const jpeg = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url)));

/** Each page's text, as a PDF reader finds it: what an editor searching the file for "4B" would see. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
  }
  await pdf.destroy();
  return texts;
}

describe('the PDF storyboard', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  async function scene(id: string, number: string, shots: number) {
    await store.getState().apply([
      {
        kind: 'create',
        record: {
          id,
          type: 'scene',
          parentId: project.projectId,
          sortKey: number.padStart(4, '0'),
          props: { number, name: 'Diner', int_ext: 'INT', day_night: 'NIGHT', page_eighths: 11 },
        },
      },
    ]);
    const ids: string[] = [];
    for (let i = 0; i < shots; i += 1) {
      const added = addShot(store.getState().records, project.projectId, id);
      await store.getState().apply(added.changes);
      ids.push(added.shotId);
    }
    return ids;
  }

  it('is searchable text: headings, shot numbers as on the slate, specs, action and page numbers', async () => {
    const [first = ''] = await scene('sc4', '4', 7);
    await scene('sc5', '5', 1);
    await store.getState().apply([
      { kind: 'update', id: first, set: { size: 'MCU', lens_mm: 35, t_stop: 2.8, status: 'have', action: 'Mary wipes the counter.', dialogue: 'We’re closed.' } },
    ]);
    const scenes = scenesIn(store.getState().records, project.projectId, { kind: 'project' });
    const asked: string[] = [];
    const bytes = await storyboardPdf({
      title: 'Bey County',
      scenes,
      aspect: 16 / 9,
      watermark: null,
      fonts,
      // One frame that couldn't be drawn still gets its box and caption.
      frame: (sceneIndex, shotIndex) => {
        asked.push(`${String(sceneIndex)}:${String(shotIndex)}`);
        return Promise.resolve(sceneIndex === 0 && shotIndex === 1 ? null : jpeg);
      },
      now: new Date('2026-11-03T12:00:00Z'),
    });

    expect(asked).toHaveLength(8);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Bey County storyboard');
    // Two rows of three fit a page under the heading, so scene 4's third row and scene 5 go on page two.
    const [one = '', two = ''] = await pageTexts(bytes);
    expect(pdf.getPageCount()).toBe(2);
    for (const text of ['Bey County', 'STORYBOARD', 'SC 04', 'INT. DINER — NIGHT', '1 3/8 pg', '4A', 'MCU · 35MM · T2.8', 'Have', 'Mary wipes the counter.', '“We’re closed.”', '4F', '1 / 2', '2026-11-03']) {
      expect(one).toContain(text);
    }
    expect(one).not.toContain('4G');
    expect(two).toContain('INT. DINER — NIGHT (continued)');
    for (const text of ['4G', 'SC 05', '5A', '2 / 2']) expect(two).toContain(text);
  });

  it('stamps the watermark on every page', async () => {
    await scene('sc4', '4', 7);
    const bytes = await storyboardPdf({
      title: 'Bey County',
      scenes: scenesIn(store.getState().records, project.projectId, { kind: 'project' }),
      aspect: 2.39,
      watermark: { text: 'DRAFT', position: 'center', opacity: 0.3, appliesTo: ['pdf'] },
      fonts,
      frame: () => Promise.resolve(jpeg),
    });
    const texts = await pageTexts(bytes);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toContain('DRAFT');
  });

  it('is one page with its header when there are no frames', async () => {
    const bytes = await storyboardPdf({ title: 'Bey County', scenes: [], aspect: 16 / 9, watermark: null, fonts, frame: () => Promise.resolve(null) });
    const [one = ''] = await pageTexts(bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(one).toContain('Bey County');
    expect(one).toContain('1 / 1');
  });
});

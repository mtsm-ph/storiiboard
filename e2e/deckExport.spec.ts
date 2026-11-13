import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { isTaggedP3 } from '../src/core/media/image';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// A deck as a PDF and as PNGs (5.6a) in the memory build, where each file downloads: a Pitch deck exported and read back (page count,
// sizes, its words as real text, nothing from outside the pages), the PNGs' names and sizes at 1x and 2x, a picture from the P3
// fixture redrawn in sRGB, a deck with no pages, and axe on the dialog. The canvas is pixels, so the board is read from its data.

test.use({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export' });
const items = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url));

async function newDeck(page: Page, name: string, template: 'Blank' | 'Pitch', format?: string) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await tile(page).getByRole('button', { name: 'New deck' }).click();
  await tile(page).getByLabel('Deck name').fill(name);
  await tile(page).getByLabel('Template').selectOption({ label: template });
  if (format) await tile(page).getByLabel('Page format').selectOption({ label: format });
  await tile(page).getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('application', { name: `${name} board` })).toBeVisible();
  await page.waitForTimeout(100);
}

/** Each page's text in an exported PDF, as a reader finds it. */
async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await pdf.destroy();
  return texts;
}

const bytesOf = async (download: Download): Promise<Uint8Array> => new Uint8Array(readFileSync(await download.path()));

/** The width and height of a PNG, from its header. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function openExport(page: Page) {
  await tile(page).getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test('exports a Pitch deck as a PDF: its pages in order, its words as text, and nothing from outside the pages', async ({ page }) => {
  await newDeck(page, 'Pitch', 'Pitch');
  const project = await openSettings(page, 'Project');
  await project.getByLabel('Logline').fill('A diner at dawn.');
  await project.getByLabel('Logline').press('Enter');
  await closeSettings(page);
  // A sticky note above the first page: working space, on no page.
  const canvas = page.getByRole('application', { name: 'Pitch board' });
  await tile(page).getByRole('button', { name: /^Sticky/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + 40);
  await page.keyboard.type('Working space only');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'sticky').length).toBe(1);

  await openExport(page);
  // The deck's own two formats, and no choice of scenes.
  await expect(dialog(page).getByRole('radio')).toHaveText(['Deck as PDF', 'Pages as PNG']);
  await expect(dialog(page).getByRole('combobox', { name: /^Scenes/ })).toHaveCount(0);
  await expect(dialog(page).getByRole('radio', { name: 'Deck as PDF' })).toBeChecked();
  await expect(dialog(page)).toContainText('6 pages, leaving out what lies outside the pages.');
  const downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Pitch.pdf');
  const bytes = await bytesOf(download);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(6);
  expect(pdf.getTitle()).toBe('Pitch');
  expect(pdf.getAuthor()).toBeUndefined();
  expect(pdf.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual(Array.from({ length: 6 }, () => [960, 540]));
  const texts = await pdfPageTexts(bytes);
  // Page 1 is the title: the project's name, and neither the page's own name nor its number.
  expect(texts[0]).toContain('Bey County');
  expect(texts[0]).not.toContain('Title');
  // The logline page: its heading and the logline, both text; The schedule's page says what the project has for dates.
  expect(texts[1]).toContain('Logline');
  expect(texts[1]).toContain('A diner at dawn.');
  expect(texts.join(' ')).toContain('Dates to come');
  expect(texts.join(' ')).not.toContain('Working space only');
  // Pages in the deck's order: the headings come as the panel lists them.
  expect(texts[2]).toContain('The team');
  expect(texts[3]).toContain('The look');
  // The text is a subset of an embedded font, not a picture of it.
  const fonts = [...pdf.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'));
  expect(fonts.length).toBeGreaterThan(0);
  await expect(page.getByRole('status').getByText('Exported 6 pages to “Pitch.pdf”.')).toBeVisible();
});

test('the page sizes follow the deck’s formats: 9:16, 4:5 and A4 in points', async ({ page }) => {
  await newDeck(page, 'Social', 'Blank', '9:16 vertical');
  await tile(page).getByRole('complementary', { name: 'Pages' }).getByLabel('Page format').selectOption({ label: '4:5 portrait' });
  await tile(page).getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await tile(page).getByRole('complementary', { name: 'Pages' }).getByLabel('Page format').selectOption({ label: 'A4' });
  await tile(page).getByRole('complementary', { name: 'Pages' }).getByRole('button', { name: 'Add page' }).click();
  await expect(tile(page).getByRole('complementary', { name: 'Pages' }).locator('[data-page-row]')).toHaveCount(3);
  await openExport(page);
  const downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  const pdf = await PDFDocument.load(await bytesOf(await downloaded));
  expect(pdf.getPages().map((p) => [Math.round(p.getWidth() * 100) / 100, Math.round(p.getHeight() * 100) / 100])).toEqual([
    [540, 960],
    [540, 675],
    [595.28, 841.89],
  ]);
});

test('exports each page as a PNG at 1x and at 2x, named with its number and name, in page order', async ({ page }) => {
  // Twelve pages drawn and encoded, the second six at 3840 x 2160.
  test.setTimeout(60_000);
  await newDeck(page, 'Pitch', 'Pitch');
  for (const [ratio, label] of [[1, '1× (the page’s own size)'], [2, '2× (double)']] as const) {
    const files: { name: string; bytes: Uint8Array }[] = [];
    const seen: Promise<void>[] = [];
    const listener = (download: Download) => {
      seen.push(
        (async () => {
          files.push({ name: download.suggestedFilename(), bytes: await bytesOf(download) });
        })(),
      );
    };
    page.on('download', listener);
    await openExport(page);
    await dialog(page).getByRole('radio', { name: 'Pages as PNG' }).click();
    await dialog(page).getByRole('radio', { name: label }).click();
    await dialog(page).getByRole('button', { name: 'Choose folder…' }).click();
    await expect(page.getByRole('status').getByText(/^Exported 6 pages to “Pitch”\./)).toBeVisible();
    // Each download is read once the browser has finished it. Waited for through the page, which is what delivers the download events:
    // expect.poll sleeps without it, and the last of them came only after it gave up.
    for (let tries = 0; tries < 60 && files.length < 6; tries += 1) await page.waitForTimeout(500);
    await Promise.all(seen);
    page.off('download', listener);
    expect(files.map((f) => f.name)).toEqual(['Pitch 01 Title.png', 'Pitch 02 Logline.png', 'Pitch 03 The team.png', 'Pitch 04 The look.png', 'Pitch 05 The schedule.png', 'Pitch 06 Closing.png']);
    for (const file of files) expect(pngSize(file.bytes), file.name).toEqual({ width: 1920 * ratio, height: 1080 * ratio });
    // Dismiss the notice so the next run's is the one read.
    await page.getByRole('button', { name: 'Got it' }).click();
  }
});

test('a link card is a link annotation over its box, with its address and title as text', async ({ page }) => {
  await newDeck(page, 'Links', 'Blank');
  const canvas = page.getByRole('application', { name: 'Links board' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await canvas.focus();
  // The address pasted as text makes a link card at the pointer, as ⌘V does.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'https://example.com/look-book');
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'link').length).toBe(1);
  await openExport(page);
  const downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  const bytes = await bytesOf(await downloaded);
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const annotations = (await (await pdf.getPage(1)).getAnnotations()) as { subtype: string; url?: string; rect: number[] }[];
  const links = annotations.filter((a) => a.subtype === 'Link');
  expect(links.map((a) => a.url)).toEqual(['https://example.com/look-book']);
  const card = (await items(page)).find((i) => i.kind === 'link') as Item;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = links[0]?.rect ?? [];
  // The box is the card's, at half scale (a 1920 unit page is 960 points), from the foot of the page.
  expect([x2 - x1, y2 - y1]).toEqual([card.width / 2, card.height / 2]);
  expect(x1).toBeCloseTo(card.x / 2, 1);
  expect(y1).toBeCloseTo(540 - (card.y + card.height) / 2, 1);
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  expect(text).toContain('example.com/look-book');
  await pdf.destroy();
});

test('draws a picture from the P3 fixture into the PDF in sRGB, not as P3 numbers read as sRGB', async ({ page }) => {
  await newDeck(page, 'Look', 'Blank');
  const data = [...readFileSync(fixture('p3-red.jpg'))];
  const wrapper = tile(page).locator('[data-board-data]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('no canvas');
  const transfer = await page.evaluateHandle((list) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(list)], 'p3-red.jpg', { type: 'image/jpeg' }));
    return t;
  }, data);
  await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'picture').length).toBe(1);
  const picture = (await items(page)).find((i) => i.kind === 'picture') as Item;
  const first = (await items(page)).find((i) => i.kind === 'page') as Item;
  // Wholly inside the page, or it isn't printed.
  expect(picture.x).toBeGreaterThanOrEqual(first.x);
  expect(picture.x + picture.width).toBeLessThanOrEqual(first.x + first.width);
  expect(picture.y).toBeGreaterThanOrEqual(first.y);
  expect(picture.y + picture.height).toBeLessThanOrEqual(first.y + first.height);

  await openExport(page);
  const downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  const bytes = await bytesOf(await downloaded);
  const pdf = await PDFDocument.load(bytes);
  const jpegs: Uint8Array[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    // Plain RGB, no profile: the profile a P3 picture carries isn't in the file.
    expect(object.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    const filter = object.dict.get(PDFName.of('Filter'));
    expect(filter instanceof PDFName ? filter : filter instanceof PDFArray ? filter.get(0) : null).toBe(PDFName.of('DCTDecode'));
    jpegs.push(object.contents);
  }
  expect(jpegs).toHaveLength(1);
  // The fixture does carry a profile, found the way the app finds one (a v2 or a v4 name), and the embedded picture carries none.
  expect(isTaggedP3(new Uint8Array(data))).toBe(true);
  expect(isTaggedP3(new Uint8Array(jpegs[0] ?? []))).toBe(false);
  // Its pixels were converted: Display P3 red is about #FF0000 on sRGB, never the (234, 51, 35) of its numbers read as sRGB.
  const pixel = await page.evaluate(async (base64) => {
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    ctx?.drawImage(bitmap, 0, 0);
    return Array.from(ctx?.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data ?? []);
  }, Buffer.from(jpegs[0] ?? []).toString('base64'));
  expect(pixel[0]).toBeGreaterThan(240);
  expect(pixel[1]).toBeLessThan(40);
  expect(pixel[2]).toBeLessThan(40);
  // The memory build keeps no path to the original, so the picture printed from its stored copy, and the notice says so.
  await expect(page.getByRole('alert').getByText(/1 picture printed from the copy kept in the project, not its original file\./)).toBeVisible();
});

test('a deck with no pages has its formats off, with the reason', async ({ page }) => {
  await newDeck(page, 'Social', 'Blank', '9:16 vertical');
  await tile(page).getByRole('complementary', { name: 'Pages' }).locator('[data-page-row]').first().getByRole('button', { name: 'Delete Page 1' }).click();
  await expect(tile(page).getByRole('complementary', { name: 'Pages' }).locator('[data-page-row]')).toHaveCount(0);
  await openExport(page);
  await expect(dialog(page).getByRole('alert')).toHaveText('This deck has no pages to export. Add a page first.');
  await expect(dialog(page).getByRole('button', { name: 'Save…' })).toBeDisabled();
  await dialog(page).getByRole('radio', { name: 'Pages as PNG' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Choose folder…' })).toBeDisabled();
});

test('Export Project does not list the deck formats', async ({ page }) => {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await expect(dialog(page).getByRole('radio', { name: 'Deck as PDF' })).toHaveCount(0);
  await expect(dialog(page).getByRole('radio', { name: 'Storyboard (PDF)' })).toBeChecked();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with the deck's Export dialog open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await newDeck(page, 'Pitch', 'Pitch');
    await openExport(page);
    const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    const check = async () => {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const result = await new AxeBuilder({ page }).withTags(rules).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await check();
    await dialog(page).getByRole('radio', { name: 'Pages as PNG' }).click();
    await expect(dialog(page).getByRole('radiogroup', { name: 'Size' })).toBeVisible();
    await check();
  });
}

/** Decodes a PNG in the page and counts the pixels in a corner that aren't the page's white. */
async function inkIn(page: Page, bytes: Uint8Array, corner: { x: number; y: number; width: number; height: number }): Promise<{ size: [number, number]; ink: number }> {
  return page.evaluate(
    async ({ base64, corner }) => {
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      ctx?.drawImage(bitmap, 0, 0);
      const x = Math.floor(corner.x * bitmap.width);
      const y = Math.floor(corner.y * bitmap.height);
      const data = ctx?.getImageData(x, y, Math.floor(corner.width * bitmap.width), Math.floor(corner.height * bitmap.height)).data ?? new Uint8ClampedArray();
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 200) ink += 1;
      return { size: [bitmap.width, bitmap.height] as [number, number], ink };
    },
    { base64: Buffer.from(bytes).toString('base64'), corner },
  );
}

test('a watermark is stamped in the chosen corner of a PNG at 1x and at 2x, not drawn off the page at 2x', async ({ page }) => {
  await newDeck(page, 'Stamp', 'Blank');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Watermark Settings…', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Watermark Settings' });
  await settings.getByLabel('Text').fill('DRAFT STAMP');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);
  for (const [ratio, label] of [[1, '1× (the page’s own size)'], [2, '2× (double)']] as const) {
    const files: Download[] = [];
    const listener = (download: Download) => files.push(download);
    page.on('download', listener);
    await openExport(page);
    await dialog(page).getByRole('radio', { name: 'Pages as PNG' }).click();
    await expect(dialog(page)).toContainText('Watermark “DRAFT STAMP”, bottom right.');
    await dialog(page).getByRole('radio', { name: label }).click();
    await dialog(page).getByRole('button', { name: 'Choose folder…' }).click();
    for (let tries = 0; tries < 40 && files.length < 1; tries += 1) await page.waitForTimeout(250);
    page.off('download', listener);
    const bytes = await bytesOf(files[0] as Download);
    // The bottom right corner has the stamp's ink; the top left, nothing.
    const corner = await inkIn(page, bytes, { x: 0.7, y: 0.9, width: 0.3, height: 0.1 });
    expect(corner.size).toEqual([1920 * ratio, 1080 * ratio]);
    expect(corner.ink, `${String(ratio)}x`).toBeGreaterThan(100);
    expect((await inkIn(page, bytes, { x: 0, y: 0, width: 0.3, height: 0.1 })).ink).toBe(0);
    await page.getByRole('button', { name: 'Got it' }).click();
  }
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- the next two tests call the app's own modules by URL from inside the page, which have no types here */
test('prints an original only when it is the picture the deck shows: same shape, and close to the stored thumbnail', async ({ page }) => {
  await newDeck(page, 'Originals', 'Blank');
  const data = [...readFileSync(fixture('p3-red.jpg'))];
  const wrapper = tile(page).locator('[data-board-data]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('no canvas');
  const transfer = await page.evaluateHandle((list) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(list)], 'p3-red.jpg', { type: 'image/jpeg' }));
    return t;
  }, data);
  await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'picture').length).toBe(1);
  const result = await page.evaluate(async (base64) => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const { projectStore } = await load('/src/app/projectStore.ts');
    const pictures = await load('/src/features/export/deckPictures.ts');
    const state = projectStore.getState() as { project: { file: unknown }; records: Record<string, { type: string; props: Record<string, unknown> }> };
    const sha = Object.values(state.records).find((r) => r.type === 'media' && r.props.kind === 'image')?.props.file as string;
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const same = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
    // A picture of the same shape that is not the same picture, and one of another shape.
    const draw = async (width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (ctx) {
        ctx.fillStyle = '#2040C0';
        ctx.fillRect(0, 0, width, height);
      }
      return createImageBitmap(await canvas.convertToBlob({ type: 'image/png' }));
    };
    const other = await draw(same.width, same.height);
    const taller = await draw(same.width, same.height * 2);
    return {
      threshold: pictures.MATCH_THRESHOLD as number,
      match: await pictures.storedDifference(state.project.file, sha, same) as number,
      mismatch: await pictures.storedDifference(state.project.file, sha, other) as number,
      shape: await pictures.storedDifference(state.project.file, sha, taller) as number,
      isMatch: await pictures.isTheStoredPicture(state.project.file, sha, same) as boolean,
      isOther: await pictures.isTheStoredPicture(state.project.file, sha, other) as boolean,
      isTaller: await pictures.isTheStoredPicture(state.project.file, sha, taller) as boolean,
    };
  }, Buffer.from(data).toString('base64'));
  expect(result.match).toBeLessThan(result.threshold);
  expect(result.mismatch).toBeGreaterThan(result.threshold);
  expect(result.shape).toBe(Infinity);
  expect([result.isMatch, result.isOther, result.isTaller]).toEqual([true, false, false]);
});

test('tells a real photograph from another of the same shape, and from its own stored copy', async ({ page }) => {
  // Two real photographs (967 by 523 and 967 by 521: the same shape to within the tolerance), the first one imported.
  await newDeck(page, 'Photos', 'Blank');
  const data = [...readFileSync(fixture('photo-a.jpg'))];
  const wrapper = tile(page).locator('[data-board-data]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('no canvas');
  const transfer = await page.evaluateHandle((list) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(list)], 'photo-a.jpg', { type: 'image/jpeg' }));
    return t;
  }, data);
  await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'picture').length).toBe(1);
  const result = await page.evaluate(
    async ({ a, b }) => {
      const load = (p: string) => import(/* @vite-ignore */ p);
      const { projectStore } = await load('/src/app/projectStore.ts');
      const pictures = await load('/src/features/export/deckPictures.ts');
      const state = projectStore.getState() as { project: { file: unknown }; records: Record<string, { type: string; props: Record<string, unknown> }> };
      const sha = Object.values(state.records).find((r) => r.type === 'media' && r.props.kind === 'image')?.props.file as string;
      const bitmap = (base64: string) => createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
      const own = await bitmap(a);
      const another = await bitmap(b);
      return {
        threshold: pictures.MATCH_THRESHOLD as number,
        own: (await pictures.storedDifference(state.project.file, sha, own)) as number,
        another: (await pictures.storedDifference(state.project.file, sha, another)) as number,
      };
    },
    { a: Buffer.from(data).toString('base64'), b: readFileSync(fixture('photo-b.jpg')).toString('base64') },
  );
  expect(result.own).toBeLessThan(result.threshold / 2);
  expect(result.another).toBeGreaterThan(result.threshold);
});

test('draws every kind of item the canvas has through PageStage, and every Konva class it draws with is one the PDF reads back', async ({ page }) => {
  await newDeck(page, 'Kinds', 'Blank');
  // One card has a real picture, so the stage draws a Konva Image and PRINT_KINDS is held to it.
  const wrapper = tile(page).locator('[data-board-data]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error('no canvas');
  const transfer = await page.evaluateHandle((list) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(list)], 'srgb.jpg', { type: 'image/jpeg' }));
    return t;
  }, [...readFileSync(fixture('srgb.jpg'))]);
  await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'picture').length).toBe(1);
  const seen = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const { projectStore } = await load('/src/app/projectStore.ts');
    const state = projectStore.getState() as { project: { file: unknown }; records: Record<string, { type: string; props: Record<string, unknown> }> };
    const sha = Object.values(state.records).find((r) => r.type === 'media' && r.props.kind === 'image')?.props.file as string;
    const itemsModule = await load('/src/features/moodboards/items.ts');
    const drawing = await load('/src/features/moodboards/drawing.tsx');
    const render = await load('/src/features/export/deckRender.tsx');
    const crop = { x: 0.5, y: 0.5, zoom: 1 };
    const kinds: { kind: string; extra?: Record<string, unknown> }[] = [
      { kind: 'rect' }, { kind: 'ellipse' }, { kind: 'triangle' }, { kind: 'diamond' },
      { kind: 'text', extra: { text: 'Words' } }, { kind: 'sticky', extra: { text: 'Note' } },
      { kind: 'section', extra: { name: 'Look' } }, { kind: 'link', extra: { url: 'https://example.com/', title: 'Look' } },
      { kind: 'picture' }, { kind: 'video' }, { kind: 'field_card', extra: { field: 'title' } },
      { kind: 'shot_card' }, { kind: 'scene_card' }, { kind: 'palette_card' }, { kind: 'brand_card' },
    ];
    const fields = new Map<string, unknown>();
    const canvas: Record<string, unknown>[] = [];
    kinds.forEach(({ kind, extra }, i) => {
      const id = `k${String(i)}`;
      const x = 20 + (i % 5) * 360;
      const y = 40 + Math.floor(i / 5) * 320;
      const props = { kind, x, y, width: 320, height: 260, rotation: 0, ...extra };
      fields.set(id, itemsModule.itemFields(props));
      canvas.push({ id, x, y, width: 320, height: 260, rotation: 0, label: kind, ...(kind === 'section' ? { section: { tab: { x: 0, y: -24, width: 80, height: 24 } } } : {}) });
    });
    const pageFields = itemsModule.itemFields({ kind: 'page', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, format: '16:9', orientation: 'portrait', name: '', background: '#FFFFFF' });
    const strokes = [
      { id: 's1', tool: 'pen', points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.2], width: 0.01, pressures: null },
      { id: 's2', tool: 'pen', points: [0.1, 0.8, 0.5, 0.9, 0.9, 0.8], width: 0.01, pressures: [0.2, 0.9, 0.4] },
      { id: 's3', tool: 'box', points: [0.2, 0.2, 0.6, 0.6], width: 0.01, pressures: null },
      { id: 's4', tool: 'arrow', points: [0.1, 0.9, 0.8, 0.3], width: 0.01, pressures: null },
    ];
    const live: Record<string, unknown> = {
      k11: { kind: 'shot_card', state: 'live', number: '1A', size: 'MCU', lens: '50mm', lensMm: 50, move: 'Dolly', status: 'source', sha256: null, crop, strokes, aspect: 16 / 9 },
      k12: { kind: 'scene_card', state: 'live', label: 'SC 01', heading: 'INT. KITCHEN', frames: 2, first: [{ id: 'f', number: '1A', sha256: null, crop }], aspect: 16 / 9 },
      k13: { kind: 'palette_card', state: 'live', label: 'SC 01', heading: 'INT. KITCHEN', colors: ['#A35139', '#1F2F4D'], sceneId: 's' },
      k14: { kind: 'brand_card', company: { name: 'Bey Films' }, logoSha256: null, colors: ['#A35139'], fonts: ['Archivo'] },
    };
    const drawn = drawing.withDrawing(
      canvas,
      (id: string) => (id === 'page' ? pageFields : fields.get(id) ?? null),
      (id: string) => (id === 'k8' ? { sha256: sha, name: 'p.jpg', duration: '', missing: false, videoId: null } : id === 'k9' ? { sha256: null, name: 'A001.MP4', duration: '00:00:10:00', missing: false, videoId: null } : null),
      (id: string) => live[id] ?? null,
      null,
      0,
      { fieldOf: (id: string) => (id === 'k10' ? { field: 'title', text: 'Bey County' } : null) },
    );
    const link = (route: string, from: unknown, to: unknown) => ({ id: `l${route}`, label: route, from, to, route, startHead: 'arrow', endHead: 'arrow', color: null, width: 3, text: 'then' });
    const links = [
      link('straight', { x: 100, y: 1000 }, { x: 500, y: 1040 }),
      link('elbow', { item: 'k0', side: 'auto' }, { item: 'k1', side: 'auto' }),
      link('curved', { item: 'k2', side: 'auto' }, { item: 'k3', side: 'auto' }),
    ];
    const [pageItem] = drawing.withDrawing([{ id: 'page', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, label: 'page', section: { tab: { x: 0, y: -24, width: 80, height: 24 } } }], (id: string) => (id === 'page' ? pageFields : null), () => null, () => null, null, 0, { pageNumbers: new Map([['page', 1]]) });
    const scene = { id: 'page', number: 1, name: '', format: '16:9', orientation: 'portrait', background: '#FFFFFF', width: 1920, height: 1080, page: pageItem, items: drawn, links, pictures: [sha], faces: [] };
    await render.preparePage(scene, state.project.file, 'thumbnail');
    const rendered = await render.renderPage(scene);
    const classes = new Set<string>();
    const walk = (node: { getClassName(): string; getChildren?: () => unknown[] }) => {
      classes.add(node.getClassName());
      for (const child of (node.getChildren?.() ?? []) as (typeof node)[]) walk(child);
    };
    const layer = rendered.stage.getLayers()[0];
    walk(layer);
    const ops = rendered.print().ops as { op: string }[];
    rendered.dispose();
    return { classes: [...classes], known: Object.keys(render.PRINT_KINDS), ops: [...new Set(ops.map((o) => o.op))] };
  });
  // Each class drawn is one that is read back; a new Konva shape in a card without a line in PRINT_KINDS fails here.
  expect(seen.classes.filter((c) => !seen.known.includes(c))).toEqual([]);
  for (const expected of ['Rect', 'Ellipse', 'Line', 'Path', 'Text', 'Group', 'Image']) expect(seen.classes).toContain(expected);
  for (const expected of ['shape', 'text', 'link', 'clip']) expect(seen.ops).toContain(expected);
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

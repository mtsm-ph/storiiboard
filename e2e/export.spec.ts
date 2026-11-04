import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { skipOnboarding } from './onboarding';

// Export (1.24, 1.25) in the memory build, where each file downloads: the PDF storyboard, the shot list CSV's text, the
// PNG frames' names and sizes, and the watermark set in Watermark Settings.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const fixture = fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url));
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

async function projectMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: item, exact: true }).click();
}

/** A PNG's width and height, from its header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('exports a scene as a PDF storyboard, the format the dialog starts on', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeChecked();
  await dialog(page, 'Export').getByRole('combobox', { name: /^Scenes/ }).selectOption({ index: 1 });
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Bey County SC 01 storyboard.pdf');
  const pdf = await PDFDocument.load(readFileSync(await file.path()));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getTitle()).toBe('Bey County storyboard');
  await expect(page.getByRole('status').getByText('Exported 2 frames to “Bey County SC 01 storyboard.pdf”.')).toBeVisible();
});

/** The width and height of each picture in an exported PDF. */
function pdfImageSizes(pdf: PDFDocument): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || !(object.dict instanceof PDFDict)) continue;
    if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const width = object.dict.get(PDFName.of('Width'));
    const height = object.dict.get(PDFName.of('Height'));
    if (width instanceof PDFNumber && height instanceof PDFNumber) sizes.push({ width: width.asNumber(), height: height.asNumber() });
  }
  return sizes;
}

test('the PDF’s frames go in at their printed size, not the 1200 px that made a feature’s PDF 200 MB', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  const sizes = pdfImageSizes(await PDFDocument.load(readFileSync(await (await downloaded).path())));
  // 16:9 frames a third of a Letter page wide, at three pixels a point: 216 ppi.
  expect(sizes).toHaveLength(2);
  for (const size of sizes) {
    expect(size.width).toBeGreaterThan(600);
    expect(size.width).toBeLessThanOrEqual(720);
    expect(Math.abs(size.width / size.height - 16 / 9)).toBeLessThan(0.01);
  }
});

test('the dialog says it is writing the PDF after the last frame, not still on it', async ({ page }) => {
  // The memory build's write is over in a moment: every status the dialog shows is kept as it shows, to read after.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { statuses?: string[] }).statuses = seen;
    new MutationObserver(() => {
      const text = document.querySelector('dialog [role="status"]')?.textContent ?? '';
      if (text !== '' && seen.at(-1) !== text) seen.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await projectMenu(page, 'Export Project…');
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  await downloaded;
  await expect(page.getByRole('status').getByText('Exported 2 frames to “Bey County storyboard.pdf”.')).toBeVisible();
  const statuses = await page.evaluate(() => (window as unknown as { statuses?: string[] }).statuses ?? []);
  expect(statuses.at(-1)).toBe('Writing the PDF…');
  expect(statuses).not.toContain('Exporting 2 of 2…');
});

/** Each page's text in an exported PDF, as a reader finds it. */
async function pdfPageTexts(path: string): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await pdf.destroy();
  return texts;
}

test('the PDF carries the watermark on every page, and none once Applies to leaves PDF out', async ({ page }) => {
  // Enough frames for a second page, so it's checked too.
  for (let i = 0; i < 11; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]')).toHaveCount(13);
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  await settings.getByLabel('Text').fill('DRAFT');
  await expect(settings.getByRole('switch', { name: 'PDF storyboard' })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  const exportPdf = async () => {
    await projectMenu(page, 'Export Project…');
    await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeChecked();
    const downloaded = page.waitForEvent('download');
    await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
    const texts = await pdfPageTexts(await (await downloaded).path());
    await expect(dialog(page, 'Export')).toHaveCount(0);
    return texts;
  };
  const marked = await exportPdf();
  expect(marked.length).toBeGreaterThan(1);
  for (const text of marked) expect(text).toContain('DRAFT');

  await projectMenu(page, 'Watermark Settings');
  await settings.getByRole('switch', { name: 'PDF storyboard' }).click();
  await expect(settings.getByRole('switch', { name: 'PDF storyboard' })).toHaveAttribute('aria-checked', 'false');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);
  const unmarked = await exportPdf();
  expect(unmarked.length).toBeGreaterThan(1);
  for (const text of unmarked) expect(text).not.toContain('DRAFT');
});

test('exports the shot list as CSV, one row per frame', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Shot list (CSV)' }).check();
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Bey County shot list.csv');
  const text = readFileSync(await file.path(), 'utf8');
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  expect(lines[0]).toMatch(/^Scene,Heading,Length,Location,Shot,Size/);
  expect(lines.slice(1).map((l) => l.split(',')[4])).toEqual(['1A', '1B']);
  await expect(page.getByRole('status').getByText('Exported 2 frames to “Bey County shot list.csv”.')).toBeVisible();
});

test('exports each frame as a PNG named as on the slate, at full HD', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  await expect.poll(() => files.length).toBe(2);
  expect(files.map((f) => f.suggestedFilename()).sort()).toEqual(['SC001_1A.png', 'SC001_1B.png']);
  for (const file of files) expect(pngSize(await file.path())).toEqual({ width: 1920, height: 1080 });
});

/**
 * What a PNG holds, decoded in the page: the colour at each point, and how many pixels in each box clearly differ from
 * `ground`, the colour under them: ink drawn over it, or the watermark's paper outline over a dark picture.
 */
async function readPng(page: Page, path: string, ground: number[], points: [number, number][], boxes: [number, number, number, number][]) {
  return page.evaluate(
    async ({ data, ground, points, boxes }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
      // A <canvas>, not an OffscreenCanvas: one of the runs below takes that away.
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const { width, height } = bitmap;
      const at = ([fx, fy]: [number, number]) => [...ctx.getImageData(Math.floor(fx * width), Math.floor(fy * height), 1, 1).data.slice(0, 3)];
      const marked = ([x1, y1, x2, y2]: [number, number, number, number]) => {
        const { data } = ctx.getImageData(Math.floor(x1 * width), Math.floor(y1 * height), Math.ceil((x2 - x1) * width), Math.ceil((y2 - y1) * height));
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const off = [0, 1, 2].reduce((sum, c) => sum + Math.abs((data[i + c] ?? 0) - (ground[c] ?? 0)), 0);
          if (off > 60) count += 1;
        }
        return count;
      };
      return { points: points.map(at), marked: boxes.map(marked) };
    },
    { data: [...readFileSync(path)], ground, points, boxes },
  );
}

/** The fixture's own colour, as this engine decodes it into an sRGB canvas. */
async function fixtureColour(page: Page): Promise<number[]> {
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    return [...ctx.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data.slice(0, 3)];
  }, [...readFileSync(fixture)]);
}

// The PNG tests above have no picture and never look at a pixel, so blank white frames would pass them. Run twice: as
// WebView2 and current WebKit draw, and as macOS 13.0 to 13.2's WebKit does, with no OffscreenCanvas at all.
for (const offscreen of [true, false]) {
  test(`a PNG frame carries its picture, its sketch and the watermark${offscreen ? '' : ', without OffscreenCanvas'}`, async ({ page }) => {
    const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
    // 1A gets the picture.
    await frames.nth(0).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('button', { name: 'Choose picture…' }).click();
    await (await chooser).setFiles(fixture);
    await expect(frames.nth(0).locator('img[data-frame-image]')).toBeVisible();
    // 1B, on white, gets a pen stroke straight across the middle.
    await frames.nth(1).click();
    await page.keyboard.press('s');
    const sketch = page.getByRole('dialog', { name: 'Sketch 1B' });
    const box = await sketch.locator('[data-sketch-frame]').boundingBox();
    if (!box) throw new Error('no frame');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await expect(frames.nth(1).locator('svg[data-sketch] > *')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sketch).toHaveCount(0);
    // And both carry the watermark, top left.
    await projectMenu(page, 'Watermark Settings');
    await dialog(page, 'Watermark Settings').getByLabel('Text').fill('DRAFT');
    await dialog(page, 'Watermark Settings').getByRole('combobox', { name: /^Position/ }).selectOption({ label: 'Top left' });
    await dialog(page, 'Watermark Settings').getByRole('button', { name: 'Save' }).click();
    await expect(dialog(page, 'Watermark Settings')).toHaveCount(0);

    if (!offscreen) {
      await page.evaluate(() => {
        Reflect.deleteProperty(window, 'OffscreenCanvas');
      });
      expect(await page.evaluate(() => typeof OffscreenCanvas)).toBe('undefined');
    }
    await projectMenu(page, 'Export Project…');
    await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
    const files: Download[] = [];
    page.on('download', (download) => files.push(download));
    await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
    await expect.poll(() => files.length).toBe(2);
    const file = async (name: string) => {
      const found = files.find((f) => f.suggestedFilename() === name);
      if (!found) throw new Error(`no ${name}`);
      return found.path();
    };

    // Boxes: where the watermark sits (top left), and the bottom of the frame, clear of it and the stroke.
    const watermarkBox: [number, number, number, number] = [0, 0, 0.25, 0.15];
    const clearBox: [number, number, number, number] = [0.3, 0.7, 0.9, 0.95];
    const colour = await fixtureColour(page);
    const picture = await readPng(page, await file('SC001_1A.png'), colour, [[0.5, 0.8]], [watermarkBox, clearBox]);
    picture.points[0]?.forEach((channel, i) => {
      expect(Math.abs(channel - (colour[i] ?? 0)), `picture channel ${String(i)}`).toBeLessThanOrEqual(10);
    });
    expect(picture.marked[0], 'the watermark over the picture').toBeGreaterThan(0);
    expect(picture.marked[1], 'the picture alone').toBe(0);

    const sketched = await readPng(page, await file('SC001_1B.png'), [255, 255, 255], [[0.5, 0.8]], [[0.45, 0.4, 0.55, 0.6], watermarkBox, clearBox]);
    expect(sketched.points[0], 'no picture: white').toEqual([255, 255, 255]);
    expect(sketched.marked[0], 'the stroke').toBeGreaterThan(0);
    expect(sketched.marked[1], 'the watermark').toBeGreaterThan(0);
    expect(sketched.marked[2], 'nothing else drawn').toBe(0);
  });
}

/**
 * Overwrites every picture the project stores with bytes no decoder reads, under the same sha256, as a truncated or
 * damaged blob in an old file would be: straight into the memory build's saved file (src/core/storage/memoryDriver.ts),
 * then a reload and a reopen, since the app itself would never store such bytes.
 */
async function damageStoredPictures(page: Page) {
  const key = 'storiiboard.memory-files';
  const saved = JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), key)) ?? '{}') as Record<string, string>;
  const path = Object.keys(saved).find((p) => p.endsWith('/Bey County.sbd'));
  if (!path) throw new Error('no Bey County.sbd in the memory build');
  const { default: initSqlJs } = await import('sql.js');
  const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const db = new SQL.Database(Buffer.from(saved[path] ?? '', 'base64'));
  db.run('UPDATE media_files SET bytes = ?', [new TextEncoder().encode('not a picture '.repeat(200))]);
  const count = db.prepare('SELECT count(*) AS n FROM media_files');
  count.step();
  expect(count.getAsObject().n, 'stored pictures damaged').toBe(1);
  count.free();
  saved[path] = Buffer.from(db.export()).toString('base64');
  db.close();
  await page.evaluate(([k, v]) => {
    window.localStorage.setItem(k, v);
  }, [key, JSON.stringify(saved)] as const);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
}

test('a stored picture that won’t decode goes out marked and named, and the export runs to the end', async ({ page }) => {
  const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
  await frames.nth(0).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fixture);
  await expect(frames.nth(0).locator('img[data-frame-image]')).toBeVisible();
  await damageStoredPictures(page);
  await expect(frames).toHaveCount(2);

  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText('Exported 2 frames to “Bey County frames”. 1 has a missing picture: SC001_1A.')).toBeVisible();
  expect(files.map((f) => f.suggestedFilename()).sort()).toEqual(['SC001_1A.png', 'SC001_1B.png']);
  const found = files.find((f) => f.suggestedFilename() === 'SC001_1A.png');
  if (!found) throw new Error('no SC001_1A.png');
  // White, with PICTURE MISSING across the middle.
  const marked = await readPng(page, await found.path(), [255, 255, 255], [[0.5, 0.8]], [[0.3, 0.45, 0.7, 0.55]]);
  expect(marked.points[0]).toEqual([255, 255, 255]);
  expect(marked.marked[0], 'PICTURE MISSING').toBeGreaterThan(0);
});

test('Watermark Settings saves one edit, and the Export dialog says the PDF and PNGs carry it', async ({ page }) => {
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  await settings.getByLabel('Text').fill('DRAFT');
  await settings.getByRole('combobox', { name: /^Position/ }).selectOption({ label: 'Centre' });
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export')).toContainText('Watermark “DRAFT”, centre.');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  await expect(dialog(page, 'Export')).toContainText('Watermark “DRAFT”, centre.');
  // The CSV is a report: it carries none.
  await dialog(page, 'Export').getByRole('radio', { name: 'Shot list (CSV)' }).check();
  await expect(dialog(page, 'Export')).toContainText('No watermark.');
});

test('a double click on Watermark Save makes one step to undo', async ({ page }) => {
  const undo = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z';
  const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
  await expect(frames).toHaveCount(2);
  await projectMenu(page, 'Watermark Settings');
  await dialog(page, 'Watermark Settings').getByLabel('Text').fill('DRAFT');
  // Both clicks in one go, as a fast double click lands before the first write is done.
  await dialog(page, 'Watermark Settings')
    .getByRole('button', { name: 'Save' })
    .evaluate((save: HTMLElement) => {
      save.click();
      save.click();
    });
  await expect(dialog(page, 'Watermark Settings')).toHaveCount(0);
  // One undo takes the watermark back, and the frames stay.
  await page.keyboard.press(undo);
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  await expect(dialog(page, 'Export')).toContainText('No watermark.');
  await expect(frames).toHaveCount(2);
});

test('undo and the workspace keys do nothing inside the export dialogs, to the board behind them', async ({ page }) => {
  const mac = await page.evaluate(() => /Mac/i.test(navigator.userAgent));
  const undo = mac ? 'Meta+z' : 'Control+z';
  const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
  await expect(frames).toHaveCount(2);
  await projectMenu(page, 'Watermark Settings');
  const strength = dialog(page, 'Watermark Settings').getByRole('slider');
  await strength.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(undo);
  await page.keyboard.press(mac ? 'Meta+Shift+z' : 'Control+y');
  await page.keyboard.press('Alt+3');
  await expect(dialog(page, 'Watermark Settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frames).toHaveCount(2);

  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeFocused();
  await page.keyboard.press(undo);
  await dialog(page, 'Export').getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press(undo);
  await expect(dialog(page, 'Export')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frames).toHaveCount(2);
  // Out of the dialog, undo is the project's again: the second frame goes.
  await page.keyboard.press(undo);
  await expect(frames).toHaveCount(1);
});

test('the dialogs take focus, close on Escape and give it back to the project menu', async ({ page }) => {
  const menuButton = page.getByRole('button', { name: 'Project', exact: true });
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Export')).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  await projectMenu(page, 'Watermark Settings');
  await expect(dialog(page, 'Watermark Settings').getByLabel('Text')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Watermark Settings')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
});

test('a dialog the browser closes by itself opens again from the menu', async ({ page }) => {
  // What WebView2 does on a second Escape the page can't stop: the dialog closes without a cancel.
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('dialog')?.close();
  });
  await expect(dialog(page, 'Export')).toHaveCount(0);
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export')).toBeVisible();
});

test('Watermark Save with nothing changed leaves no step to undo', async ({ page }) => {
  const undo = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z';
  const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
  await expect(frames).toHaveCount(2);
  await projectMenu(page, 'Watermark Settings');
  await dialog(page, 'Watermark Settings').getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page, 'Watermark Settings')).toHaveCount(0);
  // Undo reaches the last real edit, the second frame, not an empty watermark step.
  await page.keyboard.press(undo);
  await expect(frames).toHaveCount(1);
});

/**
 * Holds every frame from the `from`th on, waiting to be encoded, until the test calls window.releaseFrame(), so Stop
 * lands mid-export every time. At canvasBlob's own seam, whichever the engine has: OffscreenCanvas's convertToBlob,
 * or the <canvas> toBlob that macOS 13.0 to 13.2's WebKit falls back to.
 */
async function holdFrames(page: Page, from: number, offscreen: boolean) {
  await page.evaluate(
    ({ from, offscreen }) => {
      if (!offscreen) Reflect.deleteProperty(window, 'OffscreenCanvas');
      let calls = 0;
      const w = window as unknown as { releaseFrame?: () => void };
      const held = new Promise<void>((resolve) => {
        w.releaseFrame = resolve;
      });
      if (typeof OffscreenCanvas !== 'undefined') {
        const encode = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'convertToBlob')?.value as (
          this: OffscreenCanvas,
          options?: ImageEncodeOptions,
        ) => Promise<Blob>;
        OffscreenCanvas.prototype.convertToBlob = async function (this: OffscreenCanvas, options) {
          calls += 1;
          if (calls >= from) await held;
          return encode.call(this, options);
        };
        return;
      }
      const encode = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob')?.value as (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        type?: string,
        quality?: number,
      ) => void;
      HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback, type, quality) {
        calls += 1;
        if (calls < from) {
          encode.call(this, callback, type, quality);
          return;
        }
        void held.then(() => {
          encode.call(this, callback, type, quality);
        });
      };
    },
    { from, offscreen },
  );
  if (!offscreen) expect(await page.evaluate(() => typeof OffscreenCanvas)).toBe('undefined');
}

// Each run twice, as the picture test above is: with OffscreenCanvas where the engine has it, and without, as macOS
// 13.0 to 13.2's WebKit draws.
for (const offscreen of [true, false]) {
  const without = offscreen ? '' : ', without OffscreenCanvas';

  test(`Stop ends a running export between frames, and says what it wrote${without}`, async ({ page }) => {
    await holdFrames(page, 2, offscreen);
    await projectMenu(page, 'Export Project…');
    await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
    const files: Download[] = [];
    page.on('download', (download) => files.push(download));
    await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
    await expect(dialog(page, 'Export').getByRole('status')).toHaveText('Exporting 1 of 2…');
    await dialog(page, 'Export').getByRole('button', { name: 'Stop' }).click();
    await expect(dialog(page, 'Export')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { releaseFrame?: () => void }).releaseFrame?.();
    });
    await expect(page.getByRole('status').getByText('Export stopped: 1 of 2 written to “Bey County frames”.')).toBeVisible();
    expect(files.map((f) => f.suggestedFilename())).toEqual(['SC001_1A.png']);
  });

  test(`a double click starts one export, and Stop ends it${without}`, async ({ page }) => {
    // Two clicks land in one task, before React can disable the button: a second run would take over Stop, and the
    // first would go on writing. Every frame after the first is held, the second run's too.
    await holdFrames(page, 2, offscreen);
    await projectMenu(page, 'Export Project…');
    await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
    const files: Download[] = [];
    page.on('download', (download) => files.push(download));
    await dialog(page, 'Export')
      .getByRole('button', { name: 'Choose folder…' })
      .evaluate((button: HTMLElement) => {
        button.click();
        button.click();
      });
    await expect(dialog(page, 'Export').getByRole('status')).toHaveText('Exporting 1 of 2…');
    await dialog(page, 'Export').getByRole('button', { name: 'Stop' }).click();
    await expect(dialog(page, 'Export')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { releaseFrame?: () => void }).releaseFrame?.();
    });
    await expect(page.getByRole('status').getByText('Export stopped: 1 of 2 written to “Bey County frames”.')).toBeVisible();
    expect(files.map((f) => f.suggestedFilename())).toEqual(['SC001_1A.png']);
    await expect(page.getByText(/^Exported /)).toHaveCount(0);
  });
}

async function releaseFrame(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { releaseFrame?: () => void }).releaseFrame?.();
  });
}

test('Stop on a PDF, which writes its one file at the end, says nothing was written', async ({ page }) => {
  await holdFrames(page, 2, true);
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeChecked();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  await expect(dialog(page, 'Export').getByRole('status')).toHaveText('Exporting 1 of 2…');
  await dialog(page, 'Export').getByRole('button', { name: 'Stop' }).click();
  await expect(dialog(page, 'Export')).toHaveCount(0);
  // Let the held frame finish: its drawing counted as done made the old message say "2 of 2 written".
  await releaseFrame(page);
  await expect(page.getByRole('status').getByText('Export stopped. Nothing was written.')).toBeVisible();
  expect(files).toEqual([]);
});

/**
 * Makes every export write from the `from`th on fail as a full disk would, until window.clearDisk(). At the memory
 * build's write, the download: a typeless Blob is only ever an export's (pictures carry their type).
 */
async function failWrites(page: Page, from: number) {
  await page.evaluate((from) => {
    const make = URL.createObjectURL.bind(URL);
    let writes = 0;
    let full = true;
    (window as unknown as { clearDisk?: () => void }).clearDisk = () => {
      full = false;
    };
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob && object.type === '') {
        writes += 1;
        if (full && writes >= from) throw new Error('Disk is full.');
      }
      return make(object);
    };
  }, from);
}

test('a frame that fails to write stops the export, and the dialog says how far it got', async ({ page }) => {
  await failWrites(page, 2);
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  // Inside the dialog, where it can be read and is announced; not in the shell's notice behind the backdrop.
  await expect(dialog(page, 'Export').getByRole('alert')).toHaveText('Stopped with 1 of 2 written to “Bey County frames”: Disk is full.');
  await expect(page.getByText(/Disk is full/)).toHaveCount(1);
  await expect(dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' })).toBeEnabled();
  expect(files.map((f) => f.suggestedFilename())).toEqual(['SC001_1A.png']);
});

test('a shot list that fails to write says why inside the dialog, and a new try clears it', async ({ page }) => {
  await failWrites(page, 1);
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Shot list (CSV)' }).check();
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  await expect(dialog(page, 'Export').getByRole('alert')).toHaveText('Not exported to “Bey County shot list.csv”: Disk is full.');
  await expect(page.getByText(/Disk is full/)).toHaveCount(1);
  // Room made: the next try goes through, and the old reason goes.
  await page.evaluate(() => {
    (window as unknown as { clearDisk?: () => void }).clearDisk?.();
  });
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  expect((await downloaded).suggestedFilename()).toBe('Bey County shot list.csv');
  await expect(dialog(page, 'Export')).toHaveCount(0);
  await expect(page.getByText(/Disk is full/)).toHaveCount(0);
});

test('a PDF that fails to write says it went nowhere, not how many frames it drew', async ({ page }) => {
  await failWrites(page, 1);
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByRole('radio', { name: 'Storyboard (PDF)' })).toBeChecked();
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  await expect(dialog(page, 'Export').getByRole('alert')).toHaveText('Not exported to “Bey County storyboard.pdf”: Disk is full.');
});

/**
 * A night exterior, as a PNG made in the page: a red band across the top fifth and near-black below it. Square, so a
 * 16:9 frame crops it, and the band says which part of it the frame shows.
 */
const NIGHT_RED = [200, 30, 30];
const NIGHT_DARK = [16, 16, 16];
async function nightPicture(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ red, dark }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = `rgb(${dark.join(',')})`;
      ctx.fillRect(0, 0, 400, 400);
      ctx.fillStyle = `rgb(${red.join(',')})`;
      ctx.fillRect(0, 0, 400, 80);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) throw new Error('no png');
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    { red: NIGHT_RED, dark: NIGHT_DARK },
  );
  return Buffer.from(bytes);
}

test('a PNG frame is framed as on the board, and its watermark reads over a dark picture', async ({ page }) => {
  const frames = board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
  await frames.nth(0).click();
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await inspector.getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles({ name: 'night ext.png', mimeType: 'image/png', buffer: await nightPicture(page) });
  await expect(frames.nth(0).locator('img[data-frame-image]')).toBeVisible();
  // Framed up to the top of the picture, a step at a time (each saved before the next), as far as it goes: the
  // frame shows the picture's top 56%, the red band in its top third.
  const framing = inspector.getByRole('application', { name: /^Framing/ });
  for (const down of [44, 39, 33, 28]) {
    await framing.press('Shift+ArrowDown');
    await expect(inspector.getByText(`Zoom 100%, centred 50% across and ${String(down)}% down.`)).toBeAttached();
  }
  // The watermark where it lands on the dark, at the strength it starts at.
  await projectMenu(page, 'Watermark Settings');
  await dialog(page, 'Watermark Settings').getByLabel('Text').fill('DRAFT');
  await dialog(page, 'Watermark Settings').getByRole('combobox', { name: /^Position/ }).selectOption({ label: 'Bottom right' });
  await dialog(page, 'Watermark Settings').getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page, 'Watermark Settings')).toHaveCount(0);

  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByRole('radio', { name: 'Frames (PNG)' }).check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  await expect.poll(() => files.length).toBe(2);
  const found = files.find((f) => f.suggestedFilename() === 'SC001_1A.png');
  if (!found) throw new Error('no SC001_1A.png');

  // Red at 30% down and at both side edges: the person's framing, filling the frame. Uncropped, stretched or
  // centred, the frame would be dark there, or white at the sides.
  const points: [number, number][] = [
    [0.5, 0.02],
    [0.01, 0.3],
    [0.99, 0.3],
    [0.5, 0.5],
    [0.01, 0.6],
  ];
  const night = await readPng(page, await found.path(), NIGHT_DARK, points, [
    [0.7, 0.85, 1, 1],
    [0.05, 0.5, 0.6, 0.95],
  ]);
  const expected = [NIGHT_RED, NIGHT_RED, NIGHT_RED, NIGHT_DARK, NIGHT_DARK];
  night.points.forEach((colour, p) => {
    colour.forEach((channel, i) => {
      expect(Math.abs(channel - (expected[p]?.[i] ?? 0)), `point ${String(p)}, channel ${String(i)}`).toBeLessThanOrEqual(12);
    });
  });
  expect(night.marked[0], 'the watermark over the dark').toBeGreaterThan(0);
  expect(night.marked[1], 'the dark alone').toBe(0);
});

test('the export dialogs use the kit’s square controls', async ({ page }) => {
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  // Native checkboxes and radios draw round in WebView2 and WebKit; the kit's switches and segments don't.
  await expect(settings.getByRole('switch', { name: 'PNG frames' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.locator('input[type="checkbox"], input[type="radio"]')).toHaveCount(0);
  expect(await settings.getByRole('slider', { name: /^Strength/ }).evaluate((input) => getComputedStyle(input).appearance)).toBe('none');
  // A switch turned off is saved: the PNGs no longer carry the watermark.
  await settings.getByLabel('Text').fill('DRAFT');
  await settings.getByRole('switch', { name: 'PNG frames' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await projectMenu(page, 'Export Project…');
  const exporting = dialog(page, 'Export');
  await expect(exporting.locator('input[type="checkbox"], input[type="radio"]')).toHaveCount(0);
  await exporting.getByRole('radio', { name: 'Frames (PNG)' }).check();
  await expect(exporting.getByRole('radio', { name: 'Frames (PNG)' })).toHaveAttribute('aria-checked', 'true');
  await expect(exporting).toContainText('One image per frame');
  await expect(exporting).toContainText('No watermark.');
});

test('Strength goes as low as a stored watermark can be, 5%, and keeps it', async ({ page }) => {
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  await settings.getByLabel('Text').fill('DRAFT');
  const strength = settings.getByRole('slider', { name: /^Strength/ });
  await strength.press('Home');
  await expect(strength).toHaveValue('5');
  await expect(strength).toHaveAttribute('aria-valuetext', '5%');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await projectMenu(page, 'Watermark Settings');
  await expect(dialog(page, 'Watermark Settings').getByRole('slider', { name: /^Strength/ })).toHaveValue('5');
  await expect(dialog(page, 'Watermark Settings').getByRole('slider', { name: /^Strength/ })).toHaveAttribute('aria-valuetext', '5%');
});

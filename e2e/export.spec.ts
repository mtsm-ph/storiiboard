import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Export (1.24) in the memory build, where each file downloads: the shot list CSV's text, the PNG frames' names and
// sizes, and the watermark set in Watermark Settings.

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

test('exports the shot list as CSV, one row per frame', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export')).toBeVisible();
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
  await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  await expect.poll(() => files.length).toBe(2);
  expect(files.map((f) => f.suggestedFilename()).sort()).toEqual(['SC001_1A.png', 'SC001_1B.png']);
  for (const file of files) expect(pngSize(await file.path())).toEqual({ width: 1920, height: 1080 });
});

/**
 * What a PNG holds, decoded in the page: the colour at each point, and how many pixels in each box are clearly darker
 * than `ground`, the colour under them (ink drawn over it, at any strength the watermark has).
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
      const dark = ([x1, y1, x2, y2]: [number, number, number, number]) => {
        const { data } = ctx.getImageData(Math.floor(x1 * width), Math.floor(y1 * height), Math.ceil((x2 - x1) * width), Math.ceil((y2 - y1) * height));
        const floor = ground.reduce((sum, channel) => sum + channel, 0) - 60;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) < floor) count += 1;
        return count;
      };
      return { points: points.map(at), dark: boxes.map(dark) };
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
    await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
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
    expect(picture.dark[0], 'the watermark over the picture').toBeGreaterThan(0);
    expect(picture.dark[1], 'the picture alone').toBe(0);

    const sketched = await readPng(page, await file('SC001_1B.png'), [255, 255, 255], [[0.5, 0.8]], [[0.45, 0.4, 0.55, 0.6], watermarkBox, clearBox]);
    expect(sketched.points[0], 'no picture: white').toEqual([255, 255, 255]);
    expect(sketched.dark[0], 'the stroke').toBeGreaterThan(0);
    expect(sketched.dark[1], 'the watermark').toBeGreaterThan(0);
    expect(sketched.dark[2], 'nothing else drawn').toBe(0);
  });
}

test('Watermark Settings saves one edit, and the Export dialog says the PNGs carry it', async ({ page }) => {
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  await settings.getByLabel('Text').fill('DRAFT');
  await settings.getByRole('combobox', { name: /^Position/ }).selectOption({ label: 'Centre' });
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
  await expect(dialog(page, 'Export')).toContainText('Watermark “DRAFT”, centre.');
  // The CSV is a report: it carries none.
  await dialog(page, 'Export').getByLabel('Shot list (CSV)').check();
  await expect(dialog(page, 'Export')).toContainText('No watermark.');
});

test('the dialogs take focus, close on Escape and give it back to the project menu', async ({ page }) => {
  const menuButton = page.getByRole('button', { name: 'Project', exact: true });
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export').getByLabel('Shot list (CSV)')).toBeFocused();
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

test('Stop ends a running export between frames, and says what it wrote', async ({ page }) => {
  // The second frame waits to be encoded until the test lets it go, so Stop lands mid-export every time.
  await page.evaluate(() => {
    const encode = Object.getOwnPropertyDescriptor(OffscreenCanvas.prototype, 'convertToBlob')?.value as (
      this: OffscreenCanvas,
      options?: ImageEncodeOptions,
    ) => Promise<Blob>;
    let calls = 0;
    const w = window as unknown as { releaseFrame?: () => void };
    const held = new Promise<void>((resolve) => {
      w.releaseFrame = resolve;
    });
    OffscreenCanvas.prototype.convertToBlob = async function (this: OffscreenCanvas, options) {
      calls += 1;
      if (calls === 2) await held;
      return encode.call(this, options);
    };
  });
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
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

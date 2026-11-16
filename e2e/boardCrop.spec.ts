import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { skipOnboarding } from './onboarding';
import { wholePixelCentre } from './wholePixels';

// A board picture's crop and border (6.5.7b, Kevin, Nov 16) in the memory build. Ctrl (⌘ on a Mac) held as the right
// middle handle's drag starts crops: the box narrows, the picture's pixels stay where they were, the cut part shows
// dimmed meanwhile, and one ⌘Z restores box and crop; the same handle dragged plainly resizes the picture as a whole.
// Reset crop from the menu and from the fields; a typed side crops. A border on, in a colour and width of its own,
// drawn and printed; in the Dark view a default border is light and a chosen one is unchanged. axe on the new fields.
// The canvas is pixels, so the board is read from its data and its colours from its layers.

test.use({ viewport: { width: 1440, height: 900 } });
test.use({ deviceScaleFactor: 1 });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
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

const PAPER = [238, 233, 223];
const DARK_INK = [238, 233, 223];
const INK = [22, 21, 15];

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const boardCanvas = (page: Page) => boardTile(page).locator('[data-canvas]');
const properties = (page: Page) => boardTile(page).getByRole('group', { name: 'Properties of the selection' });
const cropGroup = (page: Page) => properties(page).getByRole('group', { name: 'Crop', exact: true });
const borderGroup = (page: Page) => properties(page).getByRole('group', { name: 'Border', exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

interface Picture {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  border: boolean;
  borderColor: string | null;
  borderWidth: number;
}
const pictureOf = async (page: Page): Promise<Picture> => {
  const all = JSON.parse((await boardTile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Picture[];
  const found = all.find((item) => item.kind === 'picture');
  if (!found) throw new Error('no picture');
  return found;
};

/** Where a world point is on screen, from the view the canvas reports. */
async function screen(canvas: Locator, x: number, y: number) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas.getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** The colour drawn at a world point: the canvas's layers laid over its background, as the screen shows them. */
async function pixel(canvas: Locator, x: number, y: number): Promise<number[]> {
  const at = await screen(canvas, x, y);
  return canvas.evaluate(
    (frame, { px, py }) => {
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const context = out.getContext('2d');
      if (!context) return [];
      context.fillStyle = getComputedStyle(frame).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      for (const layer of frame.querySelectorAll('canvas')) {
        const box = layer.getBoundingClientRect();
        if (px < box.left || px >= box.right || py < box.top || py >= box.bottom) continue;
        const sx = ((px - box.left) * layer.width) / box.width;
        const sy = ((py - box.top) * layer.height) / box.height;
        context.drawImage(layer, Math.floor(sx), Math.floor(sy), 1, 1, 0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    },
    { px: Math.round(at.x), py: Math.round(at.y) },
  );
}

/** Where the handles are, as world points: the canvas reports each shown anchor in its stage's pixels. */
async function handles(canvas: Locator): Promise<Record<string, { x: number; y: number }>> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas.getAttribute(name));
  const zoom = await attr('data-zoom');
  const cx = await attr('data-cx');
  const cy = await attr('data-cy');
  const at = JSON.parse((await canvas.getAttribute('data-handles')) ?? '{}') as Record<string, { x: number; y: number }>;
  return Object.fromEntries(Object.entries(at).map(([name, p]) => [name, { x: cx + (p.x - box.width / 2) / zoom, y: cy + (p.y - box.height / 2) / zoom }]));
}

/** That the handles frame a box exactly (to a tenth of a screen pixel's rounding), all eight of them. */
async function expectHandlesFrame(canvas: Locator, g: { x: number; y: number; width: number; height: number }) {
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const tolerance = 0.5 / zoom;
  const want: Record<string, { x: number; y: number }> = {
    'top-left': { x: g.x, y: g.y },
    'top-center': { x: g.x + g.width / 2, y: g.y },
    'top-right': { x: g.x + g.width, y: g.y },
    'middle-right': { x: g.x + g.width, y: g.y + g.height / 2 },
    'bottom-right': { x: g.x + g.width, y: g.y + g.height },
    'bottom-center': { x: g.x + g.width / 2, y: g.y + g.height },
    'bottom-left': { x: g.x, y: g.y + g.height },
    'middle-left': { x: g.x, y: g.y + g.height / 2 },
  };
  await expect.poll(async () => {
    const seen = await handles(canvas);
    return Object.entries(want).every(([name, p]) => {
      const s = seen[name];
      return s !== undefined && Math.abs(s.x - p.x) <= tolerance && Math.abs(s.y - p.y) <= tolerance;
    });
  }).toBe(true);
}

/** Whether two colours are the same to within a step of rounding on each channel. */
const near = (a: readonly number[], b: readonly number[], by = 3) => a.length === b.length && a.every((c, i) => Math.abs(c - (b[i] ?? 0)) <= by);

/** A 400 by 300 picture made in the page, red rising and green falling from left to right, dropped at the canvas's middle. */
async function dropGradient(page: Page, into: Locator) {
  const transfer = await page.evaluateHandle(async () => {
    const canvas = new OffscreenCanvas(400, 300);
    const context = canvas.getContext('2d');
    if (context) {
      for (let x = 0; x < 400; x += 1) {
        context.fillStyle = `rgb(${String(Math.round((x * 255) / 399))}, ${String(Math.round(255 - (x * 255) / 399))}, 64)`;
        context.fillRect(x, 0, 1, 300);
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(new File([blob], 'gradient.png', { type: 'image/png' }));
    return data;
  });
  const box = await into.boundingBox();
  if (!box) throw new Error('no canvas');
  await boardTile(page).locator('[data-board-data]').dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await pictureOf(page).catch(() => null))?.kind ?? null).toBe('picture');
  // Drawn once its picture is read.
  await expect.poll(async () => Object.values(JSON.parse((await boardTile(page).locator('[data-board-data]').getAttribute('data-picture-levels')) ?? '{}') as Record<string, string>).length).toBe(1);
}

/** The camera board, open, its centre on whole pixels, with the gradient picture dropped on it and selected. */
async function boardWithPicture(page: Page): Promise<Picture> {
  await sections(page).getByRole('button', { name: /^Moodboard/ }).click();
  await boardTile(page).locator('[data-department-board="camera"]').click();
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, boardCanvas(page));
  await dropGradient(page, boardCanvas(page));
  const pic = await pictureOf(page);
  const middle = await screen(boardCanvas(page), pic.x + pic.width / 2, pic.y + pic.height / 2);
  await page.mouse.click(middle.x, middle.y);
  await expect(cropGroup(page)).toBeVisible();
  return pic;
}

/** Drags from a screen point by dx, with a key held from before the press to after the release (or none). */
async function drag(page: Page, from: { x: number; y: number }, dx: number, key: string | null, during?: () => Promise<void>) {
  if (key) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y, { steps: 3 });
  await during?.();
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
}

test('Ctrl + the right middle handle crops: the box narrows, the pixels stay, the cut part dims; one undo restores it; a plain drag resizes', async ({ page }) => {
  const pic = await boardWithPicture(page);
  const canvas = boardCanvas(page);
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  expect(pic.crop).toBeNull();
  // Two points near the left edge, and one in the part about to be cut.
  const probes = [
    { x: pic.x + 40, y: pic.y + pic.height / 2 },
    { x: pic.x + 120, y: pic.y + pic.height / 3 },
  ];
  const before = await Promise.all(probes.map((p) => pixel(canvas, p.x, p.y)));
  const cutAt = { x: pic.x + pic.width - 20, y: pic.y + pic.height / 2 };
  const cutBefore = await pixel(canvas, cutAt.x, cutAt.y);
  const handle = await screen(canvas, pic.x + pic.width, pic.y + pic.height / 2);
  await drag(page, handle, -80, await mod(page), async () => {
    // Mid-drag: what is being cut shows dimmed, neither as it was nor gone.
    await expect.poll(async () => near(await pixel(canvas, cutAt.x, cutAt.y), cutBefore, 6)).toBe(false);
    const dimmed = await pixel(canvas, cutAt.x, cutAt.y);
    expect(near(dimmed, PAPER, 6)).toBe(false);
    // And the handles frame the part kept so far, never the whole picture.
    await expectHandlesFrame(canvas, { x: pic.x, y: pic.y, width: pic.width - 80 / zoom, height: pic.height });
  });
  await expect.poll(async () => (await pictureOf(page)).crop !== null).toBe(true);
  const cropped = await pictureOf(page);
  expect(cropped.x).toBeCloseTo(pic.x, 1);
  expect(cropped.y).toBeCloseTo(pic.y, 1);
  expect(cropped.height).toBeCloseTo(pic.height, 1);
  expect(cropped.width).toBeCloseTo(pic.width - 80 / zoom, 0);
  expect(cropped.crop?.x).toBe(0);
  expect(cropped.crop?.width ?? 0).toBeCloseTo(cropped.width / pic.width, 3);
  // The picture did not scale: the points near its left edge are the colours they were, and the cut part is the board's paper.
  for (const [i, p] of probes.entries()) expect(near(await pixel(canvas, p.x, p.y), before[i] ?? [])).toBe(true);
  await expect.poll(() => pixel(canvas, cutAt.x, cutAt.y)).toEqual(PAPER);
  await expectHandlesFrame(canvas, cropped);

  // One undo restores the box and the crop together.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await pictureOf(page)).crop).toBeNull();
  expect((await pictureOf(page)).width).toBe(pic.width);

  // The same handle without the key resizes the picture as a whole: no crop, its proportions kept, its pixels scaled.
  await drag(page, handle, -80, null);
  await expect.poll(async () => (await pictureOf(page)).width).toBeCloseTo(pic.width - 80 / zoom, 0);
  const resized = await pictureOf(page);
  expect(resized.crop).toBeNull();
  expect(resized.width / resized.height).toBeCloseTo(pic.width / pic.height, 2);
  expect(resized.x).toBeCloseTo(pic.x, 1);
  expect(near(await pixel(canvas, probes[1]?.x ?? 0, resized.y + resized.height / 3), before[1] ?? [])).toBe(false);
});

test('a typed side crops; Reset crop from the menu and from the fields brings the whole picture back where it was', async ({ page }) => {
  const pic = await boardWithPicture(page);
  const canvas = boardCanvas(page);
  const left = cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' });
  await expect(left).toHaveValue('0');
  await expect(cropGroup(page).getByRole('button', { name: 'Reset crop' })).toBeDisabled();
  // Typed, then Tab: the crop is taken and focus is in the next field, Top, not lost to a redrawn strip.
  await left.fill('10');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await pictureOf(page)).crop).toEqual({ x: 0.1, y: 0, width: 0.9, height: 1 });
  await expect(cropGroup(page).getByRole('spinbutton', { name: 'Crop Top %' })).toBeFocused();
  const cropped = await pictureOf(page);
  expect([cropped.x, cropped.width]).toEqual([pic.x + pic.width / 10, pic.width * 0.9]);
  await expect(cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' })).toHaveValue('10');
  // The handles frame the kept part.
  await expectHandlesFrame(canvas, cropped);

  // From the item's context menu.
  const middle = await screen(canvas, cropped.x + cropped.width / 2, cropped.y + cropped.height / 2);
  await page.mouse.click(middle.x, middle.y, { button: 'right' });
  const menu = canvas.getByRole('group', { name: 'Board actions' });
  await menu.getByRole('button', { name: 'Reset crop' }).click();
  await expect.poll(async () => (await pictureOf(page)).crop).toBeNull();
  const whole = await pictureOf(page);
  expect([whole.x, whole.y, whole.width, whole.height]).toEqual([pic.x, pic.y, pic.width, pic.height]);

  // And from the fields, after cropping the bottom by typing.
  const bottom = cropGroup(page).getByRole('spinbutton', { name: 'Crop Bottom %' });
  await bottom.fill('25');
  await bottom.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).crop).toEqual({ x: 0, y: 0, width: 1, height: 0.75 });
  await cropGroup(page).getByRole('button', { name: 'Reset crop' }).click();
  await expect.poll(async () => (await pictureOf(page)).crop).toBeNull();
  expect((await pictureOf(page)).height).toBe(pic.height);
  // Reset crop is disabled once there is no crop: focus goes to the first crop field.
  await expect(cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' })).toBeFocused();
  await expectHandlesFrame(canvas, pic);
});

test('a cropped picture’s handles: a plain corner drag scales it about its kept corner, a second Ctrl-drag crops on from its visible edge', async ({ page }) => {
  await boardWithPicture(page);
  const canvas = boardCanvas(page);
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const left = cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' });
  await left.fill('25');
  await left.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).crop).toEqual({ x: 0.25, y: 0, width: 0.75, height: 1 });
  const cropped = await pictureOf(page);
  await expectHandlesFrame(canvas, cropped);

  // A plain drag of the bottom-right corner inward: the whole kept part scales about its top-left corner, the crop as it was.
  const corner = await screen(canvas, cropped.x + cropped.width, cropped.y + cropped.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 30, corner.y - 20, { steps: 3 });
  await page.mouse.move(corner.x - 60, corner.y - 40, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await pictureOf(page)).width).toBeLessThan(cropped.width - 10);
  const scaled = await pictureOf(page);
  expect(scaled.crop).toEqual({ x: 0.25, y: 0, width: 0.75, height: 1 });
  expect(scaled.x).toBeCloseTo(cropped.x, 1);
  expect(scaled.y).toBeCloseTo(cropped.y, 1);
  expect(scaled.width / scaled.height).toBeCloseTo(cropped.width / cropped.height, 2);
  await expectHandlesFrame(canvas, scaled);

  // Ctrl on its right middle handle, where the kept part ends: it crops on from there, the picture's size kept.
  const edge = await screen(canvas, scaled.x + scaled.width, scaled.y + scaled.height / 2);
  await drag(page, edge, -40, await mod(page));
  await expect.poll(async () => (await pictureOf(page)).width).toBeCloseTo(scaled.width - 40 / zoom, 0);
  const again = await pictureOf(page);
  expect(again.x).toBeCloseTo(scaled.x, 1);
  expect(again.height).toBeCloseTo(scaled.height, 1);
  expect(again.crop?.x).toBe(0.25);
  // The picture kept its size on the board: its whole width is the same before and after.
  expect(again.width / (again.crop?.width ?? 1)).toBeCloseTo(scaled.width / 0.75, 0);
  await expectHandlesFrame(canvas, again);
});

test('focus stays put in the border’s fields: Space twice on Thicker border is two steps, and the width shows what is stored', async ({ page }) => {
  await boardWithPicture(page);
  const thicker = borderGroup(page).getByRole('button', { name: 'Thicker border' });
  await thicker.focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(3);
  await expect(thicker).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(4);
  const width = borderGroup(page).getByRole('spinbutton', { name: 'Width' });
  await expect(width).toHaveValue('4');
  // Out of range: held to the nearer end, and shown so, even when it was that already.
  await width.fill('0');
  await width.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(1);
  await expect(width).toHaveValue('1');
  await width.fill('0');
  await width.press('Enter');
  await expect(width).toHaveValue('1');
  await width.fill('41');
  await width.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(40);
  await expect(width).toHaveValue('40');
  await width.fill('41');
  await width.press('Enter');
  await expect(width).toHaveValue('40');
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the test calls the app's own modules by URL from inside the page, which have no types here */
test('a border in a colour and width of its own shows on the board and in the PDF’s display list, and the PDF holds the kept part alone', async ({ page }) => {
  await sections(page).getByRole('button', { name: /^Moodboard/ }).click();
  await boardTile(page).getByRole('button', { name: 'New deck' }).click();
  await boardTile(page).getByLabel('Deck name').fill('Look');
  await boardTile(page).getByLabel('Template').selectOption({ label: 'Blank' });
  await boardTile(page).getByRole('button', { name: 'Create deck' }).click();
  const deck = page.getByRole('application', { name: 'Look board' });
  await expect(deck).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, deck);
  await dropGradient(page, deck);
  const pic = await pictureOf(page);
  const middle = await screen(deck, pic.x + pic.width / 2, pic.y + pic.height / 2);
  await page.mouse.click(middle.x, middle.y);
  await expect(borderGroup(page)).toBeVisible();
  const zoom = Number(await deck.getAttribute('data-zoom'));

  const toggle = borderGroup(page).getByRole('switch', { name: 'Show border' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect.poll(async () => (await pictureOf(page)).border).toBe(true);
  const width = borderGroup(page).getByRole('spinbutton', { name: 'Width' });
  await width.fill('9');
  await width.press('Enter');
  await borderGroup(page).getByRole('button', { name: 'Thicker border' }).click();
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(10);
  await borderGroup(page).getByRole('button', { name: /^Border colour:/ }).click();
  const panel = borderGroup(page).getByRole('group', { name: 'Border colour' });
  const hex = panel.getByRole('textbox', { name: 'Hex' });
  await hex.fill('2c5f8a');
  await hex.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).borderColor).toBe('#2C5F8A');
  await page.keyboard.press('Escape');
  // In the middle of the 10-unit band, on the left edge clear of its handle: the border's own colour; inside it, the picture.
  const band = { x: pic.x + 5, y: pic.y + pic.height / 4 };
  await expect.poll(() => pixel(deck, band.x, band.y)).toEqual([44, 95, 138]);
  expect(near(await pixel(deck, pic.x + 10 + 4 / zoom, band.y), [44, 95, 138], 10)).toBe(false);

  // Cropped by typing, then printed: the clip is the box, the picture whole at its size, the border its width.
  const left = cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' });
  await left.fill('10');
  await left.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).crop?.x ?? null).toBe(0.1);
  const printed = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const { projectStore } = await load('/src/app/projectStore.ts');
    const print = await load('/src/features/moodboards/deckPrint.ts');
    const render = await load('/src/features/export/deckRender.tsx');
    const state = projectStore.getState();
    const boardId = Object.values(state.records as Record<string, { type: string; id: string }>).find((r) => r.type === 'board')?.id;
    const [scene] = print.printPages(state.records, boardId);
    await render.preparePage(scene, state.project.file, 'thumbnail');
    const rendered = await render.renderPage(scene);
    const ops = rendered.print().ops as { op: string; stroke?: string | null; strokeWidth?: number; width?: number; height?: number; x?: number; y?: number }[];
    rendered.dispose();
    return {
      images: ops.filter((o) => o.op === 'image'),
      borders: ops.filter((o) => o.op === 'shape' && (o.stroke ?? '').toUpperCase() === '#2C5F8A').map((o) => o.strokeWidth),
    };
  });
  // One picture, the box's own size with its kept part: no whole picture under a clip.
  expect(printed.images).toEqual([{ op: 'image', sha256: expect.any(String) as unknown, width: pic.width * 0.9, height: pic.height, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } }]);
  expect(printed.borders).toEqual([10]);

  // The PDF itself embeds the kept part alone: 360 by 300 of the picture's 400 by 300 pixels (its own density).
  await boardTile(page).getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog.getByRole('radio', { name: 'Deck as PDF' })).toBeChecked();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save…' }).click();
  const pdf = await PDFDocument.load(readFileSync(await (await downloaded).path()));
  const sizes = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [[object.dict.get(PDFName.of('Width')), object.dict.get(PDFName.of('Height'))]] : []))
    .map(([w, h]) => [w instanceof PDFNumber ? w.asNumber() : -1, h instanceof PDFNumber ? h.asNumber() : -1]);
  expect(sizes).toHaveLength(1);
  const [embedded] = sizes;
  expect(Math.abs((embedded?.[0] ?? 0) - 360)).toBeLessThanOrEqual(1);
  expect(Math.abs((embedded?.[1] ?? 0) - 300)).toBeLessThanOrEqual(1);
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

test('in the Dark view a default border is light and a chosen one keeps its colour', async ({ page }) => {
  const pic = await boardWithPicture(page);
  const canvas = boardCanvas(page);
  await borderGroup(page).getByRole('switch', { name: 'Show border' }).click();
  const width = borderGroup(page).getByRole('spinbutton', { name: 'Width' });
  await width.fill('10');
  await width.press('Enter');
  await expect.poll(async () => (await pictureOf(page)).borderWidth).toBe(10);
  // Clear of the left middle handle.
  const band = { x: pic.x + 5, y: pic.y + pic.height / 4 };
  await expect.poll(() => pixel(canvas, band.x, band.y)).toEqual(INK);
  await boardTile(page).getByRole('group', { name: 'Canvas view' }).getByRole('button', { name: 'Dark' }).click();
  await expect.poll(() => pixel(canvas, band.x, band.y)).toEqual(DARK_INK);
  await borderGroup(page).getByRole('button', { name: /^Border colour:/ }).click();
  const hex = borderGroup(page).getByRole('group', { name: 'Border colour' }).getByRole('textbox', { name: 'Hex' });
  await hex.fill('a35139');
  await hex.press('Enter');
  await page.keyboard.press('Escape');
  await expect.poll(() => pixel(canvas, band.x, band.y)).toEqual([163, 81, 57]);
  await boardTile(page).getByRole('group', { name: 'Canvas view' }).getByRole('button', { name: 'Paper' }).click();
  await expect.poll(() => pixel(canvas, band.x, band.y)).toEqual([163, 81, 57]);

  // Default takes the chosen colour off: the border is the ink again, light in Dark, and the control's swatch says so.
  await boardTile(page).getByRole('group', { name: 'Canvas view' }).getByRole('button', { name: 'Dark' }).click();
  await borderGroup(page).getByRole('button', { name: /^Border colour:/ }).click();
  const panel = borderGroup(page).getByRole('group', { name: 'Border colour' });
  await panel.getByRole('button', { name: 'Default' }).click();
  await expect.poll(async () => (await pictureOf(page)).borderColor).toBeNull();
  await expect(panel.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect.poll(() => pixel(canvas, band.x, band.y)).toEqual(DARK_INK);
  const swatch = borderGroup(page).getByRole('button', { name: /^Border colour:/ }).locator('span').first();
  await expect(swatch).toHaveCSS('background-color', 'rgb(238, 233, 223)');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the crop and border fields pass axe in the app’s ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    await boardWithPicture(page);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    for (const on of [false, true]) {
      if (on) {
        await borderGroup(page).getByRole('switch', { name: 'Show border' }).click();
        const left = cropGroup(page).getByRole('spinbutton', { name: 'Crop Left %' });
        await left.fill('10');
        await left.press('Enter');
        await expect(cropGroup(page).getByRole('button', { name: 'Reset crop' })).toBeEnabled();
      }
      const { violations } = await new AxeBuilder({ page }).include('[data-picture-crop]').include('[data-picture-border]').withTags(tags).analyze();
      expect(violations).toEqual([]);
    }
  });
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { wholePixelCentre } from './wholePixels';

// The board's dot grid (6.5.7a, Kevin, Nov 16) in the memory build: a view on this computer, never part of the board.
// Grid on draws dots at the spacing its label says, in the view's soft ink on Paper and on Dark; zooming out to the next
// level keeps the dots that were there on dots; it is still on after a reload and on another board; the switches make no
// History step; a deck's PNG is the same file with it on as off. Snap on, a dragged sticky lands on a dot and ⌘Z puts it
// back; snap off, it lands where it was dropped. axe on the switches in the app's light and dark themes. The canvas is
// pixels, so its colours are read from its layers laid over its background, as the screen shows them.

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

// The palettes, as the screen shows them (design/tokens): the paper and the dark page, and each view's muted ink.
const PAPER = [238, 233, 223];
const ABYSSAL = [27, 38, 50];
const SOFT_INK = [94, 90, 82];
const DARK_SOFT_INK = [169, 178, 188];
const WHITE = [255, 255, 255];

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const boardCanvas = (page: Page) => boardTile(page).locator('[data-canvas]');
const gridBox = (page: Page) => boardTile(page).locator('[data-dot-grid]');
const gridSwitch = (page: Page) => boardTile(page).getByRole('switch', { name: 'Grid', exact: true });
const snapSwitch = (page: Page) => boardTile(page).getByRole('switch', { name: 'Snap to grid', exact: true });
const viewGroup = (page: Page) => boardTile(page).getByRole('group', { name: 'Canvas view' });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
interface BoardItem {
  id: string;
  kind: string;
  x: number;
  y: number;
}
const boardItems = async (page: Page): Promise<BoardItem[]> => JSON.parse((await boardTile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as BoardItem[];
const stickyAt = async (page: Page) => {
  const sticky = (await boardItems(page)).find((item) => item.kind === 'sticky');
  return sticky ? { x: sticky.x, y: sticky.y } : null;
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

/** A PNG's pixel, decoded by the browser from the file's own bytes. */
async function pngPixel(page: Page, bytes: Uint8Array, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ({ data, px, py }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const context = out.getContext('2d');
      if (!context) return [];
      context.drawImage(bitmap, px, py, 1, 1, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    },
    { data: [...bytes], px: x, py: y },
  );
}

const bytesOf = async (download: Download): Promise<Uint8Array> => new Uint8Array(readFileSync(await download.path()));

/** The Moodboard section's board for a department, open, its centre on whole pixels. */
async function openBoard(page: Page, department = 'camera') {
  await sections(page).getByRole('button', { name: /^Moodboard/ }).click();
  await boardTile(page).locator(`[data-department-board="${department}"]`).click();
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, boardCanvas(page));
}

/** Turns a switch to the state asked for, and waits for it to say so. */
async function turn(control: Locator, on: boolean) {
  if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(on));
}

/** Opens History from the top bar: its steps are what the project's edits made. */
async function openHistory(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

test('the dot grid: drawn at its labelled spacing in each view’s soft ink, the same dots on a coarser level, kept on this computer, never an edit', async ({ page }) => {
  await openBoard(page);
  // Off until chosen: the board is bare paper, and Snap to grid waits for the grid.
  await expect(gridSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(snapSwitch(page)).toBeDisabled();
  await expect(gridBox(page)).toHaveAttribute('data-dot-grid', 'off');
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(PAPER);
  await openHistory(page);
  const before = await steps(page).count();

  await turn(gridSwitch(page), true);
  await expect(snapSwitch(page)).toBeEnabled();
  await turn(snapSwitch(page), true);
  // At 100%, the dots are 20 apart, and the label says so.
  await expect(boardCanvas(page)).toHaveAttribute('data-zoom', '1');
  await expect(gridBox(page)).toHaveAttribute('data-dot-spacing', '20');
  await expect(gridBox(page)).toContainText('20');
  for (const [x, y] of [[0, 0], [20, 0], [-40, 60], [100, -80]] as const) await expect.poll(() => pixel(boardCanvas(page), x, y)).toEqual(SOFT_INK);
  // Between the dots, the paper.
  for (const [x, y] of [[10, 10], [30, 0], [0, 50]] as const) await expect.poll(() => pixel(boardCanvas(page), x, y)).toEqual(PAPER);
  // Neither switch is an edit: History has no step for them.
  await expect(steps(page)).toHaveCount(before);

  // Zoomed out until the label changes level: 100 apart. The dots that were on multiples of 100 are still on dots; the
  // ones between are gone, never moved sideways.
  for (let i = 0; i < 8 && (await gridBox(page).getAttribute('data-dot-spacing')) === '20'; i += 1) {
    await boardTile(page).getByRole('button', { name: 'Zoom out' }).click();
  }
  await expect(gridBox(page)).toHaveAttribute('data-dot-spacing', '100');
  await expect(gridBox(page)).toContainText('100');
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(SOFT_INK);
  await expect.poll(() => pixel(boardCanvas(page), 100, -100)).toEqual(SOFT_INK);
  await expect.poll(() => pixel(boardCanvas(page), 40, 0)).toEqual(PAPER);

  // Dark: the dots in the dark theme's muted ink on the dark page.
  await viewGroup(page).getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(viewGroup(page)).toHaveAttribute('data-canvas-view', 'dark');
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(DARK_SOFT_INK);
  await expect.poll(() => pixel(boardCanvas(page), 40, 0)).toEqual(ABYSSAL);
  await viewGroup(page).getByRole('button', { name: 'Paper', exact: true }).click();
  await expect(steps(page)).toHaveCount(before);

  // Another board shows it too: this computer's choice, not the board's.
  await boardTile(page).getByRole('button', { name: 'Boards', exact: true }).click();
  await boardTile(page).locator('[data-department-board="art"]').click();
  await expect(boardCanvas(page)).toBeVisible();
  await expect(gridSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(snapSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(SOFT_INK);

  // A reload is the app starting again: still on.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sections(page).getByRole('list', { name: 'Boards' }).getByRole('button', { name: 'Camera' }).click();
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, boardCanvas(page));
  await expect(gridSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(snapSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(SOFT_INK);

  // Grid off: the dots go, and Snap to grid shows off and disabled, as it acts; its choice comes back with the grid.
  await turn(gridSwitch(page), false);
  await expect(snapSwitch(page)).toBeDisabled();
  await expect(snapSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(gridBox(page)).not.toHaveAttribute('data-dot-spacing', /./);
  await expect.poll(() => pixel(boardCanvas(page), 0, 0)).toEqual(PAPER);
  await turn(gridSwitch(page), true);
  await expect(snapSwitch(page)).toBeEnabled();
  await expect(snapSwitch(page)).toHaveAttribute('aria-checked', 'true');
});

test('snap to grid: a dragged sticky lands on a dot and ⌘Z puts it back; with snap off it lands where it is dropped', async ({ page }) => {
  await openBoard(page);
  await turn(gridSwitch(page), true);
  await turn(snapSwitch(page), true);
  // A sticky placed by a click, centred there, off the dots: 200 square, its corner at (113, -93).
  await boardTile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  const place = await screen(boardCanvas(page), 213, 7);
  await page.mouse.click(place.x, place.y);
  await page.keyboard.type('Rain');
  await page.keyboard.press('Escape');
  await expect.poll(() => stickyAt(page)).toEqual({ x: 113, y: -93 });
  // The dots sit under the items: on the sticky, at a dot clear of its words, its yellow; beside it, the dot.
  await expect.poll(() => pixel(boardCanvas(page), 260, 60)).toEqual([255, 233, 122]);
  await expect.poll(() => pixel(boardCanvas(page), 340, 60)).toEqual(SOFT_INK);

  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const a = await screen(boardCanvas(page), from.x, from.y);
    const b = await screen(boardCanvas(page), to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  // Dropped 50 right and 50 down: its corner would be at (163, -43), 3 from the dot at (160, -40) each way.
  await drag({ x: 213, y: 7 }, { x: 263, y: 57 });
  await expect.poll(() => stickyAt(page)).toEqual({ x: 160, y: -40 });
  const placed = await stickyAt(page);
  expect(Number.isInteger((placed?.x ?? 1) / 20)).toBe(true);
  expect(Number.isInteger((placed?.y ?? 1) / 20)).toBe(true);
  await boardCanvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => stickyAt(page)).toEqual({ x: 113, y: -93 });

  // Snap off (the grid still on): the same drag lands where it was dropped.
  await turn(snapSwitch(page), false);
  await drag({ x: 213, y: 7 }, { x: 263, y: 57 });
  await expect.poll(() => stickyAt(page)).toEqual({ x: 163, y: -43 });
});

test('snap to grid: a sticky resized by its corner handle has that corner on a dot; with snap off, where it was let go', async ({ page }) => {
  await openBoard(page);
  await turn(gridSwitch(page), true);
  await turn(snapSwitch(page), true);
  await boardTile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  const place = await screen(boardCanvas(page), 213, 7);
  await page.mouse.click(place.x, place.y);
  await page.keyboard.type('Rain');
  await page.keyboard.press('Escape');
  const size = async () => {
    const sticky = (JSON.parse((await boardCanvas(page).getAttribute('data-items')) ?? '[]') as { x: number; y: number; width: number; height: number }[])[0];
    return sticky ? { x: sticky.x, y: sticky.y, width: sticky.width, height: sticky.height } : null;
  };
  await expect.poll(size).toEqual({ x: 113, y: -93, width: 200, height: 200 });
  // The bottom-right handle, at (313, 107), let go at (337, 122): 3 and 2 from the dot at (340, 120).
  const handle = async (to: { x: number; y: number }) => {
    const a = await screen(boardCanvas(page), 313, 107);
    const b = await screen(boardCanvas(page), to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  await handle({ x: 337, y: 122 });
  await expect.poll(size).toEqual({ x: 113, y: -93, width: 227, height: 213 });
  await boardCanvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(size).toEqual({ x: 113, y: -93, width: 200, height: 200 });
  await turn(snapSwitch(page), false);
  await handle({ x: 337, y: 122 });
  await expect.poll(size).toEqual({ x: 113, y: -93, width: 224, height: 215 });
});

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
const drawnBoxes = async (canvas: Locator): Promise<Box[]> => JSON.parse((await canvas.getAttribute('data-items')) ?? '[]') as Box[];

/**
 * Drags the bottom-right handle of an item that keeps its proportions out along its diagonal to just past where its
 * right edge would sit on a dot about 60 screen pixels further out, and gives back the box it was and the box it is now.
 */
async function cornerAlongDiagonal(page: Page, canvas: Locator, id: string): Promise<{ was: Box; now: Box; spacing: number }> {
  const was = (await drawnBoxes(canvas)).find((b) => b.id === id);
  if (!was) throw new Error('no item');
  const spacing = Number(await gridBox(page).getAttribute('data-dot-spacing'));
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  // Let go 3 screen pixels past the dot along the diagonal: off the dots on both axes unless snap takes it.
  const right = Math.ceil((was.x + was.width + 60 / zoom) / spacing) * spacing + 3 / zoom;
  const bottom = was.y + (right - was.x) / (was.width / was.height);
  const from = await screen(canvas, was.x + was.width, was.y + was.height);
  const to = await screen(canvas, right, bottom);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await drawnBoxes(canvas)).find((b) => b.id === id)?.width).not.toBe(was.width);
  const now = (await drawnBoxes(canvas)).find((b) => b.id === id);
  if (!now) throw new Error('no item');
  return { was, now, spacing };
}

/** Whether a stored length is a multiple of the spacing, to the 0.01 a stored value is rounded to. */
const onDots = (value: number, spacing: number) => Math.abs(value - Math.round(value / spacing) * spacing) <= 0.011;

test('snap to grid: a picture’s and a deck page’s corner end with an edge on the dots and their proportions kept', async ({ page }) => {
  await openBoard(page);
  await turn(gridSwitch(page), true);
  await turn(snapSwitch(page), true);
  // A picture dropped on the board, fitted into view and picked.
  const wrapper = boardTile(page).locator('[data-board-data]');
  const area = await wrapper.boundingBox();
  if (!area) throw new Error('no canvas');
  const transfer = await page.evaluateHandle((list) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(list)], 'srgb.jpg', { type: 'image/jpeg' }));
    return t;
  }, [...readFileSync(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)))]);
  await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: area.x + area.width / 2, clientY: area.y + area.height / 2 });
  await expect.poll(async () => (await boardItems(page)).filter((i) => i.kind === 'picture').length).toBe(1);
  const picture = (await boardItems(page)).find((i) => i.kind === 'picture');
  if (!picture) throw new Error('no picture');
  await boardTile(page).getByRole('button', { name: 'Fit all', exact: true }).click();
  const zoomOut = boardTile(page).getByRole('button', { name: 'Zoom out' });
  await zoomOut.click();
  const placed = (await drawnBoxes(boardCanvas(page))).find((b) => b.id === picture.id);
  if (!placed) throw new Error('no picture drawn');
  const middle = await screen(boardCanvas(page), placed.x + placed.width / 2, placed.y + placed.height / 2);
  await page.mouse.click(middle.x, middle.y);
  await expect(boardCanvas(page)).toHaveAttribute('data-selection', JSON.stringify([picture.id]));
  const shot = await cornerAlongDiagonal(page, boardCanvas(page), picture.id);
  expect(onDots(shot.now.x + shot.now.width, shot.spacing) || onDots(shot.now.y + shot.now.height, shot.spacing)).toBe(true);
  expect(Math.abs(shot.now.width / shot.now.height - shot.was.width / shot.was.height)).toBeLessThanOrEqual(0.01);
  // Without snap, the same drag leaves the right edge where it was let go, off the dots.
  await boardCanvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await drawnBoxes(boardCanvas(page))).find((b) => b.id === picture.id)?.width).toBe(shot.was.width);
  await turn(snapSwitch(page), false);
  const free = await cornerAlongDiagonal(page, boardCanvas(page), picture.id);
  expect(onDots(free.now.x + free.now.width, free.spacing)).toBe(false);
  await turn(snapSwitch(page), true);

  // A deck's page, picked by its top edge.
  await boardTile(page).getByRole('button', { name: 'Boards', exact: true }).click();
  await boardTile(page).getByRole('button', { name: 'New deck' }).click();
  await boardTile(page).getByLabel('Deck name').fill('Look');
  await boardTile(page).getByLabel('Template').selectOption({ label: 'Blank' });
  await boardTile(page).getByRole('button', { name: 'Create deck' }).click();
  const deck = page.getByRole('application', { name: 'Look board' });
  await expect(deck).toBeVisible();
  await expect.poll(async () => (await boardItems(page)).some((i) => i.kind === 'page')).toBe(true);
  const sheet = (await boardItems(page)).find((i) => i.kind === 'page');
  if (!sheet) throw new Error('no page');
  await expect.poll(async () => Number(await deck.getAttribute('data-zoom'))).toBeLessThan(1);
  const drawn = (await drawnBoxes(deck)).find((b) => b.id === sheet.id);
  if (!drawn) throw new Error('no page drawn');
  const edge = await screen(deck, drawn.x + drawn.width / 2, drawn.y);
  await page.mouse.click(edge.x, edge.y);
  await expect(deck).toHaveAttribute('data-selection', JSON.stringify([sheet.id]));
  const paged = await cornerAlongDiagonal(page, deck, sheet.id);
  expect(onDots(paged.now.x + paged.now.width, paged.spacing) || onDots(paged.now.y + paged.now.height, paged.spacing)).toBe(true);
  expect(Math.abs(paged.now.width / paged.now.height - paged.was.width / paged.was.height)).toBeLessThanOrEqual(0.01);
});

test('a deck’s PNG is the same file with the dot grid on as off', async ({ page }) => {
  await sections(page).getByRole('button', { name: /^Moodboard/ }).click();
  await boardTile(page).getByRole('button', { name: 'New deck' }).click();
  await boardTile(page).getByLabel('Deck name').fill('Look');
  await boardTile(page).getByLabel('Template').selectOption({ label: 'Blank' });
  await boardTile(page).getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('application', { name: 'Look board' })).toBeVisible();
  const exportPng = async () => {
    await boardTile(page).getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('radio', { name: 'Pages as PNG' }).click();
    const waiting = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Choose folder…' }).click();
    const bytes = await bytesOf(await waiting);
    await page.getByRole('button', { name: 'Got it' }).click();
    return bytes;
  };
  const off = await exportPng();
  await turn(gridSwitch(page), true);
  await expect(gridBox(page)).toHaveAttribute('data-dot-grid', 'on');
  const on = await exportPng();
  // The page's own white at its corner and across it, never a dot, and the very same bytes as with the grid off.
  for (const [x, y] of [[0, 0], [20, 20], [100, 100], [400, 300]] as const) expect(await pngPixel(page, on, x, y)).toEqual(WHITE);
  expect(Buffer.from(on).equals(Buffer.from(off))).toBe(true);
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the test calls the app's own modules by URL from inside the page, which have no types here */
test('a sticky in a colour of its own: typed as a hex, drawn in it with paper words on a dark fill, printed so, undone, and back to a swatch', async ({ page }) => {
  await sections(page).getByRole('button', { name: /^Moodboard/ }).click();
  await boardTile(page).getByRole('button', { name: 'New deck' }).click();
  await boardTile(page).getByLabel('Deck name').fill('Look');
  await boardTile(page).getByLabel('Template').selectOption({ label: 'Blank' });
  await boardTile(page).getByRole('button', { name: 'Create deck' }).click();
  const deck = page.getByRole('application', { name: 'Look board' });
  await expect(deck).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, deck);
  const pageBox = (await boardItems(page)).find((i) => i.kind === 'page');
  if (!pageBox) throw new Error('no page');
  // A sticky placed by a click 400, 300 into the page, centred there: 200 square, from (300, 200) into the page.
  await boardTile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  const into = await screen(deck, pageBox.x + 400, pageBox.y + 300);
  await page.mouse.click(into.x, into.y);
  await page.keyboard.type('Night');
  await page.keyboard.press('Escape');
  const colour = async () => ((await boardItems(page)) as (BoardItem & { color?: string | null })[]).find((i) => i.kind === 'sticky')?.color ?? null;
  await expect.poll(colour).toBe('#FFE97A');
  // Read clear of its words and outline: towards its lower right.
  const fillAt = { x: pageBox.x + 470, y: pageBox.y + 370 };
  await expect.poll(() => pixel(deck, fillAt.x, fillAt.y)).toEqual([255, 233, 122]);

  // Typed as a hex, as a text box's colour is: taken on Enter, the panel left open.
  const properties = boardTile(page).getByRole('group', { name: 'Properties of the selection' });
  await properties.getByRole('button', { name: /^Sticky colour:/ }).click();
  const panel = properties.getByRole('group', { name: 'Sticky colour' });
  const hex = panel.getByRole('textbox', { name: 'Hex' });
  await hex.fill('1b2632');
  await hex.press('Enter');
  await expect.poll(colour).toBe('#1B2632');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect.poll(() => pixel(deck, fillAt.x, fillAt.y)).toEqual(ABYSSAL);

  // What the PDF is made from (deckRender's display list): the sticky's fill in its colour, its words in paper.
  const printed = await page.evaluate(async (pageId) => {
    const load = (p: string) => import(/* @vite-ignore */ p);
    const { projectStore } = await load('/src/app/projectStore.ts');
    const print = await load('/src/features/moodboards/deckPrint.ts');
    const render = await load('/src/features/export/deckRender.tsx');
    const state = projectStore.getState();
    const [scene] = print.printPages(state.records, state.records[pageId].parentId);
    await render.preparePage(scene, state.project.file, 'thumbnail');
    const rendered = await render.renderPage(scene);
    const ops = rendered.print().ops as { op: string; fill?: string | null; lines?: { text: string }[] }[];
    rendered.dispose();
    return {
      fills: ops.filter((o) => o.op === 'shape').map((o) => (o.fill ?? '').toUpperCase()),
      words: ops.filter((o) => o.op === 'text' && (o.lines ?? []).some((l) => l.text === 'Night')).map((o) => (o.fill ?? '').toUpperCase()),
    };
  }, pageBox.id);
  expect(printed.fills).toContain('#1B2632');
  expect(printed.words).toEqual(['#EEE9DF']);

  // ⌘Z puts the swatch back; ⌘⇧Z the colour again; then a swatch, which closes the panel as it always did.
  await deck.focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(colour).toBe('#FFE97A');
  await expect.poll(() => pixel(deck, fillAt.x, fillAt.y)).toEqual([255, 233, 122]);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(colour).toBe('#1B2632');
  await properties.getByRole('button', { name: /^Sticky colour:/ }).click();
  await panel.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect.poll(colour).toBe('#B5DDF5');
  await expect(panel).toBeHidden();
  await expect.poll(() => pixel(deck, fillAt.x, fillAt.y)).toEqual([181, 221, 245]);
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

for (const theme of ['light', 'dark'] as const) {
  test(`the Grid and Snap to grid switches pass axe in the app’s ${theme} theme, on and off`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    await openBoard(page);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    for (const [grid, snap] of [[false, false], [true, false], [true, true]] as const) {
      await turn(gridSwitch(page), grid);
      if (grid) await turn(snapSwitch(page), snap);
      // Tab reaches each switch that can be used.
      await gridSwitch(page).focus();
      await expect(gridSwitch(page)).toBeFocused();
      if (grid) {
        await page.keyboard.press('Tab');
        await expect(snapSwitch(page)).toBeFocused();
      }
      const { violations } = await new AxeBuilder({ page }).include('[data-dot-grid]').withTags(tags).analyze();
      expect(violations).toEqual([]);
    }
  });
}

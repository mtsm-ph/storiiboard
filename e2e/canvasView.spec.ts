import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';
import { wholePixelCentre } from './wholePixels';

// Paper or Dark (6.5.1, Kevin, Nov 16) in the memory build: a view of the canvas on this computer, never part of the
// board. On Setup, Dark draws the plan's page in the dark theme's abyssal and a default wall in its paper ink; it is still
// Dark after a reload and in a new project; the Moodboard keeps its own choice; toggling makes no History step and ⌘Z
// never takes it back; and the plan's PNG is on paper whatever it says. The same on a board, where a sticky's own colour
// reads the same in both views and a deck's PNG stays on paper. axe on the toggle, in the app's light and dark themes.
// The canvas is pixels, so its colours are read from its layers laid over its background, as the screen shows them.

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
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

// The palettes, as the screen shows them (design/tokens): the light theme's paper and ink, the dark theme's page and ink.
const PAPER = [238, 233, 223];
const INK = [22, 21, 15];
const ABYSSAL = [27, 38, 50];
const LIGHT_INK = PAPER;
const RAISED = [201, 193, 177];
const DARK_RAISED = [58, 75, 96];
const WHITE = [255, 255, 255];
const STICKY_YELLOW = [255, 233, 122];
const CHOSEN_BLUE = [44, 95, 138];

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const planCanvas = (page: Page) => planTile(page).locator('[data-canvas]');
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const boardCanvas = (page: Page) => boardTile(page).locator('[data-canvas]');
const viewGroup = (tile: Locator) => tile.getByRole('group', { name: 'Canvas view' });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const planData = async (page: Page): Promise<{ kind: string; width: number }[]> =>
  JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as { kind: string; width: number }[];
const wallCount = async (page: Page) => (await planData(page)).filter((item) => item.kind === 'wall').length;
interface BoardItem {
  kind: string;
  x: number;
  y: number;
  fill?: string | null;
}
const boardItems = async (page: Page): Promise<BoardItem[]> => JSON.parse((await boardTile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as BoardItem[];
const properties = (page: Page) => boardTile(page).getByRole('group', { name: 'Properties of the selection' });

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

/**
 * A plan PNG's wall, found in its pixels: the first square of 14 × 14 pixels all the given colour, scanning every 7
 * pixels (a 10 cm wall is 4 mm or more on the page at the scales a 4 m room prints at, 31 px or more at 200 dpi; no
 * letter, rule or scale bar is that wide and that tall at once). Its middle's colour, and the colour of the first of the
 * points 20 to 40 px above it that is the sheet's white (or the last one read): the plan box's own paper beside the wall.
 */
async function pngWall(page: Page, bytes: Uint8Array, colour: readonly number[]): Promise<{ wall: number[]; beside: number[] } | null> {
  return page.evaluate(
    async ({ data, rgb }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
      const out = document.createElement('canvas');
      out.width = bitmap.width;
      out.height = bitmap.height;
      const context = out.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, out.width, out.height).data;
      const at = (x: number, y: number) => [...pixels.slice((y * out.width + x) * 4, (y * out.width + x) * 4 + 3)];
      const is = (x: number, y: number) => {
        const p = at(x, y);
        return p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
      };
      const block = (x: number, y: number) => {
        for (let dy = 0; dy < 14; dy += 1) for (let dx = 0; dx < 14; dx += 1) if (!is(x + dx, y + dy)) return false;
        return true;
      };
      for (let y = 0; y + 14 < out.height; y += 7) {
        for (let x = 0; x + 14 < out.width; x += 7) {
          if (!block(x, y)) continue;
          let top = y;
          while (top > 0 && is(x + 7, top - 1)) top -= 1;
          let beside = at(x + 7, Math.max(0, top - 20));
          for (let up = 20; up <= 40; up += 1) {
            beside = at(x + 7, Math.max(0, top - up));
            if (beside[0] === 255 && beside[1] === 255 && beside[2] === 255) break;
          }
          return { wall: at(x + 7, y + 7), beside };
        }
      }
      return null;
    },
    { data: [...bytes], rgb: [...colour] },
  );
}

const bytesOf = async (download: Download): Promise<Uint8Array> => new Uint8Array(readFileSync(await download.path()));

/** The Setup workspace on SC 01's Setup 1, its room started, in metres, a 4 m wall across it from (-2 m, -1 m) to (2 m, -1 m). */
async function planWithWall(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(planCanvas(page)).toBeVisible();
  await planCanvas(page).focus();
  await page.keyboard.press('w');
  for (const x of [-200, 200]) {
    const at = await screen(planCanvas(page), x, -100);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => wallCount(page)).toBe(1);
}

/** Opens History from the top bar: its steps are what the project's edits made. */
async function openHistory(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

/** Picks Paper or Dark in a tile's canvas view pair, and waits for the canvas to say so. */
async function chooseView(tile: Locator, view: 'Paper' | 'Dark') {
  await viewGroup(tile).getByRole('button', { name: view, exact: true }).click();
  await expect(viewGroup(tile).getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(viewGroup(tile)).toHaveAttribute('data-canvas-view', view.toLowerCase());
}

test('Setup: Dark draws the plan’s page dark and a default wall light, kept on this computer, never an edit, and its PNG stays on paper', async ({ page }) => {
  await planWithWall(page);
  // Between the grid's lines, and on the wall's middle.
  const page0 = { x: 25, y: 125 };
  const wall = { x: 25, y: -100 };
  await expect(viewGroup(planTile(page)).getByRole('button', { name: 'Paper', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(viewGroup(planTile(page)).getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pixel(planCanvas(page), page0.x, page0.y)).toEqual(PAPER);
  await expect.poll(() => pixel(planCanvas(page), wall.x, wall.y)).toEqual(INK);

  // History's steps before the toggle: the scene, the setup, the room, the wall.
  await openHistory(page);
  const before = await steps(page).count();
  expect(before).toBeGreaterThan(0);

  await chooseView(planTile(page), 'Dark');
  await expect.poll(() => pixel(planCanvas(page), page0.x, page0.y)).toEqual(ABYSSAL);
  await expect.poll(() => pixel(planCanvas(page), wall.x, wall.y)).toEqual(LIGHT_INK);
  // Not an edit: no step in History, and ⌘Z takes back the wall, never the view.
  await expect(steps(page)).toHaveCount(before);
  await planCanvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => wallCount(page)).toBe(0);
  await expect(viewGroup(planTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(() => wallCount(page)).toBe(1);
  await expect(viewGroup(planTile(page))).toHaveAttribute('data-canvas-view', 'dark');

  // The plan's PNG is on paper: the sheet's white, its wall in ink with the plan box's white beside it, never the Dark
  // view's light ink on the dark page.
  await page.locator('[data-plan-tile] [data-plan-heading]').getByRole('button', { name: 'Export…' }).click();
  await page.locator('[data-plan-export="plan-setup-png"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog.getByRole('radio', { name: 'Setup plan (PNG)' })).toBeChecked();
  const waiting = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save…' }).click();
  const png = await bytesOf(await waiting);
  expect(await pngPixel(page, png, 10, 10)).toEqual(WHITE);
  expect(await pngWall(page, png, INK)).toEqual({ wall: INK, beside: WHITE });
  expect(await pngWall(page, png, LIGHT_INK)).toBeNull();
  await expect(dialog).toBeHidden();

  // The Moodboard keeps its own choice: still Paper.
  await toSection(page, 'Moodboard');
  await boardTile(page).locator('[data-department-board="camera"]').click();
  await expect(boardCanvas(page)).toBeVisible();
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', 'paper');
  await expect.poll(() => pixel(boardCanvas(page), 0, 300)).toEqual(PAPER);

  // A reload is the app starting again: the project reopened, its plan still Dark.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => wallCount(page)).toBe(1);
  await expect(viewGroup(planTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  await expect.poll(() => pixel(planCanvas(page), page0.x, page0.y)).toEqual(ABYSSAL);

  // A new project: this computer's choice, so Dark too.
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Second unit'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(planCanvas(page)).toBeVisible();
  await expect(viewGroup(planTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  await expect.poll(() => pixel(planCanvas(page), page0.x, page0.y)).toEqual(ABYSSAL);
});

test('Moodboard: Dark draws the board’s page dark and a default rectangle in the dark well, a sticky’s own colour as it is, and a deck’s PNG on paper', async ({ page }) => {
  await toSection(page, 'Moodboard');
  await boardTile(page).locator('[data-department-board="camera"]').click();
  await expect(boardCanvas(page)).toBeVisible();
  await page.waitForTimeout(100);
  await wholePixelCentre(page, boardCanvas(page));
  // A rectangle with no colour of its own, placed by a click, centred on it.
  await boardTile(page).getByRole('button', { name: 'Rectangle' }).click();
  const rect = await screen(boardCanvas(page), -300, 0);
  await page.mouse.click(rect.x, rect.y);
  await expect.poll(async () => (await boardItems(page)).length).toBe(1);
  // A sticky in its yellow, its words at its top left; read at its lower right, clear of them.
  await boardTile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  const note = await screen(boardCanvas(page), 200, 0);
  await page.mouse.click(note.x, note.y);
  await page.keyboard.type('Rain');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await boardItems(page)).length).toBe(2);
  // A rectangle given a colour of its own through the colour control: a fill typed as a hex.
  await boardTile(page).getByRole('button', { name: 'Rectangle' }).click();
  const chosen = await screen(boardCanvas(page), -300, 250);
  await page.mouse.click(chosen.x, chosen.y);
  await expect.poll(async () => (await boardItems(page)).length).toBe(3);
  await properties(page).getByRole('button', { name: /^Fill:/ }).click();
  const hex = properties(page).getByRole('textbox', { name: 'Hex' });
  await hex.fill('2c5f8a');
  await hex.press('Enter');
  await expect.poll(async () => (await boardItems(page)).map((i) => i.fill ?? null)).toContain('#2C5F8A');
  await page.keyboard.press('Escape');
  const empty = { x: 0, y: 300 };
  const sticky = { x: 270, y: 70 };

  await expect.poll(() => pixel(boardCanvas(page), empty.x, empty.y)).toEqual(PAPER);
  await expect.poll(() => pixel(boardCanvas(page), -300, 0)).toEqual(RAISED);
  await expect.poll(() => pixel(boardCanvas(page), sticky.x, sticky.y)).toEqual(STICKY_YELLOW);
  await expect.poll(() => pixel(boardCanvas(page), -300, 250)).toEqual(CHOSEN_BLUE);

  await openHistory(page);
  const before = await steps(page).count();
  expect(before).toBeGreaterThan(0);

  await chooseView(boardTile(page), 'Dark');
  await expect.poll(() => pixel(boardCanvas(page), empty.x, empty.y)).toEqual(ABYSSAL);
  await expect.poll(() => pixel(boardCanvas(page), -300, 0)).toEqual(DARK_RAISED);
  // The sticky's swatch and the chosen fill are their own: the same pixels in both views.
  await expect.poll(() => pixel(boardCanvas(page), sticky.x, sticky.y)).toEqual(STICKY_YELLOW);
  await expect.poll(() => pixel(boardCanvas(page), -300, 250)).toEqual(CHOSEN_BLUE);
  await expect(steps(page)).toHaveCount(before);
  // ⌘Z takes back the last edit (the fill), never the view.
  await boardCanvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await boardItems(page)).map((i) => i.fill ?? null)).not.toContain('#2C5F8A');
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await boardItems(page)).map((i) => i.fill ?? null)).toContain('#2C5F8A');

  // Setup keeps its own choice: still Paper.
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(planCanvas(page)).toBeVisible();
  await expect(viewGroup(planTile(page))).toHaveAttribute('data-canvas-view', 'paper');
  await expect.poll(() => pixel(planCanvas(page), 25, 125)).toEqual(PAPER);

  // A deck is a board: Dark here too. Its page PNG, through the real export, is the same file in Dark as on Paper: the
  // page's own white, a default rectangle on it in the paper palette's raised surface.
  await toSection(page, 'Moodboard');
  await boardTile(page).getByRole('button', { name: 'Boards', exact: true }).click();
  await boardTile(page).getByRole('button', { name: 'New deck' }).click();
  await boardTile(page).getByLabel('Deck name').fill('Look');
  await boardTile(page).getByLabel('Template').selectOption({ label: 'Blank' });
  await boardTile(page).getByRole('button', { name: 'Create deck' }).click();
  const deck = page.getByRole('application', { name: 'Look board' });
  await expect(deck).toBeVisible();
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  const pageBox = (await boardItems(page)).find((i) => i.kind === 'page');
  if (!pageBox) throw new Error('no page');
  // A default rectangle placed by a click 400, 300 into the page, centred there.
  await boardTile(page).getByRole('button', { name: 'Rectangle' }).click();
  const into = await screen(deck, pageBox.x + 400, pageBox.y + 300);
  await page.mouse.click(into.x, into.y);
  await expect.poll(async () => (await boardItems(page)).filter((i) => i.kind === 'rect').length).toBe(1);
  await page.keyboard.press('Escape');
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
  const dark = await exportPng();
  await chooseView(boardTile(page), 'Paper');
  const paper = await exportPng();
  expect(await pngPixel(page, dark, 10, 10)).toEqual(WHITE);
  expect(await pngPixel(page, dark, 400, 300)).toEqual(RAISED);
  expect(Buffer.from(dark).equals(Buffer.from(paper))).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the Paper and Dark pair passes axe in the app’s ${theme} theme, either way it is set`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    await toSection(page, 'Moodboard');
    await boardTile(page).locator('[data-department-board="camera"]').click();
    await expect(boardCanvas(page)).toBeVisible();
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    for (const view of ['Paper', 'Dark'] as const) {
      await chooseView(boardTile(page), view);
      // Tab reaches each of the pair.
      await viewGroup(boardTile(page)).getByRole('button', { name: view, exact: true }).focus();
      await expect(viewGroup(boardTile(page)).getByRole('button', { name: view, exact: true })).toBeFocused();
      const { violations } = await new AxeBuilder({ page }).include('[data-canvas-view]').withTags(tags).analyze();
      expect(violations).toEqual([]);
    }
  });
}

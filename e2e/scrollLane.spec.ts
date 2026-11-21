import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Controls clear of an overlay scroll bar (6.27o). Headless Chromium's bars take no room, as a Mac's do by default, so
// the page measures them as overlay: an overflowing tile takes a 16 px lane on its bar's side, a tile that fits takes
// none, and with classic bars (the root's attribute taken off, as the probe leaves it on Windows) nothing changes.

// Short, so the Layers tile in the Setup workspace overflows up and down.
test.use({ viewport: { width: 1280, height: 520 } });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
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
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Setup/ }).click();
  await expect(page.locator('[data-layers-tile]')).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Lane {
  /** The scroller's lane attribute, or null. */
  lane: string | null;
  overflows: boolean;
  /** How far inside the scroller's right edge each row's last control ends, in px. */
  clear: number[];
}

/** The Layers tile's scroller (the tile's body) and where its rows' last controls end. */
const layersLane = (page: Page): Promise<Lane> =>
  page.locator('[data-layers-tile]').evaluate((tile) => {
    const body = tile.closest('[data-scroll-root]');
    if (!(body instanceof HTMLElement)) throw new Error('no tile body');
    const right = body.getBoundingClientRect().right;
    const lasts = [...tile.querySelectorAll('[data-layer-controls]')].map((controls) => controls.lastElementChild);
    return {
      lane: body.getAttribute('data-scroll-lane'),
      overflows: body.scrollHeight > body.clientHeight,
      clear: lasts.map((last) => right - (last?.getBoundingClientRect().right ?? right)),
    };
  });

test('measures the bars as overlay, and keeps an overflowing tile’s last controls 16 px clear of its right edge', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'overlay');
  await expect.poll(async () => (await layersLane(page)).lane).toBe('y');
  const lane = await layersLane(page);
  expect(lane.overflows).toBe(true);
  expect(lane.clear.length).toBeGreaterThan(0);
  for (const clear of lane.clear) expect(clear).toBeGreaterThanOrEqual(16);
  // Solo, the last control of a row, takes the click.
  const solo = page.locator('[data-layer="camera"] [data-layer-solo]');
  await solo.click();
  await expect(solo).toHaveAttribute('aria-pressed', 'true');
});

test('a tile that fits takes no lane: its content reaches its right edge as before', async ({ page }) => {
  // The lanes are measured once the page has laid out: the overflowing Layers tile has its own by then.
  await expect.poll(async () => (await layersLane(page)).lane).toBe('y');
  // The Selection tile, with nothing picked, holds one line: neither its body nor its own scroller overflows.
  const selection = await page.locator('[data-selection-tile]').evaluate((tile) => {
    const body = tile.closest('[data-scroll-root]');
    if (!(body instanceof HTMLElement)) throw new Error('no tile body');
    return {
      overflows: body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth,
      lanes: [body.getAttribute('data-scroll-lane'), tile.getAttribute('data-scroll-lane')],
      padding: getComputedStyle(body).paddingRight,
      gap: body.getBoundingClientRect().right - tile.getBoundingClientRect().right,
    };
  });
  expect(selection).toEqual({ overflows: false, lanes: [null, null], padding: '0px', gap: 0 });
});

test('a Shot list scrolled to its right end stays there when a frame is added under the lane (#222 round 6c)', async ({ page }) => {
  // Reading the board without its lane lays everything inside out 16 px wider, which pulled the table's sideways
  // position back by 16 px on every change of the board's content; it is put back now, and a change of content alone
  // is read with the lane on.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  for (let i = 0; i < 14; i += 1) await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board.locator('[data-shot-id]').first().click();
  for (const name of ['Second unit notes', 'Drone operator', 'Visual effects plate', 'Picture vehicle']) {
    await inspector.getByLabel('New field').fill(name);
    await inspector.getByRole('button', { name: 'Add field' }).click();
    const field = inspector.getByRole('textbox', { name, exact: true });
    await expect(field).toBeFocused();
    await field.fill('Kept wide on purpose, to scroll');
    await field.press('Enter');
  }
  await board.getByRole('radio', { name: 'Shot list' }).click();
  const table = board.getByRole('table', { name: 'Shot list' });
  await expect(table.getByRole('columnheader', { name: 'Picture vehicle' })).toBeVisible();
  const scroller = table.locator('xpath=..');
  /** The table's scroller, and the board's: its lane and whether it overflows. */
  const read = () =>
    scroller.evaluate((area) => {
      const tile = area.closest('[data-scroll-root]');
      return {
        left: area.scrollLeft,
        max: area.scrollWidth - area.clientWidth,
        tileLane: tile?.getAttribute('data-scroll-lane') ?? null,
        tileOverflows: tile ? tile.scrollHeight > tile.clientHeight : false,
      };
    });
  await expect.poll(async () => (await read()).tileLane).toBe('y');
  const before = await read();
  expect(before.tileOverflows).toBe(true);
  expect(before.max).toBeGreaterThan(0);
  await scroller.evaluate((area) => {
    area.scrollLeft = area.scrollWidth - area.clientWidth;
  });
  await expect.poll(async () => { const now = await read(); return now.left === now.max; }).toBe(true);
  const frames = board.locator('[data-shot-id]');
  // The new frame takes the focus, and focus scrolls its number, in the table's first column, into view: that is the
  // board's own doing, not the lane's, so here focus moves without scrolling. The frame is added by its button's own
  // click, so nothing scrolls the button into view first either.
  await page.evaluate(() => {
    const focus = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')?.value as (this: HTMLElement, options?: FocusOptions) => void;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      focus.call(this, { ...options, preventScroll: true });
    };
  });
  await table.getByRole('button', { name: '+ Frame in SC 01' }).dispatchEvent('click');
  await expect(frames).toHaveCount(15);
  const after = await scroller.evaluate(async (area) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { left: area.scrollLeft, max: area.scrollWidth - area.clientWidth };
  });
  expect(after.max).toBeGreaterThan(0);
  expect(after.left).toBe(after.max);
  // The board taller: its box changes, so once the new size holds it is read without the lane, and the table's
  // position is put back. The table's width doesn't change, so neither does how far it reaches.
  await page.setViewportSize({ width: 1280, height: 560 });
  const resized = await scroller.evaluate(async (area) => {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    const tile = area.closest('[data-scroll-root]');
    return { left: area.scrollLeft, max: area.scrollWidth - area.clientWidth, tileLane: tile?.getAttribute('data-scroll-lane') ?? null };
  });
  expect(resized).toEqual({ left: after.max, max: after.max, tileLane: 'y' });
});

test('with classic bars the overflowing tile takes no lane', async ({ page }) => {
  await expect.poll(async () => (await layersLane(page)).lane).toBe('y');
  const narrow = await layersLane(page);
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-scrollbars');
  });
  await expect.poll(async () => (await layersLane(page)).lane).toBeNull();
  const wide = await layersLane(page);
  expect(wide.overflows).toBe(true);
  // The lane's 16 px are given back to the rows.
  for (const [i, clear] of wide.clear.entries()) expect(clear).toBeCloseTo((narrow.clear[i] ?? 0) - 16, 1);
});

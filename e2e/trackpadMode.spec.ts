import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Trackpad mode (6.5.3, Kevin, Nov 16) in the memory build: one choice on this computer, shown in Settings → App and by
// every plan's and board's zoom, the two in step and kept through a reload. Off, a plain wheel zooms at the pointer (the
// world point under it stays put), Ctrl + wheel scrolls up and down only, Shift + wheel sideways only; on, a wheel pans
// as it always has. A pinch (a wheel flagged Ctrl with no Control key down and a fractional delta, as Chromium sends it)
// zooms in both. The mode is set in each test, never taken from the platform: the suite runs on Windows, Linux and a Mac.

test.use({ viewport: { width: 1440, height: 900 } });

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

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvasOf = (tile: Locator) => tile.locator('[data-canvas]');
const canvasSwitch = (tile: Locator) => tile.getByRole('switch', { name: 'Trackpad mode' });

interface View {
  cx: number;
  cy: number;
  zoom: number;
}

const viewOf = async (canvas: Locator): Promise<View> => ({
  cx: Number(await canvas.getAttribute('data-cx')),
  cy: Number(await canvas.getAttribute('data-cy')),
  zoom: Number(await canvas.getAttribute('data-zoom')),
});

/** The middle of the canvas on the page. */
async function middleOf(canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The world point under a page point, from the view the canvas reports. */
async function worldAt(canvas: Locator, at: { x: number; y: number }) {
  const middle = await middleOf(canvas);
  const view = await viewOf(canvas);
  return { x: view.cx + (at.x - middle.x) / view.zoom, y: view.cy + (at.y - middle.y) / view.zoom };
}

/** Where a world point is on the page now. */
async function pageAt(canvas: Locator, world: { x: number; y: number }) {
  const middle = await middleOf(canvas);
  const view = await viewOf(canvas);
  return { x: middle.x + (world.x - view.cx) * view.zoom, y: middle.y + (world.y - view.cy) * view.zoom };
}

/** A wheel event fired at a page point with exactly these fields: a pinch as Chromium sends one, or a notch. */
async function fireWheel(canvas: Locator, at: { x: number; y: number }, fields: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; shiftKey?: boolean }) {
  await canvas.evaluate(
    (element, { x, y, init }) => {
      element.dispatchEvent(new WheelEvent('wheel', { ...init, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { x: at.x, y: at.y, init: fields },
  );
}

/** Sets trackpad mode with the canvas's own switch, and waits for it to say so. */
async function setMode(tile: Locator, on: boolean) {
  const control = canvasSwitch(tile);
  if ((await control.getAttribute('aria-checked')) !== String(on)) await control.click();
  await expect(control).toHaveAttribute('aria-checked', String(on));
}

/** The Setup workspace on SC 01's Setup 1, its room started. */
async function openPlan(page: Page): Promise<Locator> {
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvasOf(planTile(page))).toBeVisible();
  return planTile(page);
}

/** The Camera board, made as it is first opened. */
async function openBoard(page: Page): Promise<Locator> {
  await toSection(page, 'Moodboard');
  await boardTile(page).locator('[data-department-board="camera"]').click();
  await expect(canvasOf(boardTile(page))).toBeVisible();
  return boardTile(page);
}

/** A wheel over `at` zooms with the world point under it held within 1 px. */
async function expectWheelZoomsAt(page: Page, canvas: Locator, at: { x: number; y: number }) {
  const before = await viewOf(canvas);
  const under = await worldAt(canvas, at);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeGreaterThan(before.zoom * 1.1);
  const now = await pageAt(canvas, under);
  expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);
}

test('Setup, trackpad mode off: the wheel zooms at the pointer, Ctrl + wheel scrolls up and down, Shift + wheel sideways, a pinch zooms', async ({ page }) => {
  const tile = await openPlan(page);
  const canvas = canvasOf(tile);
  await setMode(tile, false);
  const middle = await middleOf(canvas);
  const at = { x: middle.x - 180, y: middle.y + 90 };

  // A plain wheel zooms around the pointer, off the middle.
  await expectWheelZoomsAt(page, canvas, at);
  // One 100 px notch is the zoom control's own step, either way.
  let before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaY: 100 });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom / 1.25, 4);
  before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaY: -100 });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom * 1.25, 4);

  // Ctrl + wheel moves the view up and down only: no zoom, nothing sideways.
  before = await viewOf(canvas);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await viewOf(canvas)).cy).toBeCloseTo(before.cy + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).cx).toBe(before.cx);
  expect((await viewOf(canvas)).zoom).toBe(before.zoom);

  // Shift + wheel moves it sideways only, whether the system sends it as deltaY or has turned it into deltaX.
  before = await viewOf(canvas);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await viewOf(canvas)).cx).toBeCloseTo(before.cx + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).cy).toBe(before.cy);
  expect((await viewOf(canvas)).zoom).toBe(before.zoom);
  before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaX: 100, shiftKey: true });
  await expect.poll(async () => (await viewOf(canvas)).cx).toBeCloseTo(before.cx + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).cy).toBe(before.cy);
  before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaX: 100, deltaY: 100, shiftKey: true });
  await expect.poll(async () => (await viewOf(canvas)).cx).toBeCloseTo(before.cx + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).cy).toBe(before.cy);

  // A pinch zooms at the pointer, no Control key down.
  before = await viewOf(canvas);
  const under = await worldAt(canvas, at);
  await fireWheel(canvas, at, { deltaY: -12.5, ctrlKey: true });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom * Math.exp(12.5 * 0.004), 4);
  const now = await pageAt(canvas, under);
  expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);

  // Over the tool strip, the wheel follows the mode too: it zooms.
  const strip = await tile.locator('[data-tool-strip]').getByRole('button', { name: 'Wall', exact: true }).boundingBox();
  if (!strip) throw new Error('no Wall button');
  before = await viewOf(canvas);
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeGreaterThan(before.zoom * 1.1);
  await expect(canvas).toHaveAttribute('data-tool', 'select');
});

test('Setup, trackpad mode on: a wheel pans as before and a pinch zooms', async ({ page }) => {
  const tile = await openPlan(page);
  const canvas = canvasOf(tile);
  await setMode(tile, true);
  const middle = await middleOf(canvas);
  const at = { x: middle.x + 120, y: middle.y - 60 };
  let before = await viewOf(canvas);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(80, 100);
  await expect.poll(async () => (await viewOf(canvas)).cy).toBeCloseTo(before.cy + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).cx).toBeCloseTo(before.cx + 80 / before.zoom, 3);
  expect((await viewOf(canvas)).zoom).toBe(before.zoom);
  before = await viewOf(canvas);
  const under = await worldAt(canvas, at);
  await fireWheel(canvas, at, { deltaY: -12.5, ctrlKey: true });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom * Math.exp(12.5 * 0.004), 4);
  const now = await pageAt(canvas, under);
  expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);
});

test('the switch in Settings and the one by the zoom are one choice, the platform’s until chosen, kept through a reload', async ({ page }) => {
  const mac = await page.evaluate(() => /Mac/i.test(navigator.userAgent));
  const tile = await openPlan(page);
  // Never chosen: on on a Mac, off elsewhere.
  await expect(canvasSwitch(tile)).toHaveAttribute('aria-checked', String(mac));
  let app = await openSettings(page, 'App');
  const setting = app.getByRole('switch', { name: 'Trackpad mode' });
  await expect(setting).toHaveAttribute('aria-checked', String(mac));
  await expect(app.getByText('Two fingers pan. Off: the wheel zooms.')).toBeVisible();
  // The help line is the switch's description, read with it.
  await expect(setting).toHaveAccessibleDescription('Two fingers pan. Off: the wheel zooms.');
  // Changed in Settings: the canvas's switch follows on Apply (here, the close question's Apply changes).
  await setting.click();
  await expect(setting).toHaveAttribute('aria-checked', String(!mac));
  await closeSettings(page, 'apply');
  await expect(canvasSwitch(tile)).toHaveAttribute('aria-checked', String(!mac));
  await expect(tile.locator('[data-trackpad-mode]')).toHaveAttribute('data-trackpad-mode', mac ? 'off' : 'on');
  // Changed on the canvas: Settings follows.
  await canvasSwitch(tile).click();
  await expect(canvasSwitch(tile)).toHaveAttribute('aria-checked', String(mac));
  app = await openSettings(page, 'App');
  await expect(app.getByRole('switch', { name: 'Trackpad mode' })).toHaveAttribute('aria-checked', String(mac));
  // And set the platform's other way, so the reload shows a choice, not the default.
  await app.getByRole('switch', { name: 'Trackpad mode' }).click();
  await closeSettings(page, 'apply');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect(canvasSwitch(planTile(page))).toHaveAttribute('aria-checked', String(!mac));
  // A board shares it: one choice for every canvas on this computer.
  const board = await openBoard(page);
  await expect(canvasSwitch(board)).toHaveAttribute('aria-checked', String(!mac));
  app = await openSettings(page, 'App');
  await expect(app.getByRole('switch', { name: 'Trackpad mode' })).toHaveAttribute('aria-checked', String(!mac));
  await closeSettings(page);
});

test('Moodboard: off, the wheel zooms at the pointer and a pinch zooms; on, the wheel pans', async ({ page }) => {
  const tile = await openBoard(page);
  const canvas = canvasOf(tile);
  await setMode(tile, false);
  const middle = await middleOf(canvas);
  const at = { x: middle.x + 150, y: middle.y - 80 };
  await expectWheelZoomsAt(page, canvas, at);
  let before = await viewOf(canvas);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await viewOf(canvas)).cy).toBeCloseTo(before.cy - 100 / before.zoom, 3);
  expect((await viewOf(canvas)).zoom).toBe(before.zoom);
  before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaY: 6.25, ctrlKey: true });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom * Math.exp(-6.25 * 0.004), 4);

  await setMode(tile, true);
  before = await viewOf(canvas);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await viewOf(canvas)).cy).toBeCloseTo(before.cy + 100 / before.zoom, 3);
  expect((await viewOf(canvas)).zoom).toBe(before.zoom);
  before = await viewOf(canvas);
  await fireWheel(canvas, at, { deltaY: 6.25, ctrlKey: true });
  await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(before.zoom * Math.exp(-6.25 * 0.004), 4);
});

for (const on of [true, false]) {
  test(`mid-pinch (WebKit's gesture events), no Ctrl- or ⌘-flagged wheel moves or zooms the view, trackpad mode ${on ? 'on' : 'off'}`, async ({ page }) => {
    const tile = await openBoard(page);
    const canvas = canvasOf(tile);
    await setMode(tile, on);
    const middle = await middleOf(canvas);
    const at = { x: middle.x + 100, y: middle.y - 50 };
    const fire = (type: string, scale: number) =>
      canvas.evaluate(
        (el, [kind, value, x, y]) => {
          const event = new Event(kind, { bubbles: true, cancelable: true });
          Object.assign(event, { scale: value, clientX: x, clientY: y });
          el.dispatchEvent(event);
        },
        [type, scale, at.x, at.y] as const,
      );
    const start = await viewOf(canvas);
    await fire('gesturestart', 1);
    await fire('gesturechange', 1.05);
    await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(start.zoom * 1.05, 4);
    const pinched = await viewOf(canvas);
    // A notch-sized and a pinch-sized Ctrl wheel, a ⌘ wheel, and Ctrl with the key really down: none of them is let
    // through mid-gesture, so neither the zoom nor the view's centre moves.
    await fireWheel(canvas, at, { deltaY: -300, ctrlKey: true });
    await fireWheel(canvas, at, { deltaY: 4.5, ctrlKey: true });
    await canvas.evaluate(
      (el, [x, y]) => {
        el.dispatchEvent(new WheelEvent('wheel', { metaKey: true, deltaX: 30, deltaY: 100, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      },
      [at.x, at.y] as const,
    );
    await page.keyboard.down('Control');
    await fireWheel(canvas, at, { deltaY: 100, ctrlKey: true });
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    expect(await viewOf(canvas)).toEqual(pinched);
    await fire('gestureend', 1.05);
    // After the gesture, a pinch-shaped wheel zooms again.
    await fireWheel(canvas, at, { deltaY: -12.5, ctrlKey: true });
    await expect.poll(async () => (await viewOf(canvas)).zoom).toBeCloseTo(pinched.zoom * Math.exp(12.5 * 0.004), 4);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`the trackpad switches pass axe in the app’s ${theme} theme, on and off`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    const tile = await openBoard(page);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    for (const on of [true, false]) {
      await setMode(tile, on);
      // It takes focus, and axe checks it focused, then the Settings switch, in each state.
      await canvasSwitch(tile).focus();
      await expect(canvasSwitch(tile)).toBeFocused();
      const onCanvas = await new AxeBuilder({ page }).include('[data-trackpad-mode]').withTags(tags).analyze();
      expect(onCanvas.violations).toEqual([]);
      const app = await openSettings(page, 'App');
      await expect(app.getByRole('switch', { name: 'Trackpad mode' })).toHaveAttribute('aria-checked', String(on));
      const inSettings = await new AxeBuilder({ page }).include('[role="tabpanel"][aria-labelledby$="-tab-app"]').withTags(tags).analyze();
      expect(inSettings.violations).toEqual([]);
      await closeSettings(page);
    }
  });
}

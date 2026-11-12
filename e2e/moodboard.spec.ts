import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The canvas core and boards (5.0) in the memory build: the Camera board is made when it is first opened from the
// picker, rectangles are drawn, selected, moved, resized, rotated, reordered, copied, deleted and brought back from the
// Trash, every step undoes, and the board is as left after a reload. The canvas is pixels, so the tests read the board
// from the data the canvas keeps on its container (data-items, data-selection).

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
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

const items = async (page: Page): Promise<Item[]> => JSON.parse((await canvas(page).getAttribute('data-items')) ?? '[]') as Item[];
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const ids = async (page: Page) => (await items(page)).map((i) => i.id);
const geometry = async (page: Page) => (await items(page)).map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation }));

async function openCamera(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await expect(tile(page)).toBeVisible();
  // Nothing exists until it is opened: the picker lists the departments to start.
  await tile(page).locator('[data-department-board="camera"]').click();
  await expect(canvas(page)).toBeVisible();
  await page.waitForTimeout(100);
}

/** Where world (0, 0) is on screen: the middle of the canvas at the standard view. */
async function origin(page: Page) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** The view as the canvas reports it: the world point at its middle, and the zoom. */
const viewOf = async (page: Page) => {
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  return { cx: await attr('data-cx'), cy: await attr('data-cy'), zoom: await attr('data-zoom') };
};
/** The world point under a screen point, worked out from the real view. */
const worldUnder = async (page: Page, screen: { x: number; y: number }) => {
  const v = await viewOf(page);
  const o = await origin(page);
  return { x: v.cx + (screen.x - o.x) / v.zoom, y: v.cy + (screen.y - o.y) / v.zoom };
};

const rectTool = (page: Page) => tile(page).getByRole('button', { name: 'Rectangle' });

/** Draws a rectangle by dragging between two world points. */
async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const o = await origin(page);
  const before = (await items(page)).length;
  await rectTool(page).click();
  await drag(page, { x: o.x + from.x, y: o.y + from.y }, { x: o.x + to.x, y: o.y + to.y });
  await expect.poll(async () => (await items(page)).length).toBe(before + 1);
}

const world = async (page: Page, x: number, y: number) => {
  const o = await origin(page);
  return { x: o.x + x, y: o.y + y };
};

async function openTrash(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash).toBeVisible();
  return trash;
}

test('opens the Camera board from the picker, made on first open, and draws rectangles', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  // A new project has no boards: the picker offers the departments and New board.
  await expect(sidebar(page).getByRole('list', { name: 'Boards' }).getByRole('button')).toHaveCount(1);
  await expect(tile(page).getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(tile(page).getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
  await openCamera(page);
  // The board is in the sidebar now, and its name in the tile.
  await expect(sidebar(page).getByRole('list', { name: 'Boards' }).getByRole('button', { name: 'Camera' })).toBeVisible();
  await expect(tile(page).locator('[data-board-title]')).toHaveText('Camera');

  // Drag to draw.
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  expect(await geometry(page)).toEqual([{ x: -300, y: -100, width: 200, height: 120, rotation: 0 }]);
  // After drawing, the tool is Select and the new rectangle is selected.
  await expect(tile(page).getByRole('button', { name: /^Select/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await selection(page)).toEqual(await ids(page));
  await expect(tile(page).getByRole('status')).toHaveText('Rectangle 1 of 1 selected');

  // A click places the standard 200 x 120 rectangle, centred on the click.
  await rectTool(page).click();
  const at = await world(page, 200, 0);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page))[1]).toMatchObject({ x: 100, y: -60, width: 200, height: 120 });

  // Opening another way back: the picker lists the board, and the department's second open makes no second board.
  await tile(page).getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(tile(page).locator('[data-board-open]')).toHaveText(/^Camera/);
  await expect(tile(page).locator('[data-department-board="camera"]')).toHaveCount(0);
  await tile(page).locator('[data-board-open]').click();
  await expect(canvas(page)).toBeVisible();
  expect(await items(page)).toHaveLength(2);
});

test('selects by click, shift and marquee, moves by drag, and each step undoes', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  await draw(page, { x: -100, y: 100 }, { x: 100, y: 220 });
  const [a, b, c] = await ids(page);
  const key = await mod(page);

  // Click selects one, shift adds, shift again takes it off, a click on empty space clears.
  await page.mouse.click(...(Object.values(await world(page, -200, -40)) as [number, number]));
  expect(await selection(page)).toEqual([a]);
  await page.keyboard.down('Shift');
  await page.mouse.click(...(Object.values(await world(page, 200, -40)) as [number, number]));
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([a, b]);
  await page.keyboard.down('Shift');
  await page.mouse.click(...(Object.values(await world(page, -200, -40)) as [number, number]));
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([b]);
  await page.mouse.click(...(Object.values(await world(page, 0, -300)) as [number, number]));
  expect(await selection(page)).toEqual([]);

  // A marquee selects everything it touches, a corner of an item counts.
  await drag(page, await world(page, 80, -150), await world(page, 150, 50));
  expect(await selection(page)).toEqual([b]);
  await drag(page, await world(page, -400, -200), await world(page, 400, 300));
  expect(new Set(await selection(page))).toEqual(new Set([a, b, c]));
  await expect(tile(page).getByRole('status')).toHaveText('3 items selected');
  await page.keyboard.press('Escape');
  expect(await selection(page)).toEqual([]);
  await canvas(page).press(`${key}+a`);
  expect(new Set(await selection(page))).toEqual(new Set([a, b, c]));

  // Dragging one of the three moves all three, as one step.
  const was = await geometry(page);
  await drag(page, await world(page, -200, -40), await world(page, -150, -10));
  await expect.poll(async () => (await items(page))[0]?.x).toBe(was[0] ? was[0].x + 50 : 0);
  expect(await geometry(page)).toEqual(was.map((g) => ({ ...g, x: g.x + 50, y: g.y + 30 })));
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => geometry(page)).toEqual(was);
  await page.keyboard.press(`${key}+Shift+z`);
  await expect.poll(async () => geometry(page)).toEqual(was.map((g) => ({ ...g, x: g.x + 50, y: g.y + 30 })));
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => geometry(page)).toEqual(was);

  // Dragging an unselected item selects it and moves only it.
  await page.mouse.click(...(Object.values(await world(page, 0, -300)) as [number, number]));
  await drag(page, await world(page, 200, -40), await world(page, 220, -40));
  await expect.poll(async () => (await items(page))[1]?.x).toBe(120);
  // The canvas keeps its size under a press-drag, so the item moves only as far as the pointer did.
  expect((await items(page))[1]?.y).toBe(-100);
  expect(await selection(page)).toEqual([b]);
  expect((await items(page))[0]?.x).toBe(-300);
});

test('resizes and rotates by the handles, and nudges with the arrows', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  const key = await mod(page);
  // Selected, with handles at its corners: the bottom right is at world (-100, 20).
  await drag(page, await world(page, -100, 20), await world(page, -60, 40));
  await expect.poll(async () => (await geometry(page))[0]).toMatchObject({ x: -300, y: -100, width: 240, height: 140 });
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await geometry(page))[0]).toMatchObject({ width: 200, height: 120 });
  await page.keyboard.press(`${key}+Shift+z`);
  await expect.poll(async () => (await geometry(page))[0]).toMatchObject({ width: 240, height: 140 });

  // No smaller than 8 x 8.
  await drag(page, await world(page, -60, 40), await world(page, -290, -90));
  // (The handle stops at the last size that fits, a step or two above 8.)
  await expect.poll(async () => (await geometry(page))[0]?.width).toBeLessThan(20);
  expect((await geometry(page))[0]?.width).toBeGreaterThanOrEqual(8);
  expect((await geometry(page))[0]?.height).toBeGreaterThanOrEqual(8);
  expect((await geometry(page))[0]?.height).toBeLessThan(20);
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await geometry(page))[0]?.width).toBe(240);

  // The rotate handle sits 24px above the top edge's middle; dragging it level with the centre, to the right, turns
  // the rectangle a quarter turn clockwise.
  const centre = { x: -300 + 120, y: -100 + 70 };
  await drag(page, await world(page, centre.x, -100 - 24), await world(page, centre.x + 150, centre.y), 14);
  await expect.poll(async () => Math.round((await geometry(page))[0]?.rotation ?? 0)).toBe(90);
  // The turn is about the centre: it stays where it was.
  const turned = (await items(page))[0];
  expect((turned?.x ?? 0) + (turned?.width ?? 0) / 2).toBeCloseTo(centre.x, 0);
  expect((turned?.y ?? 0) + (turned?.height ?? 0) / 2).toBeCloseTo(centre.y, 0);
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await geometry(page))[0]?.rotation).toBe(0);

  // Arrows nudge 1 unit, Shift+arrows 10, one step each.
  await canvas(page).focus();
  const x0 = (await geometry(page))[0]?.x ?? 0;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await geometry(page))[0]).toMatchObject({ x: x0 + 2, y: -100 + 10 });
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await geometry(page))[0]).toMatchObject({ x: x0 + 2, y: -100 });
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await geometry(page))[0]?.x).toBe(x0 + 1);
});

test('orders, copies, pastes, deletes and restores from the Trash, and every step undoes', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  await draw(page, { x: -100, y: 100 }, { x: 100, y: 220 });
  const [a, b, c] = await ids(page);
  const key = await mod(page);

  // To front: one move, and an undo puts it back.
  await page.mouse.click(...(Object.values(await world(page, -200, -40)) as [number, number]));
  await page.keyboard.press(`${key}+Shift+BracketRight`);
  await expect.poll(() => ids(page)).toEqual([b, c, a]);
  await page.keyboard.press(`${key}+BracketLeft`);
  await expect.poll(() => ids(page)).toEqual([b, a, c]);
  await page.keyboard.press(`${key}+Shift+BracketLeft`);
  await expect.poll(() => ids(page)).toEqual([a, b, c]);
  await page.keyboard.press(`${key}+BracketRight`);
  await expect.poll(() => ids(page)).toEqual([b, a, c]);
  for (let i = 0; i < 4; i += 1) await page.keyboard.press(`${key}+z`);
  await expect.poll(() => ids(page)).toEqual([a, b, c]);

  // Copy and paste with the pointer off the canvas: offset 16 units from the original, selected.
  await page.keyboard.press(`${key}+c`);
  await page.mouse.move(5, 5);
  await page.keyboard.press(`${key}+v`);
  await expect.poll(async () => (await items(page)).length).toBe(4);
  const pasted = (await items(page))[3];
  expect(pasted).toMatchObject({ x: -300 + 16, y: -100 + 16, width: 200, height: 120 });
  expect(await selection(page)).toEqual([pasted?.id]);
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(3);
  await page.keyboard.press(`${key}+Shift+z`);
  await expect.poll(async () => (await items(page)).length).toBe(4);

  // Pasting with the pointer over the canvas puts the item's middle under it.
  const target = await world(page, 400, 200);
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press(`${key}+v`);
  await expect.poll(async () => (await items(page)).length).toBe(5);
  expect((await items(page))[4]).toMatchObject({ x: 300, y: 140 });

  // Duplicate.
  await page.keyboard.press(`${key}+d`);
  await expect.poll(async () => (await items(page)).length).toBe(6);
  expect((await items(page))[5]).toMatchObject({ x: 316, y: 156 });

  // Delete moves the selection to the Trash; the Trash lists it by board; Restore brings it back where it was.
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await items(page)).length).toBe(5);
  expect(await selection(page)).toEqual([]);
  const trash = await openTrash(page);
  const row = trash.getByRole('row', { name: /Rectangle on Camera board/ });
  await expect(row).toContainText('Board item');
  await trash.getByRole('button', { name: 'Restore board item Rectangle on Camera board' }).click();
  await expect.poll(async () => (await items(page)).length).toBe(6);
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(5);
  await page.keyboard.press(`${key}+Shift+z`);
  await expect.poll(async () => (await items(page)).length).toBe(6);
});

test('keeps the board as it was left after a reload', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  const [a] = await ids(page);
  await page.mouse.click(...(Object.values(await world(page, -200, -40)) as [number, number]));
  await canvas(page).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press(`${await mod(page)}+Shift+BracketRight`);
  await expect.poll(async () => (await items(page))[1]?.id).toBe(a);
  const left = await items(page);

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sidebar(page).getByRole('list', { name: 'Boards' }).getByRole('button', { name: 'Camera' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => items(page)).toEqual(left);
});

test('works from the keyboard alone: Tab in, R, Enter, arrows, Tab between items, Delete', async ({ page }) => {
  await openCamera(page);
  const key = await mod(page);
  // Tab into the canvas: it is one stop, named for the board.
  await tile(page).getByRole('button', { name: 'Select' }).focus();
  // Select, Hand, Rectangle, Text, Sticky, Link (5.1b), Connector (5.2), Section (5.3) and Shapes come before the canvas.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(canvas(page)).toBeFocused();

  // R, then Enter: a rectangle at the middle of the view, selected, and the tool back to Select.
  await page.keyboard.press('r');
  await expect(tile(page).getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect((await items(page))[0]).toMatchObject({ x: -100, y: -60, width: 200, height: 120 });
  await expect(tile(page).getByRole('status')).toHaveText('Rectangle 1 of 1 selected');
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await items(page)).length).toBe(2);
  const [first, second] = await ids(page);

  // Arrows nudge the selection; Tab and Shift+Tab walk the items in z order.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await items(page))[1]?.x).toBe(-101);
  await page.keyboard.press('Shift+Tab');
  expect(await selection(page)).toEqual([first]);
  await page.keyboard.press('Tab');
  expect(await selection(page)).toEqual([second]);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await items(page))[1]?.y).toBe(-70);

  // With nothing selected the arrows pan, and Tab leaves the canvas.
  await page.keyboard.press('Escape');
  expect(await selection(page)).toEqual([]);
  const view = async () => Number(await canvas(page).getAttribute('data-zoom'));
  expect(await view()).toBe(1);
  // The arrows pan the view by 48 screen pixels, and edit nothing.
  const panned = await viewOf(page);
  const edited = await items(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await viewOf(page)).cx).toBe(panned.cx + 48);
  expect((await viewOf(page)).cy).toBe(panned.cy);
  expect(await items(page)).toEqual(edited);
  await page.keyboard.press('Equal');
  await expect.poll(view).toBeCloseTo(1.25, 2);
  await page.keyboard.press('Shift+Digit0');
  await expect.poll(view).toBe(1);
  // Shift+1 fits everything: the view shows every item whole. Shift+2 with nothing selected does nothing.
  await page.keyboard.press('Shift+Digit2');
  expect(await viewOf(page)).toMatchObject({ zoom: 1 });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+Digit1');
  const fitted = await viewOf(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  for (const item of await items(page)) {
    expect(item.x).toBeGreaterThanOrEqual(fitted.cx - box.width / 2 / fitted.zoom);
    expect(item.x + item.width).toBeLessThanOrEqual(fitted.cx + box.width / 2 / fitted.zoom);
    expect(item.y).toBeGreaterThanOrEqual(fitted.cy - box.height / 2 / fitted.zoom);
    expect(item.y + item.height).toBeLessThanOrEqual(fitted.cy + box.height / 2 / fitted.zoom);
  }
  await page.keyboard.press('Tab');
  await expect(canvas(page)).not.toBeFocused();

  // Delete from the keyboard, and undo.
  await canvas(page).focus();
  await page.keyboard.press(`${key}+a`);
  await expect(tile(page).getByRole('status')).toHaveText('2 items selected');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await items(page)).length).toBe(0);
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(2);
});

test('opens a context menu with the edit and z-order commands', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  const [a, b] = await ids(page);
  const at = await world(page, -200, -40);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = canvas(page).getByRole('group', { name: 'Board actions' });
  await expect(menu).toBeVisible();
  expect(await selection(page)).toEqual([a]);
  await menu.getByRole('button', { name: 'Bring to front' }).click();
  await expect.poll(() => ids(page)).toEqual([b, a]);
  await expect(menu).toBeHidden();
  // From the keyboard, Shift+F10, and Escape closes it with focus back on the canvas.
  await canvas(page).focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Copy' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(canvas(page)).toBeFocused();
  await canvas(page).press('Shift+F10');
  await menu.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await items(page)).length).toBe(1);
});

test('pans and zooms, and the minimap moves the view', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  const zoom = async () => Number(await canvas(page).getAttribute('data-zoom'));
  const o = await origin(page);

  // Ctrl + wheel zooms around the pointer; a plain wheel pans; the Hand tool and Space pan by drag.
  const pointerAt = { x: o.x - 200, y: o.y - 40 };
  await page.mouse.move(pointerAt.x, pointerAt.y);
  const under = await worldUnder(page, pointerAt);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(zoom).toBeGreaterThan(1.5);
  // The world point under the pointer stayed under it, worked out from the real view.
  const after = await worldUnder(page, pointerAt);
  expect(after.x).toBeCloseTo(under.x, 0);
  expect(after.y).toBeCloseTo(under.y, 0);
  await tile(page).getByRole('button', { name: /^Zoom \d+%/ }).click();
  await expect.poll(zoom).toBe(1);
  await tile(page).getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(zoom).toBeCloseTo(0.8, 2);
  await tile(page).getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(zoom).toBe(1);

  const before = await items(page);
  // A plain wheel (two-finger scroll) pans.
  await page.mouse.move(o.x, o.y);
  const wheeled = await viewOf(page);
  await page.mouse.wheel(120, 60);
  await expect.poll(async () => (await viewOf(page)).cx).toBeCloseTo(wheeled.cx + 120 / wheeled.zoom, 0);
  expect((await viewOf(page)).cy).toBeCloseTo(wheeled.cy + 60 / wheeled.zoom, 0);
  // The Hand tool, Space and the middle button pan by drag: the view moves against the drag.
  await tile(page).getByRole('button', { name: 'Hand' }).click();
  let was = await viewOf(page);
  await drag(page, { x: o.x, y: o.y }, { x: o.x + 100, y: o.y + 50 });
  expect((await viewOf(page)).cx).toBeCloseTo(was.cx - 100 / was.zoom, 0);
  expect((await viewOf(page)).cy).toBeCloseTo(was.cy - 50 / was.zoom, 0);
  await tile(page).getByRole('button', { name: /^Select/ }).click();
  await canvas(page).focus();
  was = await viewOf(page);
  await page.keyboard.down('Space');
  await drag(page, { x: o.x, y: o.y }, { x: o.x - 80, y: o.y });
  await page.keyboard.up('Space');
  expect((await viewOf(page)).cx).toBeCloseTo(was.cx + 80 / was.zoom, 0);
  was = await viewOf(page);
  await page.mouse.move(o.x, o.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(o.x, o.y + 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  expect((await viewOf(page)).cy).toBeCloseTo(was.cy - 40 / was.zoom, 0);
  // Panning never edits: the items are where they were.
  expect(await items(page)).toEqual(before);
  await tile(page).getByRole('button', { name: 'Fit all' }).click();

  // The minimap: every item as a box and the view as a rectangle; a click moves the view.
  await tile(page).getByRole('button', { name: 'Minimap', exact: true }).click();
  const mini = tile(page).getByRole('img', { name: /^Minimap/ });
  await expect(mini).toBeVisible();
  await expect(mini.locator('[data-minimap-item]')).toHaveCount(1);
  // The view against the item's box, since the minimap rescales as the view moves.
  const viewBox = async () => ((await mini.locator('[data-minimap-view]').boundingBox())?.x ?? 0) - ((await mini.locator('[data-minimap-item]').boundingBox())?.x ?? 0);
  const startX = await viewBox();
  const box = await mini.boundingBox();
  if (!box) throw new Error('no minimap');
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect.poll(viewBox).toBeGreaterThan(startX + 20);
  // The view is session state: nothing was written to the project.
  expect(await items(page)).toEqual(before);
});

test('lists boards in the sidebar, and Delete on one moves it with its items to the Trash', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  const key = await mod(page);
  const boards = sidebar(page).getByRole('list', { name: 'Boards' });
  const row = boards.getByRole('button', { name: 'Camera' });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await row.focus();
  await page.keyboard.press('Delete');
  await expect(row).toHaveCount(0);
  // The open board went; the tile shows the picker, which offers Camera again.
  await expect(tile(page).locator('[data-department-board="camera"]')).toContainText('In the Trash');
  const trash = await openTrash(page);
  await expect(trash.getByRole('row', { name: /Camera/ })).toContainText('Board');
  // Its items went with it: they are not rows of their own.
  await expect(trash.getByRole('row', { name: /Rectangle on/ })).toHaveCount(0);

  // Opening the department again restores that board, never a second one, items and all.
  await tile(page).locator('[data-department-board="camera"]').click();
  await expect(canvas(page)).toBeVisible();
  expect(await items(page)).toHaveLength(2);
  await expect(boards.getByRole('button')).toHaveCount(2);
  await expect(trash.getByText('The Trash is empty.', { exact: false })).toBeVisible();

  // ⌘Z takes the restore back; the board is in the Trash again.
  await page.keyboard.press(`${key}+z`);
  await expect(trash.getByRole('button', { name: 'Restore board Camera' })).toBeVisible();
  await trash.getByRole('button', { name: 'Restore board Camera' }).click();
  await expect(boards.getByRole('button', { name: 'Camera' })).toBeVisible();
});

test('makes a free board with a name, renames it in the tile, and + Add Board opens the picker', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await tile(page).getByRole('button', { name: 'New board' }).click();
  await tile(page).getByLabel('Board name').fill('Look book');
  await tile(page).getByRole('button', { name: 'Create board' }).click();
  const free = page.getByRole('application', { name: 'Look book board' });
  await expect(free).toBeVisible();
  await expect(tile(page).locator('[data-board-title]')).toHaveText('Look book');
  await tile(page).getByRole('button', { name: 'Edit name of Look book' }).click();
  const field = tile(page).getByRole('textbox', { name: 'name of Look book' });
  await field.fill('Lookbook v2');
  await field.press('Enter');
  await expect(tile(page).locator('[data-board-title]')).toHaveText('Lookbook v2');
  await expect(sidebar(page).getByRole('list', { name: 'Boards' }).getByRole('button', { name: 'Lookbook v2' })).toBeVisible();

  await sidebar(page).getByRole('button', { name: '+ Add Board' }).click();
  await expect(tile(page).getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(tile(page).getByRole('list').first().getByRole('button', { name: 'Lookbook v2' })).toBeVisible();
  // The tile's title bar is the same section; a department's board is not editable by name.
  await tile(page).getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(tile(page).getByRole('button', { name: /^Edit name/ })).toHaveCount(0);
});

test('a WebKit pinch zooms from where it began, and the wheel it may also send is ignored', async ({ page }) => {
  await openCamera(page);
  await canvas(page).focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Equal');
  await expect.poll(async () => (await viewOf(page)).zoom).toBeCloseTo(1.25 ** 5, 2);
  const start = (await viewOf(page)).zoom;
  const fire = (type: string, scale: number) =>
    canvas(page).evaluate(
      (el, [kind, value]) => {
        const event = new Event(kind, { bubbles: true, cancelable: true });
        Object.assign(event, { scale: value, clientX: 700, clientY: 400 });
        el.dispatchEvent(event);
      },
      [type, scale] as const,
    );
  await fire('gesturestart', 1);
  // Each in its own step, so the view has been drawn again between them.
  await fire('gesturechange', 1.05);
  await expect.poll(async () => (await viewOf(page)).zoom).toBeCloseTo(start * 1.05, 2);
  await fire('gesturechange', 1.08);
  await expect.poll(async () => (await viewOf(page)).zoom).toBeCloseTo(start * 1.08, 2);
  // Ctrl + wheel in the middle of a pinch would zoom twice: it does not.
  await canvas(page).evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -300, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
  });
  await page.waitForTimeout(100);
  expect((await viewOf(page)).zoom).toBeCloseTo(start * 1.08, 2);
  await fire('gestureend', 1);
});

test('Shift keeps the proportions in a resize and snaps a turn to 15 degrees', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  // Shift on the bottom right corner, dragged out and a little down: the 200 x 120 shape stays 5 : 3.
  await page.keyboard.down('Shift');
  await page.waitForTimeout(50);
  await drag(page, await world(page, -100, 20), await world(page, -40, 25));
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await geometry(page))[0]?.width).toBeGreaterThan(230);
  const resized = (await geometry(page))[0];
  expect((resized?.width ?? 0) / (resized?.height ?? 1)).toBeCloseTo(200 / 120, 1);

  // Without Shift a turn lands where it is dropped; with Shift, on a multiple of 15.
  const item = (await items(page))[0];
  const centre = { x: (item?.x ?? 0) + (item?.width ?? 0) / 2, y: (item?.y ?? 0) + (item?.height ?? 0) / 2 };
  const top = (item?.y ?? 0) - 24;
  const angle = (40 * Math.PI) / 180;
  const target = { x: centre.x + 150 * Math.sin(angle), y: centre.y - 150 * Math.cos(angle) };
  await drag(page, await world(page, centre.x, top), await world(page, target.x, target.y), 14);
  await expect.poll(async () => (await geometry(page))[0]?.rotation).not.toBe(0);
  const free = (await geometry(page))[0]?.rotation ?? 0;
  expect(Math.abs(free % 15)).toBeGreaterThan(1);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await geometry(page))[0]?.rotation).toBe(0);
  await page.keyboard.down('Shift');
  await page.waitForTimeout(50);
  const again = (await items(page))[0];
  await drag(page, await world(page, centre.x, (again?.y ?? 0) - 24), await world(page, target.x, target.y), 14);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await geometry(page))[0]?.rotation).toBe(45);
});

test('stretching two rectangles both turned 30 degrees keeps them at 30, with no skew', async ({ page }) => {
  await openCamera(page);
  await draw(page, { x: -300, y: -100 }, { x: -100, y: 20 });
  await draw(page, { x: 100, y: -100 }, { x: 300, y: 20 });
  await canvas(page).press(`${await mod(page)}+a`);
  // Turn the pair together with the rotate handle, above the middle of their box.
  const centre = { x: 0, y: -40 };
  const angle = (30 * Math.PI) / 180;
  await drag(page, await world(page, 0, -100 - 24), await world(page, centre.x + 150 * Math.sin(angle), centre.y - 150 * Math.cos(angle)), 14);
  await expect.poll(async () => Math.round((await geometry(page))[0]?.rotation ?? 0)).toBe(30);
  expect(Math.round((await geometry(page))[1]?.rotation ?? 0)).toBe(30);
  const turned = await items(page);
    const corners = turned.flatMap((i) => {
    const cx = i.x + i.width / 2;
    const cy = i.y + i.height / 2;
    const r = (i.rotation * Math.PI) / 180;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
      x: cx + ((sx ?? 0) * i.width) / 2 * Math.cos(r) - ((sy ?? 0) * i.height) / 2 * Math.sin(r),
      y: cy + ((sx ?? 0) * i.width) / 2 * Math.sin(r) + ((sy ?? 0) * i.height) / 2 * Math.cos(r),
    }));
  });
  // After a turn the handles' box stays turned with it: its bottom right corner is the farthest along the turned axes.
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -Math.sin(angle), y: Math.cos(angle) };
  const alongU = Math.max(...corners.map((c) => c.x * u.x + c.y * u.y));
  const alongV = Math.max(...corners.map((c) => c.x * v.x + c.y * v.y));
  const corner = { x: u.x * alongU + v.x * alongV, y: u.y * alongU + v.y * alongV };
  await drag(page, await world(page, corner.x, corner.y), await world(page, corner.x + 60, corner.y + 10), 12);
  await expect.poll(async () => (await items(page))[0]?.width).not.toBe(turned[0]?.width);
  for (const item of await geometry(page)) expect(item.rotation).toBeCloseTo(30, 0);
  // Both grew by the same factor: the proportions of each are kept.
  const after = await items(page);
  for (const [i, item] of after.entries()) expect(item.width / item.height).toBeCloseTo((turned[i]?.width ?? 1) / (turned[i]?.height ?? 1), 1);
});

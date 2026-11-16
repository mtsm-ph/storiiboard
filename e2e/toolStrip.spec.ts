import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The tools as one vertical strip of icons at the canvas's top-left corner (6.5.2, Kevin Nov 16), on a plan and on a
// board: where it sits, each button's name and keys, the tooltip "Name (Key)" on keyboard focus and on hover, a press
// switching the tool as the old labelled button did, V, H, Shift+H and held Space on the canvas, a letter typed into a
// field or a text item staying a letter, and axe on the strip in the app's light and dark themes over Paper and Dark.

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

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvasOf = (tile: Locator) => tile.locator('[data-canvas]');
const stripOf = (tile: Locator) => tile.locator('[data-tool-strip]');
const tipOf = (tile: Locator) => stripOf(tile).locator('[data-tool-tip]');
const viewGroup = (tile: Locator) => tile.getByRole('group', { name: 'Canvas view' });
const walls = async (page: Page) =>
  (JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as { kind: string }[]).filter((item) => item.kind === 'wall').length;
const boardItems = async (page: Page) => JSON.parse((await boardTile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as { kind: string; text?: string }[];

/** Where a world point is on screen, from the view the canvas reports. */
async function screen(canvas: Locator, x: number, y: number) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas.getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** The Setup workspace on SC 01's Setup 1, its room started, in metres. */
async function openPlan(page: Page): Promise<Locator> {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
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

/** The plan's rulers' depth (src/ui/canvas/Rulers.tsx): the strip sits inside them. */
const RULER = 18;

/**
 * The strip's box inside the canvas's, its corner within 16 px of the drawing area's top-left: the canvas's own on a
 * board, inside the rulers on a plan (`rulers`, their depth), so no ruler's number is hidden.
 */
async function expectAtCorner(tile: Locator, rulers = 0) {
  const canvas = await canvasOf(tile).boundingBox();
  const strip = await stripOf(tile).boundingBox();
  if (!canvas || !strip) throw new Error('no canvas or strip');
  expect(strip.x).toBeGreaterThanOrEqual(canvas.x + rulers);
  expect(strip.y).toBeGreaterThanOrEqual(canvas.y + rulers);
  expect(strip.x - (canvas.x + rulers)).toBeLessThanOrEqual(16);
  expect(strip.y - (canvas.y + rulers)).toBeLessThanOrEqual(16);
  expect(strip.x + strip.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(strip.y + strip.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  // One column at this size: every button one above another, at least 28 px square.
  const boxes = await stripOf(tile).getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(1);
  for (const b of boxes) {
    expect(b.w).toBeGreaterThanOrEqual(28);
    expect(b.h).toBeGreaterThanOrEqual(28);
  }
}

/** Each button named for its tool, its keys said, in the order given. */
async function expectNames(tile: Locator, tools: readonly (readonly [string, string])[]) {
  const buttons = stripOf(tile).getByRole('button');
  await expect(buttons).toHaveCount(tools.length);
  for (const [i, [name, keys]] of tools.entries()) {
    await expect(buttons.nth(i)).toHaveAccessibleName(name);
    await expect(buttons.nth(i)).toHaveAttribute('aria-keyshortcuts', keys);
  }
}

/** The tooltip on keyboard focus (Shift+Tab from the canvas reaches the strip's last buttons) and on hover. */
async function expectTips(page: Page, tile: Locator, last: string, beforeLast: string, hovered: Locator, hoverTip: string) {
  // The pointer off the strip first (the last click, on New room, may have left it where the strip now is).
  const frame = await canvasOf(tile).boundingBox();
  if (!frame) throw new Error('no canvas');
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect(tipOf(tile)).toHaveCount(0);
  await canvasOf(tile).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tipOf(tile)).toHaveText(last);
  await expect(tipOf(tile)).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(tipOf(tile)).toHaveText(beforeLast);
  // Escape hides it; it never takes the pointer.
  await page.keyboard.press('Escape');
  await expect(tipOf(tile)).toHaveCount(0);
  await hovered.hover();
  await expect(tipOf(tile)).toHaveText(hoverTip);
  await expect(tipOf(tile)).toBeVisible();
  expect(await tipOf(tile).evaluate((tip) => getComputedStyle(tip).pointerEvents)).toBe('none');
  const canvas = await canvasOf(tile).boundingBox();
  if (!canvas) throw new Error('no canvas');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(tipOf(tile)).toHaveCount(0);
}

/** V, H, Shift+H on the canvas, and Space held pans without changing the tool. */
async function expectKeys(page: Page, tile: Locator) {
  const canvas = canvasOf(tile);
  const button = (name: string) => stripOf(tile).getByRole('button', { name, exact: true });
  await canvas.focus();
  await page.keyboard.press('h');
  await expect(canvas).toHaveAttribute('data-tool', 'hand');
  await expect(button('Hand')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(canvas).toHaveAttribute('data-tool', 'select');
  await expect(button('Select')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+H');
  await expect(canvas).toHaveAttribute('data-tool', 'hand');
  await expect(button('Hand')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(canvas).toHaveAttribute('data-tool', 'select');
  // Held Space: the hand's cursor, and a drag pans; the tool is still Select.
  const cx = Number(await canvas.getAttribute('data-cx'));
  const cursor = () => canvas.evaluate((frame) => (frame as HTMLElement).style.cursor);
  await page.keyboard.down('Space');
  await expect.poll(cursor).toBe('grab');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(async () => Number(await canvas.getAttribute('data-cx'))).not.toBe(cx);
  await expect(canvas).toHaveAttribute('data-tool', 'select');
  await expect.poll(cursor).toBe('default');
}

test('the plan’s tools are a strip of icons at the canvas’s corner: named, with their keys, a tooltip, and a wall drawn after choosing Wall', async ({ page }) => {
  const tile = await openPlan(page);
  await expectAtCorner(tile, RULER);
  await expectNames(tile, [
    ['Select', 'V'],
    ['Hand', 'H Shift+H'],
    ['Wall', 'W'],
    ['Door', 'D'],
    ['Window', 'N'],
    ['Camera', 'C'],
    ['Light', 'L'],
    ['Mark', 'M'],
    ['Measure', 'R'],
  ]);
  // The old row of labelled tool buttons is gone: the tools are only in the strip.
  await expect(tile.getByRole('group', { name: 'Tools', exact: true })).toHaveCount(1);
  await expectTips(page, tile, 'Measure (R)', 'Mark (M)', stripOf(tile).getByRole('button', { name: 'Wall', exact: true }), 'Wall (W)');

  // Wall from its button, as its labelled button did: two clicks and Enter draw one.
  await stripOf(tile).getByRole('button', { name: 'Wall', exact: true }).click();
  await expect(canvasOf(tile)).toHaveAttribute('data-tool', 'host:wall');
  await expect(stripOf(tile).getByRole('button', { name: 'Wall', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const x of [-150, 150]) {
    const at = await screen(canvasOf(tile), x, 0);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => walls(page)).toBe(1);
  await stripOf(tile).getByRole('button', { name: 'Light', exact: true }).click();
  await expect(canvasOf(tile)).toHaveAttribute('data-tool', 'host:light');

  await expectKeys(page, tile);

  // An H typed in a field is a letter: the room's name takes it and the tool stays. Nothing picked, the Selection tile
  // shows the room.
  await canvasOf(tile).focus();
  await page.keyboard.press('Escape');
  const name = page.getByRole('region', { name: 'Selection', exact: true }).getByRole('textbox', { name: 'Room name', exact: true });
  await name.fill('');
  await name.pressSequentially('Hh');
  await expect(name).toHaveValue('Hh');
  await expect(canvasOf(tile)).toHaveAttribute('data-tool', 'select');
});

test('the board’s tools are a strip of icons at the canvas’s corner: named, with their keys, a tooltip, Shapes to its right, and a rectangle drawn after choosing Rectangle', async ({ page }) => {
  const tile = await openBoard(page);
  await expectAtCorner(tile);
  await expectNames(tile, [
    ['Select', 'V'],
    ['Hand', 'H Shift+H'],
    ['Rectangle', 'R'],
    ['Text', 'T'],
    ['Sticky', 'S'],
    ['Link', 'L'],
    ['Connector', 'C'],
    ['Section', 'Shift+S'],
    ['Shapes', 'O'],
  ]);
  // The board's row keeps its actions and no tool.
  await expect(tile.locator('[data-board-header]').getByRole('button', { name: 'Rectangle' })).toHaveCount(0);
  await expect(tile.locator('[data-board-header]').getByRole('button', { name: 'Boards', exact: true })).toBeVisible();
  await expectTips(page, tile, 'Shapes (O)', 'Section (⇧S)', stripOf(tile).getByRole('button', { name: 'Rectangle', exact: true }), 'Rectangle (R)');

  // Rectangle from its button: a drag draws one.
  await stripOf(tile).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(canvasOf(tile)).toHaveAttribute('data-tool', 'rect');
  const from = await screen(canvasOf(tile), -100, -60);
  const to = await screen(canvasOf(tile), 100, 60);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await boardItems(page)).map((item) => item.kind)).toEqual(['rect']);

  // Shapes opens its four to the strip's right, over the canvas; one picked is the tool, and presses Shapes.
  const shapes = stripOf(tile).getByRole('button', { name: 'Shapes', exact: true });
  await shapes.click();
  const group = tile.getByRole('group', { name: 'Shapes' });
  await expect(group.getByRole('button')).toHaveCount(4);
  const shapesBox = await shapes.boundingBox();
  const groupBox = await group.boundingBox();
  expect((groupBox?.x ?? 0) >= (shapesBox?.x ?? 0) + (shapesBox?.width ?? 0)).toBe(true);
  await group.getByRole('button', { name: 'Diamond', exact: true }).click();
  await expect(canvasOf(tile)).toHaveAttribute('data-tool', 'diamond');
  await expect(shapes).toHaveAttribute('aria-pressed', 'true');

  await expectKeys(page, tile);

  // An H typed in a text box is a letter: the box takes it and the tool stays.
  await stripOf(tile).getByRole('button', { name: 'Text', exact: true }).click();
  const at = await screen(canvasOf(tile), -300, -200);
  await page.mouse.click(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Text box text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hh');
  await page.keyboard.press('Shift+H');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await boardItems(page)).filter((item) => item.kind === 'text').map((item) => item.text)).toEqual(['HhH']);
  await expect(canvasOf(tile)).not.toHaveAttribute('data-tool', 'hand');
});

test('a short plan wraps the strip into columns, inside the canvas and above the Paper/Dark box', async ({ page }) => {
  const tile = await openPlan(page);
  await tile.locator('[data-plan-tile]').evaluate((element) => {
    (element as HTMLElement).style.height = '300px';
  });
  const view = await viewGroup(tile).boundingBox();
  const canvas = await canvasOf(tile).boundingBox();
  if (!view || !canvas) throw new Error('no view box or canvas');
  await expect.poll(async () => new Set((await stripOf(tile).getByRole('button').evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().x))))).size).toBeGreaterThanOrEqual(2);
  const boxes = await stripOf(tile).getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
  // Never spread into a column per tool: at most three over this canvas.
  expect(new Set(boxes.map((b) => Math.round(b.left))).size).toBeLessThanOrEqual(3);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(canvas.x);
    expect(b.right).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(b.top).toBeGreaterThanOrEqual(canvas.y);
    expect(b.bottom).toBeLessThanOrEqual(view.y);
  }
});

test('the pressed tool has an outline in forced colours, where its ink fill is dropped', async ({ page }) => {
  const tile = await openPlan(page);
  await page.emulateMedia({ forcedColors: 'active' });
  const outline = (name: string) => stripOf(tile).getByRole('button', { name, exact: true }).evaluate((button) => getComputedStyle(button.parentElement ?? button).outlineStyle);
  await expect.poll(() => outline('Select')).toBe('solid');
  expect(await outline('Hand')).toBe('none');
  await page.emulateMedia({ forcedColors: 'none' });
  await expect.poll(() => outline('Select')).toBe('none');
});

test('over the strip, a wheel and a middle-button drag move the plan, and a Library drop places nothing', async ({ page }) => {
  const tile = await openPlan(page);
  const canvas = canvasOf(tile);
  const wall = await stripOf(tile).getByRole('button', { name: 'Wall', exact: true }).boundingBox();
  if (!wall) throw new Error('no Wall button');
  const middle = { x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 };
  const view = async () => ({ cx: Number(await canvas.getAttribute('data-cx')), cy: Number(await canvas.getAttribute('data-cy')), zoom: Number(await canvas.getAttribute('data-zoom')) });
  // A wheel scrolls the plan as it would anywhere on the canvas.
  const before = await view();
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await view()).cy).toBeCloseTo(before.cy + 120 / before.zoom, 3);
  // A middle-button drag from a tool pans; the tool is not picked.
  const panned = await view();
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(middle.x + 100, middle.y, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await view()).cx).toBeCloseTo(panned.cx - 100 / panned.zoom, 3);
  await expect(canvas).toHaveAttribute('data-tool', 'select');

  // A sofa dragged from the Library and let go over the strip is not on the plan.
  const library = page.getByRole('region', { name: 'Library', exact: true });
  const sofa = library.locator('[data-library-icon="set-art/sofa"]');
  await sofa.scrollIntoViewIfNeeded();
  const from = await sofa.boundingBox();
  if (!from) throw new Error('no sofa');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + 40, middle.y + 40, { steps: 6 });
  await page.mouse.move(middle.x, middle.y, { steps: 6 });
  await expect(page.locator('[data-library-ghost="set-art/sofa"]')).not.toHaveAttribute('data-library-ghost-over', 'plan');
  await page.mouse.up();
  await page.waitForTimeout(200);
  const icons = (JSON.parse((await tile.locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as { kind: string }[]).filter((item) => item.kind === 'icon');
  expect(icons).toEqual([]);
});

test('a quick-connect "+" by the strip draws under it, and Escape on the canvas hides a hovered tool’s tooltip', async ({ page }) => {
  const tile = await openBoard(page);
  const canvas = canvasOf(tile);
  const text = await stripOf(tile).getByRole('button', { name: 'Text', exact: true }).boundingBox();
  const strip = await stripOf(tile).boundingBox();
  if (!text || !strip) throw new Error('no strip');
  // A 200 px sticky whose left edge is just inside the strip's right edge: its left "+" (13 px out) lies over the strip.
  await stripOf(tile).getByRole('button', { name: 'Sticky', exact: true }).click();
  await page.mouse.click(strip.x + strip.width - 3 + 100, text.y + text.height / 2);
  await page.keyboard.type('Rain cover?');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (JSON.parse((await canvas.getAttribute('data-selection')) ?? '[]') as string[]).length).toBe(1);
  const plus = tile.locator('[data-quick-side="left"]');
  await expect(plus).toHaveCount(1);
  const handle = await plus.boundingBox();
  if (!handle) throw new Error('no handle');
  // The handle and the strip meet; where they do, the strip's button is what is on top.
  expect(handle.x).toBeLessThan(strip.x + strip.width);
  const at = { x: Math.max(handle.x, strip.x) + 2, y: handle.y + handle.height / 2 };
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-tool-strip]') !== null, at);
  expect(top).toBe(true);

  // Escape with the focus on the canvas hides the tooltip that hover opened.
  await stripOf(tile).getByRole('button', { name: 'Hand', exact: true }).hover();
  await expect(tipOf(tile)).toHaveText('Hand (H, ⇧H)');
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(tipOf(tile)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the strip passes axe in the app’s ${theme} theme, over a Paper and a Dark canvas, on a plan and a board`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    for (const open of [openPlan, openBoard]) {
      const tile = await open(page);
      for (const view of ['Paper', 'Dark'] as const) {
        await viewGroup(tile).getByRole('button', { name: view, exact: true }).click();
        await expect(viewGroup(tile)).toHaveAttribute('data-canvas-view', view.toLowerCase());
        // With a tooltip showing, so its words are checked too.
        await stripOf(tile).getByRole('button').nth(1).hover();
        await expect(tipOf(tile)).toBeVisible();
        const { violations } = await new AxeBuilder({ page }).include('[data-tool-strip]').withTags(tags).analyze();
        expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
      }
    }
  });
}

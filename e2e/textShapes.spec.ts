import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Text, sticky notes and shapes in any colour (5.1a) in the memory build: a text box is placed, typed into and left, a
// sticky note is made in each of its six colours, an ellipse is given a fill by hex, three items change colour at once
// and one ⌘Z puts them back, Escape ends editing and keeps what was typed, and the whole thing works from the keyboard.
// The canvas is pixels, so the board is read from the data its wrapper keeps (data-board-data).

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
  text: string;
  fill: string | null;
  stroke: string | null;
  color: string | null;
  fontFamily: string;
  fontWeight: number;
  fontItalic: boolean;
  fontSize: number;
  align: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const data = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const properties = (page: Page) => tile(page).getByRole('group', { name: 'Properties of the selection' });

async function openCamera(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await tile(page).locator('[data-department-board="camera"]').click();
  await expect(canvas(page)).toBeVisible();
  await page.waitForTimeout(100);
}

/** Where a world point is on screen, at the standard view. */
async function world(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y };
}

async function click(page: Page, x: number, y: number) {
  const at = await world(page, x, y);
  await page.mouse.click(at.x, at.y);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await world(page, from.x, from.y);
  const b = await world(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Draws a shape with a tool button. */
async function drawShape(page: Page, tool: string, from: { x: number; y: number }, to: { x: number; y: number }) {
  const before = (await data(page)).length;
  await tile(page).getByRole('button', { name: tool, exact: true }).click();
  await drag(page, from, to);
  await expect.poll(async () => (await data(page)).length).toBe(before + 1);
}

/** Sets a colour control to a hex typed in its field. */
async function setHex(page: Page, label: string, hex: string) {
  await properties(page).getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  const field = properties(page).getByRole('textbox', { name: 'Hex' });
  await field.fill(hex);
  await field.press('Enter');
}

test('places a text box, types, clicks away, and it is still there after a reload', async ({ page }) => {
  await openCamera(page);
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -200);
  const editor = page.getByRole('textbox', { name: 'Text box text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Dusk, the bridge');
  // Nothing is written while typing.
  expect(await data(page)).toEqual([]);
  // A click on empty canvas ends it.
  await click(page, 300, 200);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await data(page)).map((i) => [i.kind, i.text])).toEqual([['text', 'Dusk, the bridge']]);
  const [item] = await data(page);
  expect(item).toMatchObject({ fontFamily: 'Inter Tight', fontWeight: 400, fontSize: 24, x: -420, width: 240 });
  expect(item?.height).toBeGreaterThanOrEqual(28);
  expect(await selection(page)).toEqual([item?.id]);

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sidebar(page).getByRole('list', { name: 'Boards' }).getByRole('button', { name: 'Camera' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => (await data(page)).map((i) => [i.kind, i.text])).toEqual([['text', 'Dusk, the bridge']]);
});

test('leaves nothing behind for an empty new text box, and Escape keeps what was typed', async ({ page }) => {
  await openCamera(page);
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -200);
  await expect(page.getByRole('textbox', { name: 'Text box text' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Text box text' })).toHaveCount(0);
  expect(await data(page)).toEqual([]);
  // Escape with words in the box ends editing and keeps them; focus is back on the canvas.
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -200);
  await page.keyboard.type('Keep me');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await data(page)).map((i) => i.text)).toEqual(['Keep me']);
  await expect(canvas(page)).toBeFocused();
});

test('makes a sticky note in each of its six colours', async ({ page }) => {
  await openCamera(page);
  await tile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  await click(page, -300, -200);
  await page.keyboard.type('Rain cover?');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await data(page)).length).toBe(1);
  expect((await data(page))[0]).toMatchObject({ kind: 'sticky', text: 'Rain cover?', width: 200, height: 200, color: '#FFE97A' });
  const colours = [['#FFE97A', 'Yellow'], ['#FFC9A8', 'Peach'], ['#FFB8C8', 'Pink'], ['#BFE8B0', 'Green'], ['#B5DDF5', 'Blue'], ['#D9C8F0', 'Lilac']] as const;
  for (const [colour, name] of colours) {
    await properties(page).getByRole('button', { name: /^Sticky colour:/ }).click();
    const panel = properties(page).getByRole('group', { name: 'Sticky colour' });
    // Stickies are offered their six colours only: no hex field, no system picker.
    await expect(panel.getByRole('button')).toHaveCount(6);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await panel.getByRole('button', { name, exact: true }).click();
    await expect.poll(async () => (await data(page))[0]?.color).toBe(colour);
  }
});

test('gives an ellipse a fill by hex, and refuses a hex that is not a colour', async ({ page }) => {
  await openCamera(page);
  await page.keyboard.press('Escape');
  await canvas(page).focus();
  await page.keyboard.press('o');
  await expect(tile(page).getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');
  await drag(page, { x: -200, y: -100 }, { x: 0, y: 20 });
  await expect.poll(async () => (await data(page)).map((i) => [i.kind, i.fill])).toEqual([['ellipse', null]]);
  await setHex(page, 'Fill', 'df5e27');
  await expect.poll(async () => (await data(page))[0]?.fill).toBe('#DF5E27');
  await setHex(page, 'Stroke', '#16150f');
  await expect.poll(async () => (await data(page))[0]?.stroke).toBe('#16150F');
  const field = properties(page).getByRole('textbox', { name: 'Hex' });
  await properties(page).getByRole('button', { name: /^Fill:/ }).click();
  await field.fill('nope');
  await field.press('Enter');
  await expect(properties(page).getByRole('alert')).toHaveText('Type a colour like #DF5E27.');
  expect((await data(page))[0]?.fill).toBe('#DF5E27');
});

test('takes a colour from the system picker, and the strip never resizes the canvas', async ({ page }) => {
  await openCamera(page);
  await drawShape(page, 'Rectangle', { x: -200, y: -100 }, { x: 0, y: 20 });
  // The strip is an overlay: the canvas keeps its size whether or not something is selected.
  const box = await canvas(page).boundingBox();
  await click(page, 0, -300);
  expect(await selection(page)).toEqual([]);
  expect(await canvas(page).boundingBox()).toEqual(box);
  await click(page, -100, -40);
  await expect(properties(page)).toBeVisible();
  expect(await canvas(page).boundingBox()).toEqual(box);
  await properties(page).getByRole('button', { name: /^Fill:/ }).click();
  await properties(page).getByLabel('System colour picker').fill('#123456');
  await expect.poll(async () => (await data(page))[0]?.fill).toBe('#123456');
  await properties(page).getByLabel('System colour picker').fill('#654321');
  await expect.poll(async () => (await data(page))[0]?.fill).toBe('#654321');
});

test('opens the four shapes from the Shapes button', async ({ page }) => {
  await openCamera(page);
  const shapes = tile(page).getByRole('button', { name: 'Shapes' });
  const group = tile(page).getByRole('group', { name: 'Shapes' });
  for (const [name, kind] of [['Triangle', 'triangle'], ['Diamond', 'diamond'], ['Ellipse', 'ellipse'], ['Rectangle', 'rect']] as const) {
    await shapes.click();
    await expect(group.getByRole('button')).toHaveCount(4);
    await group.getByRole('button', { name, exact: true }).click();
    await click(page, -300 + (await data(page)).length * 150, 0);
    await expect.poll(async () => (await data(page)).at(-1)?.kind).toBe(kind);
  }
  expect((await data(page)).map((i) => i.kind)).toEqual(['triangle', 'diamond', 'ellipse', 'rect']);
});

test('changes the colour of three items at once, and one ⌘Z puts all three back', async ({ page }) => {
  await openCamera(page);
  const key = await mod(page);
  await drawShape(page, 'Rectangle', { x: -400, y: -100 }, { x: -250, y: 0 });
  await drawShape(page, 'Rectangle', { x: -100, y: -100 }, { x: 50, y: 0 });
  await drawShape(page, 'Rectangle', { x: 200, y: -100 }, { x: 350, y: 0 });
  await canvas(page).focus();
  await page.keyboard.press(`${key}+a`);
  expect(await selection(page)).toHaveLength(3);
  await setHex(page, 'Fill', '2C5F8A');
  await expect.poll(async () => (await data(page)).map((i) => i.fill)).toEqual(['#2C5F8A', '#2C5F8A', '#2C5F8A']);
  await canvas(page).focus();
  await page.keyboard.press(`${key}+z`);
  await expect.poll(async () => (await data(page)).map((i) => i.fill)).toEqual([null, null, null]);
  expect(await data(page)).toHaveLength(3);
  await page.keyboard.press(`${key}+Shift+z`);
  await expect.poll(async () => (await data(page)).map((i) => i.fill)).toEqual(['#2C5F8A', '#2C5F8A', '#2C5F8A']);
});

test('changes the font, style, size and alignment of a text box', async ({ page }) => {
  await openCamera(page);
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -200);
  await page.keyboard.type('Title card');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await properties(page).getByLabel('Font').selectOption('Outfit');
  await properties(page).getByLabel('Style').selectOption('700');
  const size = properties(page).getByLabel('Size');
  await size.fill('40');
  await size.press('Enter');
  await properties(page).getByRole('button', { name: 'Centre' }).click();
  await expect
    .poll(async () => {
      const [item] = await data(page);
      return item && [item.fontFamily, item.fontWeight, item.fontSize, item.align];
    })
    .toEqual(['Outfit', 700, 40, 'center']);
  // The bundled font is loaded for the page to draw.
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'Outfit' && face.status === 'loaded')))
    .toBe(true);
  // The browser build lists the bundled fonts only.
  const options = await properties(page).getByLabel('Font').locator('option').allTextContents();
  expect(options).toEqual(['Inter Tight', 'JetBrains Mono', 'Archivo', 'Bodoni Moda', 'Jost', 'Outfit']);
  // The height grew with the bigger text.
  expect((await data(page))[0]?.height).toBeGreaterThan(40);
});

test('works from the keyboard alone: T, Enter, type, Escape, then Enter edits it again', async ({ page }) => {
  await openCamera(page);
  await canvas(page).focus();
  await page.keyboard.press('t');
  await expect(tile(page).getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Text box text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Slate 4A');
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toBeFocused();
  await expect.poll(async () => (await data(page)).map((i) => i.text)).toEqual(['Slate 4A']);
  // The new item is selected: Enter edits it, and the caret is at the end.
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Slate 4A');
  await page.keyboard.type(' take 2');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await data(page)).map((i) => i.text)).toEqual(['Slate 4A take 2']);
  // A sticky note and an ellipse from the keyboard too.
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Note');
  await page.keyboard.press('Escape');
  await page.keyboard.press('o');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['text', 'sticky', 'ellipse']);
});

test('edits a text box with a double-click, and ⌘Z in the field undoes typing, not the board', async ({ page }) => {
  await openCamera(page);
  const key = await mod(page);
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -200);
  await page.keyboard.type('One');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await page.keyboard.press('Escape');
  const item = (await data(page))[0];
  const at = await world(page, (item?.x ?? 0) + 30, (item?.y ?? 0) + 10);
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Text box text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type(' two');
  await page.keyboard.press(`${key}+z`);
  // The field's own undo took some of the typing back; the board still has its item.
  await expect.poll(() => editor.inputValue()).not.toBe('One two');
  await page.keyboard.press('Escape');
  // The board kept its item.
  expect(await data(page)).toHaveLength(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with shapes, text and a sticky note on the board, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
    await openCamera(page);
    await drawShape(page, 'Rectangle', { x: -400, y: -100 }, { x: -250, y: 0 });
    await setHex(page, 'Fill', '#2C5F8A');
    await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
    await click(page, -100, -200);
    await page.keyboard.type('Dusk, the bridge');
    await page.keyboard.press('Escape');
    await tile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
    await click(page, 200, -100);
    await page.keyboard.type('Rain cover?');
    await page.keyboard.press('Escape');
    await properties(page).getByRole('button', { name: /^Sticky colour:/ }).click();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

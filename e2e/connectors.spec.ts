import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Connectors (5.2) in the memory build: drawn between two sticky notes with C, followed when a note moves, switched
// between straight, elbow and curved, given an arrowhead and a label, an end dragged to a third note, a connected copy
// made with the "+" handle and with the arrow shortcut, and deleted with a note and brought back from the Trash. The
// canvas is pixels, so the tests read the paths from the canvas's data-links and the records from the board's data.

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
  kind: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface End {
  item?: string;
  side?: string;
  x?: number;
  y?: number;
}
interface Connector {
  id: string;
  from: End;
  to: End;
  route: string;
  startHead: string;
  endHead: string;
  label: string;
  width: number;
}
interface LinkPath {
  id: string;
  kind: 'line' | 'curve';
  points: { x: number; y: number }[];
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const properties = (page: Page) => tile(page).getByRole('group', { name: 'Properties of the selection' });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const connectors = async (page: Page): Promise<Connector[]> =>
  JSON.parse((await tile(page).locator('[data-board-connectors]').getAttribute('data-board-connectors')) ?? '[]') as Connector[];
const paths = async (page: Page): Promise<LinkPath[]> => JSON.parse((await canvas(page).getAttribute('data-links')) ?? '[]') as LinkPath[];
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];

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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await world(page, from.x, from.y);
  const b = await world(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number) {
  const at = await world(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** A sticky note centred on a world point, with some words. */
async function sticky(page: Page, x: number, y: number, words: string) {
  const before = (await items(page)).length;
  await tile(page).getByRole('button', { name: 'Sticky', exact: true }).click();
  await click(page, x, y);
  await page.keyboard.type(words);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).length).toBe(before + 1);
}

/** Two sticky notes side by side (boxes −400…−200 and 200…400 across, −200…0 down) joined by a connector. */
async function joinedStickies(page: Page) {
  await openCamera(page);
  await sticky(page, -300, -100, 'Key light');
  await sticky(page, 300, -100, 'Fill');
  await page.keyboard.press('c');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'connector');
  // From the middle of the first note to the middle of the second: both ends join at the side facing the other.
  await drag(page, { x: -300, y: -100 }, { x: 300, y: -100 });
  await expect.poll(async () => (await connectors(page)).length).toBe(1);
  const [a, b] = await items(page);
  const [connector] = await connectors(page);
  return { a: a as Item, b: b as Item, connector: connector as Connector };
}

test('draws a connector between two sticky notes with C, selects it, and the tool goes back to Select', async ({ page }) => {
  const { a, b, connector } = await joinedStickies(page);
  expect(connector).toMatchObject({ from: { item: a.id, side: 'auto' }, to: { item: b.id, side: 'auto' }, route: 'straight', startHead: 'none', endHead: 'arrow' });
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  expect(await selection(page)).toEqual([connector.id]);
  const [path] = await paths(page);
  expect(path).toMatchObject({ id: connector.id, kind: 'line' });
  expect(path?.points).toEqual([{ x: -200, y: -100 }, { x: 200, y: -100 }]);
  // The strip shows the connector's own properties.
  await expect(properties(page).getByLabel('Route')).toHaveValue('straight');
  // Said for a screen reader with what it joins.
  await expect(canvas(page).getByRole('status')).toHaveText(/Connector from Sticky note to Sticky note/);
});

test('Escape cancels a connector being drawn, and a click without a drag draws nothing', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Key light');
  await page.keyboard.press('c');
  const a = await world(page, -300, -100);
  const b = await world(page, 100, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await connectors(page)).toEqual([]);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  await page.keyboard.press('c');
  await click(page, 100, 100);
  expect(await connectors(page)).toEqual([]);
});

test('follows a sticky note that moves, writing nothing to the connector', async ({ page }) => {
  const { b, connector } = await joinedStickies(page);
  await drag(page, { x: 300, y: -40 }, { x: 300, y: 110 });
  await expect.poll(async () => (await items(page)).find((i) => i.id === b.id)?.y).toBe(-50);
  // The record is as it was; the path ends at the moved note's facing side.
  expect((await connectors(page))[0]).toEqual(connector);
  const [path] = await paths(page);
  expect(path?.points[0]).toEqual({ x: -200, y: -100 });
  expect(path?.points[1]).toEqual({ x: 200, y: 50 });
});

test('switches to elbow and curved on offset notes, adds an arrowhead at the start and a label', async ({ page }) => {
  const { connector } = await joinedStickies(page);
  // Move the second note down so the elbow has something to bend round.
  await drag(page, { x: 300, y: -40 }, { x: 300, y: 160 });
  await expect.poll(async () => (await paths(page))[0]?.points.at(-1)?.y).toBe(100);
  await click(page, 0, 0);
  expect(await selection(page)).toEqual([connector.id]);
  await properties(page).getByLabel('Route').selectOption('Elbow');
  await expect.poll(async () => (await connectors(page))[0]?.route).toBe('elbow');
  const [bent] = await paths(page);
  expect(bent?.kind).toBe('line');
  expect(bent?.points.length).toBeGreaterThan(2);
  expect(bent?.points[0]).toEqual({ x: -200, y: -100 });
  expect(bent?.points.at(-1)).toEqual({ x: 200, y: 100 });
  await properties(page).getByLabel('Route').selectOption('Curved');
  await expect.poll(async () => (await paths(page))[0]?.kind).toBe('curve');
  expect((await paths(page))[0]?.points).toHaveLength(4);
  await properties(page).getByLabel('Start').selectOption('Arrowhead');
  await expect.poll(async () => (await connectors(page))[0]?.startHead).toBe('arrow');
  // A label typed in the strip.
  const label = properties(page).getByRole('textbox', { name: 'Label' });
  await label.fill('Key to fill');
  await label.press('Enter');
  await expect.poll(async () => (await connectors(page))[0]?.label).toBe('Key to fill');
  expect((await connectors(page))[0]?.id).toBe(connector.id);
});

test('edits the label in place with Enter, and ⌘Z takes it back', async ({ page }) => {
  await joinedStickies(page);
  await canvas(page).focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Connector label' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hard edge');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await connectors(page))[0]?.label).toBe('Hard edge');
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await connectors(page))[0]?.label).toBe('');
});

test('a bent connector at right angles reaches the facing sides', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -300, 'Top left');
  await sticky(page, 300, 100, 'Lower right');
  await page.keyboard.press('c');
  // Out of the first note's right side to the second's top side: one right angle.
  await drag(page, { x: -195, y: -300 }, { x: 300, y: -5 });
  await expect.poll(async () => (await connectors(page)).length).toBe(1);
  expect((await connectors(page))[0]).toMatchObject({ from: { side: 'right' }, to: { side: 'top' } });
  await properties(page).getByLabel('Route').selectOption('Elbow');
  await expect.poll(async () => (await paths(page))[0]?.points.length).toBe(3);
  expect((await paths(page))[0]?.points).toEqual([{ x: -200, y: -300 }, { x: 300, y: -300 }, { x: 300, y: 0 }]);
});

test('drags an end to a third note, then frees it in empty space', async ({ page }) => {
  const { a, connector } = await joinedStickies(page);
  await sticky(page, 0, 230, 'Third');
  const third = (await items(page)).find((i) => i.text === 'Third') as Item;
  // Take the end at the second note, drop it at the middle of the third.
  await click(page, 0, -100);
  await drag(page, { x: 200, y: -100 }, { x: 0, y: 230 });
  await expect.poll(async () => (await connectors(page))[0]?.to.item).toBe(third.id);
  expect((await connectors(page))[0]).toMatchObject({ id: connector.id, from: { item: a.id }, to: { item: third.id, side: 'auto' } });
  // Free: the end follows the pointer where nothing is near.
  const [path] = await paths(page);
  const end = path?.points.at(-1) as { x: number; y: number };
  await drag(page, end, { x: 560, y: 120 });
  await expect.poll(async () => (await connectors(page))[0]?.to).toEqual({ x: 560, y: 120 });
});

test('makes a connected copy with the "+" handle, typed into at once', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Key light');
  const [first] = await items(page);
  await expect(tile(page).locator('[data-quick-side]')).toHaveCount(4);
  await tile(page).locator('[data-quick-side="right"]').click();
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Fill light');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).length).toBe(2);
  const [, copy] = await items(page);
  // Same size and colour, 80 beyond the right side (−200 + 80), aligned to it.
  expect(copy).toMatchObject({ kind: 'sticky', text: 'Fill light', x: -120, y: -200, width: 200, height: 200 });
  expect(await connectors(page)).toHaveLength(1);
  expect((await connectors(page))[0]).toMatchObject({ from: { item: first?.id, side: 'right' }, to: { item: copy?.id, side: 'left' } });
  expect(await selection(page)).toEqual([copy?.id]);
});

test('makes a connected copy from the keyboard alone: select, ⌘⌥↓, type, Escape', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Key light');
  await canvas(page).focus();
  await page.keyboard.press('Tab');
  const [first] = await items(page);
  expect(await selection(page)).toEqual([first?.id]);
  const chord = (await mod(page)) === 'Meta' ? 'Meta+Alt' : 'Control+Shift';
  await page.keyboard.press(`${chord}+ArrowDown`);
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Below');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).map((i) => i.text)).toEqual(['Key light', 'Below']);
  const [, copy] = await items(page);
  expect(copy).toMatchObject({ x: -400, y: 80 });
  expect((await connectors(page))[0]).toMatchObject({ from: { item: first?.id, side: 'bottom' }, to: { item: copy?.id, side: 'top' } });
  await expect(canvas(page)).toBeFocused();
  // The words are one step, the copy with its connector another: two undos take everything back.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).map((i) => i.text)).toEqual(['Key light', '']);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect(await connectors(page)).toEqual([]);
});

test('Delete on a note takes its connector to the Trash; Restore brings both back', async ({ page }) => {
  const { a, b, connector } = await joinedStickies(page);
  await click(page, 300, -150);
  expect(await selection(page)).toEqual([b.id]);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect(await connectors(page)).toEqual([]);
  expect(await paths(page)).toEqual([]);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  // The note is listed; the connector that went with it isn't.
  await expect(trash.getByRole('row', { name: /Sticky note on Camera board/ })).toHaveCount(1);
  await expect(trash.getByRole('row', { name: /Connector/ })).toHaveCount(0);
  await trash.getByRole('button', { name: 'Restore board item Sticky note on Camera board' }).click();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  await expect.poll(async () => (await connectors(page)).map((c) => c.id)).toEqual([connector.id]);
  expect((await items(page)).map((i) => i.id)).toEqual([a.id, b.id]);
});

test('a connector deleted on its own is listed in the Trash and restored alone', async ({ page }) => {
  const { connector } = await joinedStickies(page);
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await connectors(page)).length).toBe(0);
  expect((await items(page)).length).toBe(2);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash.getByRole('row', { name: /Connector on Camera board/ })).toHaveCount(1);
  await trash.getByRole('button', { name: 'Restore board item Connector on Camera board' }).click();
  await expect.poll(async () => (await connectors(page)).map((c) => c.id)).toEqual([connector.id]);
});

test('copies and pastes a connector with its two notes, joined to the copies', async ({ page }) => {
  await joinedStickies(page);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await page.keyboard.press(`${await mod(page)}+d`);
  await expect.poll(async () => (await items(page)).length).toBe(4);
  const all = await connectors(page);
  expect(all).toHaveLength(2);
  const ids = (await items(page)).map((i) => i.id);
  const copy = all.find((c) => c.from.item && ids.indexOf(c.from.item) >= 2);
  expect(copy?.to.item && ids.indexOf(copy.to.item)).toBeGreaterThanOrEqual(2);
});

test('Tab reaches the connector before the notes, in z order', async ({ page }) => {
  const { a, connector } = await joinedStickies(page);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await canvas(page).focus();
  await click(page, -300, -50);
  expect(await selection(page)).toEqual([a.id]);
  await page.keyboard.press('Shift+Tab');
  expect(await selection(page)).toEqual([connector.id]);
});

test('copies, pastes and cuts a connector on its own with the keyboard', async ({ page }) => {
  const { connector } = await joinedStickies(page);
  await canvas(page).focus();
  expect(await selection(page)).toEqual([connector.id]);
  const key = await mod(page);
  await page.keyboard.press(`${key}+c`);
  await page.keyboard.press(`${key}+v`);
  await expect.poll(async () => (await connectors(page)).length).toBe(2);
  // The copy is not on the original: its ends were moved.
  const [copy] = (await connectors(page)).filter((c) => c.id !== connector.id);
  expect(copy?.from.item).toBeUndefined();
  expect(copy?.from).not.toEqual({ x: -200, y: -100 });
  // Cut takes it away, and the paste brings a connector back.
  await page.keyboard.press(`${key}+x`);
  await expect.poll(async () => (await connectors(page)).length).toBe(1);
  await page.keyboard.press(`${key}+v`);
  await expect.poll(async () => (await connectors(page)).length).toBe(2);
});

test('the connectors follow a note while it is being resized, before the mouse is let go', async ({ page }) => {
  const { b } = await joinedStickies(page);
  await click(page, 300, -150);
  expect(await selection(page)).toEqual([b.id]);
  // The left handle of the second note, at the middle of its left edge.
  const from = await world(page, 200, -100);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await world(page, 150, -100);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect.poll(async () => (await paths(page))[0]?.points.at(-1)?.x).toBeLessThan(200);
  // The "+" handles are out of the way while it turns.
  await expect(tile(page).locator('[data-quick-side]')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await items(page)).find((i) => i.id === b.id)?.x).toBeLessThan(200);
  await expect(tile(page).locator('[data-quick-side]')).toHaveCount(4);
});

test('a connected text box left empty leaves nothing, connector included; with words it is written with its connector', async ({ page }) => {
  await openCamera(page);
  await tile(page).getByRole('button', { name: 'Text', exact: true }).click();
  await click(page, -300, -100);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await tile(page).locator('[data-quick-side="bottom"]').click();
  const editor = page.getByRole('textbox', { name: 'Text box text' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  expect(await items(page)).toHaveLength(1);
  expect(await connectors(page)).toEqual([]);
  await tile(page).locator('[data-quick-side="bottom"]').click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('World');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).map((i) => i.text)).toEqual(['Hello', 'World']);
  expect(await connectors(page)).toHaveLength(1);
  // One undo takes the box and its connector together.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect(await connectors(page)).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with a labelled connector selected and the "+" handles showing, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
    await joinedStickies(page);
    const label = properties(page).getByRole('textbox', { name: 'Label' });
    await label.fill('Key to fill');
    await label.press('Enter');
    await expect.poll(async () => (await connectors(page))[0]?.label).toBe('Key to fill');
    await properties(page).getByLabel('Route').selectOption('Elbow');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    // And with a note selected: its four "+" handles are on the page.
    await click(page, -300, -150);
    await expect(tile(page).locator('[data-quick-side]')).toHaveCount(4);
    result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

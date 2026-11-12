import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Sections, align and distribute, Tidy up and snap guides (5.3) in the memory build. The canvas is pixels, so the tests
// read the items from the board's data, the snap guides from the canvas's data-guides, and move the mouse over the same
// world coordinates the canvas draws (the standard view: the origin at the middle of the canvas, 100%).

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
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const properties = (page: Page) => tile(page).getByRole('group', { name: 'Properties of the selection' });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const guides = async (page: Page): Promise<Guide[]> => JSON.parse((await canvas(page).getAttribute('data-guides')) ?? '[]') as Guide[];
const section = async (page: Page) => (await items(page)).find((i) => i.kind === 'section') as Item;
const stickies = async (page: Page) => (await items(page)).filter((i) => i.kind === 'sticky');
const at = (item: Item) => [item.x, item.y];

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
  const point = await world(page, x, y);
  await page.mouse.click(point.x, point.y);
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

/** A rectangle (200 by 120) centred on a world point. */
async function rectangle(page: Page, x: number, y: number) {
  const before = (await items(page)).length;
  await tile(page).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await click(page, x, y);
  await expect.poll(async () => (await items(page)).length).toBe(before + 1);
}

/** A section drawn from (−420, −250) to (180, 150): 600 by 400. */
async function drawSection(page: Page) {
  await tile(page).getByRole('button', { name: 'Section', exact: true }).click();
  await expect(canvas(page)).toHaveAttribute('data-tool', 'section');
  await drag(page, { x: -420, y: -250 }, { x: 180, y: 150 });
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'section').length).toBe(1);
}

/** The section with two sticky notes dropped into it (boxes −400…−200 and −50…150 across). */
async function sectionWithStickies(page: Page) {
  await openCamera(page);
  await drawSection(page);
  await sticky(page, -300, -100, 'Key light');
  await sticky(page, 50, -60, 'Fill');
  return { section: await section(page), notes: await stickies(page) };
}

test('Shift+S picks the Section tool, which draws a section that is selected, upright and unnamed', async ({ page }) => {
  await openCamera(page);
  await canvas(page).focus();
  await page.keyboard.press('Shift+S');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'section');
  await drag(page, { x: -420, y: -250 }, { x: 180, y: 150 });
  await expect.poll(async () => (await items(page)).length).toBe(1);
  const made = await section(page);
  expect(made).toMatchObject({ kind: 'section', name: '', x: -420, y: -250, width: 600, height: 400 });
  expect(await selection(page)).toEqual([made.id]);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  // Said for a screen reader with its name and how many items it holds.
  await expect(canvas(page).getByRole('status')).toHaveText(/Section, 0 items inside/);
  // One undo takes it back.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).length).toBe(0);
});

test('moving a section moves the two sticky notes dropped into it, and one undo puts them all back', async ({ page }) => {
  const { section: start, notes } = await sectionWithStickies(page);
  // Take it by its edge band, 2 px inside the top edge, clear of the notes.
  await drag(page, { x: -100, y: -248 }, { x: 0, y: -188 });
  await expect.poll(async () => at(await section(page))).toEqual([start.x + 100, start.y + 60]);
  const moved = await stickies(page);
  expect(moved.map(at)).toEqual(notes.map((n) => [n.x + 100, n.y + 60]));
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => at(await section(page))).toEqual(at(start));
  expect((await stickies(page)).map(at)).toEqual(notes.map(at));
});

test('a click on a section’s empty middle starts a marquee and picks the notes inside, not the section', async ({ page }) => {
  const { section: s, notes } = await sectionWithStickies(page);
  // Drag from empty space inside the section, round both notes.
  await drag(page, { x: -410, y: -240 }, { x: 170, y: 140 });
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  expect(await selection(page)).toEqual(expect.arrayContaining(notes.map((n) => n.id)));
  expect(await selection(page)).not.toContain(s.id);
  // And a plain click there picks nothing.
  await click(page, -100, 100);
  expect(await selection(page)).toEqual([]);
});

test('resizing a section moves nothing inside it', async ({ page }) => {
  const { notes } = await sectionWithStickies(page);
  await click(page, -100, -248);
  // The right handle, at the middle of the right edge (180, −50).
  const from = await world(page, 180, -50);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await world(page, 260, -50);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await section(page)).width).toBeGreaterThan(600);
  expect((await stickies(page)).map(at)).toEqual(notes.map(at));
});

test('names a section in place: double-click its tab, type, Enter; ⌘Z takes the name back', async ({ page }) => {
  await sectionWithStickies(page);
  await page.mouse.dblclick((await world(page, -390, -262)).x, (await world(page, -390, -262)).y);
  const editor = page.getByRole('textbox', { name: 'Section name' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Act One');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await section(page)).name).toBe('Act One');
  await expect(canvas(page)).toBeFocused();
  await expect(canvas(page).getByRole('status')).toHaveText(/Section Act One, 2 items inside/);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await section(page)).name).toBe('');
});

test('Enter on a selected section edits its name, and Escape ends the edit', async ({ page }) => {
  await sectionWithStickies(page);
  await click(page, -100, -248);
  expect(await selection(page)).toEqual([(await section(page)).id]);
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Section name' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('Interiors');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await section(page)).name).toBe('Interiors');
});

test('Delete takes the section to the Trash alone, listed by its name, and Restore brings it back', async ({ page }) => {
  const { notes } = await sectionWithStickies(page);
  await page.mouse.dblclick((await world(page, -390, -262)).x, (await world(page, -390, -262)).y);
  await page.keyboard.type('Act One');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await section(page)).name).toBe('Act One');
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'section').length).toBe(0);
  expect((await stickies(page)).map(at)).toEqual(notes.map(at));
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash.getByRole('row', { name: /Section 'Act One' on Camera board/ })).toHaveCount(1);
  await trash.getByRole('button', { name: "Restore board item Section 'Act One' on Camera board" }).click();
  await expect.poll(async () => (await section(page)).name).toBe('Act One');
});

test('the context menu selects a section’s contents', async ({ page }) => {
  const { notes } = await sectionWithStickies(page);
  const point = await world(page, -100, -248);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await tile(page).getByRole('button', { name: 'Select contents' }).click();
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  expect((await selection(page)).sort()).toEqual(notes.map((n) => n.id).sort());
});

test('⌘⌥G draws a section round the selection, with padding, in one step', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Key light');
  await sticky(page, 300, 100, 'Fill');
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await page.keyboard.press(`${await mod(page)}+Alt+g`);
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'section').length).toBe(1);
  // The notes span −400…400 across and −200…200 down: 40 round, and 24 more above for the name.
  expect(await section(page)).toMatchObject({ x: -440, y: -264, width: 880, height: 504 });
  expect(await selection(page)).toEqual([(await section(page)).id]);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'section').length).toBe(0);
});

/** Three notes at different places: boxes (−400, −300), (−50, −120) and (−200, 130). */
async function threeNotes(page: Page) {
  await openCamera(page);
  await sticky(page, -300, -200, 'One');
  await sticky(page, 50, -20, 'Two');
  await sticky(page, -100, 230, 'Three');
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await expect.poll(async () => (await selection(page)).length).toBe(3);
}

test('Alt+A aligns three notes left, Alt+Shift+V distributes them down, and ⌘Z undoes each', async ({ page }) => {
  await threeNotes(page);
  await page.keyboard.press('Alt+a');
  await expect.poll(async () => (await stickies(page)).map((n) => n.x)).toEqual([-400, -400, -400]);
  expect((await stickies(page)).map((n) => n.y)).toEqual([-300, -120, 130]);
  await expect(canvas(page).getByRole('status')).toHaveText('Aligned 3 items left');
  await page.keyboard.press('Alt+Shift+V');
  // 630 down, 600 of notes: 15 in each gap.
  await expect.poll(async () => (await stickies(page)).map((n) => n.y)).toEqual([-300, -85, 130]);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await stickies(page)).map((n) => n.y)).toEqual([-300, -120, 130]);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await stickies(page)).map((n) => n.x)).toEqual([-400, -50, -200]);
});

test('the Arrange group in the strip aligns and distributes with labelled buttons', async ({ page }) => {
  await threeNotes(page);
  const arrange = properties(page).getByRole('group', { name: 'Arrange' });
  await arrange.getByRole('button', { name: 'Align top', exact: true }).click();
  await expect.poll(async () => (await stickies(page)).map((n) => n.y)).toEqual([-300, -300, -300]);
  await arrange.getByRole('button', { name: 'Distribute across', exact: true }).click();
  // Notes One, Two and Three at −400, −50 and −200 across: by their middles One, Three, Two, 25 overlapping in each gap.
  await expect.poll(async () => (await stickies(page)).map((n) => n.x)).toEqual([-400, -50, -225]);
  await arrange.getByRole('button', { name: 'Tidy up as a column', exact: true }).click();
  await expect.poll(async () => (await stickies(page)).map((n) => n.x)).toEqual([-400, -400, -400]);
});

test('Alt+Shift+T tidies six rectangles into a grid from the keyboard alone, and ⌘Z puts them back', async ({ page }) => {
  await openCamera(page);
  const places = [
    [-320, -150],
    [10, -140],
    [310, -160],
    [-290, 110],
    [20, 100],
    [330, 120],
  ] as const;
  for (const [x, y] of places) await rectangle(page, x, y);
  const before = (await items(page)).map(at);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await page.keyboard.press('Alt+Shift+T');
  // Three columns, two rows; 200 by 120 cells, 24 apart, from the top left corner of the lot (−420, −220).
  await expect
    .poll(async () => (await items(page)).map(at).sort((a, b) => (a[1] as number) - (b[1] as number) || (a[0] as number) - (b[0] as number)))
    .toEqual([
      [-420, -220],
      [-196, -220],
      [28, -220],
      [-420, -76],
      [-196, -76],
      [28, -76],
    ]);
  await expect(canvas(page).getByRole('status')).toHaveText('Tidied 6 items into a grid');
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await items(page)).map(at)).toEqual(before);
});

test('a note dragged near another snaps to its line, with a guide while the mouse is down, and not with Ctrl held', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Anchor');
  await sticky(page, 300, 100, 'Moved');
  const [anchor, moved] = await stickies(page);
  expect(at(moved as Item)).toEqual([200, 0]);
  // Pull it up by 197: its top is 3 units from the anchor’s top (−200).
  const from = await world(page, 300, 100);
  const to = await world(page, 300, -97);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect.poll(async () => (await guides(page)).some((g) => g.axis === 'y' && g.at === -200)).toBe(true);
  const [line] = (await guides(page)).filter((g) => g.axis === 'y' && g.at === -200);
  // The guide runs across both notes.
  expect(line?.from).toBe(-400);
  expect(line?.to).toBe(400);
  await page.mouse.up();
  await expect.poll(async () => (await stickies(page))[1]?.y).toBe((anchor as Item).y);
  expect(await guides(page)).toEqual([]);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await stickies(page))[1]?.y).toBe(0);
  // With Ctrl (⌘ on a Mac) held the same drag lands where the mouse let go.
  const key = await mod(page);
  await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  expect(await guides(page)).toEqual([]);
  await page.mouse.up();
  await page.keyboard.up(key);
  await expect.poll(async () => (await stickies(page))[1]?.y).toBe(-197);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with a section, the Arrange group, the menu and a snap guide showing, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
    await openCamera(page);
    await drawSection(page);
    await sticky(page, -300, -100, 'Key light');
    await sticky(page, 300, 100, 'Fill');
    await page.mouse.dblclick((await world(page, -390, -262)).x, (await world(page, -390, -262)).y);
    await page.keyboard.type('Act One');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await section(page)).name).toBe('Act One');
    await canvas(page).focus();
    await page.keyboard.press(`${await mod(page)}+a`);
    await expect(properties(page).getByRole('group', { name: 'Arrange' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    let result = await new AxeBuilder({ page }).withTags(rules).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    // The menu with the layout commands.
    const point = await world(page, -100, -248);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(tile(page).getByRole('group', { name: 'Board actions' }).getByRole('button', { name: 'Align left' })).toBeVisible();
    result = await new AxeBuilder({ page }).withTags(rules).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.keyboard.press('Escape');
    // And mid-drag, with a guide drawn.
    await click(page, 0, 300);
    const from = await world(page, 300, 100);
    const to = await world(page, 300, -97);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect.poll(async () => (await guides(page)).length).toBeGreaterThan(0);
    result = await new AxeBuilder({ page }).withTags(rules).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.mouse.up();
  });
}

test('a sticky dragged into a section is held by it: move the section and the sticky follows', async ({ page }) => {
  const { section: start } = await sectionWithStickies(page);
  await sticky(page, 300, 100, 'Late');
  const late = (await stickies(page)).find((n) => n.text === 'Late') as Item;
  expect(at(late)).toEqual([200, 0]);
  await drag(page, { x: 300, y: 100 }, { x: -100, y: -50 });
  await expect.poll(async () => at(((await stickies(page)).find((n) => n.text === 'Late')) as Item)).toEqual([-200, -150]);
  await drag(page, { x: -100, y: -248 }, { x: 0, y: -188 });
  await expect.poll(async () => at(await section(page))).toEqual([start.x + 100, start.y + 60]);
  expect(at((await stickies(page)).find((n) => n.text === 'Late') as Item)).toEqual([-100, -90]);
});

test('drawing a rectangle next to a note snaps its corners with guides and raises no error', async ({ page }) => {
  await openCamera(page);
  await sticky(page, -300, -100, 'Anchor');
  await tile(page).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const from = await world(page, -197, -197);
  const to = await world(page, 100, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // Both corners lie on the note's lines (−200 across, −200 and 0 down): guides show, each line once.
  await expect.poll(async () => (await guides(page)).length).toBeGreaterThan(0);
  const keys = (await guides(page)).map((g) => `${g.axis}${String(g.at)}`);
  expect(new Set(keys).size).toBe(keys.length);
  await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect(at((await items(page))[1] as Item)).toEqual([-200, -200]);
});

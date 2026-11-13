import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Live cards (5.4) in the memory build: shots and scenes from the storyboard on a board, read from the project as it is
// now; scene palettes; the brand kit of the project's company; and a board's links. The canvas is pixels, so the tests read
// the cards from the board's data (data-board-data for what is stored, data-board-live for what each card shows) and
// double-click the same world coordinates the canvas draws (the standard view: the origin at the middle, 100%).

test.use({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];

test.beforeEach(async ({ page, context, browserName }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  shotId: string;
  sceneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Live {
  id: string;
  kind: string;
  state?: string;
  number?: string;
  size?: string;
  lens?: string;
  label: string;
  colors?: string[];
  fonts?: string[];
  company?: { name: string } | null;
  frames?: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const properties = (page: Page) => tile(page).getByRole('group', { name: 'Properties of the selection' });
const items = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const live = async (page: Page): Promise<Live[]> => JSON.parse((await tile(page).locator('[data-board-live]').getAttribute('data-board-live')) ?? '[]') as Live[];
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const frame = (page: Page, number: string) => storyboard(page).locator('[data-shot-id]').filter({ has: page.locator('[data-number]', { hasText: new RegExp(`^${number}$`) }) });

/** A scene with two frames, 1A and 1B, in the Storyboard. */
async function twoFrames(page: Page) {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(2);
}

async function openCamera(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await tile(page).locator('[data-department-board="camera"]').click();
  await expect(canvas(page)).toBeVisible();
  await page.waitForTimeout(100);
}

const toMoodboard = async (page: Page) => {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await expect(canvas(page)).toBeVisible();
};

const toStoryboard = async (page: Page) => {
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(storyboard(page)).toBeVisible();
};

/** Where a world point is on screen, at the standard view. */
async function world(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y };
}

/** Double-clicks the middle of a card. */
async function openCard(page: Page, card: Item) {
  const point = await world(page, card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.dblclick(point.x, point.y);
}

async function clickCard(page: Page, card: Item) {
  const point = await world(page, card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.click(point.x, point.y);
}

/** Add from storyboard: ticks the named boxes and adds. */
async function addFromStoryboard(page: Page, names: (string | RegExp)[]) {
  await tile(page).getByRole('button', { name: 'Add from storyboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add from storyboard' });
  for (const name of names) await dialog.getByRole('checkbox', { name }).check();
  await dialog.getByRole('button', { name: 'Add to board' }).click();
  await expect(dialog).toBeHidden();
}

test('adds a frame and a scene from the picker as one tidied row, shows the frame as it is now, and jumps back to it', async ({ page }) => {
  await twoFrames(page);
  await openCamera(page);
  await addFromStoryboard(page, ['1B', /^SC 01/]);
  // One scene card and one shot card, a row at the middle of the view, both selected.
  await expect.poll(async () => (await items(page)).length).toBe(2);
  const [first, second] = await items(page);
  if (!first || !second) throw new Error('two cards');
  // Scenes first (the order of the storyboard), then its frames, 24 units apart, tops level around the middle.
  expect([first.kind, second.kind]).toEqual(['scene_card', 'shot_card']);
  expect(second.x).toBe(first.x + first.width + 24);
  expect(await selection(page)).toHaveLength(2);
  const cards = await live(page);
  expect(cards.find((c) => c.kind === 'scene_card')).toMatchObject({ state: 'live', frames: 2 });
  expect(cards.find((c) => c.kind === 'shot_card')).toMatchObject({ state: 'live', number: '1B', size: '' });
  await expect(canvas(page).getByRole('status')).toHaveText(/Added 2 cards from the storyboard/);

  // The frame's shot size changes in the Inspector, and the card shows it with no edit of its own.
  await toStoryboard(page);
  await frame(page, '1B').click();
  await inspector(page).getByRole('radio', { name: 'MCU' }).click();
  await toMoodboard(page);
  await expect.poll(async () => (await live(page)).find((c) => c.kind === 'shot_card')?.size).toBe('MCU');
  await expect.poll(async () => (await live(page)).find((c) => c.kind === 'shot_card')?.label).toBe('Shot card 1B, MCU');

  // Double-click goes back to the Storyboard with that frame selected.
  await openCard(page, second);
  await expect(storyboard(page)).toBeVisible();
  await expect(storyboard(page).locator('[data-shot-id][aria-current="true"] [data-number]')).toHaveText('1B');
  await expect(frame(page, '1B')).toBeFocused();
  await frame(page, '1A').click();
  await expect(storyboard(page).locator('[data-shot-id][aria-current="true"] [data-number]')).toHaveText('1A');
  // And the scene card selects its scene.
  await toMoodboard(page);
  await openCard(page, first);
  await expect(storyboard(page)).toBeVisible();
  await expect(sidebar(page).getByRole('list', { name: 'Scenes' }).getByRole('button', { name: /^SC 01/ })).toHaveAttribute('aria-current', 'true');
  // Focus is on the scene's first frame.
  await expect(frame(page, '1A')).toBeFocused();
});

test('a card whose frame is in the Trash says so and stays; opening it shows the Trash filtered to the frame', async ({ page }) => {
  await twoFrames(page);
  await openCamera(page);
  await addFromStoryboard(page, ['1A', '1B']);
  await expect.poll(async () => (await items(page)).length).toBe(2);
  await toStoryboard(page);
  await frame(page, '1A').focus();
  await page.keyboard.press('Delete');
  await toMoodboard(page);
  await expect.poll(async () => (await live(page)).map((c) => c.state)).toEqual(['trash', 'live']);
  expect((await live(page))[0]?.label).toContain('In the Trash');
  // The card is still on the board.
  expect(await items(page)).toHaveLength(2);
  const trashed = (await items(page)).find((i) => i.kind === 'shot_card') as Item;
  const firstId = (await live(page))[0]?.id;
  await openCard(page, (await items(page)).find((i) => i.id === firstId) ?? trashed);
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash).toBeVisible();
  await expect(trash.getByRole('combobox', { name: 'Type' })).toHaveValue('frame');
  await expect(trash.getByRole('row')).toHaveCount(2);
  await expect(trash).toContainText('1A');
  // The request was taken once: with the filter set to everything, a tile closed and opened again starts on everything.
  await trash.getByRole('combobox', { name: 'Type' }).selectOption('');
  await trash.getByRole('button', { name: 'Close Trash' }).click();
  await expect(trash).toHaveCount(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(trash).toBeVisible();
  await expect(trash.getByRole('combobox', { name: 'Type' })).toHaveValue('');
  // Restored, the card is live again.
  await trash.getByRole('button', { name: /^Restore/ }).first().click();
  await expect.poll(async () => (await live(page)).map((c) => c.state)).toEqual(['live', 'live']);
});

test('a scene’s palette card reads the palette as it is now, copies a hex, and offers the editor when there is none', async ({ page, browserName }) => {
  await twoFrames(page);
  await frame(page, '1A').click();
  await inspector(page).getByRole('textbox', { name: 'Add a colour' }).fill('#A35139');
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('toolbar', { name: 'Palette for SC 01' }).getByRole('button')).toHaveCount(1);
  await openCamera(page);
  await addFromStoryboard(page, [/^Palette$/]);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await expect.poll(async () => (await live(page))[0]?.colors).toEqual(['#A35139']);
  // Selected, the strip lists the hex to copy.
  await expect(properties(page).locator('[data-copy-hex="#A35139"]')).toBeVisible();
  await properties(page).locator('[data-copy-hex="#A35139"]').click();
  await expect(page.getByRole('status').getByText('Copied #A35139.')).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#A35139');
  // The palette changes in the Storyboard; the card follows.
  await toStoryboard(page);
  await inspector(page).getByRole('textbox', { name: 'Add a colour' }).fill('#1F2F4D');
  await page.keyboard.press('Enter');
  await toMoodboard(page);
  await expect.poll(async () => (await live(page))[0]?.colors).toEqual(['#A35139', '#1F2F4D']);
});

test('a palette card on a scene with none says so and opens the scene in the storyboard', async ({ page }) => {
  await twoFrames(page);
  await openCamera(page);
  await addFromStoryboard(page, [/^Palette$/]);
  await expect.poll(async () => (await live(page))[0]?.colors).toEqual([]);
  await expect(properties(page).getByRole('button', { name: 'Open palette in the storyboard' })).toBeVisible();
  await properties(page).getByRole('button', { name: 'Open palette in the storyboard' }).click();
  await expect(storyboard(page)).toBeVisible();
  await expect(inspector(page).getByText('Add pictures to this scene’s frames to make its palette.')).toBeVisible();
});

test('the brand kit of the project’s company shows its colours and fonts, and says so with no company', async ({ page }) => {
  await twoFrames(page);
  await openCamera(page);
  await addFromStoryboard(page, ['Brand kit']);
  await expect.poll(async () => (await live(page))[0]?.kind).toBe('brand_card');
  expect((await live(page))[0]).toMatchObject({ company: null, label: 'Brand kit, no company attached' });
  const sizeBefore = await items(page).then((all) => [all[0]?.width, all[0]?.height]);
  await expect(properties(page).getByRole('button', { name: 'Open Settings' })).toBeVisible();

  // A profile with a logo-less kit, saved in Settings → App and attached in Settings → Project.
  let panel = await openSettings(page, 'App');
  await panel.getByRole('button', { name: 'Add company' }).click();
  const company = panel.getByRole('list', { name: 'Company profiles' }).getByRole('group').first();
  await company.getByRole('textbox', { name: 'Name' }).fill('Zima Blue Pictures');
  // Contact details, to prove below that they never reach the board's data.
  const details = { Website: 'https://zima.example.com', Address: '12 Hidden Lane', Phone: '+1 555 010 7788', Email: 'office@zima.example.com' };
  const contact = Object.values(details);
  for (const [label, value] of Object.entries(details)) {
    await company.getByRole('textbox', { name: label, exact: true }).fill(value);
    await company.getByRole('textbox', { name: label, exact: true }).blur();
  }
  // Not a colour: refused, with the words, and nothing saved.
  await company.getByRole('textbox', { name: 'Brand colours' }).fill('#DF5E27 nope');
  await company.getByRole('textbox', { name: 'Brand colours' }).blur();
  await expect(panel.getByRole('alert')).toContainText('“nope” isn’t a colour');
  await company.getByRole('textbox', { name: 'Brand colours' }).fill('#df5e27 #16150F');
  await company.getByRole('textbox', { name: 'Brand colours' }).blur();
  await expect(company.getByRole('list', { name: 'Brand colours' }).getByRole('listitem')).toHaveText(['#DF5E27', '#16150F']);
  // One list of fonts serves every picker (a datalist): typed or picked, and only a font in the list is kept.
  await company.getByRole('combobox', { name: 'Brand font 1' }).fill('Not a font');
  await company.getByRole('combobox', { name: 'Brand font 1' }).blur();
  await expect(panel.getByRole('alert')).toContainText('isn’t a font in the list');
  await expect(company.getByRole('combobox', { name: 'Brand font 1' })).toHaveValue('');
  // The words belong to their own field, and go when its value is valid.
  await expect(company.getByRole('combobox', { name: 'Brand font 1' })).toHaveAttribute('aria-invalid', 'true');
  await expect(company.getByRole('combobox', { name: 'Brand font 1' })).toHaveAccessibleDescription(/isn’t a font in the list/);
  await expect(company.getByRole('combobox', { name: 'Brand font 2' })).not.toHaveAttribute('aria-invalid', 'true');
  // Case doesn't matter, and the listed spelling is kept.
  await company.getByRole('combobox', { name: 'Brand font 1' }).fill('jost');
  await company.getByRole('combobox', { name: 'Brand font 1' }).blur();
  await expect(company.getByRole('combobox', { name: 'Brand font 1' })).toHaveValue('Jost');
  await expect(company.getByRole('combobox', { name: 'Brand font 1' })).not.toHaveAttribute('aria-invalid', 'true');
  await expect(company.getByText('isn’t a font in the list')).toHaveCount(0);
  await company.getByRole('combobox', { name: 'Brand font 2' }).fill('Outfit');
  await company.getByRole('combobox', { name: 'Brand font 2' }).blur();
  await expect(panel.locator('datalist')).toHaveCount(1);
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  await panel.getByRole('combobox', { name: 'Company', exact: true }).selectOption({ label: 'Zima Blue Pictures' });
  await panel.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(panel.locator('[data-brand-colors-copy]')).toHaveText('#DF5E27 #16150F');
  await expect(panel.locator('[data-brand-fonts-copy]')).toHaveText('Jost, Outfit');
  await closeSettings(page);

  await expect.poll(async () => (await live(page))[0]).toMatchObject({ company: { name: 'Zima Blue Pictures' }, colors: ['#DF5E27', '#16150F'], fonts: ['Jost', 'Outfit'] });
  expect((await live(page))[0]?.label).toBe('Brand kit, Zima Blue Pictures');
  // The card's box was made once and is never rewritten: the full kit fits the room it was made with.
  expect(await items(page).then((all) => [all[0]?.width, all[0]?.height])).toEqual(sizeBefore);
  // Contact details are never put in the board's data.
  const shown = await tile(page).locator('[data-board-live]').getAttribute('data-board-live');
  expect(shown).toContain('Zima Blue Pictures');
  for (const detail of [...contact, 'Hidden Lane', '555 010', 'example.com']) expect(shown).not.toContain(detail);
  // The profile's kit changes: the project's copy stays until Update from profile.
  panel = await openSettings(page, 'App');
  const again = panel.getByRole('list', { name: 'Company profiles' }).getByRole('group').first();
  await again.getByRole('textbox', { name: 'Brand colours' }).fill('#2C5F8A');
  await again.getByRole('textbox', { name: 'Brand colours' }).blur();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  await expect(panel.locator('[data-brand-colors-copy]')).toHaveText('#DF5E27 #16150F');
  await panel.getByRole('button', { name: 'Update from profile' }).click();
  await expect(panel.locator('[data-brand-colors-copy]')).toHaveText('#2C5F8A');
  await closeSettings(page);
  await expect.poll(async () => (await live(page))[0]?.colors).toEqual(['#2C5F8A']);
});

test('a board linked to a scene, a character and a location says so, and the scene’s Inspector lists the board', async ({ page }) => {
  await twoFrames(page);
  // A location, set from the "/" menu on the board is more than needed: one made in Production → Locations.
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await page.getByRole('region', { name: 'Locations', exact: true }).getByRole('button', { name: '+ New location' }).first().click();
  await page.getByRole('region', { name: 'Locations', exact: true }).getByRole('textbox', { name: 'Name' }).fill('Rooftop');
  await page.getByRole('region', { name: 'Locations', exact: true }).getByRole('textbox', { name: 'Name' }).blur();
  await openCamera(page);
  // Nothing linked yet: no line, and the scene's Inspector has no boards list.
  await expect(tile(page).locator('[data-board-links]')).not.toContainText('Linked to');
  await toStoryboard(page);
  await frame(page, '1A').click();
  await expect(inspector(page).getByRole('group', { name: 'Boards' })).toHaveCount(0);
  await toMoodboard(page);
  await tile(page).getByRole('button', { name: 'Link to…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link this board to…' });
  await dialog.getByRole('checkbox', { name: /^SC 01/ }).check();
  await dialog.getByRole('checkbox', { name: 'Rooftop' }).check();
  await dialog.getByRole('button', { name: 'Save links' }).click();
  await expect(dialog).toBeHidden();
  await expect(tile(page).locator('[data-board-links]')).toContainText('Linked to: SC 01, Rooftop');
  await expect(tile(page).getByRole('button', { name: 'Edit links' })).toBeVisible();
  // One edit: ⌘Z takes the links back.
  const undo = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z';
  await canvas(page).focus();
  await page.keyboard.press(undo);
  await expect(tile(page).locator('[data-board-links]')).not.toContainText('Linked to');
  await page.keyboard.press(undo.replace('z', 'Shift+z'));
  await expect(tile(page).locator('[data-board-links]')).toContainText('Linked to: SC 01, Rooftop');

  // Read the other way: the scene's Inspector, and the location's tile, list the board and open it.
  await toStoryboard(page);
  await frame(page, '1A').click();
  const boards = inspector(page).getByRole('group', { name: 'Boards' });
  await expect(boards.getByRole('button', { name: 'Camera' })).toBeVisible();
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await expect(page.getByRole('region', { name: 'Locations', exact: true }).locator('[data-linked-boards="location"]').getByRole('button', { name: 'Camera' })).toBeVisible();
  await toStoryboard(page);
  await frame(page, '1A').click();
  await boards.getByRole('button', { name: 'Camera' }).click();
  await expect(canvas(page)).toBeVisible();
});

test('Add to board… from a frame’s context menu puts its card on the chosen board, which opens with it selected', async ({ page }) => {
  await twoFrames(page);
  // The board has to exist: opening the camera board makes it.
  await openCamera(page);
  await toStoryboard(page);
  await frame(page, '1B').click({ button: 'right' });
  const menu = page.locator('[data-add-to-board-menu]');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Add to board…' }).click();
  await menu.getByRole('button', { name: 'Camera' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => (await live(page)).map((c) => [c.kind, c.number])).toEqual([['shot_card', '1B']]);
  expect(await selection(page)).toHaveLength(1);
  // From the keyboard: the menu key on the focused frame, and Escape closes it and gives focus back.
  await toStoryboard(page);
  await frame(page, '1A').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  // From the keyboard it opens beside the frame, not in a corner.
  const near = await frame(page, '1A').boundingBox();
  const at = await menu.boundingBox();
  if (!near || !at) throw new Error('boxes');
  expect(Math.abs(at.x - near.x)).toBeLessThan(40);
  expect(at.y - (near.y + near.height)).toBeLessThan(40);
  expect(at.y).toBeGreaterThan(near.y);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(frame(page, '1A')).toBeFocused();
  // Tab out of the menu closes it; a later Escape elsewhere then leaves focus where it is.
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Add to board…' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  const focused = () => page.evaluate(() => document.activeElement?.outerHTML ?? '');
  const where = await focused();
  await page.keyboard.press('Escape');
  expect(await focused()).toBe(where);
  await expect(frame(page, '1A')).not.toBeFocused();
  // A scene's heading has it too, and Escape gives focus back to something in the Storyboard.
  await storyboard(page).locator('[data-heading-row]').first().click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(storyboard(page).locator(':focus')).toHaveCount(1);
  await storyboard(page).locator('[data-heading-row]').first().click({ button: 'right' });
  await menu.getByRole('button', { name: 'Add to board…' }).click();
  await menu.getByRole('button', { name: 'Camera' }).click();
  await expect.poll(async () => (await live(page)).map((c) => c.kind).sort()).toEqual(['scene_card', 'shot_card']);
});

test('a card moves, resizes keeping its shape, and goes to the Trash like any item', async ({ page }) => {
  await twoFrames(page);
  await openCamera(page);
  await addFromStoryboard(page, ['1A']);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  const [card] = await items(page);
  if (!card) throw new Error('a card');
  const ratio = card.width / card.height;
  // Moved by the arrow keys, resized by a corner handle: its shape is kept.
  await canvas(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await items(page))[0]?.x).toBe(card.x + 1);
  const corner = await world(page, card.x + 1 + card.width, card.y + card.height);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 10, { steps: 6 });
  await page.mouse.up();
  const resized = (await items(page))[0] as Item;
  expect(resized.width).toBeGreaterThan(card.width);
  expect(resized.width / resized.height).toBeCloseTo(ratio, 1);
  // Delete trashes the card: the Trash lists it by what it shows.
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await items(page)).length).toBe(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Trash', exact: true })).toContainText('Shot card 1A on Camera board');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with live cards, the picker and the links window open, ${scheme}`, async ({ page }) => {
    await twoFrames(page);
    await openCamera(page);
    await addFromStoryboard(page, ['1A', /^SC 01/, /^Palette$/, 'Brand kit']);
    await expect.poll(async () => (await items(page)).length).toBe(4);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
    // A reload forgets which board was open: the picker lists the camera board, which now exists.
    await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
    await tile(page).locator('[data-board-open]').first().click();
    await expect(canvas(page)).toBeVisible();
    const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    const check = async () => {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const result = await new AxeBuilder({ page }).withTags(rules).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await check();
    // A palette card selected, with its hex buttons in the strip.
    const palette = (await items(page)).find((i) => i.kind === 'palette_card') as Item;
    await clickCard(page, palette);
    await expect(properties(page).getByRole('button', { name: 'Open palette in the storyboard' })).toBeVisible();
    await check();
    await tile(page).getByRole('button', { name: 'Add from storyboard' }).click();
    await expect(page.getByRole('dialog', { name: 'Add from storyboard' })).toBeVisible();
    await check();
    await page.keyboard.press('Escape');
    await tile(page).getByRole('button', { name: 'Link to…' }).click();
    await expect(page.getByRole('dialog', { name: 'Link this board to…' })).toBeVisible();
    await check();
  });
}

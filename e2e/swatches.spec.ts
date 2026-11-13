import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// A scene's palette from a moodboard, and its swatches as a PNG strip and an Adobe .ase (5.6b) in the memory build: a board with
// three pictures linked to a scene makes its palette (one edit, undone with the keyboard), the palette editor shows it, and the
// exported files are read back (the .ase's signature and swatch count, the PNG's width). Axe on the Export dialog, light and dark.

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

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const wrapper = (page: Page) => tile(page).locator('[data-board-data]');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export' });
const swatches = (page: Page) => inspector(page).getByRole('toolbar', { name: 'Palette for SC 01' }).getByRole('button');
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url));
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;
const bytesOf = async (download: Download): Promise<Uint8Array> => new Uint8Array(readFileSync(await download.path()));

/** A scene with one frame, selected. */
async function oneFrame(page: Page) {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await storyboard(page).locator('[data-shot-id]').first().click();
}

/** The Camera board with three pictures dropped on it. */
async function boardWithPictures(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await tile(page).locator('[data-department-board="camera"]').click();
  await expect(canvas(page)).toBeVisible();
  await page.waitForTimeout(100);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  for (const [i, name] of ['p3-red.jpg', 'srgb.jpg', 'photo-a.jpg'].entries()) {
    const list = [{ name, type: 'image/jpeg', data: [...readFileSync(fixture(name))] }];
    const transfer = await page.evaluateHandle((list) => {
      const transfer = new DataTransfer();
      for (const { name, type, data } of list) transfer.items.add(new File([new Uint8Array(data)], name, { type }));
      return transfer;
    }, list);
    await wrapper(page).dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2 - 300 + i * 300, clientY: box.y + box.height / 2 });
    await expect.poll(async () => (JSON.parse((await wrapper(page).getAttribute('data-board-data')) ?? '[]') as unknown[]).length).toBe(i + 1);
    await page.waitForTimeout(150);
  }
}

async function linkToScene(page: Page) {
  await tile(page).getByRole('button', { name: 'Link to…' }).click();
  const links = page.getByRole('dialog', { name: 'Link this board to…' });
  await links.getByRole('checkbox', { name: /^SC 01/ }).check();
  await links.getByRole('button', { name: 'Save links' }).click();
  await expect(links).toBeHidden();
}

test('makes a scene’s palette from a linked board, shows it in the palette editor, and undoes it', async ({ page }) => {
  await oneFrame(page);
  await expect(inspector(page).getByRole('button', { name: 'From a board' })).toHaveCount(0);
  await boardWithPictures(page);
  // Not linked yet: no button.
  await expect(tile(page).getByRole('button', { name: 'Make palette from this board' })).toHaveCount(0);
  await linkToScene(page);
  await tile(page).getByRole('button', { name: 'Make palette from this board' }).click();
  await expect(page.getByRole('status').getByText('Made SC 01’s palette from the Camera board.')).toBeVisible();

  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await storyboard(page).locator('[data-shot-id]').first().click();
  await expect(swatches(page).first()).toBeVisible();
  const count = await swatches(page).count();
  expect(count).toBeGreaterThan(0);
  // The editor lists the board it can read too.
  await inspector(page).getByRole('button', { name: 'From a board' }).click();
  await expect(inspector(page).getByRole('button', { name: 'From a board' }).locator('xpath=following::button[normalize-space()="Camera"][1]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press(await undoKey(page));
  await expect(swatches(page)).toHaveCount(0);
  // The notice about the step goes with it.
  await expect(page.getByRole('status').getByText(/^Made SC 01/)).toHaveCount(0);
});

test('exports a scene’s swatches as an .ase and as a PNG strip, and reads both back', async ({ page }) => {
  await oneFrame(page);
  await boardWithPictures(page);
  await linkToScene(page);
  await tile(page).getByRole('button', { name: 'Make palette from this board' }).click();
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await storyboard(page).locator('[data-shot-id]').first().click();
  await expect(swatches(page).first()).toBeVisible();
  const count = await swatches(page).count();

  await inspector(page).getByRole('button', { name: 'Export swatches…' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('radio')).toHaveText(['Swatches as PNG', 'Swatches as .ase']);
  await expect(dialog(page).getByRole('combobox', { name: /^Scenes/ })).toHaveCount(0);

  // The PNG strip first (it is the first format).
  let downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  let download = await downloaded;
  expect(download.suggestedFilename()).toBe('SC 01 palette.png');
  const png = await bytesOf(download);
  expect(String.fromCharCode(...png.slice(1, 4))).toBe('PNG');
  expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(2400);
  await expect(page.getByRole('status').getByText(`Exported ${String(count)} ${count === 1 ? 'colour' : 'colours'} to “SC 01 palette.png”.`)).toBeVisible();

  await inspector(page).getByRole('button', { name: 'Export swatches…' }).click();
  await dialog(page).getByRole('radio', { name: 'Swatches as .ase' }).click();
  downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  download = await downloaded;
  expect(download.suggestedFilename()).toBe('SC 01 palette.ase');
  const ase = await bytesOf(download);
  expect(String.fromCharCode(...ase.slice(0, 4))).toBe('ASEF');
  const view = new DataView(ase.buffer, ase.byteOffset);
  expect([view.getUint16(4), view.getUint16(6)]).toEqual([1, 0]);
  // The group's start and end blocks, and one entry for each swatch.
  expect(view.getUint32(8)).toBe(count + 2);
});

test('undo brings back the palette a scene had before, and a board linked to two scenes asks which', async ({ page }) => {
  await oneFrame(page);
  await inspector(page).getByRole('textbox', { name: 'Add a colour' }).fill('#A35139');
  await page.keyboard.press('Enter');
  await expect(swatches(page)).toHaveCount(1);
  // A second scene, so the board can be linked to both.
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await boardWithPictures(page);
  await tile(page).getByRole('button', { name: 'Link to…' }).click();
  const links = page.getByRole('dialog', { name: 'Link this board to…' });
  // Linked in the opposite order: the menu still follows the board.
  await links.getByRole('checkbox', { name: /^SC 02/ }).check();
  await links.getByRole('checkbox', { name: /^SC 01/ }).check();
  await links.getByRole('button', { name: 'Save links' }).click();
  await expect(links).toBeHidden();
  const button = tile(page).getByRole('button', { name: 'Make palette from this board' });
  await button.click();
  await expect(tile(page).getByRole('button', { name: /^SC \d\d$/ })).toHaveText(['SC 01', 'SC 02']);
  await tile(page).getByRole('button', { name: 'SC 01', exact: true }).click();
  await expect(page.getByRole('status').getByText('Made SC 01’s palette from the Camera board.')).toBeVisible();

  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await storyboard(page).locator('[data-shot-id]').first().click();
  await expect(swatches(page).first()).toBeVisible();
  expect(await swatches(page).count()).toBeGreaterThan(1);
  await page.keyboard.press(await undoKey(page));
  // The step's notice goes with the step, and the old palette is back.
  await expect(page.getByRole('status').getByText(/^Made SC 01/)).toHaveCount(0);
  await expect(swatches(page)).toHaveCount(1);
  await expect(swatches(page).first()).toHaveAccessibleName(/#A35139/);
});

test('exports swatches from a palette card and from a brand card', async ({ page }) => {
  await oneFrame(page);
  await boardWithPictures(page);
  await linkToScene(page);
  await tile(page).getByRole('button', { name: 'Make palette from this board' }).click();
  await expect(page.getByRole('status').getByText(/^Made SC 01/)).toBeVisible();
  // A palette card, selected as it is added.
  await tile(page).getByRole('button', { name: 'Add from storyboard' }).click();
  const picker = page.getByRole('dialog', { name: 'Add from storyboard' });
  await picker.getByRole('checkbox', { name: /^Palette$/ }).check();
  await picker.getByRole('button', { name: 'Add to board' }).click();
  await expect(picker).toBeHidden();
  const strip = tile(page).getByRole('group', { name: 'Properties of the selection' });
  await strip.getByRole('button', { name: 'Export swatches…' }).click();
  await expect(dialog(page)).toBeVisible();
  let downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  expect((await downloaded).suggestedFilename()).toBe('SC 01 palette.png');
  await expect(dialog(page)).toBeHidden();

  // A company with two brand colours, attached to the project, and its brand card.
  let panel = await openSettings(page, 'App');
  await panel.getByRole('button', { name: 'Add company' }).click();
  const company = panel.getByRole('list', { name: 'Company profiles' }).getByRole('group').first();
  await company.getByRole('textbox', { name: 'Name' }).fill('Zima Blue Pictures');
  await company.getByRole('textbox', { name: 'Brand colours' }).fill('#DF5E27 #16150F');
  await company.getByRole('textbox', { name: 'Brand colours' }).blur();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  await panel.getByRole('combobox', { name: 'Company', exact: true }).selectOption({ label: 'Zima Blue Pictures' });
  await panel.getByRole('button', { name: 'Attach', exact: true }).click();
  await closeSettings(page);
  await tile(page).getByRole('button', { name: 'Add from storyboard' }).click();
  await picker.getByRole('checkbox', { name: 'Brand kit' }).check();
  await picker.getByRole('button', { name: 'Add to board' }).click();
  await expect(picker).toBeHidden();
  await strip.getByRole('button', { name: 'Export swatches…' }).click();
  await dialog(page).getByRole('radio', { name: 'Swatches as .ase' }).click();
  downloaded = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Save…' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Zima Blue Pictures palette.ase');
  const ase = await bytesOf(download);
  expect(String.fromCharCode(...ase.slice(0, 4))).toBe('ASEF');
  expect(new DataView(ase.buffer, ase.byteOffset).getUint32(8)).toBe(4);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with the swatches Export dialog open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await oneFrame(page);
    await boardWithPictures(page);
    await linkToScene(page);
    await tile(page).getByRole('button', { name: 'Make palette from this board' }).click();
    await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
    await storyboard(page).locator('[data-shot-id]').first().click();
    await expect(swatches(page).first()).toBeVisible();
    await inspector(page).getByRole('button', { name: 'Export swatches…' }).click();
    await expect(dialog(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

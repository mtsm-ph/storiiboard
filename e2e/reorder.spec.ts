import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Dragging frames and notes to a new place, and the "/" menu (1.12), on real projects in the memory build.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  const newScene = page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' });
  await newScene.click();
  await newScene.click();
  for (let i = 0; i < 3; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 02' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const items = (page: Page, scene: string) => board(page).locator(`[aria-label="Frames in ${scene}"] [data-item-id]`);
const frames = (page: Page, scene: string) => board(page).locator(`[aria-label="Frames in ${scene}"] [data-shot-id]`);
const numbers = (page: Page, scene: string) => frames(page, scene).locator('[data-number]').allTextContents();
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

/** Presses on `from`, moves in steps and lets go over `to`, at a fraction of its width (0.2 is its left part). */
async function drag(page: Page, from: Locator, to: Locator, across = 0.2) {
  // The board may have scrolled to the last frame added.
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('not on screen');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 3);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width * across, end.y + end.height / 3, { steps: 8 });
  await page.mouse.up();
}

test('drags a frame to a new place, renumbering, and ⌘Z puts it back', async ({ page }) => {
  const last = frames(page, 'SC 01').nth(2);
  const id = await last.getAttribute('data-shot-id');
  await drag(page, last, frames(page, 'SC 01').nth(0));
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
  await expect(frames(page, 'SC 01').nth(0)).toHaveAttribute('data-shot-id', id ?? '');

  await page.keyboard.press(`${await command(page)}+z`);
  await expect(frames(page, 'SC 01').nth(2)).toHaveAttribute('data-shot-id', id ?? '');
});

test('drags a frame into another scene, numbering it there', async ({ page }) => {
  await drag(page, frames(page, 'SC 01').nth(1), frames(page, 'SC 02').nth(0), 0.8);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B']);
  await expect.poll(() => numbers(page, 'SC 02')).toEqual(['2A', '2B']);
});

test('Escape cancels a drag, and a press that doesn’t move is a click', async ({ page }) => {
  const first = frames(page, 'SC 01').nth(0);
  const id = await first.getAttribute('data-shot-id');
  await first.scrollIntoViewIfNeeded();
  const target = await frames(page, 'SC 01').nth(2).boundingBox();
  const box = await first.boundingBox();
  if (!box || !target) throw new Error('not on screen');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 10, target.y + 20, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(frames(page, 'SC 01').nth(0)).toHaveAttribute('data-shot-id', id ?? '');

  await frames(page, 'SC 01').nth(1).click();
  await expect(frames(page, 'SC 01').nth(1)).toHaveAttribute('aria-current', 'true');
});

test('the "/" menu inserts a note, written in place and saved when left', async ({ page }) => {
  await frames(page, 'SC 01').nth(0).focus();
  await page.keyboard.press('/');
  const menu = page.getByRole('combobox', { name: 'Insert' });
  await expect(menu).toBeFocused();
  await page.keyboard.type('no');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([/^Note/]);
  await page.keyboard.press('Enter');

  const field = board(page).getByRole('textbox', { name: 'Note' });
  await expect(field).toBeFocused();
  await page.keyboard.type('Rain starts on the glass');
  await page.keyboard.press(`${await command(page)}+Enter`);
  // The note sits after 1A and takes no number.
  await expect(items(page, 'SC 01').nth(1)).toContainText('Rain starts on the glass');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
  await expect(items(page, 'SC 01').nth(1)).toBeFocused();

  // Escape leaves an edit without saving it.
  await page.keyboard.press('Enter');
  await page.keyboard.type(' and stops');
  await page.keyboard.press('Escape');
  await expect(items(page, 'SC 01').nth(1)).toHaveText('NoteRain starts on the glass');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(items(page, 'SC 01').nth(1)).toContainText('Rain starts on the glass');
});

test('a note moves with ⌘ and an arrow, goes to the Trash with Delete, and comes back with ⌘Z', async ({ page }) => {
  await frames(page, 'SC 01').nth(0).focus();
  await page.keyboard.press('/');
  await page.keyboard.type('note');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Cut to black');
  await page.keyboard.press('Tab');
  const note = board(page).locator('[data-note-id]');
  await note.focus();
  const mod = await command(page);
  await page.keyboard.press(`${mod}+ArrowLeft`);
  await expect(items(page, 'SC 01').nth(0)).toHaveAttribute('data-note-id', /.+/);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);

  await note.focus();
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  await expect(note).toHaveCount(1);
});

test('the "/" menu inserts a frame after this one and a scene after this scene', async ({ page }) => {
  await frames(page, 'SC 01').nth(0).focus();
  await page.keyboard.press('/');
  await page.keyboard.press('Enter');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C', '1D']);
  await expect(frames(page, 'SC 01').nth(1)).toBeFocused();

  await page.keyboard.press('/');
  await page.keyboard.type('sc');
  await page.keyboard.press('Enter');
  // Between scenes 1 and 2, numbered as scripts do.
  await expect(board(page).getByRole('button', { name: '+ Frame in SC 1A' })).toBeFocused();
  await expect(board(page).locator('[data-scene-group] h3')).toHaveText([/^SC 01/, /^SC 1A/, /^SC 02/]);
});

test('the "/" menu sets the scene’s location, reusing one the project has', async ({ page }) => {
  await frames(page, 'SC 01').nth(0).click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Location for SC 01' })).toBeFocused();
  await page.keyboard.type('Penn Station');
  await expect(page.getByRole('option', { name: /New location “Penn Station”/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByText('Penn Station')).toBeVisible();

  await frames(page, 'SC 02').nth(0).click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('penn');
  // The project's own location comes first; a new one with what was typed is still offered.
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([/^Penn Station/, /^New location “penn”/]);
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByText('Penn Station')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the board with a note and the "/" menu open passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await frames(page, 'SC 01').nth(0).focus();
    await page.keyboard.press('/');
    await page.keyboard.type('note');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Rain');
    await page.keyboard.press('Tab');
    await frames(page, 'SC 01').nth(0).focus();
    await page.keyboard.press('/');
    await expect(page.getByRole('combobox', { name: 'Insert' })).toBeFocused();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

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
  await skipOnboarding(page);
  const newScene = page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' });
  await newScene.click();
  await newScene.click();
  for (let i = 0; i < 3; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 02' }).click();
  // Each new frame takes focus once it's saved; wait for the last, so it can't take focus back from a test's first
  // steps.
  await expect(frames(page, 'SC 02').nth(0)).toBeFocused();
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
  await expect(inspector(page).locator('span', { hasText: /^Penn Station$/ })).toBeVisible();

  await frames(page, 'SC 02').nth(0).click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('penn');
  // The project's own location comes first; a new one with what was typed is still offered.
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([/^Penn Station/, /^New location “penn”/]);
  await page.keyboard.press('Enter');
  await expect(inspector(page).locator('span', { hasText: /^Penn Station$/ })).toBeVisible();
});

test('⌘ with an arrow, pressed twice quickly, moves a frame two places', async ({ page }) => {
  const first = frames(page, 'SC 01').nth(0);
  const id = await first.getAttribute('data-shot-id');
  await first.focus();
  const mod = await command(page);
  await page.keyboard.press(`${mod}+ArrowRight`);
  await page.keyboard.press(`${mod}+ArrowRight`);
  await expect(frames(page, 'SC 01').nth(2)).toHaveAttribute('data-shot-id', id ?? '');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
});

test('a frame dropped on a scene’s heading goes to the start of that scene', async ({ page }) => {
  const id = await frames(page, 'SC 01').nth(1).getAttribute('data-shot-id');
  await drag(page, frames(page, 'SC 01').nth(1), board(page).getByRole('heading', { name: /^SC 02/ }), 0.1);
  await expect(frames(page, 'SC 02').nth(0)).toHaveAttribute('data-shot-id', id ?? '');
  await expect.poll(() => numbers(page, 'SC 02')).toEqual(['2A', '2B']);
});

test('in the shot list, a row dropped on any cell of another row lands there', async ({ page }) => {
  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  const rows = board(page).locator('[aria-label="Frames in SC 01"] tr', { has: page.locator('[data-shot-id]') });
  const last = rows.nth(2);
  const id = await last.locator('[data-shot-id]').getAttribute('data-shot-id');
  // Lifted by its shot number, the row's focus target, and let go over the first row's Move cell.
  await drag(page, last.locator('[data-shot-id]'), rows.nth(0).locator('td').nth(6), 0.5);
  await expect(frames(page, 'SC 01').nth(0)).toHaveAttribute('data-shot-id', id ?? '');
});

test('locking a scene whose letters are already on another scene’s slates says which frames it re-letters', async ({ page }) => {
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  await scenes.getByRole('button', { name: 'Lock shot numbers for SC 01' }).click();
  // Renumbered while locked, scene 1 becomes 9, and its frames keep 1A to 1C, the numbers on their slates.
  await frames(page, 'SC 01').nth(0).click();
  await inspector(page).getByLabel('Number', { exact: true }).fill('9');
  await inspector(page).getByLabel('Number', { exact: true }).press('Enter');
  await expect(frames(page, 'SC 09')).toHaveCount(3);
  // Scene 2, unlocked, becomes 1: its frame follows the board and reads 1A again.
  await frames(page, 'SC 02').nth(0).click();
  await inspector(page).getByLabel('Number', { exact: true }).fill('1');
  await inspector(page).getByLabel('Number', { exact: true }).press('Enter');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A']);
  // Locking it puts the numbers on slates, where 1A already is, so it's re-lettered, and the person is told.
  await scenes.getByRole('button', { name: 'Lock shot numbers for SC 01' }).click();
  await expect(page.getByText('Locked SC 01. To keep slate numbers unique, 1A is now 1D.')).toBeVisible();
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1D']);
  expect(await numbers(page, 'SC 09')).toEqual(['1A', '1B', '1C']);
});

test('a frame stays in a scene whose numbers are locked, and the board says why', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Lock shot numbers for SC 01' }).click();
  await drag(page, frames(page, 'SC 01').nth(1), frames(page, 'SC 02').nth(0), 0.8);
  await expect(page.getByText('This scene’s shot numbers are locked, so its frames stay in it.', { exact: false })).toBeVisible();
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
});

test('focus stays on the board when the frame before a note goes to the Trash, and a click outside closes the menu', async ({ page }) => {
  await frames(page, 'SC 01').nth(0).focus();
  await page.keyboard.press('/');
  await page.keyboard.type('note');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Rain');
  await page.keyboard.press(`${await command(page)}+Enter`);
  // ⌘Enter puts focus back on the note once it's drawn; wait for that before moving on.
  await expect(board(page).locator('[data-note-id]')).toBeFocused();
  await frames(page, 'SC 01').nth(0).focus();
  await page.keyboard.press('Delete');
  // The note that came next takes focus.
  await expect(board(page).locator('[data-note-id]')).toBeFocused();

  await page.keyboard.press('/');
  await expect(page.getByRole('combobox', { name: 'Insert' })).toBeFocused();
  await board(page).getByRole('heading', { name: /^SC 02/ }).click();
  await expect(page.getByRole('combobox', { name: 'Insert' })).toHaveCount(0);
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

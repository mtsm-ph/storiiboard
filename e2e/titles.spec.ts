import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Titles edited in place (Nov 5): a pencil beside every scene name and frame title, shown on hover and on keyboard
// focus. A click (or F2 on a frame) makes the text a field; Enter saves, Escape puts it back; each save is one undo.

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
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a scene’s name, from its heading on the board: Enter saves, Escape puts it back, one undo takes it back', async ({ page }) => {
  const heading = board(page).getByRole('heading', { name: /^SC 01/ });
  const pencil = board(page).getByRole('button', { name: 'Edit name of SC 01' });
  // Hidden until wanted: the heading's name stays the scene's, without the pencil in it.
  await expect(heading).toHaveAccessibleName(/^SC 01 Untitled/);
  await expect(pencil).toHaveCSS('opacity', '0');
  await heading.hover();
  await expect(pencil).toHaveCSS('opacity', '1');

  await pencil.click();
  const field = board(page).getByRole('textbox', { name: 'name of SC 01' });
  await expect(field).toBeFocused();
  await field.fill('Penn Station');
  await field.press('Escape');
  await expect(heading).toHaveAccessibleName(/^SC 01 Untitled/);
  await expect(pencil).toBeFocused();

  await page.keyboard.press('Enter');
  await field.fill('Penn Station');
  await field.press('Enter');
  await expect(heading).toHaveAccessibleName(/^SC 01 Penn Station/);
  await expect(page.getByRole('navigation', { name: 'Sections' })).toContainText('Penn Station');
  await page.keyboard.press(await undoKey(page));
  await expect(heading).toHaveAccessibleName(/^SC 01 Untitled/);
});

test('a frame’s title: F2 on the frame, or its pencil, the next Tab stop; it shows on the card and in the inspector', async ({ page }) => {
  await frames(page).nth(0).click();
  await page.keyboard.press('F2');
  const field = board(page).getByRole('textbox', { name: 'title of 1A' });
  await expect(field).toBeFocused();
  await field.fill('Mary wipes the counter');
  await field.press('Enter');
  await expect(frames(page).nth(0).locator('[data-frame-title]')).toHaveText('Mary wipes the counter');
  await expect(frames(page).nth(0)).toBeFocused();
  await expect(inspector(page).locator('header')).toContainText('Mary wipes the counter');

  // From the keyboard alone: the frame, then Tab to its pencil, shown as it takes focus.
  await frames(page).nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(frames(page).nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  const pencil = board(page).getByRole('button', { name: 'Edit title of 1B' });
  await expect(pencil).toBeFocused();
  await expect(pencil).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await board(page).getByRole('textbox', { name: 'title of 1B' }).fill('Jay comes in');
  await page.keyboard.press('Escape');
  await expect(frames(page).nth(1).locator('[data-frame-title]')).toHaveCount(0);

  // An emptied title is taken off; one undo brings it back.
  await frames(page).nth(0).focus();
  await page.keyboard.press('F2');
  await field.fill('');
  await field.press('Enter');
  await expect(frames(page).nth(0).locator('[data-frame-title]')).toHaveCount(0);
  await page.keyboard.press(await undoKey(page));
  await expect(frames(page).nth(0).locator('[data-frame-title]')).toHaveText('Mary wipes the counter');
});

test('the inspector’s header and the Scenes tile edit the same titles in place', async ({ page }) => {
  await frames(page).nth(1).click();
  await inspector(page).getByRole('button', { name: 'Edit title of 1B' }).click();
  await inspector(page).getByRole('textbox', { name: 'title of 1B' }).fill('Wide on the dock');
  await page.keyboard.press('Enter');
  await expect(frames(page).nth(1).locator('[data-frame-title]')).toHaveText('Wide on the dock');

  await scenesTile(page).getByRole('button', { name: 'Edit name of SC 01' }).click();
  const field = scenesTile(page).getByRole('textbox', { name: 'name of SC 01' });
  await field.fill('Diner');
  await field.press('Enter');
  await expect(scenesTile(page).locator('[data-scene-row]')).toContainText('Diner');
  await expect(scenesTile(page).locator('[data-scene-row]')).toBeFocused();
  await expect(board(page).getByRole('heading', { name: /^SC 01 Diner/ })).toBeVisible();
});

test('the board with titles and their pencils passes axe', async ({ page }) => {
  await frames(page).nth(0).click();
  await page.keyboard.press('F2');
  await page.keyboard.type('Mary wipes the counter');
  await page.keyboard.press('Enter');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
});

test('leaving a field by a click keeps focus where the click went, and Escape in the inspector saves nothing', async ({ page }) => {
  // Click away from a frame's title field: the inspector's Action box keeps focus, so typing goes there.
  await frames(page).nth(0).click();
  await page.keyboard.press('F2');
  await board(page).getByRole('textbox', { name: 'title of 1A' }).fill('Wide');
  await inspector(page).getByLabel('Action').click();
  await expect(inspector(page).getByLabel('Action')).toBeFocused();
  await expect(frames(page).nth(0).locator('[data-frame-title]')).toHaveText('Wide');

  // Escape in the inspector's title field puts it back, saving nothing.
  await inspector(page).getByRole('button', { name: 'Edit title of 1A' }).click();
  await inspector(page).getByRole('textbox', { name: 'title of 1A' }).fill('Half typed');
  await page.keyboard.press('Escape');
  await expect(frames(page).nth(0).locator('[data-frame-title]')).toHaveText('Wide');

  // And Escape in Action puts its text back too, before the inspector goes back to the board.
  await inspector(page).getByLabel('Action').fill('Mary sits');
  await page.keyboard.press('Escape');
  await frames(page).nth(0).click();
  await expect(inspector(page).getByLabel('Action')).toHaveValue('');
});

test('a picture dropped on a card’s corner, where its pencil is, sets that frame’s picture', async ({ page }) => {
  const card = frames(page).nth(0);
  const pencil = board(page).getByRole('button', { name: 'Edit title of 1A' });
  const data = [...readFileSync(new URL('./fixtures/images/srgb.jpg', import.meta.url))];
  const transfer = await page.evaluateHandle((bytes) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(bytes)], 'corner.jpg', { type: 'image/jpeg' }));
    return t;
  }, data);
  await pencil.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(card.locator('img[data-frame-image]')).toBeVisible();
  await expect(frames(page)).toHaveCount(2);
});

test('the board stays one Tab stop: only the heading of the scene holding it has its pencil in the Tab order', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await expect(board(page).getByRole('button', { name: 'Edit name of SC 01' })).toHaveAttribute('tabindex', '0');
  await expect(board(page).getByRole('button', { name: 'Edit name of SC 02' })).toHaveAttribute('tabindex', '-1');
});

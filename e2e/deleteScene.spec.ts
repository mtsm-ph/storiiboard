import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Delete scene (polish 5) in the memory build: from the Scenes tile or the sidebar, a whole scene and its frames go to
// the Trash in one step. Undo or Restore brings them back; no confirm, since nothing is lost.

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
  for (let i = 0; i < 3; i += 1) await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await sidebar(page).getByRole('button', { name: /^SC 02/ }).click();
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 02' }).click();
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const trashTile = (page: Page) => page.getByRole('region', { name: 'Trash', exact: true });
const rows = (page: Page) => scenesTile(page).getByRole('list', { name: 'Scenes' }).locator('[data-scene-row]');
const sidebarScenes = (page: Page) => sidebar(page).locator('[data-sidebar-scene]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function openTrash(page: Page) {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(trashTile(page)).toBeVisible();
}

test('the Scenes tile’s delete button sends a scene and its frames to the Trash, and Restore brings them back', async ({ page }) => {
  await expect(rows(page)).toHaveCount(3);
  await scenesTile(page).getByRole('button', { name: 'Delete scene SC 02' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('status').getByText('Deleted SC 02 and its 2 frames to the Trash.', { exact: false })).toBeVisible();
  // The active scene moves to the one that took its place, in the tile and the sidebar.
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(sidebar(page).getByRole('button', { name: /^SC 03/ })).toHaveAttribute('aria-current', 'true');
  await expect(sidebar(page).getByRole('button', { name: /^SC 02/ })).toHaveCount(0);

  await openTrash(page);
  // One row for the scene, its frames in it, not three.
  await expect(trashTile(page).getByRole('row')).toHaveCount(2);
  await expect(trashTile(page).getByRole('row', { name: /SC 02/ })).toContainText('2 frames');
  await trashTile(page).getByRole('button', { name: /^Restore scene SC 02/ }).click();
  await expect(rows(page)).toHaveCount(3);
  await sidebar(page).getByRole('button', { name: /^SC 02/ }).click();
  await expect(board(page).locator('[data-shot-id] [data-number]')).toHaveText(['2A', '2B']);
});

test('Delete on a focused scene row deletes it, focus moves to the next scene, and one undo brings it all back', async ({ page }) => {
  await rows(page).nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(rows(page)).toHaveCount(2);
  // The scene that took its place has focus, so Delete again carries on down the list.
  await expect(rows(page).nth(1)).toBeFocused();
  await expect(rows(page).nth(1)).toContainText('03');

  await page.keyboard.press(await undoKey(page));
  await expect(rows(page)).toHaveCount(3);
  await sidebar(page).getByRole('button', { name: /^SC 02/ }).click();
  await expect(board(page).locator('[data-shot-id] [data-number]')).toHaveText(['2A', '2B']);
});

test('one delete per press and per click: a held key or a double-click never runs on into the next scene', async ({ page }) => {
  await rows(page).first().focus();
  // A second keydown without a keyup is the key held down (Playwright marks it as a repeat).
  await page.keyboard.down('Delete');
  await expect(rows(page)).toHaveCount(2);
  // Focus is on the next scene by now, so a repeat that got through would delete it.
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.down('Delete');
  await page.keyboard.up('Delete');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('status').getByText('Deleted SC 01', { exact: false })).toBeVisible();

  // A double-click's second click lands where the first did, on SC 03's bin once the list has closed up under it.
  const bin = scenesTile(page).getByRole('button', { name: 'Delete scene SC 02' });
  const box = await bin.boundingBox();
  if (!box) throw new Error('no bin');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(rows(page)).toHaveCount(1);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('03');

  // Backspace, a Mac's delete key, deletes too.
  await rows(page).first().focus();
  await page.keyboard.press('Backspace');
  await expect(rows(page)).toHaveCount(0);
});

test('a scene with no frames says so, and the last scene gone leaves focus on + New scene', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: /^SC 03/ }).click();
  await scenesTile(page).getByRole('button', { name: 'Delete scene SC 03' }).click();
  await expect(page.getByRole('status').getByText('Deleted SC 03 to the Trash.', { exact: false })).toBeVisible();
  // The last scene gone, the one above takes its place, in the tile and the sidebar.
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows(page).nth(1)).toContainText('02');
  await scenesTile(page).getByRole('button', { name: 'Delete scene SC 02' }).click();
  await rows(page).first().focus();
  await page.keyboard.press('Delete');
  await expect(rows(page)).toHaveCount(0);
  await expect(scenesTile(page).getByRole('button', { name: '+ New scene' })).toBeFocused();
});

test('Delete on a scene in the sidebar deletes it and keeps focus in the sidebar', async ({ page }) => {
  await expect(sidebarScenes(page)).toHaveCount(3);
  await sidebar(page).getByRole('button', { name: /^SC 01/ }).focus();
  await page.keyboard.press('Delete');
  await expect(sidebarScenes(page)).toHaveCount(2);
  await expect(sidebar(page).getByRole('button', { name: /^SC 02/ })).toBeFocused();
  await expect(rows(page)).toHaveCount(2);

  // A new scene never takes a deleted one's number, so Restore has it to come back to.
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await expect(sidebar(page).getByRole('button', { name: /^SC 01/ })).toHaveCount(0);
});

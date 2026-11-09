import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Notifications (3.10) in the memory build: steps made under another name are unread for whoever reads next; the status
// bar counts them (only while there are some) and opens the tile; a step opened is read, Mark all read reads the rest; your own steps are never
// unread; read state stays with the file.

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
});

const count = (page: Page) => page.locator('[data-unread-count]');
const tile = (page: Page) => page.getByRole('region', { name: 'Notifications', exact: true });

async function signAs(page: Page, name: string) {
  const profile = await openSettings(page, 'Profile');
  await profile.getByLabel('Your name').fill(name);
  await profile.getByLabel('Your name').press('Enter');
  await closeSettings(page);
}

test('steps by someone else are unread; opened, they’re read; Mark all read; your own never are; kept with the file', async ({ page }) => {
  // Sam makes two steps.
  await signAs(page, 'Sam Ortiz');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(count(page)).toHaveCount(0);

  // Kevin reads: Sam's steps (and the project's first, made before any name) are unread.
  await signAs(page, 'Kevin Matos');
  await expect(count(page)).toBeVisible();
  const before = Number((await count(page).textContent())?.split(' ')[0]);
  expect(before).toBeGreaterThanOrEqual(2);

  // The status bar opens the tile, focus inside it.
  await count(page).click();
  await expect(tile(page)).toBeVisible();
  await expect(tile(page).getByRole('radio', { name: 'All' })).toBeFocused();
  const list = tile(page).getByRole('list', { name: 'Notifications, newest first' });
  const newest = list.getByRole('button').first();
  await expect(newest).toContainText('Sam Ortiz');
  await expect(newest).toHaveAccessibleName(/^Unread:/);

  // Opened, a step is read, and picks what it changed.
  await newest.click();
  await expect(count(page)).toHaveText(`${String(before - 1)} unread`);
  await expect(newest).not.toHaveAccessibleName(/^Unread:/);
  await expect(count(page)).toHaveAccessibleName(`${String(before - 1)} unread: open Notifications`);

  // Unread alone, then This scene.
  await tile(page).getByRole('radio', { name: 'Unread' }).click();
  await expect(list.getByRole('button')).toHaveCount(before - 1);
  await tile(page).getByRole('radio', { name: 'This scene' }).click();
  // The scene's two steps: the scene added, and its frame.
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('button').first()).toContainText('Added frame 1A');
  const results = await new AxeBuilder({ page }).include('[aria-label="Notifications"]').analyze();
  expect(results.violations).toEqual([]);

  // Mark all read.
  await tile(page).getByRole('radio', { name: 'Unread' }).click();
  await tile(page).getByRole('button', { name: 'Mark all read' }).click();
  await expect(count(page)).toHaveCount(0);
  await expect(tile(page)).toContainText('Nothing unread.');

  // Kevin's own step is never unread.
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(count(page)).toHaveCount(0);

  // Kept with the file: still read after a reload.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(count(page)).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The smoke set (Kevin, Nov 4): the one path every build must get through, run at each checkpoint on Linux and in
// WebKit on the CI Mac (.github/workflows/checkpoint.yml). Create, open, add a scene and frames, undo, save and
// reopen. The other specs go deeper and run locally with `npm run e2e`.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const scenes = (page: Page) => sidebar(page).getByRole('list', { name: 'Scenes' }).getByRole('button', { name: /^SC/ });
const grid = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const numbers = (page: Page, scene: string) =>
  grid(page).locator(`[aria-label="Frames in ${scene}"] [data-shot-id] [data-number]`).allTextContents();
const undoKey = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z');

test('creates a project, adds a scene and frames, undoes, and reopens it as it was saved', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();

  await sidebar(page).getByRole('button', { name: '+ Add Scene' }).click();
  await expect(scenes(page)).toHaveText([/SC 01/]);
  const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
  for (let i = 0; i < 3; i += 1) await add.click();
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);

  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B']);

  // Every edit is saved as it lands; reloading is the app restarting, and the project waits in Recent.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(scenes(page)).toHaveText([/SC 01/]);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B']);

  // Undo carries on across the reopen, from the file's own history.
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A']);
});

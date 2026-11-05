import { expect, test, type Page } from '@playwright/test';
import { INTRODUCED_KEY, LAYOUTS_KEY } from '../src/app/shell/docking/layoutStore';
import { SETTINGS_KEY } from '../src/core/storage/settings';

// Settings → App (polish 1): the app's language is the person's, saved with their settings, and every word comes
// from the translation files. English is the only language until the Spanish milestone.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

const settingsWorkspace = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('region', { name: 'Settings workspace' });
};

test('Settings has an App language, English by default, kept across a restart', async ({ page }) => {
  let settings = await settingsWorkspace(page);
  await settings.getByRole('tab', { name: 'App' }).click();
  const language = () => settings.getByRole('combobox', { name: 'App language' });
  await expect(language()).toHaveValue('en');
  await expect(language().getByRole('option')).toHaveText(['English']);
  await language().selectOption('en');
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown, SETTINGS_KEY)).toMatchObject({ language: 'en' });

  await page.reload();
  settings = await settingsWorkspace(page);
  await settings.getByRole('tab', { name: 'App' }).click();
  await expect(language()).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('a language this version doesn’t have opens in English', async ({ page }) => {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({ language: 'xx' }));
  }, SETTINGS_KEY);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Storyboard' })).toBeVisible();
  const settings = await settingsWorkspace(page);
  await settings.getByRole('tab', { name: 'App' }).click();
  await expect(settings.getByRole('combobox', { name: 'App language' })).toHaveValue('en');
});

test('the App tile joins a Settings layout saved before it, once, as a tab beside Project', async ({ page }) => {
  // Settings as it was saved before polish 1: Project, Theme, then Backups and Storage.
  const before = {
    root: {
      kind: 'split',
      id: 'split-old',
      direction: 'row',
      sizes: [0.3, 0.4, 0.3],
      children: [
        { kind: 'stack', id: 'stack-a', tiles: ['project'], active: 'project' },
        { kind: 'stack', id: 'stack-b', tiles: ['theme'], active: 'theme' },
        { kind: 'stack', id: 'stack-c', tiles: ['backups', 'storage'], active: 'backups' },
      ],
    },
    maximized: null,
  };
  await page.evaluate(
    ([key, introduced, layout]) => {
      // As an install from before polish 1 left it: its own layout, and no tile introduced yet.
      window.localStorage.setItem(key, JSON.stringify({ settings: { current: layout, saved: layout } }));
      window.localStorage.removeItem(introduced);
    },
    [LAYOUTS_KEY, INTRODUCED_KEY, before] as const,
  );
  await page.reload();
  const settings = await settingsWorkspace(page);
  await expect(settings.getByRole('tab', { name: 'App' })).toBeVisible();
  // Project stays the open tab; the layout looks as it did until App is picked.
  await expect(settings.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true');

  // And it's there on the next launch too, with nothing moved meanwhile.
  await page.reload();
  await expect((await settingsWorkspace(page)).getByRole('tab', { name: 'App' })).toBeVisible();
});

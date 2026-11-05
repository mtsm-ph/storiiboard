import { expect, test } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';
import { openSettings } from './settings';

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

test('Settings has an App language, English by default, kept across a restart', async ({ page }) => {
  const language = (await openSettings(page, 'App')).getByRole('combobox', { name: 'App language' });
  await expect(language).toHaveValue('en');
  await expect(language.getByRole('option')).toHaveText(['English']);
  await language.selectOption('en');
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown, SETTINGS_KEY)).toMatchObject({ language: 'en' });

  await page.reload();
  await expect((await openSettings(page, 'App')).getByRole('combobox', { name: 'App language' })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('a language this version doesn’t have opens in English', async ({ page }) => {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({ language: 'xx' }));
  }, SETTINGS_KEY);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ })).toBeVisible();
  await expect((await openSettings(page, 'App')).getByRole('combobox', { name: 'App language' })).toHaveValue('en');
});

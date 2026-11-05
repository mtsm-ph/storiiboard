import { expect, test } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';
import { openSettings } from './settings';

// Settings → App (polish 1): the app's language is the person's, saved with their settings, and every word comes
// from the translation files. English and Latin American Spanish (polish 7).

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
  await expect(language.getByRole('option')).toHaveText(['English', 'Español (Latinoamérica)']);
  await language.selectOption('en');
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown, SETTINGS_KEY)).toMatchObject({ language: 'en' });

  await page.reload();
  await expect((await openSettings(page, 'App')).getByRole('combobox', { name: 'App language' })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('picking Español in Settings switches the open app at once, and English switches it back (polish 7)', async ({ page }) => {
  const language = (await openSettings(page, 'App')).getByRole('combobox', { name: 'App language' });
  await language.selectOption('es');
  // The window itself, its tabs and the app behind it, without a reload.
  const ajustes = page.getByRole('dialog', { name: 'Configuración' });
  await expect(ajustes.getByRole('tab', { name: 'Respaldos' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-419');
  await page.keyboard.press('Escape');
  const sections = page.getByRole('navigation', { name: 'Secciones' });
  await expect(sections.getByRole('button', { name: /^Recursos/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Escenas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Disposición/ }).click();
  await expect(page.getByRole('button', { name: 'Volver a la disposición guardada' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Back to English, kept across a restart.
  await page.getByRole('button', { name: /^Configuración \(/ }).click();
  await ajustes.getByRole('tab', { name: 'App', exact: true }).click();
  await ajustes.getByRole('combobox', { name: 'Idioma de la app' }).selectOption('en');
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Backups' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Assets/ })).toBeVisible();
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

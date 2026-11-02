import { expect, test } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';

test('follows the OS until a theme is picked, then remembers it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // Native parts (scrollbars, select menus) follow the theme too.
  expect(await html.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');

  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await html.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('radio', { name: 'System' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('sets the theme before the app itself loads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  // Block the app bundle: theme-boot.js alone has to get the theme right, or the window flashes paper.
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('applies a saved theme before the app loads, even against the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({ theme: 'light' }));
  }, SETTINGS_KEY);
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

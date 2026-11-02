import { expect, test } from '@playwright/test';

test('app shell loads with its heading and offline fonts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Storiiboard' })).toBeVisible();

  // Fonts must come from the bundle, never a CDN, so the app reads the same on set with no signal.
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:1420')) external.push(r.url());
  });
  await page.reload();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  expect(external).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('app shell loads with its heading and bundled fonts', async ({ page }) => {
  // Fonts must come from the bundle, never a CDN, so the app reads the same on set with no signal.
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://localhost:1420')) external.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Storiiboard' })).toBeAttached();
  // Landmarks let screen-reader users jump between the top bar, the sidebar, the tiles and the status bar.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replace(/"/g, ''));
  });
  expect(loaded).toEqual(expect.arrayContaining(['Inter Tight', 'JetBrains Mono']));
  expect(external).toEqual([]);
});

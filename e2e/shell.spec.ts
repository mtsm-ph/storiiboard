import { expect, test } from '@playwright/test';

test('app shell loads with its heading and bundled fonts', async ({ page, baseURL }) => {
  // Fonts must come from the bundle, never a CDN, so the app reads the same on set with no signal. The app's own
  // origin is the config's, so the test holds on whatever port the dev server runs.
  const own = new URL(baseURL ?? 'http://localhost:1420').origin;
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== own) external.push(request.url());
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

// The accent belongs to the theme and the logo's orange to the brand (DESIGN.md, Colour), so a project theme can
// change one without the other.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the active section uses the theme accent, and the logo keeps Signal Orange (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    const section = page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ });
    expect(await section.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(223, 94, 39)');
    const dot = page.getByRole('banner').locator('svg circle').first();
    expect(await dot.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(224, 97, 43)');
  });
}

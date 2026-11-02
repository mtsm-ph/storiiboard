import { expect, test } from '@playwright/test';

// Baselines are per browser and per OS (fonts render differently), so each platform keeps its own set.
test.use({ viewport: { width: 1440, height: 900 } });

for (const scheme of ['light', 'dark'] as const) {
  test(`shell, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page).toHaveScreenshot(`shell-${scheme}.png`, { animations: 'disabled' });
  });
}

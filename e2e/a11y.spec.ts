import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// axe checks roles, names, labels and text contrast against WCAG 2.2 A and AA, in both themes and both engines.
const VIEWS: { name: string; path: string; ready: (page: Page) => Locator }[] = [
  { name: 'app shell', path: '/', ready: (page) => page.getByRole('navigation', { name: 'Sections' }) },
  { name: 'UI catalogue', path: '/#catalogue', ready: (page) => page.getByRole('heading', { name: 'UI catalogue' }) },
];

for (const view of VIEWS) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${view.name} passes axe (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(view.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(view.ready(page)).toBeVisible();
      // Contrast is measured on rendered text, so wait for the bundled fonts first.
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      // Rule ids and selectors make a failure readable without opening the trace.
      expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
    });
  }
}

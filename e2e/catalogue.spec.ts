import { expect, test } from '@playwright/test';

// Keyboard behaviour of the src/ui primitives, driven through the dev-only catalogue page.
test.beforeEach(async ({ page }) => {
  await page.goto('/#catalogue');
  await expect(page.getByRole('heading', { name: 'UI catalogue' })).toBeVisible();
});

test('segmented control moves selection with the arrow keys', async ({ page }) => {
  const group = page.getByRole('radiogroup', { name: 'Int / Ext' });
  await group.getByRole('radio', { name: 'Int', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const ext = group.getByRole('radio', { name: 'Ext', exact: true });
  await expect(ext).toBeChecked();
  await expect(ext).toBeFocused();
});

// Keyboard focus always lands on the selected segment, which is ink-filled, so an ink ring there would vanish.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the focused segment shows a ring that differs from its fill (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    const group = page.getByRole('radiogroup', { name: 'Int / Ext' });
    await group.getByRole('radio', { name: 'Int', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    const ext = group.getByRole('radio', { name: 'Ext', exact: true });
    await expect(ext).toBeFocused();
    const style = await ext.evaluate((el) => ({
      visible: el.matches(':focus-visible'),
      ring: getComputedStyle(el).outlineColor,
      fill: getComputedStyle(el).backgroundColor,
    }));
    expect(style.visible).toBe(true);
    expect(style.ring).not.toBe(style.fill);
  });
}

test('toggle flips with Space', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: 'Snap tiles to edges' });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
});

test('slider steps through T-stops and reads them out', async ({ page }) => {
  const slider = page.getByRole('slider', { name: 'T-stop' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', 'T2.8');
  await expect(page.locator('output')).toHaveText('T2.8');
});

test('tile tabs move with the arrow keys', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Storyboard tabs' });
  await tabs.getByRole('tab', { name: 'SC 04' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'SC 05' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Open tab: SC 05')).toBeVisible();
});

test('lists all 68 plan icons', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Plan icons (68)' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(68);
});

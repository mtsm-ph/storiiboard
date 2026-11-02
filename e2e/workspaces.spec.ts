import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('workspace tabs switch by click, arrow keys and Alt+1 to Alt+4', async ({ page }) => {
  const tabs = page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab');
  await expect(tabs).toHaveText(['Storyboard', 'Production', "Bird's-eye", 'Call sheet']);
  await expect(page.getByRole('tab', { name: 'Storyboard' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Call sheet' }).click();
  await expect(page.getByRole('region', { name: 'Shoot days' })).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  const birdsEye = page.getByRole('tab', { name: "Bird's-eye" });
  await expect(birdsEye).toBeFocused();
  await expect(birdsEye).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Set plan' })).toBeVisible();

  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('tab', { name: 'Production' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Moodboard' })).toBeVisible();
  await expect(page.getByText('Workspace: Production')).toBeVisible();
});

test('Alt+number moves keyboard focus to the new workspace tab', async ({ page }) => {
  // Focus inside a tile: the switch unmounts that tile, so focus must not drop to <body>.
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('tab', { name: "Bird's-eye" })).toBeFocused();
  // Focus on the tabs follows the selection.
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('tab', { name: 'Production' })).toBeFocused();
  // The workspace already open: nothing unmounts, so focus stays where it is.
  await page.getByRole('button', { name: 'Maximize Gear' }).focus();
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('button', { name: 'Maximize Gear' })).toBeFocused();
});

// Paper ink on orange is 2.9:1, under the 3:1 a focus ring needs, so the ring on the active tab stays ink.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the orange workspace tab keeps an ink focus ring (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    const storyboard = page.getByRole('tab', { name: 'Storyboard' });
    await storyboard.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await expect(storyboard).toBeFocused();
    const style = await storyboard.evaluate((el) => ({
      visible: el.matches(':focus-visible'),
      ring: getComputedStyle(el).outlineColor,
    }));
    expect(style.visible).toBe(true);
    expect(style.ring).toBe('rgb(22, 21, 15)');
  });
}

test('a tile maximizes to fill the workspace and restores', async ({ page }) => {
  await page.getByRole('button', { name: 'Maximize Storyboard' }).click();
  await expect(page.getByRole('region', { name: 'Scenes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore Storyboard' }).click();
  await expect(page.getByRole('region', { name: 'Scenes' })).toBeVisible();
});

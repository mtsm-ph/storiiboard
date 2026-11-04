import { expect, test } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Baselines are per browser and per OS (fonts render differently), so each platform keeps its own set.
test.use({ viewport: { width: 1440, height: 900 } });

// Suppressed while the UI is still changing (Kevin, Nov 3): kept, not deleted, and skipped unless SB_VISUAL=1, so CI
// and the local gate don't need new baselines for every change. CI's baseline update run sets it.
test.skip(!process.env.SB_VISUAL, 'Screenshot tests are suppressed until the UI is ready to test properly');

for (const scheme of ['light', 'dark'] as const) {
  test(`shell, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page).toHaveScreenshot(`shell-${scheme}.png`, { animations: 'disabled' });
  });
}

// The board with a project open (the memory build): scene groups, frame cards and a selected frame, so a change to
// how frames draw shows up here.
for (const scheme of ['light', 'dark'] as const) {
  test(`board, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/?files=memory');
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.reload();
    page.once('dialog', (dialog) => void dialog.accept('Bey County'));
    await page.getByRole('button', { name: 'New project…' }).click();
    await skipOnboarding(page);
    const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
    await scenes.getByRole('button', { name: '+ New scene' }).click();
    await scenes.getByRole('button', { name: '+ New scene' }).click();
    const board = page.getByRole('region', { name: 'Storyboard', exact: true });
    for (let i = 0; i < 3; i += 1) await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
    await board.getByRole('button', { name: '+ Frame in SC 02' }).click();
    await board.locator('[data-shot-id]').nth(1).click();
    // Nothing focused, so the picture shows the selection, not a focus ring; and the board scrolled to the top,
    // since adding SC 02's frame scrolled it to keep that frame in view.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.querySelector('[data-board]')?.parentElement?.scrollTo(0, 0);
    });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page).toHaveScreenshot(`board-${scheme}.png`, { animations: 'disabled' });
  });
}

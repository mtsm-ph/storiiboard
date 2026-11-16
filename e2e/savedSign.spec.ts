import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { settingsWindow } from './settings';

// The status bar's "Saved" sign (6.5.4) in the memory build: the time of the last change and of the newest backup.
// The page's clock is fixed, so each time is known; British English and London's zone (UTC in November) make the
// times read "14:32" on every computer.

test.use({ locale: 'en-GB', timezoneId: 'Europe/London' });

const at = (time: string) => new Date(`2026-11-16T${time}:00Z`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(at('09:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

const sign = (page: Page) => page.getByRole('contentinfo').locator('[data-saved-sign]');
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('shows the time of each change, undo included, and not of a layout or theme change', async ({ page }) => {
  // A new project: its file is written outside the log, so there's no op to give a time, and it has no backup yet.
  await expect(sign(page)).toHaveText('Saved · No backup yet');

  await page.clock.setFixedTime(at('14:32'));
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await expect(board(page).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
  await expect(sign(page)).toHaveText('Saved 14:32 · No backup yet');
  await expect(sign(page)).toHaveAccessibleName('Saved 14:32 · No backup yet');
  await expect(sign(page)).toHaveAccessibleDescription(/^Saved at 14:32\. No backup yet\. /);

  // Undo is a change too.
  await page.clock.setFixedTime(at('14:36'));
  await board(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(await undoKey(page));
  await expect(board(page).getByRole('button', { name: '+ Frame in SC 01' })).toHaveCount(0);
  await expect(sign(page)).toHaveText('Saved 14:36 · No backup yet');

  // A layout change and a theme change are not project changes.
  await page.clock.setFixedTime(at('14:50'));
  await page.getByRole('button', { name: 'Close Frame inspector' }).click();
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true })).toHaveCount(0);
  await page.getByRole('contentinfo').getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(sign(page)).toHaveText('Saved 14:36 · No backup yet');

  // The next morning, the day is read again when the window comes back (an event, not a timer): the time gets its date.
  await page.clock.setFixedTime(new Date('2026-11-17T09:00:00Z'));
  await expect(sign(page)).toHaveText('Saved 14:36 · No backup yet');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(sign(page)).toHaveText('Saved 16 Nov 14:36 · No backup yet');
  await expect(sign(page)).toHaveAccessibleDescription(/^Saved on 16 Nov at 14:36\. No backup yet\. /);
});

test('says what it means on keyboard focus, opens Settings → Backups, and shows a backup made there', async ({ page }) => {
  await page.clock.setFixedTime(at('14:32'));
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await expect(sign(page)).toHaveText('Saved 14:32 · No backup yet');

  const tip = page.locator('[data-saved-tip]');
  await expect(tip).toHaveCount(0);
  // Focus from the keyboard (:focus-visible) shows it, as the tool strip's tooltips.
  await sign(page).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tip).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(sign(page)).toBeFocused();
  await expect(tip).toHaveText(
    'Saved at 14:32. No backup yet.Every change is saved at once; a backup is made every 5 minutes when the project has changed.',
  );
  // Its time in JetBrains Mono, as every technical value.
  await expect(tip.locator('.font-mono')).toHaveText('14:32');
  await expect(sign(page)).toHaveAccessibleDescription(
    'Saved at 14:32. No backup yet. Every change is saved at once; a backup is made every 5 minutes when the project has changed.',
  );
  // Escape hides it, as every tooltip of the app.
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  await sign(page).click();
  const settings = settingsWindow(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Backups', exact: true })).toHaveAttribute('aria-selected', 'true');
  const backups = settings.getByRole('tabpanel', { name: 'Backups', exact: true });

  await page.clock.setFixedTime(at('14:40'));
  await backups.getByRole('button', { name: 'Back up now' }).click();
  await expect(backups.getByRole('status')).toContainText('Backed up at');
  await expect(sign(page)).toHaveText('Saved 14:32 · Backup 14:40');
  await expect(sign(page)).toHaveAccessibleDescription(/^Saved at 14:32\. Last backup at 14:40\. /);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the status bar with the sign passes axe, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
    await expect(sign(page)).toHaveText(/^Saved 09:00 · /);
    await sign(page).hover();
    await expect(page.locator('[data-saved-tip]')).toBeVisible();
    const axe = () => new AxeBuilder({ page }).include('footer').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect((await axe()).violations).toEqual([]);

    // "Not saved", drawn by setting the store's flag in the page, as a commit that failed sets it.
    await page.evaluate(async () => {
      const url = '/src/app/projectStore.ts';
      const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
      projectStore.setState({ saveFailed: 'The disk is full.' });
    });
    await expect(sign(page)).toHaveText(/^Not saved · /);
    await expect(sign(page)).toHaveAttribute('data-saved-sign', 'failed');
    await expect(page.locator('[data-saved-tip]')).toContainText('Not saved: The disk is full.');
    expect((await axe()).violations).toEqual([]);
  });
}

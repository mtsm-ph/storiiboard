import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// A shoot day's own history (Kevin, Nov 18) in the memory build: opened from the day in Shoot days and from the day in
// the Calendar's schedule, it lists the steps on the day and on the frames that are or were on it, in History's own
// words, so a frame moved to another day stays in both days' histories.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  const add = page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const editor = (page: Page) => days(page).locator('[data-day-editor]');
const calendar = (page: Page) => page.getByRole('region', { name: 'Calendar', exact: true });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const daySteps = (page: Page, day: string) => history(page).getByRole('list', { name: `Steps on shoot day ${day}, newest first` }).getByRole('listitem');

const SCHEDULED = '1A: shoot day — → Mon, Nov 16';
const MOVED = '1A: shoot day Mon, Nov 16 → Tue, Nov 17';

test('a day’s history from Shoot days and from the Calendar: a frame scheduled, then moved to another day', async ({ page }) => {
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await editor(page).getByLabel('Date').fill('2026-11-16');
  await editor(page).getByLabel('Date').blur();
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const list = days(page).getByRole('list', { name: 'Shoot days' });
  await expect(list.getByRole('button').nth(1)).toContainText('Day 2 · Tue, Nov 17');
  await list.getByRole('button').first().click();
  await editor(page).getByRole('button', { name: 'Add 1A to Day 1 · Mon, Nov 16' }).click();
  await editor(page).getByRole('combobox', { name: 'Move to, for 1A' }).selectOption({ label: 'Day 2 · Tue, Nov 17' });
  await editor(page).getByRole('button', { name: 'Move 1A' }).click();
  await expect(editor(page)).toContainText('No frames yet.');

  // From the day in Shoot days: History, filtered to the day by its date, both steps newest first in History's words.
  await editor(page).getByRole('button', { name: 'History of Day 1 · Mon, Nov 16' }).click();
  await expect(history(page)).toBeVisible();
  const only = history(page).getByRole('switch', { name: 'Only shoot day Mon, Nov 16' });
  await expect(only).toHaveAttribute('aria-checked', 'true');
  await expect(only).toBeFocused();
  await expect(daySteps(page, 'Mon, Nov 16').first()).toContainText(MOVED);
  await expect(daySteps(page, 'Mon, Nov 16').nth(1)).toContainText(SCHEDULED);
  // Who and when, as the main feed shows them; and nothing to put back or restore: it's a view.
  await expect(daySteps(page, 'Mon, Nov 16').first().locator('p.font-mono')).toHaveText(/\d/);
  await expect(daySteps(page, 'Mon, Nov 16').getByRole('button')).toHaveCount(0);
  // The main feed words the same steps the same way.
  await only.click();
  const feed = history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
  await expect(feed.first()).toContainText(MOVED);
  await expect(feed.nth(1)).toContainText(SCHEDULED);

  // The other day's history, from the Calendar's schedule: the move only.
  await calendar(page).getByRole('button', { name: 'History of Day 2 · Tue, Nov 17' }).click();
  await expect(history(page).getByRole('switch', { name: 'Only shoot day Tue, Nov 17' })).toHaveAttribute('aria-checked', 'true');
  const second = daySteps(page, 'Tue, Nov 17');
  await expect(second.first()).toContainText(MOVED);
  await expect(second.filter({ hasText: SCHEDULED })).toHaveCount(0);
  await expect(second.filter({ hasText: 'Added shoot day' })).toHaveCount(1);

  // And the first day's again, from the Calendar: both steps.
  await calendar(page).getByRole('button', { name: 'History of Day 1 · Mon, Nov 16' }).click();
  await expect(history(page).getByRole('switch', { name: 'Only shoot day Mon, Nov 16' })).toHaveAttribute('aria-checked', 'true');
  await expect(daySteps(page, 'Mon, Nov 16').first()).toContainText(MOVED);
  await expect(daySteps(page, 'Mon, Nov 16').nth(1)).toContainText(SCHEDULED);

  // A later step on the day joins it as it lands.
  await list.getByRole('button').first().click();
  await editor(page).getByLabel('Call').fill('07:00');
  await editor(page).getByLabel('Call').blur();
  await expect(daySteps(page, 'Mon, Nov 16')).toHaveCount(5);
  await expect(daySteps(page, 'Mon, Nov 16').nth(2)).toContainText(SCHEDULED);
});

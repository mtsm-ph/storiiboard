import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Calendar (3.8) in the memory build: shoot days by month and week, a date picked to narrow the shoot schedule,
// each day with its scenes, locations and crew confirmed (set in the Shoot days tile). The page's clock is fixed, so
// "today" is a known date.

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T10:00:00'));
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

const calendar = (page: Page) => page.getByRole('region', { name: 'Calendar', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const editor = (page: Page) => days(page).locator('[data-day-editor]');

test('a shoot day on the month, picked to narrow the schedule, with its scenes and crew confirmed; arrows and the week', async ({ page }) => {
  // Someone in Cast and crew, confirmed for the day in the Shoot days tile.
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Sam Ortiz');
  await page.keyboard.press('Enter');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await editor(page).getByLabel('Date').fill('2026-11-16');
  await editor(page).getByLabel('Date').blur();
  await editor(page).getByRole('button', { name: 'Add all 2 from SC 01 to Day 1 · Mon, Nov 16' }).click();
  const confirm = editor(page).getByRole('button', { name: 'Confirmed, Sam Ortiz' });
  await expect(confirm).toHaveAttribute('aria-pressed', 'false');
  await confirm.click();
  await expect(confirm).toHaveAttribute('aria-pressed', 'true');
  await expect(confirm).toHaveText('●Confirmed');
  await expect(editor(page)).toContainText('Crew · 1 of 1 confirmed');

  // The month, today's included; the shoot day on its date.
  await expect(calendar(page).getByRole('heading', { name: 'November 2026' })).toBeVisible();
  const grid = calendar(page).getByRole('grid', { name: 'November 2026' });
  // Each date named by its number, then in full (today said), then its shoot days as they show.
  await expect(grid.getByRole('button', { name: /^9\s*Monday, November 9, today$/ })).toHaveAttribute('tabindex', '0');
  const shootDay = grid.getByRole('button', { name: /^16\s*Monday, November 16, ?Day 1$/ });
  await expect(shootDay).toBeVisible();

  // Picked, it narrows the schedule to that date; Show all days widens it again.
  await shootDay.click();
  const schedule = calendar(page).getByRole('list', { name: 'Shoot schedule, Mon, Nov 16' });
  await expect(schedule.getByRole('listitem')).toHaveCount(1);
  await expect(schedule).toContainText('SC 01');
  await expect(schedule).toContainText('1 of 1 confirmed');
  await expect(schedule).toContainText('2 frames');
  await calendar(page).getByRole('button', { name: 'Show all days' }).click();
  await expect(calendar(page).getByRole('list', { name: 'Shoot schedule' })).toBeVisible();

  // The arrows move a day and a week, into the next month too.
  await shootDay.focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('button', { name: /^17\s*Tuesday, November 17/ })).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(calendar(page).getByRole('heading', { name: 'December 2026' })).toBeVisible();
  await expect(calendar(page).getByRole('grid', { name: 'December 2026' }).getByRole('button', { name: /^8\s*Tuesday, December 8/ })).toBeFocused();
  // Home and End go to the week's ends (Sunday first in English); Page Up a month back, to the same day.
  await page.keyboard.press('End');
  await expect(calendar(page).getByRole('button', { name: /^12\s*Saturday, December 12/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(calendar(page).getByRole('button', { name: /^6\s*Sunday, December 6/ })).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(calendar(page).getByRole('button', { name: /^6\s*Friday, November 6/ })).toBeFocused();

  const results = await new AxeBuilder({ page }).include('[aria-label="Calendar"]').analyze();
  expect(results.violations).toEqual([]);

  // The week: seven days, today's week after Today.
  await calendar(page).getByRole('radio', { name: 'Week' }).click();
  await calendar(page).getByRole('button', { name: 'Today' }).click();
  const week = calendar(page).getByRole('grid');
  await expect(week.getByRole('row')).toHaveCount(2);
  await expect(week.getByRole('gridcell')).toHaveCount(7);
  await calendar(page).getByRole('button', { name: 'Next week' }).click();
  await expect(week.getByRole('button', { name: /^16\s*Monday, November 16, ?Day 1/ })).toBeVisible();
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Shoot days (3.7) in the memory build: days made, dated and timed in the Production workspace's Days tile, "Need to
// shoot" frames added one at a time or a scene at once, moved between days and out, with totals; each one ⌘Z.

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
  await add.click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const editor = (page: Page) => days(page).locator('[data-day-editor]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('days made and dated, frames added by scene and one by one, moved and taken out, totals worked out', async ({ page }) => {
  await expect(days(page)).toContainText('No shoot days yet.');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const list = days(page).getByRole('list', { name: 'Shoot days' });
  await expect(list.getByRole('button')).toHaveCount(1);

  // Dated and timed (the first day starts on today: a fixed date, so the labels are known).
  await editor(page).getByLabel('Date').fill('2026-11-16');
  await editor(page).getByLabel('Date').blur();
  await editor(page).getByLabel('Call').fill('07:00');
  await editor(page).getByLabel('Call').blur();
  await expect(list.getByRole('button').first()).toContainText('Day 1 · Mon, Nov 16');
  await expect(list.getByRole('button').first()).toContainText('Call 07:00');
  // The next day is dated the day after, and the list stays on the one picked.
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await expect(list.getByRole('button').nth(1)).toContainText('Day 2 · Tue, Nov 17');
  await list.getByRole('button').first().click();

  // A scene's three "Need to shoot" frames in at once: one step.
  await editor(page).getByRole('button', { name: 'Add all 3 from SC 01 to Day 1 · Mon, Nov 16' }).click();
  await expect(editor(page).getByRole('list', { name: 'Frames on Day 1 · Mon, Nov 16' }).getByRole('listitem')).toHaveCount(3);
  await expect(editor(page).locator('[data-day-totals]')).toHaveText('3 frames3 setupsabout 1 h 30 min');
  await expect(editor(page)).toContainText('Every frame that needs shooting is in a day.');
  await page.keyboard.press(await undoKey(page));
  await expect(editor(page)).toContainText('No frames yet.');

  // One by one, then moved to the other day and out again.
  await editor(page).getByRole('button', { name: 'Add 1A to Day 1 · Mon, Nov 16' }).click();
  await expect(editor(page).getByRole('button', { name: 'Add 1B to Day 1 · Mon, Nov 16' })).toBeFocused();
  // Picking a day moves nothing until Move: arrowing through the choices from the keyboard is safe.
  const moveTo = editor(page).getByRole('combobox', { name: 'Move to, for 1A' });
  // It starts on the day the frame is in, and Move does nothing until another is picked.
  await expect(moveTo).toHaveValue(/.+/);
  await expect(editor(page).getByRole('button', { name: 'Move 1A' })).toBeDisabled();
  await moveTo.focus();
  await page.keyboard.press('ArrowDown');
  await expect(editor(page).getByRole('list', { name: 'Frames on Day 1 · Mon, Nov 16' })).toContainText('1A');
  await moveTo.selectOption({ label: 'Not scheduled' });
  await editor(page).getByRole('button', { name: 'Move 1A' }).click();
  await expect(editor(page)).toContainText('No frames yet.');
  await editor(page).getByRole('button', { name: 'Add 1C to Day 1 · Mon, Nov 16' }).click();
  await editor(page).getByRole('combobox', { name: 'Move to, for 1C' }).selectOption({ label: 'Day 2 · Tue, Nov 17' });
  await editor(page).getByRole('button', { name: 'Move 1C' }).click();
  await list.getByRole('button').nth(1).click();
  await expect(editor(page).getByRole('list', { name: 'Frames on Day 2 · Tue, Nov 17' })).toContainText('1C');
  await expect(list.getByRole('button').nth(1)).toContainText('1 frame');

  // The minutes per setup change every day's estimate.
  const minutes = days(page).getByLabel('Minutes per setup');
  await minutes.fill('45');
  await minutes.press('Enter');
  await expect(editor(page).locator('[data-day-totals]')).toHaveText('1 frame1 setupabout 45 min');

  const results = await new AxeBuilder({ page }).include('[aria-label="Shoot days"]').analyze();
  expect(results.violations).toEqual([]);

  // A day to the Trash: its frame is unscheduled until the day is restored.
  await editor(page).getByRole('button', { name: 'Delete day' }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(editor(page).getByRole('list', { name: 'Unscheduled frames in SC 01' })).toContainText('1C');
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: /^Restore shoot day/ }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('button').nth(1)).toContainText('1 frame');
  await expect(editor(page).getByRole('list', { name: 'Unscheduled frames in SC 01' })).not.toContainText('1C');
});

test('a half-typed date leaves the day’s date as it was', async ({ page }) => {
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const date = editor(page).getByLabel('Date');
  await date.fill('2026-11-16');
  await date.blur();
  await date.focus();
  // Clear one part of the date: the field reads empty while it's unfinished.
  await page.keyboard.press('Backspace');
  await date.blur();
  await expect(days(page).getByRole('list', { name: 'Shoot days' }).getByRole('button').first()).toContainText('Mon, Nov 16');
});

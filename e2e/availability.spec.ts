import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Unavailable dates (7.3) in the memory build, from the keyboard: a stretch added to a made-up person in Cast and crew,
// the person put on a shoot day inside it, the call sheet's Checks strip naming them and the Calendar marking the day
// and listing who is away; then the stretch removed, the removal undone and redone. axe, light and dark, on Cast and
// crew with the stretch shown. The page's clock is fixed, so the Calendar opens on November 2026.

const people = (page: Page) => page.getByRole('region', { name: 'Cast and crew', exact: true });
const editor = (page: Page) => people(page).locator('[data-person-editor]');
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const day = (page: Page) => days(page).locator('[data-day-editor]');
const sheet = (page: Page) => page.getByRole('region', { name: 'Call sheet', exact: true });
const calendar = (page: Page) => page.getByRole('region', { name: 'Calendar', exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Harbor Lights'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

test('a stretch marked in Cast and crew shows on the call sheet and the Calendar; removed, undone, redone, by keyboard', async ({ page }) => {
  // A made-up gaffer.
  await people(page).getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Robin Vale');
  await page.keyboard.press('Enter');
  await editor(page).getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Gaffer' });
  const unavailable = editor(page).getByRole('group', { name: 'Unavailable' });
  await expect(unavailable).toContainText('No dates marked unavailable.');

  // Add dates…, from the keyboard: the From field takes focus, the To starts as the From, Enter adds.
  const addDates = unavailable.getByRole('button', { name: 'Add dates…' });
  await addDates.focus();
  await page.keyboard.press('Enter');
  const from = unavailable.getByLabel('From');
  await expect(from).toBeFocused();
  await from.fill('2026-11-24');
  const to = unavailable.getByLabel('To');
  await expect(to).toHaveValue('2026-11-24');
  // The To cleared from the keyboard: once touched it stops following the From, so an empty To (a date typed part by
  // part is empty until it's whole) is never put back to the From's date. The new date is then put in whole: each
  // engine's date field takes typed digits in its own segment order (WebKit's isn't Chromium's; nov21-h).
  await to.focus();
  await page.keyboard.press('Backspace');
  await expect(to).toHaveValue('');
  await to.fill('2026-11-28');
  await expect(to).toHaveValue('2026-11-28');
  // A From changed after that leaves the To as typed.
  await from.fill('2026-11-25');
  await expect(to).toHaveValue('2026-11-28');
  await from.fill('2026-11-24');
  await unavailable.getByLabel('Note').focus();
  await page.keyboard.type('Family wedding');
  await page.keyboard.press('Enter');
  const stretch = unavailable.locator('[data-stretch]');
  await expect(stretch).toHaveCount(1);
  // Standing alone, a stretch says its year.
  await expect(stretch).toContainText('Nov 24 – Nov 28, 2026');
  await expect(stretch).toContainText('Family wedding');
  // Back to Add dates once it's saved.
  await expect(addDates).toBeFocused();

  // WCAG 2.2 AA with the stretch shown, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.removeAttribute('data-theme');
  });

  // A shoot day inside the stretch, with the frame, and Robin on it.
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await day(page).getByLabel('Date').fill('2026-11-26');
  await day(page).getByLabel('Date').blur();
  await day(page).getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();

  // The call sheet's strip names them.
  const check = sheet(page).locator('[data-checks] [data-check="unavailable-on-day"]');
  await expect(check).toHaveText(/Robin Vale \(Gaffer\) is called on Thu, Nov 26 but marked unavailable Nov 24 – Nov 28/);
  // Its Show goes to Robin's Take off in "Who's on the day", where it's fixed.
  await check.getByRole('button', { name: /^Show: Robin Vale/ }).click();
  await expect(sheet(page).getByRole('button', { name: /^Take off Robin Vale from / })).toBeFocused();

  // The Calendar marks the shoot day and a date with no shoot, each with a count, and picking the day lists who.
  const grid = calendar(page).getByRole('grid', { name: 'November 2026' });
  const shootDate = grid.locator('[data-date="2026-11-26"]');
  await expect(shootDate.locator('[data-away="1"]')).toBeVisible();
  await expect(shootDate).toHaveAccessibleName(/Thursday, November 26, ?Day 1, 1 unavailable$/);
  await expect(grid.locator('[data-date="2026-11-24"] [data-away="1"]')).toBeVisible();
  await expect(grid.locator('[data-date="2026-11-29"] [data-away]')).toHaveCount(0);
  await shootDate.focus();
  await page.keyboard.press('Enter');
  const away = calendar(page).locator('[data-away-list]');
  await expect(away.getByRole('heading', { name: 'Unavailable, Thu, Nov 26' })).toBeVisible();
  await expect(away.getByRole('listitem')).toHaveCount(1);
  await expect(away).toContainText('Robin Vale');
  await expect(away).toContainText('Gaffer');
  await expect(away).toContainText('Nov 24 – Nov 28');
  await expect(away).toContainText('Family wedding');

  // Removed from the keyboard: the strip and the marks go, and focus goes back to Add dates.
  const remove = unavailable.getByRole('button', { name: 'Remove unavailable dates Nov 24 – Nov 28, 2026', exact: true });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(unavailable).toContainText('No dates marked unavailable.');
  await expect(addDates).toBeFocused();
  await expect(check).toHaveCount(0);
  await expect(grid.locator('[data-away]')).toHaveCount(0);
  await expect(away).toHaveCount(0);

  // One ⌘Z brings it back; ⌘⇧Z takes it off again.
  const key = await mod(page);
  await page.keyboard.press(`${key}+z`);
  await expect(stretch).toContainText('Nov 24 – Nov 28, 2026');
  await expect(check).toHaveCount(1);
  await expect(shootDate.locator('[data-away="1"]')).toBeVisible();
  await page.keyboard.press(`${key}+Shift+z`);
  await expect(stretch).toHaveCount(0);
  await expect(check).toHaveCount(0);

  // Back again, and a second shoot day on the same date: each item's words end in the separator, with no stray space.
  await page.keyboard.press(`${key}+z`);
  await expect(stretch).toHaveCount(1);
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await day(page).getByLabel('Date').fill('2026-11-26');
  await day(page).getByLabel('Date').blur();
  await expect(shootDate).toHaveAccessibleName(/Thursday, November 26, ?Day 1, Day 2, 1 unavailable$/);
});

test('dates out of order are refused in words, and Escape leaves the form without adding', async ({ page }) => {
  await people(page).getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Sam Ortiz');
  await page.keyboard.press('Enter');
  const unavailable = editor(page).getByRole('group', { name: 'Unavailable' });
  await unavailable.getByRole('button', { name: 'Add dates…' }).click();
  await unavailable.getByLabel('From').fill('2026-11-28');
  await unavailable.getByLabel('To').fill('2026-11-24');
  const add = unavailable.getByRole('button', { name: 'Add dates', exact: true });
  await expect(unavailable.getByLabel('From')).not.toHaveAttribute('aria-invalid');
  await add.click();
  const alert = unavailable.getByRole('alert');
  await expect(alert).toHaveText('▲ Pick a From date, and a To date on or after it, at most 366 days later.');
  await expect(unavailable.locator('[data-stretch]')).toHaveCount(0);
  // Both date fields say they're refused, and are described by the words.
  for (const label of ['From', 'To']) {
    await expect(unavailable.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
    await expect(unavailable.getByLabel(label)).toHaveAccessibleDescription('Pick a From date, and a To date on or after it, at most 366 days later.');
  }
  // A second bad Add says it again: the words are drawn afresh, so a screen reader hears them again.
  const said = await alert.elementHandle();
  await add.click();
  await expect(alert).toHaveText('▲ Pick a From date, and a To date on or after it, at most 366 days later.');
  expect(await said.evaluate((node) => node.isConnected)).toBe(false);
  // Escape from anywhere in the form, the Add dates button too, leaves it without adding.
  await add.focus();
  await page.keyboard.press('Escape');
  await expect(unavailable.getByRole('button', { name: 'Add dates…' })).toBeFocused();
  await expect(unavailable).toContainText('No dates marked unavailable.');
  await expect(unavailable.locator('[data-add-stretch]')).toHaveCount(0);
  // And from a field, as before.
  await page.keyboard.press('Enter');
  await unavailable.getByLabel('To').focus();
  await page.keyboard.press('Escape');
  await expect(unavailable.getByRole('button', { name: 'Add dates…' })).toBeFocused();
  await expect(unavailable).toContainText('No dates marked unavailable.');
});

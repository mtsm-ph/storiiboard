import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The gear catalogue (3.9a) in the memory build: an item made in the Production workspace's Gear tile, with its
// department, quantity, rental house and day rate, priced in the project's currency; each field one ⌘Z; to the Trash
// and back.

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
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const editor = (page: Page) => gear(page).locator('[data-gear-editor]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('an item made, rented and priced in the project’s currency; deleted to the Trash and restored', async ({ page }) => {
  await expect(gear(page)).toContainText('No gear yet.');
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  // Focus lands on the new item's name.
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('FX3 package');
  await page.keyboard.press('Enter');
  await editor(page).getByLabel('Department').selectOption({ label: 'Camera' });
  await editor(page).getByLabel('Quantity').fill('2');
  await editor(page).getByLabel('Quantity').press('Enter');
  await editor(page).getByRole('radio', { name: 'Rental' }).click();
  await editor(page).getByLabel('Rental house').fill('Abel Cine');
  await editor(page).getByLabel('Rental house').press('Enter');
  await editor(page).getByLabel('Day rate (USD)').fill('350');
  await editor(page).getByLabel('Day rate (USD)').press('Enter');
  await expect(editor(page)).toContainText('$350.00 a day × 2 = $700.00');
  // Text that isn't a number is refused, and says so; the rate stays.
  await editor(page).getByLabel('Day rate (USD)').fill('');
  await editor(page).getByLabel('Day rate (USD)').pressSequentially('3e');
  await editor(page).getByLabel('Day rate (USD)').blur();
  await expect(editor(page).getByLabel('Day rate (USD)')).toHaveValue('350');
  const row = gear(page).getByRole('list', { name: 'Gear' }).getByRole('button').first();
  await expect(row).toContainText('FX3 package');
  await expect(row).toContainText('×2 · Rental · Camera');

  // The project's currency, for every price; one ⌘Z takes it back.
  await gear(page).getByLabel('Currency').selectOption('EUR');
  await expect(editor(page).getByLabel('Day rate (EUR)')).toBeVisible();
  await expect(editor(page)).toContainText('€350.00');
  await page.keyboard.press(await undoKey(page));
  await expect(editor(page).getByLabel('Day rate (USD)')).toBeVisible();

  const results = await new AxeBuilder({ page }).include('[aria-label="Gear"]').analyze();
  expect(results.violations).toEqual([]);

  await editor(page).getByRole('button', { name: 'Delete item' }).click();
  await expect(gear(page)).toContainText('No gear yet.');
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: 'Restore gear FX3 package' }).click();
  await expect(row).toContainText('FX3 package');
});

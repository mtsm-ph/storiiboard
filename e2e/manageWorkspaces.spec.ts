import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Your own workspaces (3.6d) in the memory build: a layout saved as a workspace from the Layout menu, renamed,
// duplicated, opened and deleted in Manage workspaces…, listed in the sidebar and kept after a reload.

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
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const yours = (page: Page) => sections(page).getByRole('list', { name: 'Your workspaces' });
const layoutMenu = async (page: Page) => {
  await page.getByRole('button', { name: /^Layout/ }).click();
};
const manage = (page: Page) => page.getByRole('dialog', { name: 'Manage workspaces' });

test('a layout saved as a workspace of your own, renamed, duplicated, opened, kept and deleted', async ({ page }) => {
  // From the Layout menu: the Storyboard's layout as it is, shown at once, its sidebar entry focused.
  await layoutMenu(page);
  await page.getByRole('button', { name: 'Save as new workspace' }).click();
  const copy = yours(page).getByRole('button', { name: 'Storyboard copy' });
  await expect(copy).toHaveAttribute('aria-current', 'page');
  await expect(copy).toBeFocused();
  await expect(page.getByRole('region', { name: 'Storyboard copy workspace' })).toBeVisible();

  // Manage workspaces…: rename it, and duplicate Production as a start for another.
  await layoutMenu(page);
  await page.getByRole('button', { name: 'Manage workspaces…' }).click();
  await expect(manage(page)).toBeVisible();
  const name = manage(page).getByRole('textbox', { name: 'Name of Storyboard copy' });
  await name.fill('Prep day');
  await name.press('Enter');
  // Renamed, and focus stays in the field: Tab goes on from here.
  await expect(manage(page).getByRole('textbox', { name: 'Name of Prep day' })).toBeFocused();
  await expect(yours(page).getByRole('button', { name: 'Prep day' })).toBeVisible();
  // The workspace on screen takes its new name everywhere, its region among them.
  await expect(page.getByRole('region', { name: 'Prep day workspace' })).toBeAttached();
  await manage(page).getByRole('button', { name: 'Duplicate Production' }).click();
  // Focus lands on the new one's name, ready to rename.
  await expect(manage(page).getByRole('textbox', { name: 'Name of Production copy' })).toBeFocused();
  await expect(manage(page).getByRole('textbox', { name: 'Name of Production copy' })).toHaveValue('Production copy');
  const results = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(results.violations).toEqual([]);
  await manage(page).getByRole('button', { name: 'Open Production copy' }).click();
  await expect(manage(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Production copy workspace' })).toBeVisible();
  await expect(yours(page).getByRole('button', { name: 'Production copy' })).toBeFocused();

  // Yours, on this computer: still there after a reload, in the order made.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(yours(page).getByRole('button')).toHaveText(['Prep day', 'Production copy']);
  // Alt+2 from one of your own in the sidebar: focus goes to the section shown, not left on the entry behind.
  await yours(page).getByRole('button', { name: 'Production copy' }).click();
  await page.keyboard.press('Alt+2');
  await expect(sections(page).getByRole('button', { name: /^Assets/ })).toBeFocused();

  // Delete from the Layout menu, asked first: the Storyboard takes its place.
  await yours(page).getByRole('button', { name: 'Prep day' }).click();
  await layoutMenu(page);
  await page.getByRole('button', { name: 'Delete workspace…' }).click();
  const asked = page.getByRole('alertdialog', { name: 'Delete Prep day?' });
  await expect(asked).toContainText('Nothing in any project changes.');
  await asked.getByRole('button', { name: 'Delete workspace' }).click();
  await expect(sections(page).getByRole('button', { name: /^Storyboard/ })).toHaveAttribute('aria-current', 'page');
  await expect(sections(page).getByRole('button', { name: /^Storyboard/ })).toBeFocused();
  await expect(yours(page).getByRole('button')).toHaveText(['Production copy']);

  // And from Manage workspaces…, cancelled once, then for good: the list says there are none.
  await layoutMenu(page);
  await page.getByRole('button', { name: 'Manage workspaces…' }).click();
  await manage(page).getByRole('button', { name: 'Delete Production copy…' }).click();
  await page.getByRole('alertdialog', { name: 'Delete Production copy?' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(manage(page).getByRole('textbox', { name: /^Name of / })).toHaveCount(1);
  await manage(page).getByRole('button', { name: 'Delete Production copy…' }).click();
  await page.getByRole('alertdialog', { name: 'Delete Production copy?' }).getByRole('button', { name: 'Delete workspace' }).click();
  await expect(manage(page)).toContainText('None yet.');
  // Focus stays in the window, on what's left to do.
  await expect(manage(page).getByRole('button', { name: 'Save Storyboard as a new workspace' })).toBeFocused();
  await expect(yours(page)).toHaveCount(0);
});

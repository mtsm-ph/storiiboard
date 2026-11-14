import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Setups (6.0) in the memory build: made and named in the Setup workspace's Setups tile, frames put in from the board's
// context menu and from the Inspector, reordered with their numbers following, deleted and undone, all there after a
// reload; and the same from the keyboard alone.

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
  const add = storyboard(page).getByRole('button', { name: '+ Frame in SC 01' });
  for (let i = 0; i < 3; i += 1) await add.click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(3);
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const frame = (page: Page, number: string) => storyboard(page).locator('[data-shot-id]').filter({ has: page.locator('[data-number]', { hasText: new RegExp(`^${number}$`) }) });
const rows = (page: Page) => setupsTile(page).locator('[data-setup-select]');
const setupField = (page: Page) => inspector(page).getByRole('combobox', { name: 'Setup', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('setups made and named, filled from the board and the Inspector, reordered, deleted and undone, kept after a reload', async ({ page }) => {
  await toSection(page, 'Setup');
  await expect(setupsTile(page)).toContainText('No setups in this scene yet.');
  await expect(setupsTile(page)).toContainText('Pick a setup to see its frames.');
  const addSetup = setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' });
  await addSetup.click();
  await addSetup.click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText('Setup 1');
  await expect(rows(page).nth(1)).toContainText('Setup 2');
  // The new one is picked, and shows it has no frames yet.
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(setupsTile(page)).toContainText('No frames in this setup yet.');

  // Named in place.
  await setupsTile(page).getByRole('button', { name: 'Edit name of Setup 2 in SC 01' }).click();
  await page.keyboard.type('Window side');
  await page.keyboard.press('Enter');
  await expect(setupsTile(page).locator('[data-setup-row]').nth(1)).toContainText('Window side');

  // 1A into Setup 2 from the board's context menu.
  await toSection(page, 'Storyboard');
  await frame(page, '1A').click({ button: 'right' });
  const menu = page.locator('[data-add-to-board-menu]');
  await menu.getByRole('button', { name: 'Add to setup' }).click();
  await menu.getByRole('button', { name: 'Setup 2 · Window side' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText('1A is in Setup 2 · Window side now.')).toBeVisible();
  // 1B into Setup 1 from the Inspector.
  await frame(page, '1B').click();
  await expect(setupField(page)).toHaveValue('');
  await setupField(page).selectOption({ label: 'Setup 1' });
  await frame(page, '1A').click();
  await expect(setupField(page).locator('option:checked')).toHaveText('Setup 2 · Window side');

  // The Setups tile reads them live: how many frames, and their numbers.
  await toSection(page, 'Setup');
  await expect(rows(page).nth(0)).toContainText('1 frame');
  await expect(rows(page).nth(0)).toContainText('1B');
  await expect(rows(page).nth(1)).toContainText('1A');
  await rows(page).nth(1).click();
  const picked = setupsTile(page).locator('[data-setup-frames]');
  await expect(picked.locator('[data-setup-frame]')).toHaveCount(1);
  await expect(picked).toContainText('Frames in SC 01 with no setup');
  // A frame added from the tile, and taken out again.
  await picked.getByRole('button', { name: 'Add 1C to Setup 2 · Window side' }).click();
  await expect(picked.locator('[data-setup-frame]')).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include('[data-setups-tile]').analyze()).violations).toEqual([]);
  await picked.getByRole('button', { name: 'Take out of setup: 1C from Setup 2 · Window side' }).click();
  await expect(picked.locator('[data-setup-frame]')).toHaveCount(1);

  // Reordered: the named one becomes Setup 1, and the numbers follow.
  await setupsTile(page).getByRole('button', { name: 'Move Setup 2 · Window side in SC 01 up' }).click();
  await expect(setupsTile(page).locator('[data-setup-row]').nth(0)).toContainText('Window side');
  await expect(rows(page).nth(0)).toContainText('Setup 1');
  await expect(rows(page).nth(0)).toContainText('1A');
  await expect(rows(page).nth(1)).toContainText('1B');

  // Deleted: its frame reads No setup; undo brings it back with its frame in it.
  await setupsTile(page).getByRole('button', { name: 'Delete Setup 1 · Window side in SC 01' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0)).toContainText('1B');
  await toSection(page, 'Storyboard');
  await frame(page, '1A').click();
  await expect(setupField(page)).toHaveValue('');
  await expect(setupField(page).locator('option:checked')).toHaveText('No setup');
  await page.keyboard.press(await undoKey(page));
  await expect(setupField(page).locator('option:checked')).toHaveText('Setup 1 · Window side');

  // All of it is in the file.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await expect(rows(page)).toHaveCount(2);
  await expect(setupsTile(page).locator('[data-setup-row]').nth(0)).toContainText('Window side');
  await expect(rows(page).nth(0)).toContainText('1A');
  await expect(rows(page).nth(1)).toContainText('Setup 2');
  await expect(rows(page).nth(1)).toContainText('1B');

  const results = await new AxeBuilder({ page }).include('[data-setups-tile]').analyze();
  expect(results.violations).toEqual([]);
});

test('setups added, named and reordered from the keyboard alone', async ({ page }) => {
  await toSection(page, 'Setup');
  const addSetup = setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' });
  await addSetup.focus();
  await page.keyboard.press('Enter');
  // Focus goes to the new setup.
  await expect(rows(page).nth(0)).toBeFocused();
  await addSetup.focus();
  await page.keyboard.press('Enter');
  await expect(rows(page).nth(1)).toBeFocused();

  // Tab from the setup reaches its name's pencil; Enter, type, Enter names it and gives the keys back to the pencil.
  await page.keyboard.press('Tab');
  const pencil = setupsTile(page).getByRole('button', { name: 'Edit name of Setup 2 in SC 01' });
  await expect(pencil).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Door');
  await page.keyboard.press('Enter');
  await expect(setupsTile(page).locator('[data-setup-row]').nth(1)).toContainText('Door');
  await expect(setupsTile(page).getByRole('button', { name: 'Edit name of Setup 2 · Door in SC 01' })).toBeFocused();

  // Up, from the keyboard: the numbers follow. First now, Up can't go further, so the keys go to the setup itself.
  await page.keyboard.press('Tab');
  await expect(setupsTile(page).getByRole('button', { name: 'Move Setup 2 · Door in SC 01 up' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(setupsTile(page).locator('[data-setup-row]').nth(0)).toContainText('Door');
  await expect(rows(page).nth(0)).toContainText('Setup 1');
  await expect(rows(page).nth(0)).toBeFocused();
  // Then Down puts it back, and again the keys land on the moved setup.
  await setupsTile(page).getByRole('button', { name: 'Move Setup 1 · Door in SC 01 down' }).focus();
  await page.keyboard.press('Enter');
  await expect(setupsTile(page).locator('[data-setup-row]').nth(1)).toContainText('Door');
  await expect(rows(page).nth(1)).toContainText('Setup 2');
  await expect(rows(page).nth(1)).toBeFocused();
});

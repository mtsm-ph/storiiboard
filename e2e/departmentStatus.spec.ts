import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings, settingsWindow } from './settings';

// Department status per frame (polish 6) in the memory build: Priority, Working on it and Done ticked in the
// inspector, Approved only by the director or the DP, with who. Every tick is an edit undo takes back.

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
  const add = board(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
  await board(page).locator('[data-shot-id]').first().click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const statusGrid = (page: Page) => inspector(page).getByRole('grid', { name: 'Departments on this frame' });
const box = (page: Page, name: string) => statusGrid(page).getByRole('checkbox', { name, exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('ticks a department’s status by click and by keyboard, undoes it, and keeps Priority first on the next visit', async ({ page }) => {
  await box(page, 'Camera: Priority').click();
  await expect(box(page, 'Camera: Priority')).toHaveAttribute('aria-checked', 'true');

  // One Tab stop: the arrows move between boxes, Space ticks.
  await box(page, 'Camera: Priority').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(box(page, 'Camera: Done')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box(page, 'Camera: Done')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(box(page, 'Grip & electric: Done')).toBeFocused();

  await page.keyboard.press(await undoKey(page));
  await expect(box(page, 'Camera: Done')).toHaveAttribute('aria-checked', 'false');
  await expect(box(page, 'Camera: Priority')).toHaveAttribute('aria-checked', 'true');

  // Rows stay put while the frame is open; the next time, Priority comes first.
  await box(page, 'Sound: Priority').click();
  await board(page).locator('[data-shot-id]').nth(1).click();
  await board(page).locator('[data-shot-id]').first().click();
  await expect(statusGrid(page).getByRole('rowheader')).toHaveText([
    'Camera', 'Sound', 'Direction', 'Grip & electric', 'Art', 'HMU', 'Wardrobe', 'Production', 'Post', 'Cast', 'Client',
  ]);

  // The shot list names the departments the frame depends on most.
  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  await expect(board(page).getByRole('table', { name: 'Shot list' }).locator('tr:has([data-shot-id])').first()).toContainText('Camera, Sound');
});

test('only the director or the DP approves, and the approval shows who', async ({ page }) => {
  const approved = box(page, 'Camera: Approved');
  await expect(approved).toHaveAttribute('aria-disabled', 'true');
  // Still in reach, so it can say why: Space does nothing.
  await approved.focus();
  await page.keyboard.press('Space');
  await expect(approved).toHaveAttribute('aria-checked', 'false');
  await expect(inspector(page)).toContainText('Only the director or the DP can tick Approved.');

  // A usual role that doesn't approve, and a role on this project that does.
  const profile = await openSettings(page, 'Profile');
  await profile.getByLabel('Your name').fill('Kevin Matos');
  await profile.getByLabel('Your name').press('Enter');
  await profile.getByLabel('Usual role').selectOption('gaffer');
  // Settings is open already: its Project tab.
  await settingsWindow(page).getByRole('tab', { name: 'Project', exact: true }).click();
  const project = settingsWindow(page).getByRole('tabpanel', { name: 'Project', exact: true });
  const role = project.getByLabel('Your role on this project');
  await expect(role.locator('option').first()).toHaveText('Your usual role (Gaffer)');
  await role.selectOption({ label: 'Director and DP' });
  await closeSettings(page);

  await approved.click();
  await expect(approved).toHaveAttribute('aria-checked', 'true');
  await expect(inspector(page).getByRole('list', { name: 'Approvals' })).toHaveText('Camera approved by Kevin Matos (Director and DP)');

  // The role is this person's, on this computer: it's still there after a reload, and the approval is in the file.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await expect(box(page, 'Camera: Approved')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Camera: Approved')).not.toHaveAttribute('aria-disabled');
  // Taking it back is the director's or the DP's too.
  await box(page, 'Camera: Approved').click();
  await expect(box(page, 'Camera: Approved')).toHaveAttribute('aria-checked', 'false');
  await expect(inspector(page).getByRole('list', { name: 'Approvals' })).toHaveCount(0);
});

test('two quick ticks both stay, each worked out from the frame as it is when it lands', async ({ page }) => {
  await box(page, 'Art: Priority').focus();
  // No waits between keys: the second tick lands before the first has re-rendered.
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(box(page, 'Art: Priority')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Art: Working on it')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Art: Done')).toHaveAttribute('aria-checked', 'true');
});

test('the department status grid passes the axe checks', async ({ page }) => {
  await box(page, 'Camera: Priority').click();
  await box(page, 'Camera: Done').click();
  const results = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(results.violations).toEqual([]);
});

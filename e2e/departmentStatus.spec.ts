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
  await expect(box(page, 'Camera: Seen')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
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

  // The shot list names each department with its shapes (words for a screen reader), Priority first.
  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  await expect(board(page).getByRole('table', { name: 'Shot list' }).locator('tr:has([data-shot-id])').first()).toContainText('Camera(priority)Sound(priority)');
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
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(box(page, 'Art: Priority')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Art: Working on it')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Art: Done')).toHaveAttribute('aria-checked', 'true');
});

test('opening a frame marks it Seen by your department, shown on its card and in the shot list, and undo leaves it', async ({ page }) => {
  // No role yet: opening a frame marks nothing.
  await expect(box(page, 'Camera: Seen')).toHaveAttribute('aria-readonly', 'true');
  await page.waitForTimeout(800);
  await expect(box(page, 'Camera: Seen')).toHaveAttribute('aria-checked', 'false');

  const project = await openSettings(page, 'Project');
  await project.getByLabel('Your role on this project').selectOption({ label: 'Director of photography' });
  await closeSettings(page);
  // The frame open as the role was set is marked; arrowing past the next one doesn't count as opening it.
  const second = board(page).locator('[data-shot-id]').nth(1);
  await expect(board(page).locator('[data-shot-id]').first()).toHaveAccessibleDescription('Departments: 1 seen');
  await board(page).locator('[data-shot-id]').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(800);
  await expect(second).toHaveAccessibleDescription('');
  await second.click();
  await expect(box(page, 'Camera: Seen')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Direction: Seen')).toHaveAttribute('aria-checked', 'false');
  // Seen is automatic: a click or Space doesn't untick it.
  await box(page, 'Camera: Seen').click();
  await expect(box(page, 'Camera: Seen')).toHaveAttribute('aria-checked', 'true');

  // The card says how far the departments have got, in shapes and in words.
  await box(page, 'Camera: Priority').click();
  const card = board(page).locator('[data-shot-id]').nth(1);
  await expect(card).toHaveAccessibleDescription('Departments: 1 priority and 1 seen');
  // Undo takes back the Priority tick, never Seen.
  await page.keyboard.press(await undoKey(page));
  await expect(card).toHaveAccessibleDescription('Departments: 1 seen');

  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  await expect(board(page).getByRole('table', { name: 'Shot list' }).locator('tr:has([data-shot-id])').nth(1)).toContainText('Camera(seen)');
});

test('the department status grid passes the axe checks', async ({ page }) => {
  await box(page, 'Camera: Priority').click();
  await box(page, 'Camera: Done').click();
  const results = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(results.violations).toEqual([]);
});

test('you in Cast and crew: your person’s role approves and their departments mark Seen, the setting the fallback (3.5c)', async ({ page }) => {
  const sections = page.getByRole('navigation', { name: 'Sections' });
  // A usual role that approves nothing, and another name, so whatever approves below, and the name it's signed with, are
  // the person picked.
  const profile = await openSettings(page, 'Profile');
  await profile.getByLabel('Your name').fill('Sam Ortiz');
  await profile.getByLabel('Your name').press('Enter');
  await profile.getByLabel('Usual role').selectOption('gaffer');
  await closeSettings(page);

  await sections.getByRole('button', { name: /^Production/ }).click();
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  const editor = people.locator('[data-person-editor]');
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Director of photography' });
  await editor.getByRole('button', { name: 'Camera', exact: true }).click();
  await editor.getByRole('button', { name: 'Direction', exact: true }).click();
  const me = editor.getByRole('button', { name: 'This is me' });
  await expect(me).toHaveAttribute('aria-pressed', 'false');
  await me.click();
  await expect(me).toHaveAttribute('aria-pressed', 'true');
  // Heard as the name, then You, then the rest.
  await expect(people.getByRole('list', { name: 'Cast and crew' }).getByRole('button')).toHaveAccessibleName(/^Kevin Matos ?, You /);

  // Settings → Project says who you are, in place of the role picker.
  const project = await openSettings(page, 'Project');
  await expect(project.locator('[data-you-are]')).toContainText('You’re Kevin Matos in Cast and crew: Director and DP.');
  await expect(project.getByLabel('Your role on this project')).toHaveCount(0);
  await closeSettings(page);

  // A DP in Direction approves as the Director and DP, and opening a frame marks it Seen by Camera and Direction.
  await sections.getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').nth(1).click();
  await expect(box(page, 'Camera: Seen')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Direction: Seen')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'Sound: Seen')).toHaveAttribute('aria-checked', 'false');
  await box(page, 'Camera: Approved').click();
  await expect(inspector(page).getByRole('list', { name: 'Approvals' })).toHaveText('Camera approved by Kevin Matos (Director and DP)');

  // Kept on this computer: still you after a reload.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sections.getByRole('button', { name: /^Production/ }).click();
  await expect(people.getByRole('list', { name: 'Cast and crew' }).getByRole('button')).toHaveAccessibleName(/^Kevin Matos ?, You /);

  // Your person in the Trash: the setting applies again (a gaffer approves nothing), and Settings shows the picker.
  await editor.getByRole('button', { name: 'Delete person' }).click();
  await sections.getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').nth(1).click();
  await expect(box(page, 'Camera: Approved')).toHaveAttribute('aria-disabled', 'true');
  const after = await openSettings(page, 'Project');
  await expect(after.getByLabel('Your role on this project')).toBeVisible();
  await expect(after.locator('[data-you-are]')).toHaveCount(0);
  await closeSettings(page);

  // Restored from the Trash, they're you again: the pick was never dropped.
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: 'Restore person Kevin Matos' }).click();
  await board(page).locator('[data-shot-id]').nth(1).click();
  await expect(box(page, 'Camera: Approved')).not.toHaveAttribute('aria-disabled');
});

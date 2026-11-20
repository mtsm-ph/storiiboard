import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The top bar's Undo and Redo (item 8, Kevin Nov 17 and 18): ⌘Z and ⌘⇧Z as buttons, each named by the step it would
// take in History's own words, with the platform's keys in its tip; project edits only, never a layout change.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

async function newProject(page: Page) {
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
}

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const undoButton = (page: Page) => page.getByRole('banner').locator('[data-step-button="undo"]');
const redoButton = (page: Page) => page.getByRole('banner').locator('[data-step-button="redo"]');
const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
/** The app's own Mac test (undoShortcuts.ts): Playwright's Chromium reports Windows even on a Mac. */
const onMac = (page: Page) => page.evaluate(() => /Mac/i.test(navigator.userAgent));

async function twoEdits(page: Page) {
  await newProject(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(frames(page)).toHaveCount(1);
}

test('Undo and Redo name the step they take, do what ⌘Z and ⌘⇧Z do, and History records it the same way', async ({ page }) => {
  await twoEdits(page);
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added frame 1A');
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Nothing to redo');
  await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'true');

  await page.getByRole('banner').getByRole('button', { name: 'Undo: Added frame 1A', exact: true }).click();
  await expect(frames(page)).toHaveCount(0);
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added scene SC 01');
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Redo: Added frame 1A');
  await expect(redoButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(steps(page).first()).toContainText('Undid: Added frame 1A');

  await page.getByRole('banner').getByRole('button', { name: 'Redo: Added frame 1A', exact: true }).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText('Redid: Added frame 1A');
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added frame 1A');
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Nothing to redo');

  // Nothing to redo: a click does nothing.
  await redoButton(page).click({ force: true });
  await expect(steps(page).first()).toContainText('Redid: Added frame 1A');
  await expect(frames(page)).toHaveCount(1);
});

test('with nothing to undo the button stays focusable, says so, and a click or Enter does nothing', async ({ page }) => {
  await newProject(page);
  const undo = undoButton(page);
  await expect(undo).toHaveAttribute('aria-label', 'Nothing to undo');
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(undo).not.toHaveAttribute('disabled', /.*/);
  await undo.focus();
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await undo.click({ force: true });
  // Had anything been undone, Redo would name it.
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Nothing to redo');
  await expect(undo).toHaveAttribute('aria-label', 'Nothing to undo');

  // Reached by Tab too, from the History button before it (the project name between them isn't a stop).
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(undo).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(redoButton(page)).toBeFocused();
});

test('the tip names the step and this platform’s keys', async ({ page }) => {
  await twoEdits(page);
  const mac = await onMac(page);
  await undoButton(page).hover();
  await expect(page.locator('[data-step-tip="undo"]')).toHaveText(`Undo: Added frame 1A · ${mac ? '⌘Z' : 'Ctrl+Z'}`);
  await expect(undoButton(page)).toHaveAttribute('aria-keyshortcuts', mac ? 'Meta+Z' : 'Control+Z');
  await redoButton(page).hover();
  await expect(page.locator('[data-step-tip="undo"]')).toHaveCount(0);
  await expect(page.locator('[data-step-tip="redo"]')).toHaveText(`Nothing to redo · ${mac ? '⌘⇧Z' : 'Ctrl+Y or Ctrl+Shift+Z'}`);
});

test('a layout change is not undone by the button', async ({ page }) => {
  await twoEdits(page);
  await page.getByRole('button', { name: 'Close Frame inspector' }).click();
  await expect(tile(page, 'Frame inspector')).toBeHidden();
  // Still the project's newest step, not the layout change.
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added frame 1A');
  await undoButton(page).click();
  await expect(frames(page)).toHaveCount(0);
  await expect(tile(page, 'Frame inspector')).toBeHidden();
});

test('not shown with no project open, shown once one is', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
  await expect(undoButton(page)).toHaveCount(0);
  await expect(redoButton(page)).toHaveCount(0);
  await newProject(page);
  await expect(undoButton(page)).toHaveCount(1);
  await expect(redoButton(page)).toHaveCount(1);
});

test('Enter and Space take the step named once, and with nothing to take do nothing', async ({ page }) => {
  await twoEdits(page);
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(steps(page)).toHaveCount(2);
  await undoButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(frames(page)).toHaveCount(0);
  await expect(steps(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Undid: Added frame 1A');
  await redoButton(page).focus();
  await page.keyboard.press('Space');
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page)).toHaveCount(4);
  await expect(steps(page).first()).toContainText('Redid: Added frame 1A');
  // Nothing to redo now: Enter and Space on it add no step.
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Nothing to redo');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added frame 1A');
  await expect(steps(page)).toHaveCount(4);
  await expect(frames(page)).toHaveCount(1);
});

test('a press while typing in a field commits the typing first, then takes it back; Redo then has nothing to take', async ({ page }) => {
  await twoEdits(page);
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await frames(page).first().click();
  const area = tile(page, 'Frame inspector').getByLabel('Action');
  await area.fill('Mary wipes the counter.');
  await expect(area).toBeFocused();
  // Never left the field: the press itself commits it, in every engine.
  await undoButton(page).click();
  await expect(area).toHaveValue('');
  // History's two newest lines: the typing, then "Undid: " the typing.
  await expect(steps(page).nth(1)).toContainText('1A: action');
  await expect(steps(page).nth(1)).not.toContainText('Undid');
  await expect(steps(page).first()).toContainText('Undid: 1A: action');
  await expect(redoButton(page)).not.toHaveAttribute('aria-disabled', 'true');

  await area.click();
  await area.fill('Push in on the cup.');
  await redoButton(page).click();
  await expect(area).toHaveValue('Push in on the cup.');
  await expect(redoButton(page)).toHaveAttribute('aria-label', 'Nothing to redo');
  await expect(steps(page).first()).not.toContainText('Redid');
  await expect(steps(page).first()).toContainText('action');
});

test('the tip shows on keyboard focus, draws the numbers and keys in mono, and Escape hides a hovered tip', async ({ page }) => {
  await twoEdits(page);
  const mac = await onMac(page);
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(undoButton(page)).toBeFocused();
  const tip = page.locator('[data-step-tip="undo"]');
  await expect(tip).toHaveText(`Undo: Added frame 1A · ${mac ? '⌘Z' : 'Ctrl+Z'}`);
  await expect(tip.locator('.font-mono')).toHaveText(['1A', mac ? '⌘Z' : 'Ctrl+Z']);
  // The name people hear stays plain text.
  await expect(undoButton(page)).toHaveAttribute('aria-label', 'Undo: Added frame 1A');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  // Opened by hover with the focus elsewhere: Escape still puts it away.
  await board(page).click({ position: { x: 5, y: 5 } });
  await redoButton(page).hover();
  await expect(page.locator('[data-step-tip="redo"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-step-tip="redo"]')).toHaveCount(0);
});

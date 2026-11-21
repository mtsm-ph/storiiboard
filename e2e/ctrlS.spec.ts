import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Ctrl+S, ⌘S on a Mac (Kevin, Nov 18): every change is saved at once, so the key confirms. It commits the field being
// typed in, keeps focus and caret there, takes a hand backup by the one rule Back up now follows too, and shows the
// Saved sign's tip with the answer; the browser's own save dialog never opens.

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

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const tip = (page: Page) => page.locator('[data-saved-tip]');
const said = (page: Page) => page.locator('[data-saved-said]');
/** The app's own Mac test (undoShortcuts.ts): Playwright's Chromium reports Windows even on a Mac. */
const saveKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+s`;
const backupList = (page: Page) =>
  page.getByRole('dialog', { name: 'Settings' }).getByRole('list', { name: 'Backups' }).getByRole('listitem');

test('commits the field, keeps the caret in it, backs up, and a second press within the minute queues one', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();

  // Whether the key's default was prevented, as a listener after the app's own hears it.
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { saveKeys: boolean[] }).saveKeys = seen;
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) seen.push(event.defaultPrevented);
    });
  });
  const saveKeys = () => page.evaluate(() => (window as unknown as { saveKeys: boolean[] }).saveKeys);

  const action = inspector(page).getByRole('textbox', { name: 'Action', exact: true });
  await action.click();
  await action.pressSequentially('Wide on the pier');
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(await saveKey(page));

  // In History at once, without leaving the field.
  await expect(steps(page).first()).toContainText('1A: action — → Wide on the pier');
  await expect(action).toBeFocused();
  await expect.poll(() => action.evaluate((el) => (el as HTMLTextAreaElement).selectionStart)).toBe(12);
  expect(await saveKeys()).toEqual([true]);
  await expect(tip(page)).toContainText('Saved at');
  await expect(tip(page)).toContainText('Last backup at');
  await expect(said(page)).toContainText(/^Saved at .+\. Last backup at .+\.$/);

  // Typing goes on where it was.
  await page.keyboard.type('long ');
  await expect(action).toHaveValue('Wide on the long pier');
  // A key puts the tip away.
  await expect(tip(page)).toHaveCount(0);

  // Again within the minute: no second backup; the answer says when the next one will be made.
  await page.keyboard.press(await saveKey(page));
  await expect(steps(page).first()).toContainText('1A: action Wide on the pier → Wide on the long pier');
  await expect(tip(page)).toContainText('Next backup at');
  await expect(said(page)).toContainText(/Next backup at .+\.$/);
  await expect(action).toBeFocused();
  expect(await saveKeys()).toEqual([true, true]);

  await openSettings(page, 'Backups');
  await expect(backupList(page)).toHaveCount(1);
});

test('keys typed at once after the press go into the field in order, and none acts on the page meanwhile', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();

  const action = inspector(page).getByRole('textbox', { name: 'Action', exact: true });
  await action.click();
  await action.pressSequentially('Wide');
  const before = await steps(page).count();

  // The gap between the blur and the refocus waits for a drawn frame: held to 300 ms here, so every key below lands in
  // it whatever the machine's speed. A listener after the app's own records what reaches the page.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held = window as unknown as { restoreFrames: () => void; heardKeys: string[] };
    held.restoreFrames = () => {
      window.requestAnimationFrame = raf;
    };
    window.requestAnimationFrame = (callback) => window.setTimeout(() => raf(callback), 300);
    held.heardKeys = [];
    window.addEventListener('keydown', (event) => {
      held.heardKeys.push(event.key);
    });
  });
  const key = await saveKey(page);
  await page.keyboard.press(key);
  await page.keyboard.type('x');
  // An undo in the gap would take back the step just committed.
  await page.keyboard.press(`${key.split('+')[0] ?? 'Control'}+z`);
  await page.keyboard.type('yz');

  await expect(action).toHaveValue('Widexyz');
  await expect(action).toBeFocused();
  // The press itself reached it; nothing typed or pressed after it did.
  expect(await page.evaluate(() => (window as unknown as { heardKeys: string[] }).heardKeys)).toEqual([key.split('+')[0], 's']);
  await page.evaluate(() => {
    (window as unknown as { restoreFrames: () => void }).restoreFrames();
  });
  // One step for the commit, none for the undo.
  await expect(steps(page)).toHaveCount(before + 1);
  await expect(steps(page).first()).toContainText('1A: action — → Wide');

  // The typing is the field's next commit, as leaving it makes.
  await page.keyboard.press('Tab');
  await expect(steps(page)).toHaveCount(before + 2);
  await expect(steps(page).first()).toContainText('1A: action Wide → Widexyz');
});

test('Back up now twice within the minute makes one backup, and says when the next one will be made', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  let backups = await openSettings(page, 'Backups');
  await backups.getByRole('button', { name: 'Back up now' }).click();
  await expect(backups.getByRole('status')).toContainText('Backed up at');
  await expect(backupList(page)).toHaveCount(1);
  await closeSettings(page);

  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(1);
  backups = await openSettings(page, 'Backups');
  await backups.getByRole('button', { name: 'Back up now' }).click();
  await expect(backups.getByRole('status')).toContainText(/^A backup was made less than a minute ago\. The next one will be made at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\.$/);
  await expect(backupList(page)).toHaveCount(1);
});

test('with no project open the key still never opens the save dialog', async ({ page }) => {
  // Opened again: the Projects screen, with nothing open.
  await page.reload();
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { saveKeys: boolean[] }).saveKeys = seen;
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) seen.push(event.defaultPrevented);
    });
  });
  await expect(page.getByRole('button', { name: 'New project…' })).toBeVisible();
  await page.keyboard.press(await saveKey(page));
  expect(await page.evaluate(() => (window as unknown as { saveKeys: boolean[] }).saveKeys)).toEqual([true]);
});

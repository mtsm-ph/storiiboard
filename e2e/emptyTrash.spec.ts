import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { answerAsk } from './ask';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings, settingsWindow } from './settings';

// Empty Trash and Clean up old pictures (1.21) in the memory build: each asks first, in a window of the app's own
// (polish B), says it can't be undone, and deletes for good only when the person agrees.

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
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const trashTile = (page: Page) => page.getByRole('region', { name: 'Trash', exact: true });
const storage = (page: Page) => settingsWindow(page).getByRole('tabpanel', { name: 'Storage', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;
const redoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+Shift+z`;
async function openStorage(page: Page) {
  await openSettings(page, 'Storage');
}
const fixture = fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url));

async function openTile(page: Page, name: string) {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('Empty Trash asks first; Cancel keeps everything, and agreeing deletes it for good', async ({ page }) => {
  await openTile(page, 'Trash');
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);

  const asked: string[] = [];
  await trashTile(page).getByRole('button', { name: 'Empty Trash…' }).click();
  asked.push(await answerAsk(page, false));
  expect(asked[0]).toContain('can’t be undone');
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
  // The button stays where the keys left it, so Enter asks again.
  await expect(trashTile(page).getByRole('button', { name: 'Empty Trash…' })).toBeFocused();

  await trashTile(page).getByRole('button', { name: 'Empty Trash…' }).click();
  asked.push(await answerAsk(page, true));
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeVisible();
  expect(asked).toHaveLength(2);
  await expect(page.getByRole('status').getByText(/Emptied the Trash: 1 item deleted for good/)).toBeVisible();
  // The button turned off; focus is on the message that says the Trash is empty.
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeFocused();
  // Nothing to undo: it's gone for good.
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press(await undoKey(page));
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeVisible();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(1);
});

test('Empty Trash in Settings → Storage asks first too', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await openStorage(page);
  await expect(storage(page).getByText('1 item in the Trash.')).toBeVisible();
  const asked: string[] = [];
  await storage(page).getByRole('button', { name: 'Empty Trash…' }).click();
  asked.push(await answerAsk(page, true));
  await expect(storage(page).getByText('0 items in the Trash.')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('can’t be undone');
  await expect(storage(page).getByText('0 items in the Trash.')).toBeFocused();
});

test('Compact project backs up and shrinks the file without asking, and the board carries on', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await openStorage(page);
  await storage(page).getByRole('button', { name: 'Empty Trash…' }).click();
  await answerAsk(page, true);
  await expect(storage(page).getByText('0 items in the Trash.')).toBeVisible();
  // (The memory build's small file has no free pages to show; the unit and Rust tests measure the shrinking.)
  await expect(storage(page).getByText(/^\d+ KB/)).toBeVisible();
  // It deletes nothing, so it asks nothing.
  await storage(page).getByRole('button', { name: 'Compact project' }).click();
  await expect(page.getByText(/^Compacted the project: .+ Backed up first as “Bey County \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.sbd”\.$/)).toBeVisible();
  await expect(storage(page).getByText(/with no free space inside\.$/)).toBeFocused();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // The backup is listed with the project's others.
  await settingsWindow(page).getByRole('tab', { name: 'Backups' }).click();
  await expect(
    page.getByRole('list', { name: 'Backups' }).getByRole('button', { name: /^Open the \d{4}-\d{2}-\d{2} \d{2}:\d{2} backup/ }),
  ).toBeVisible();
  // And editing carries on, with undo.
  await closeSettings(page);
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(2);
  await page.keyboard.press(await undoKey(page));
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(1);
});

test('Clean up old pictures finds a picture only History uses and, after a yes, deletes it', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fixture);
  await expect(board(page).locator('[data-shot-id]').first().locator('img[data-frame-image]')).toBeVisible();
  // Undone: no frame shows it any more, but History does.
  await page.keyboard.press(await undoKey(page));
  await expect(board(page).locator('[data-shot-id]').first().locator('img[data-frame-image]')).toHaveCount(0);

  await openStorage(page);
  await expect(storage(page).getByText(/^1 picture,/)).toBeVisible();
  const asked: string[] = [];
  // Cancel deletes nothing.
  await storage(page).getByRole('button', { name: 'Clean up old pictures…' }).click();
  asked.push(await answerAsk(page, false));
  expect(asked[0]).toContain('can’t be undone');
  expect(asked[0]).toContain('1 picture only History uses');
  await expect(storage(page).getByText(/^1 picture,/)).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Clean up old pictures…' })).toBeFocused();

  await storage(page).getByRole('button', { name: 'Clean up old pictures…' }).click();
  asked.push(await answerAsk(page, true));
  await expect(storage(page).getByText('None. Every stored picture is on the board, in the Trash or in a named version.')).toBeVisible();
  expect(asked).toHaveLength(2);
  await expect(storage(page).getByRole('button', { name: 'Clean up old pictures…' })).toBeDisabled();
  await expect(storage(page).getByText('None. Every stored picture is on the board, in the Trash or in a named version.')).toBeFocused();

  // Redo names the picture again: the frame says it's missing rather than showing what was deleted.
  await closeSettings(page);
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press(await redoKey(page));
  await expect(board(page).locator('[data-shot-id]').first().getByText('Picture missing')).toBeVisible();

  // The same photo chosen again, on the other frame, is stored again, and both frames show it.
  await board(page).locator('[data-shot-id]').nth(1).click();
  const again = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Choose picture…' }).click();
  await (await again).setFiles(fixture);
  await expect(board(page).locator('[data-shot-id]').nth(1).locator('img[data-frame-image]')).toBeVisible();
  await expect(board(page).locator('[data-shot-id]').first().locator('img[data-frame-image]')).toBeVisible();
});

test('a theme image deleted by Clean up reads as missing, and shows again when chosen again', async ({ page }) => {
  const theme = await openSettings(page, 'Theme');
  const choose = async () => {
    const chooser = page.waitForEvent('filechooser');
    await theme.getByRole('button', { name: 'Choose image…' }).click();
    await (await chooser).setFiles(fixture);
  };
  await choose();
  await expect(theme.locator('img')).toBeVisible();
  // Undone: only History uses the image now.
  await page.keyboard.press(await undoKey(page));
  await expect(theme.getByText('No image')).toBeVisible();

  await settingsWindow(page).getByRole('tab', { name: 'Storage' }).click();
  await storage(page).getByRole('button', { name: 'Clean up old pictures…' }).click();
  await answerAsk(page, true);
  await expect(storage(page).getByText('None. Every stored picture is on the board, in the Trash or in a named version.')).toBeVisible();

  // Redo names it again: the well says it's missing, as a frame does; chosen again, it shows.
  await settingsWindow(page).getByRole('tab', { name: 'Theme' }).click();
  await page.keyboard.press(await redoKey(page));
  await expect(theme.getByText('Picture missing')).toBeVisible();
  await choose();
  await expect(theme.locator('img')).toBeVisible();
});

test('a question opens on Cancel, says why, and Escape answers it: nothing is deleted', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await openTile(page, 'Trash');
  await trashTile(page).getByRole('button', { name: 'Empty Trash…' }).click();
  const asked = page.getByRole('alertdialog', { name: 'Empty Trash?' });
  await expect(asked).toBeVisible();
  // Read as it opens: the question and why.
  await expect(asked).toHaveAccessibleDescription(/can’t be undone/);
  await expect(asked.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(asked.getByRole('button', { name: 'Empty Trash', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(asked).toBeHidden();
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
  await expect(trashTile(page).getByRole('button', { name: 'Empty Trash…' })).toBeFocused();
});

test('a question over Settings: Escape closes only the question, and focus goes back inside Settings', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await openStorage(page);
  await storage(page).getByRole('button', { name: 'Empty Trash…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Empty Trash?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(settingsWindow(page)).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Empty Trash…' })).toBeFocused();
  await expect(storage(page).getByText('1 item in the Trash.')).toBeVisible();
});

test('a notice raised inside Settings shows there, where it can be read and dismissed', async ({ page }) => {
  await openStorage(page);
  await storage(page).getByRole('button', { name: 'Compact project' }).click();
  const said = settingsWindow(page).getByRole('status').filter({ hasText: /^Compacted the project/ });
  await expect(said).toBeVisible();
  await said.getByRole('button', { name: 'Got it' }).click();
  await expect(said).toHaveCount(0);
});

test('a notice still showing doesn’t take a window’s first focus', async ({ page }) => {
  await openStorage(page);
  await storage(page).getByRole('button', { name: 'Compact project' }).click();
  await expect(settingsWindow(page).getByRole('status').filter({ hasText: /^Compacted the project/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // The notice now shows above the workspace; Export opens on its own first control, the notice one Tab away.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…' }).click();
  const exporting = page.getByRole('dialog', { name: 'Export' });
  await expect(exporting.getByRole('radio', { name: 'Storyboard (PDF)' })).toBeFocused();
  // Shown in the window, but not read out a second time: it was announced when it first appeared (PB's low).
  await expect(exporting.locator('[data-notice]')).toContainText(/^Compacted the project/);
  await expect(exporting.locator('[data-notice]')).not.toHaveAttribute('role');
});

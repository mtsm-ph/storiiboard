import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Empty Trash and Clean up old pictures (1.21) in the memory build: each asks first, says it can't be undone, and
// deletes for good only when the person agrees.

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
const storage = (page: Page) => page.getByRole('region', { name: 'Storage', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;
const redoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+Shift+z`;
/** Answers the next confirm, and keeps what it asked. */
function answer(page: Page, asked: string[], yes: boolean) {
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void (yes ? dialog.accept() : dialog.dismiss());
  });
}
async function openStorage(page: Page) {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Settings/ }).click();
  // Storage shares a stack with Backups in Settings.
  await page.getByRole('tab', { name: 'Storage' }).click();
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
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await trashTile(page).getByRole('button', { name: 'Empty Trash…' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('can’t be undone');
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
  // The button stays where the keys left it, so Enter asks again.
  await expect(trashTile(page).getByRole('button', { name: 'Empty Trash…' })).toBeFocused();

  answer(page, asked, true);
  await trashTile(page).getByRole('button', { name: 'Empty Trash…' }).click();
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
  answer(page, asked, true);
  await storage(page).getByRole('button', { name: 'Empty Trash…' }).click();
  await expect(storage(page).getByText('0 items in the Trash.')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('can’t be undone');
  await expect(storage(page).getByText('0 items in the Trash.')).toBeFocused();
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
  answer(page, asked, false);
  await storage(page).getByRole('button', { name: 'Clean up old pictures…' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain('can’t be undone');
  expect(asked[0]).toContain('1 picture only History uses');
  await expect(storage(page).getByText(/^1 picture,/)).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Clean up old pictures…' })).toBeFocused();

  answer(page, asked, true);
  await storage(page).getByRole('button', { name: 'Clean up old pictures…' }).click();
  await expect(storage(page).getByText('None. Every stored picture is on the board, in the Trash or in a named version.')).toBeVisible();
  expect(asked).toHaveLength(2);
  await expect(storage(page).getByRole('button', { name: 'Clean up old pictures…' })).toBeDisabled();
  await expect(storage(page).getByText('None. Every stored picture is on the board, in the Trash or in a named version.')).toBeFocused();

  // Redo names the picture again: the frame says it's missing rather than showing what was deleted.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
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

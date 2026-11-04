import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Trash tile (1.20) in the memory build: opened from the Layout menu in any workspace, it lists what was deleted
// and brings each back with one click, as one edit undo takes back.

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
  for (let i = 0; i < 3; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const trashTile = (page: Page) => page.getByRole('region', { name: 'Trash', exact: true });
const numbers = (page: Page) => board(page).locator('[data-shot-id] [data-number]').allTextContents();
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function openTrash(page: Page) {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(trashTile(page)).toBeVisible();
}

test('a deleted frame waits in the Trash, and Restore puts it back where it was', async ({ page }) => {
  await openTrash(page);
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeVisible();

  await board(page).locator('[data-shot-id]').nth(1).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => numbers(page)).toEqual(['1A', '1B']);
  const row = trashTile(page).getByRole('row', { name: /1B/ });
  await expect(row).toContainText('Frame');
  await expect(row).toContainText('SC 01');

  await trashTile(page).getByRole('button', { name: 'Restore frame 1B' }).click();
  await expect.poll(() => numbers(page)).toEqual(['1A', '1B', '1C']);
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeVisible();

  // One undo sends it back to the Trash.
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => numbers(page)).toEqual(['1A', '1B']);
  await expect(trashTile(page).getByRole('button', { name: 'Restore frame 1B' })).toBeVisible();
});

test('filters by type and scene, and a restore keeps focus in the list', async ({ page }) => {
  await openTrash(page);
  for (let i = 0; i < 2; i += 1) {
    await board(page).locator('[data-shot-id]').first().click();
    await page.keyboard.press('Delete');
  }
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(2);
  await trashTile(page).getByRole('combobox', { name: /^Type/ }).selectOption({ label: 'Notes' });
  await expect(trashTile(page).getByText('Nothing in the Trash matches these filters.')).toBeVisible();
  await trashTile(page).getByRole('combobox', { name: /^Type/ }).selectOption({ label: 'Frames' });
  await trashTile(page).getByRole('combobox', { name: /^Scene/ }).selectOption({ label: 'SC 01' });
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(2);

  await trashTile(page).getByRole('button', { name: /^Restore frame/ }).first().click();
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toBeFocused();
});

test('a scene with nothing left in the Trash leaves the filter, and focus goes to the message once the list is empty', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 02' }).click();
  await openTrash(page);
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('Delete');
  await board(page).locator('[data-shot-id]').last().click();
  await page.keyboard.press('Delete');
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(2);

  const scene = trashTile(page).getByRole('combobox', { name: /^Scene/ });
  await scene.selectOption({ label: 'SC 02' });
  await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
  await trashTile(page).getByRole('button', { name: 'Restore frame 2A' }).click();
  // SC 02 has nothing left in the Trash, so the filter shows every scene again rather than nothing.
  await expect(scene).toHaveValue('');
  await expect(trashTile(page).getByRole('button', { name: 'Restore frame 1A' })).toBeFocused();
  await trashTile(page).getByRole('button', { name: 'Restore frame 1A' }).click();
  await expect(trashTile(page).getByText('The Trash is empty.', { exact: false })).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Trash passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openTrash(page);
    await board(page).locator('[data-shot-id]').first().click();
    await page.keyboard.press('Delete');
    await expect(trashTile(page).getByRole('button', { name: /^Restore frame/ })).toHaveCount(1);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

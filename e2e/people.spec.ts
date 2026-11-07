import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Cast & crew tile (3.5) in the memory build: a person added and named, given a role, departments, a title and a
// phone, each one edit; one ⌘Z takes back the last; Delete sends them to the Trash and Restore brings them back.

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

const tile = (page: Page) => page.getByRole('region', { name: 'Cast and crew', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a person is added, named, given a role, departments and contacts; Delete and Restore', async ({ page }) => {
  const people = tile(page);
  const editor = people.locator('[data-person-editor]');
  await expect(people.getByText('No one yet.', { exact: false })).toBeVisible();
  await people.getByRole('button', { name: '+ New person' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Director of photography' });
  await editor.getByRole('button', { name: 'Camera', exact: true }).click();
  await editor.getByRole('button', { name: 'Grip & electric', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const list = people.getByRole('list', { name: 'Cast and crew' });
  await expect(list.getByRole('button')).toHaveText([/Kevin Matos.*Director of photography · Camera, Grip & electric/]);
  await editor.getByRole('textbox', { name: 'Phone' }).fill('+1 212 555 0100');
  // Left for a button, where ⌘Z is the project's (in a text field it's the field's own). One ⌘Z: the phone back to
  // empty, the departments as they are.
  await editor.getByRole('button', { name: 'Camera', exact: true }).focus();
  await page.keyboard.press(await undoKey(page));
  await expect(editor.getByRole('textbox', { name: 'Phone' })).toHaveValue('');
  await expect(editor.getByRole('button', { name: 'Grip & electric', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // WCAG 2.2 AA, as the app's other checks run it, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  // Delete, then Restore from the Trash.
  await editor.getByRole('button', { name: 'Delete person' }).click();
  await expect(people.getByText('No one yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: 'Restore person Kevin Matos' }).click();
  await expect(list.getByRole('button')).toHaveText([/Kevin Matos/]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Custom fields on frames (1.19) in the memory build: added and filled in the inspector, shown as shot list columns,
// kept across a reload, and undone one edit at a time.

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
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function addField(page: Page, name: string, value: string) {
  await inspector(page).getByLabel('New field').fill(name);
  await inspector(page).getByRole('button', { name: 'Add field' }).click();
  // The new field takes focus, ready for its value.
  const field = inspector(page).getByRole('textbox', { name: new RegExp(`^${name}$`, 'i') });
  await expect(field).toBeFocused();
  await field.fill(value);
  await field.press('Enter');
}

test('adds a field to a frame, shows it as a shot list column, and keeps it after a reload', async ({ page }) => {
  await frames(page).nth(0).click();
  await addField(page, 'Drone', 'Mavic 3');
  await addField(page, 'VFX', 'Sky replace');

  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  const table = board(page).getByRole('table', { name: 'Shot list' });
  await expect(table.getByRole('columnheader', { name: 'Drone' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'VFX' })).toBeVisible();
  await expect(table.getByRole('row', { name: /^1A/ })).toContainText('Mavic 3');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await frames(page).nth(0).click();
  await expect(inspector(page).getByRole('textbox', { name: 'Drone' })).toHaveValue('Mavic 3');
});

test('a second frame takes the project’s spelling of a field, and Remove takes it off that frame only', async ({ page }) => {
  await frames(page).nth(0).click();
  await addField(page, 'Drone', 'Mavic 3');
  await frames(page).nth(1).click();
  await addField(page, 'drone', 'FPV');
  // The project's spelling, not the one typed.
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toHaveValue('FPV');

  await inspector(page).getByRole('button', { name: 'Remove Drone from this frame' }).click();
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toHaveCount(0);
  await frames(page).nth(0).click();
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toHaveValue('Mavic 3');

  // Undo brings the second frame's field back.
  await page.keyboard.press(await undoKey(page));
  await frames(page).nth(1).click();
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toHaveValue('FPV');
});

test('from the keyboard, Add field puts the focus in the new field, and Remove moves it on, then to New field', async ({ page }) => {
  await frames(page).nth(0).click();
  await inspector(page).getByLabel('New field').fill('Drone');
  await page.keyboard.press('Tab');
  await expect(inspector(page).getByRole('button', { name: 'Add field' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toBeFocused();
  await addField(page, 'VFX', 'Sky replace');

  await inspector(page).getByRole('button', { name: 'Remove Drone from this frame' }).click();
  await expect(inspector(page).getByRole('textbox', { name: 'VFX', exact: true })).toBeFocused();
  await inspector(page).getByRole('button', { name: 'Remove VFX from this frame' }).click();
  await expect(inspector(page).getByLabel('New field')).toBeFocused();
});

test('refuses the name of one of the frame’s own fields', async ({ page }) => {
  await frames(page).nth(0).click();
  await inspector(page).getByLabel('New field').fill('status');
  await inspector(page).getByLabel('New field').press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('status is one of the frame’s own fields. Choose another name.');
  await expect(inspector(page).getByRole('button', { name: /^Remove .* from this frame$/ })).toHaveCount(0);
});

test('refuses a name that’s only spaces', async ({ page }) => {
  await frames(page).nth(0).click();
  await expect(inspector(page).getByRole('button', { name: 'Add field' })).toBeDisabled();
  await inspector(page).getByLabel('New field').fill('   ');
  await expect(inspector(page).getByRole('button', { name: 'Add field' })).toBeDisabled();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the inspector with custom fields passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await frames(page).nth(0).click();
    await addField(page, 'Drone', 'Mavic 3');
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(violations).toEqual([]);
  });
}

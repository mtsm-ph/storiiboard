import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Locations tile (3.3) in the memory build: a location set on a scene from the "/" menu shows there with its
// scene; its details are edited once for every scene, one edit each; Delete sends it to the Trash and Restore brings it
// back, its scene with it.

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
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
  // The scene's location, from the "/" menu.
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).getByText('Diner')).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
  // A small tile in Production's layout: given the room to edit, as a person would.
  await tile(page).getByRole('button', { name: 'Maximize Locations' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const tile = (page: Page) => page.getByRole('region', { name: 'Locations', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a scene’s location shows with its scene, and its details are edited once, each one edit', async ({ page }) => {
  const locations = tile(page);
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*TBD · 1 scene/]);
  const editor = locations.locator('[data-location-editor]');
  await expect(editor.getByText('SC 01')).toBeVisible();
  await editor.getByRole('textbox', { name: 'Address' }).fill('12 Route 9, Bey County');
  await editor.getByRole('textbox', { name: 'Parking' }).click();
  await editor.getByRole('textbox', { name: 'Parking' }).fill('Lot behind the diner');
  await editor.getByRole('radio', { name: 'Confirmed' }).click();
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*Confirmed · 1 scene/]);
  await expect(editor.getByRole('textbox', { name: 'Parking' })).toHaveValue('Lot behind the diner');
  // One ⌘Z: the status back to TBD, the address and parking as they are.
  await editor.getByRole('radio', { name: 'Confirmed' }).focus();
  await page.keyboard.press(await undoKey(page));
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*TBD · 1 scene/]);
  await expect(editor.getByRole('textbox', { name: 'Address' })).toHaveValue('12 Route 9, Bey County');
  // A new one, named straight away.
  await locations.getByRole('button', { name: '+ New location' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Barn');
  await page.keyboard.press('Enter');
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Barn.*0 scenes/, /Diner/]);
  // WCAG 2.2 AA, as the app's other checks run it, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);
});

test('Delete sends a location to the Trash; Restore brings it back with its scene', async ({ page }) => {
  const locations = tile(page);
  await locations.getByRole('button', { name: 'Delete location' }).click();
  await expect(locations.getByText('No locations yet.', { exact: false })).toBeVisible();
  // The scene no longer reads as there.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).getByText('Diner')).toHaveCount(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await trash.getByRole('button', { name: 'Restore location Diner' }).click();
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).getByText('Diner')).toBeVisible();
});

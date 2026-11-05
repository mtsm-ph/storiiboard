import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Scene palettes (polish PP) in the memory build: generated from the frames' pictures, edited in the inspector, each
// change an edit undo takes back, and shown as a strip on the scene's row in the Scenes tile.

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url));

test.beforeEach(async ({ page, context, browserName }) => {
  // Chromium asks; WebKit lets a click write to the clipboard as Safari does.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).locator('[data-shot-id]').first().click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const swatches = (page: Page) => inspector(page).getByRole('toolbar', { name: 'Palette for SC 01' }).getByRole('button');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function choosePicture(page: Page, name: string) {
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fixture(name));
  await expect(board(page).locator('[data-shot-id] img').first()).toBeVisible();
}

test('generates a scene’s palette from its frames, colour-managed, and edits it with undo', async ({ page, browserName }) => {
  await expect(inspector(page).getByText('Add pictures to this scene’s frames to make its palette.')).toBeVisible();
  await expect(inspector(page).getByRole('button', { name: 'Generate palette' })).toBeDisabled();

  await choosePicture(page, 'p3-red.jpg');
  await inspector(page).getByRole('button', { name: 'Generate palette' }).click();
  await expect(swatches(page).first()).toBeVisible();
  // Display P3 red, drawn colour-managed onto sRGB: about #FF0000, never the (234, 51, 35) of P3 numbers read as sRGB.
  const label = (await swatches(page).first().getAttribute('aria-label')) ?? '';
  const hex = /#([0-9A-F]{6})/.exec(label)?.[1] ?? '000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  expect(r).toBeGreaterThan(240);
  expect(g).toBeLessThan(40);
  expect(b).toBeLessThan(40);
  await expect(scenesTile(page).locator('[data-palette-strip] span')).not.toHaveCount(0);

  // Click copies the hex.
  await swatches(page).first().click();
  await expect(page.getByRole('status').getByText(`Copied #${hex}.`)).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`#${hex}`);

  // L locks it, and undo takes the lock back.
  await swatches(page).first().focus();
  await page.keyboard.press('l');
  await expect(swatches(page).first()).toHaveAccessibleName(/, locked$/);
  await expect(inspector(page).getByRole('button', { name: 'Lock', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(await undoKey(page));
  await expect(swatches(page).first()).not.toHaveAccessibleName(/, locked$/);

  // Delete takes colours out, focus staying in the palette; with the last one gone, it's on Regenerate's place.
  await swatches(page).first().focus();
  const count = await swatches(page).count();
  for (let i = 0; i < count; i += 1) {
    if (i < count - 1) await expect(swatches(page).first()).toBeFocused();
    await page.keyboard.press('Delete');
  }
  await expect(inspector(page).getByText('No palette yet. Generate one from this scene’s frames.')).toBeVisible();
  await expect(inspector(page).getByRole('button', { name: 'Generate palette' })).toBeFocused();
  await expect(scenesTile(page).locator('[data-palette-strip]')).toHaveCount(0);
  await page.keyboard.press(await undoKey(page));
  await expect(swatches(page)).toHaveCount(1);
});

test('keeps a locked colour in its place when the rest are generated again, and the count sets how many', async ({ page }) => {
  // Two frames, two pictures of different colours.
  await choosePicture(page, 'srgb.jpg');
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).locator('[data-shot-id]').nth(1).click();
  await choosePicture(page, 'p3-red.jpg');
  await inspector(page).getByLabel('Colours').selectOption('1');
  await inspector(page).getByRole('button', { name: 'Generate palette' }).click();
  await expect(swatches(page)).toHaveCount(1);

  // Lock it, ask for more, generate again: the locked one stays first, the rest come after it.
  const kept = (await swatches(page).first().getAttribute('aria-label')) ?? '';
  const keptHex = /#[0-9A-F]{6}/.exec(kept)?.[0] ?? '';
  await swatches(page).first().click();
  await inspector(page).getByRole('button', { name: 'Lock', exact: true }).click();
  await inspector(page).getByLabel('Colours').selectOption('4');
  await inspector(page).getByRole('button', { name: 'Regenerate' }).click();
  await expect(swatches(page)).not.toHaveCount(1);
  await expect(swatches(page).first()).toHaveAccessibleName(new RegExp(`^Colour 1 of [0-9]+, ${keptHex}, locked$`));

  // ⌘ (Ctrl) with an arrow moves a colour, and focus goes with it.
  await swatches(page).first().focus();
  await page.keyboard.press(`${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+ArrowRight`);
  await expect(swatches(page).nth(1)).toHaveAccessibleName(new RegExp(`^Colour 2 of [0-9]+, ${keptHex}, locked$`));
  await expect(swatches(page).nth(1)).toBeFocused();
});

test('the palette editor passes the axe checks', async ({ page }) => {
  await choosePicture(page, 'srgb.jpg');
  await inspector(page).getByRole('button', { name: 'Generate palette' }).click();
  await expect(swatches(page).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(results.violations).toEqual([]);
});

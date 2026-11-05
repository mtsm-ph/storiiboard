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

test('the eyedropper adds the colour under the pointer from any frame’s picture; Esc stops it; a typed hex adds too', async ({ page }) => {
  await choosePicture(page, 'p3-red.jpg');
  await inspector(page).getByRole('button', { name: 'Pick from a frame' }).click();
  await expect(inspector(page).getByRole('button', { name: 'Pick from a frame' })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector(page).getByRole('status').filter({ hasText: 'Click a picture on any frame' })).toBeVisible();
  // A click on the frame's picture picks, and doesn't select or drag the frame.
  await board(page).locator('[data-shot-id] img[data-frame-image]').first().click();
  await expect(page.getByRole('status').getByText(/^Added #[0-9A-F]{6} to SC 01’s palette\.$/)).toBeVisible();
  await expect(swatches(page)).toHaveCount(1);
  const picked = /#([0-9A-F]{6})/.exec((await swatches(page).first().getAttribute('aria-label')) ?? '')?.[1] ?? '000000';
  expect(parseInt(picked.slice(0, 2), 16)).toBeGreaterThan(240);
  await expect(inspector(page).getByRole('button', { name: 'Pick from a frame' })).toHaveAttribute('aria-pressed', 'false');

  // While picking, a menu drawn over the board still works: its item runs, nothing is picked through it.
  await inspector(page).getByRole('button', { name: 'Pick from a frame' }).click();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Color script', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Color script', exact: true })).toBeVisible();
  await expect(swatches(page)).toHaveCount(1);

  await expect(page.locator('html[data-eyedropper]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Escape stops it without picking.
  await inspector(page).getByRole('button', { name: 'Pick from a frame' }).click();
  await page.keyboard.press('Escape');
  await expect(inspector(page).getByRole('button', { name: 'Pick from a frame' })).toHaveAttribute('aria-pressed', 'false');

  // Picking stops when the inspector moves on to another scene: it never picks for a scene that isn't on screen.
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await scenesTile(page).getByRole('list', { name: 'Scenes' }).locator('[data-scene-row]').first().click();
  await board(page).locator('[data-shot-id]').first().click();
  await inspector(page).getByRole('button', { name: 'Pick from a frame' }).click();
  await expect(page.locator('html[data-eyedropper]')).toHaveCount(1);
  await scenesTile(page).getByRole('list', { name: 'Scenes' }).locator('[data-scene-row]').nth(1).click();
  await expect(page.locator('html[data-eyedropper]')).toHaveCount(0);
  await scenesTile(page).getByRole('list', { name: 'Scenes' }).locator('[data-scene-row]').first().click();
  await board(page).locator('[data-shot-id]').first().click();

  // The keyboard's way: a typed hex.
  const field = inspector(page).getByLabel('Add a colour');
  await field.fill('nope');
  await field.press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('A colour as six hex digits, such as #A35139.');
  await field.fill('1f2f4d');
  await field.press('Enter');
  await expect(swatches(page)).toHaveCount(2);
  await expect(swatches(page).nth(1)).toHaveAccessibleName('Colour 2 of 2, #1F2F4D');
  await expect(swatches(page).nth(1)).toBeFocused();
});

test('the Color script lists every scene’s palette in script order, and opens a scene', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Color script', exact: true }).click();
  const tile = page.getByRole('region', { name: 'Color script', exact: true });
  const rows = tile.getByRole('list', { name: 'Scene palettes in script order' }).getByRole('button');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('No palette');

  await board(page).locator('[data-shot-id]').first().click();
  await inspector(page).getByLabel('Add a colour').fill('#A35139');
  await inspector(page).getByLabel('Add a colour').press('Enter');
  await expect(rows.first()).toContainText('1 colour: #A35139');
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
});

test('Export offers the PDF storyboard’s scene palettes, and remembers the choice', async ({ page }) => {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…' }).click();
  const exportWindow = page.getByRole('dialog', { name: 'Export' });
  const toggle = exportWindow.getByRole('switch', { name: 'Print each scene’s palette in its heading' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await exportWindow.getByRole('radio', { name: 'Shot list (CSV)' }).click();
  await expect(toggle).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' }).getByRole('switch', { name: 'Print each scene’s palette in its heading' })).toHaveAttribute('aria-checked', 'true');
});

test('the palette editor passes the axe checks', async ({ page }) => {
  await choosePicture(page, 'srgb.jpg');
  await inspector(page).getByRole('button', { name: 'Generate palette' }).click();
  await expect(swatches(page).first()).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(results.violations).toEqual([]);
});

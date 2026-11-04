import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// A new project's first step and Settings → Theme (1.16), in the memory build: a logo gives accents, Create writes the
// image and the theme in one op group that one undo takes back, Skip writes nothing, and Settings takes an accent by
// hand through the same AA fit.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

const onboarding = (page: Page) => page.getByRole('dialog', { name: 'Set up Bey County' });
const themeTile = (page: Page) => page.getByRole('region', { name: 'Theme', exact: true });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const accent = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));
/** ⌘ where the app thinks it's on a Mac, Ctrl elsewhere (the Chromium project runs with a Windows user agent). */
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function newProject(page: Page) {
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(onboarding(page)).toBeVisible();
}

/** A logo drawn in the page: a navy disc on white, as a PNG file. */
async function logo(page: Page) {
  const data = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#1e6bd6';
    ctx.beginPath();
    ctx.arc(100, 100, 70, 0, Math.PI * 2);
    ctx.fill();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(data) };
}

async function chooseLogo(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await onboarding(page).getByRole('button', { name: 'Choose image…' }).click();
  await (await chooser).setFiles(await logo(page));
}

test('Skip, or Escape, leaves the kit’s look and writes nothing', async ({ page }) => {
  await newProject(page);
  await onboarding(page).getByRole('button', { name: 'Skip' }).click();
  await expect(onboarding(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();
  // Focus lands on the workspace's section, not the page.
  await expect(sidebar(page).getByRole('button', { name: /^Storyboard/ })).toBeFocused();
  expect(await accent(page)).toBe('');

  // A second project, from the switcher: Escape skips its onboarding the same way.
  page.once('dialog', (dialog) => void dialog.accept('Bey County Pilot'));
  await sidebar(page).getByRole('button', { name: /^Project: / }).click();
  await page.getByRole('button', { name: 'New project…' }).click();
  const second = page.getByRole('dialog', { name: 'Set up Bey County Pilot' });
  await expect(second).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(second).toHaveCount(0);
  expect(await accent(page)).toBe('');
});

test('a logo offers its accent, the dialog previews it, and Create themes the project in one undoable step', async ({ page }) => {
  await newProject(page);
  await chooseLogo(page);
  const accents = onboarding(page).getByRole('radiogroup', { name: 'Accent' }).getByRole('radio');
  // The kit's orange, then the logo's navy, picked by default as the most saturated.
  await expect(accents).toHaveCount(2);
  await expect(accents.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(onboarding(page).getByText('logo.png')).toBeVisible();
  // The dialog wears the theme it previews, before anything is written.
  const previewed = await onboarding(page).evaluate((d) => d.style.getPropertyValue('--accent'));
  expect(previewed).toMatch(/^#[0-9A-F]{6}$/);
  expect(await accent(page)).toBe('');

  // Arrow keys move between the accents.
  await accents.nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(accents.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(accents.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');

  await onboarding(page).getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).click();
  await onboarding(page).getByRole('button', { name: 'Create' }).click();
  await expect(onboarding(page)).toHaveCount(0);
  await expect.poll(() => accent(page)).not.toBe('');
  // Follow project takes the project's own mode.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await sidebar(page).getByRole('button', { name: /^Settings/ }).click();
  await expect(themeTile(page).getByText('logo.png')).toBeVisible();

  // One undo takes back the image and the theme together.
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => accent(page)).toBe('');
  await expect(themeTile(page).getByText('No image')).toBeVisible();
});

test('a picture dropped on the dialog is its image, never a frame on the board', async ({ page }) => {
  await newProject(page);
  const file = await logo(page);
  const transfer = await page.evaluateHandle((data) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' }));
    return dataTransfer;
  }, [...file.buffer]);
  await onboarding(page).dispatchEvent('drop', { dataTransfer: transfer });
  await expect(onboarding(page).getByText('dropped.png')).toBeVisible();
  await onboarding(page).getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).locator('[data-shot-id]')).toHaveCount(0);
});

test('Settings → Theme takes an accent by hand, shows what AA makes of it, and resets to the kit', async ({ page }) => {
  await newProject(page);
  await onboarding(page).getByRole('button', { name: 'Skip' }).click();
  await sidebar(page).getByRole('button', { name: /^Settings/ }).click();

  const hex = themeTile(page).getByLabel('Hex');
  await hex.fill('#f60');
  // Picked, then what's used in each mode after the AA fit.
  await expect(themeTile(page).getByText(/^#FF6600 → #[0-9A-F]{6} light, #[0-9A-F]{6} dark$/)).toBeVisible();
  await hex.fill('blue');
  await expect(themeTile(page).getByText('A colour as six hex digits, #RRGGBB, or three, #RGB.')).toBeVisible();
  await expect(themeTile(page).getByRole('button', { name: 'Use this accent' })).toBeDisabled();
  await hex.fill('#1E6BD6');
  await hex.press('Enter');
  await expect.poll(() => accent(page)).not.toBe('');
  const used = await accent(page);

  await themeTile(page).getByRole('button', { name: 'Reset to default' }).click();
  await expect.poll(() => accent(page)).toBe('');
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => accent(page)).toBe(used);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`onboarding and Settings → Theme pass axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await newProject(page);
    await chooseLogo(page);
    await expect(onboarding(page).getByRole('radiogroup', { name: 'Accent' }).getByRole('radio')).toHaveCount(2);
    await onboarding(page).getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: scheme === 'dark' ? 'Dark' : 'Light' }).click();
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).include('dialog').withTags(tags).analyze()).violations).toEqual([]);

    await onboarding(page).getByRole('button', { name: 'Create' }).click();
    await sidebar(page).getByRole('button', { name: /^Settings/ }).click();
    await expect(themeTile(page).getByText('logo.png')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

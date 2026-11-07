import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// A video's LUT (2.5) in the memory build: loaded from a .cube, picked from the project's, or taken off, one undo step
// each; another LUT is another playback copy (pretended here: the browser build plays the file as it is, and the
// desktop's grading has its own Rust tests). The fixture: 2 s of H.264 at 24000/1001, 320 x 180.

const clipPath = fileURLToPath(new URL('./fixtures/video/A001_C003_2398.mp4', import.meta.url));

/** A 2-point cube that inverts: written here, as no camera maker's LUT is ever shipped. */
const INVERT = 'TITLE "Invert"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n';
/** The same LUT under another name, and one darker, for the list. */
const DARKER = 'LUT_3D_SIZE 2\n0 0 0\n0.5 0 0\n0 0.5 0\n0.5 0.5 0\n0 0 0.5\n0.5 0 0.5\n0 0.5 0.5\n0.5 0.5 0.5\n';

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
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(clipPath);
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);
});

const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const copyLine = (page: Page) => inspector(page).locator('[data-copy-state]');
const lutList = (page: Page) => inspector(page).getByRole('combobox', { name: 'LUT' });
/** A pretend copy takes 2.5 s; a loaded runner's timers can run late. */
const READY = { timeout: 15_000 };
/** Shorter than a pretend copy takes: a copy ready this soon was found, not made again. */
const FOUND = { timeout: 2_000 };
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

async function loadLut(page: Page, name: string, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Load LUT…' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
}

const chosen = (page: Page) => lutList(page).evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');

test('loads a LUT for the video, makes its graded copy, and undoes and redoes it in one step each', async ({ page }) => {
  await expect.poll(() => chosen(page)).toBe('None (as shot)');
  // Every option the list shows from here: a LUT just stored is never called missing while the list reads it again.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { lutOptions: string[] }).lutOptions = seen;
    const list = document.querySelector('[data-video-lut]');
    if (!list) return;
    new MutationObserver(() => {
      for (const option of list.querySelectorAll('option')) seen.push(option.textContent);
    }).observe(list, { subtree: true, childList: true, characterData: true });
  });
  await loadLut(page, 'Invert.cube', INVERT);
  await expect.poll(() => chosen(page)).toBe('Invert');
  expect(await page.evaluate(() => (window as unknown as { lutOptions: string[] }).lutOptions)).not.toContain('LUT not in the project');
  // Another LUT is another copy: made at once, as after a relink.
  await expect(copyLine(page)).not.toHaveText('Playback copy ready.');
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);
  expect(await new AxeBuilder({ page }).include('[data-inspector]').analyze().then((r) => r.violations)).toEqual([]);

  // One undo takes the LUT off: the copy as shot is the video's again, found as it was.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press(`${await command(page)}+z`);
  await expect.poll(() => chosen(page)).toBe('None (as shot)');
  await expect(copyLine(page)).toHaveText('Playback copy ready.', FOUND);
  // Redo puts it back, and its graded copy is found, not made again.
  await page.keyboard.press(`${await command(page)}+Shift+z`);
  await expect.poll(() => chosen(page)).toBe('Invert');
  await expect(copyLine(page)).toHaveText('Playback copy ready.', FOUND);
});

test('picks among the project’s LUTs, takes one off, and stores a LUT loaded twice once', async ({ page }) => {
  await loadLut(page, 'Invert.cube', INVERT);
  await expect.poll(() => chosen(page)).toBe('Invert');
  await loadLut(page, 'Darker.cube', DARKER);
  await expect.poll(() => chosen(page)).toBe('Darker');
  // The same text under another name: the LUT stored already, not a second one.
  await loadLut(page, 'Invert copy.cube', INVERT);
  await expect.poll(() => chosen(page)).toBe('Invert');
  const names = await lutList(page).locator('option').allTextContents();
  expect(names).toEqual(['None (as shot)', 'Darker', 'Invert']);
  // Picked from the list, and taken off.
  await lutList(page).selectOption({ label: 'Darker' });
  await expect.poll(() => chosen(page)).toBe('Darker');
  await lutList(page).selectOption({ label: 'None (as shot)' });
  await expect.poll(() => chosen(page)).toBe('None (as shot)');
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);
});

test('refuses a file that isn’t a LUT it can use, saying why, and leaves the video’s LUT as it was', async ({ page }) => {
  await loadLut(page, 'Shaper.cube', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
  await expect(page.locator('[data-notice]')).toContainText('Shaper.cube is a 1D LUT. Load a 3D LUT (one with LUT_3D_SIZE) instead.');
  await expect.poll(() => chosen(page)).toBe('None (as shot)');
  await loadLut(page, 'Short.cube', 'LUT_3D_SIZE 2\n0 0 0\n');
  await expect(page.locator('[data-notice]')).toContainText('Short.cube doesn’t have the rows its size says');
  await expect(lutList(page).locator('option')).toHaveCount(1);
  await expect(copyLine(page)).toHaveText('Playback copy ready.');
});

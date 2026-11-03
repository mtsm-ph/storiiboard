import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Pictures in frames (1.11) on real projects in the memory build: chosen, dropped and pasted, framed in the inspector,
// undone, and still there after a reload. In the desktop app the files come through Rust instead
// (src-tauri/src/pictures.rs), which has its own test; what happens to them after that is the same code.

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url));
const fixture = (name: string) => [...readFileSync(fixturePath(name))];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const frames = (page: Page) => board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
const pictureIn = (page: Page, index: number) => frames(page).nth(index).locator('img[data-frame-image]');
const numbers = (page: Page) => frames(page).locator('[data-number]').allTextContents();
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

/** Files as a drag or the clipboard carries them, built in the page. */
function files(page: Page, list: { name: string; type: string; data: number[] }[]) {
  return page.evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const { name, type, data } of list) transfer.items.add(new File([new Uint8Array(data)], name, { type }));
    return transfer;
  }, list);
}

const jpeg = (name = 'srgb.jpg') => ({ name, type: 'image/jpeg', data: fixture('srgb.jpg') });

test('chooses a picture in the inspector; the card shows it, and it’s there after a reload', async ({ page }) => {
  await expect(inspector(page).getByText('No picture')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fixturePath('srgb.jpg'));

  await expect(pictureIn(page, 0)).toBeVisible();
  await expect(inspector(page).getByText('srgb.jpg')).toBeVisible();
  await expect(inspector(page).getByRole('application', { name: /^Framing/ })).toBeVisible();

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(pictureIn(page, 0)).toBeVisible();
});

test('a drop on a frame sets its picture, a drop on the scene adds frames, and one ⌘Z takes back each', async ({ page }) => {
  await frames(page).nth(0).dispatchEvent('drop', { dataTransfer: await files(page, [jpeg()]) });
  await expect(pictureIn(page, 0)).toBeVisible();

  const add = board(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.dispatchEvent('drop', { dataTransfer: await files(page, [jpeg('one.jpg'), jpeg('two.jpg')]) });
  await expect.poll(() => numbers(page)).toEqual(['1A', '1B', '1C']);
  await expect(pictureIn(page, 2)).toBeVisible();
  // The first new frame is selected.
  await expect(frames(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(inspector(page).getByText('one.jpg')).toBeVisible();

  const mod = await command(page);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => numbers(page)).toEqual(['1A']);
  await expect(pictureIn(page, 0)).toBeVisible();
  await page.keyboard.press(`${mod}+z`);
  await expect(pictureIn(page, 0)).toHaveCount(0);
});

/** A paste of a PNG, sent to whatever has focus, as ⌘V would. */
const paste = (page: Page) =>
  page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'image.png', { type: 'image/png' }));
    (document.activeElement ?? document).dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, fixture('alpha.png'));

test('pastes a picture into the selected frame, and Remove empties it again', async ({ page }) => {
  await frames(page).nth(0).click();
  await paste(page);
  await expect(pictureIn(page, 0)).toBeVisible();

  await inspector(page).getByRole('button', { name: 'Remove' }).click();
  await expect(pictureIn(page, 0)).toHaveCount(0);
  await expect(inspector(page).getByText('No picture')).toBeVisible();
  // Focus stays in the Picture section rather than falling to the page.
  await expect(inspector(page).getByRole('button', { name: 'Choose picture…' })).toBeFocused();
});

test('a paste while typing in a field is the field’s, not a picture', async ({ page }) => {
  await inspector(page).getByLabel('Lens (mm)').focus();
  await paste(page);
  await page.waitForTimeout(300);
  await expect(pictureIn(page, 0)).toHaveCount(0);
});

test('Enter on a frame with a picture goes to its camera, and a drop on the inspector replaces the picture', async ({ page }) => {
  await frames(page).nth(0).dispatchEvent('drop', { dataTransfer: await files(page, [jpeg('first.jpg')]) });
  await expect(inspector(page).getByText('first.jpg')).toBeVisible();
  await frames(page).nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('radiogroup', { name: 'Size' }).getByRole('radio').first()).toBeFocused();

  const section = inspector(page).locator('section', { has: page.getByRole('application', { name: /^Framing/ }) });
  await section.dispatchEvent('drop', { dataTransfer: await files(page, [jpeg('second.jpg')]) });
  await expect(inspector(page).getByText('second.jpg')).toBeVisible();
});

test('frames the picture with the keys and the zoom, saving each move once', async ({ page }) => {
  await frames(page).nth(0).dispatchEvent('drop', { dataTransfer: await files(page, [jpeg()]) });
  const framing = inspector(page).getByRole('application', { name: /^Framing/ });
  await expect(framing).toHaveAccessibleName('Framing, zoom 100%');
  const left = () => pictureIn(page, 0).evaluate((img) => (img as HTMLImageElement).style.left);
  const before = await left();

  await framing.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(framing).toHaveAccessibleName('Framing, zoom 121%');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(left).not.toBe(before);
  // The card follows the saved framing.
  const moved = await left();

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await frames(page).nth(0).click();
  await expect(inspector(page).getByRole('application', { name: /^Framing/ })).toHaveAccessibleName('Framing, zoom 121%');
  await expect.poll(left).toBe(moved);

  // One undo per move: the pan, then each zoom step.
  await inspector(page).getByRole('application', { name: /^Framing/ }).focus();
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(inspector(page).getByRole('application', { name: /^Framing/ })).toHaveAccessibleName('Framing, zoom 121%');
  await expect.poll(left).not.toBe(moved);
  await inspector(page).getByRole('button', { name: 'Centre' }).click();
  await expect(inspector(page).getByRole('application', { name: /^Framing/ })).toHaveAccessibleName('Framing, zoom 100%');
});

test('names a file that isn’t a picture, and still adds the rest', async ({ page }) => {
  const add = board(page).getByRole('button', { name: '+ Frame in SC 01' });
  const notes = { name: 'notes.txt', type: 'text/plain', data: [...Buffer.from('Call sheet notes')] };
  await add.dispatchEvent('drop', { dataTransfer: await files(page, [notes, jpeg()]) });
  await expect(page.getByText('1 of 2 files weren’t added. notes.txt: This file isn’t an image Storiiboard can read.')).toBeVisible();
  await expect.poll(() => numbers(page)).toEqual(['1A', '1B']);
  await expect(pictureIn(page, 1)).toBeVisible();
});

test('says to convert an HEIC photo the engine can’t read', async ({ page }) => {
  // Not a real HEIC: the message is the same for any HEIC this engine can't decode.
  const heic = { name: 'IMG_4012.HEIC', type: 'image/heic', data: [...Buffer.from('not really a photo')] };
  await frames(page).nth(0).dispatchEvent('drop', { dataTransfer: await files(page, [heic]) });
  await expect(page.getByText('This is an HEIC photo, which Storiiboard can’t read on this computer yet. Convert it to JPEG first.')).toBeVisible();
  await expect(pictureIn(page, 0)).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`a frame with a picture passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await frames(page).nth(0).dispatchEvent('drop', { dataTransfer: await files(page, [jpeg()]) });
    await expect(inspector(page).getByRole('application', { name: /^Framing/ })).toBeVisible();
    await expect(pictureIn(page, 0)).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

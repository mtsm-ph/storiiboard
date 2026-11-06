import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answerAsk } from './ask';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings, settingsWindow } from './settings';

// Linking videos to frames (2.2b) in the memory build. The browser build can't run ffmpeg, so a stand-in reads the
// MP4's own boxes and grabs the first frame from a <video> (src/app/video.ts); the desktop app's ffmpeg path has its
// own Rust tests. The fixture: 2 s of H.264 at 24000/1001, 320 x 180, made once and checked in. Playback copies (2.3b)
// are pretended too: each takes 2.5 s and 2.4 MB, kept for the page (src/app/playback.ts).

const clipPath = fileURLToPath(new URL('./fixtures/video/A001_C003_2398.mp4', import.meta.url));

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
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const frames = (page: Page) => board(page).locator('[aria-label="Frames in SC 01"] [data-shot-id]');
const copyLine = (page: Page) => inspector(page).locator('[data-copy-state]');
const storage = (page: Page) => settingsWindow(page).getByRole('tabpanel', { name: 'Storage', exact: true });
const copies = (page: Page) => storage(page).locator('[data-playback-copies]');
/** A pretend copy takes 2.5 s; a loaded runner's timers can run late. */
const READY = { timeout: 15_000 };
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

async function linkFromInspector(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(clipPath);
}

test('links a video to a frame: its first frame is the picture, the card says Clip, the inspector reads the file', async ({ page }) => {
  await linkFromInspector(page);

  const card = frames(page).first();
  await expect(card.locator('img[data-frame-image]')).toBeVisible();
  await expect(card.locator('[data-clip-tag]')).toHaveText('Clip');
  const details = inspector(page).locator('[data-video-details]');
  await expect(details).toContainText('A001_C003_2398.mp4');
  await expect(details).toContainText('23.976 fps · 320 × 180');
  // No source timecode in the stand-in: the clip runs from 00:00:00:00, 48 frames.
  await expect(details).toContainText('00:00:00:00 – 00:00:01:23 · 48 frames');
  expect(await new AxeBuilder({ page }).include('[data-inspector]').analyze().then((r) => r.violations)).toEqual([]);

  // One undo takes the link back whole: the clip, the picture.
  await card.focus();
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(card.locator('[data-clip-tag]')).toHaveCount(0);
  await expect(card.locator('img[data-frame-image]')).toHaveCount(0);
  await expect(inspector(page).locator('[data-video-details]')).toHaveCount(0);
});

test('a video dropped on the board becomes a frame; Unlink keeps its picture', async ({ page }) => {
  const data = [...readFileSync(clipPath)];
  const transfer = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], 'A001_C003_2398.mp4', { type: 'video/mp4' }));
    return t;
  }, data);
  await frames(page).first().dispatchEvent('drop', { dataTransfer: transfer });
  await expect(frames(page).first().locator('[data-clip-tag]')).toHaveText('Clip');

  await inspector(page).getByRole('button', { name: 'Unlink video' }).click();
  await expect(frames(page).first().locator('[data-clip-tag]')).toHaveCount(0);
  await expect(frames(page).first().locator('img[data-frame-image]')).toBeVisible();
  await expect(inspector(page).getByRole('button', { name: 'Link video…' })).toBeFocused();
});

test('a video and a picture dropped together on a frame land as one edit, in order, and one undo takes both back', async ({ page }) => {
  const video = [...readFileSync(clipPath)];
  const jpg = [...readFileSync(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)))];
  const transfer = await page.evaluateHandle(
    ({ video, jpg }) => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array(video)], 'A001_C003_2398.mp4', { type: 'video/mp4' }));
      t.items.add(new File([new Uint8Array(jpg)], 'ref.jpg', { type: 'image/jpeg' }));
      return t;
    },
    { video, jpg },
  );
  await frames(page).first().dispatchEvent('drop', { dataTransfer: transfer });
  // The video on the frame it was dropped on, the picture a new frame after it.
  await expect(frames(page)).toHaveCount(2);
  await expect(frames(page).first().locator('[data-clip-tag]')).toHaveText('Clip');
  await expect(frames(page).nth(1).locator('img[data-frame-image]')).toBeVisible();
  await expect(frames(page).nth(1).locator('[data-clip-tag]')).toHaveCount(0);

  await frames(page).first().focus();
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page).first().locator('img[data-frame-image]')).toHaveCount(0);
});

test('a linked video gets its playback copy, with its progress; Cancel stops it, and Make playback copy starts it again (2.3b)', async ({ page }) => {
  await linkFromInspector(page);
  await expect(copyLine(page)).toHaveText('Making the playback copy…');
  await expect(inspector(page).getByRole('meter', { name: 'Playback copy' })).toBeVisible();
  expect(await new AxeBuilder({ page }).include('[data-inspector]').analyze().then((r) => r.violations)).toEqual([]);

  // Cancel: no copy, and focus on the button that makes one.
  await inspector(page).getByRole('button', { name: 'Cancel copy' }).click();
  await expect(copyLine(page)).toHaveText('No playback copy yet.');
  await expect(inspector(page).getByRole('button', { name: 'Make playback copy' })).toBeFocused();
  await expect(inspector(page).getByRole('button', { name: 'Cancel copy' })).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(copyLine(page)).toHaveText('Making the playback copy…');
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);
  await expect(inspector(page).getByRole('button', { name: 'Make playback copy' })).toHaveCount(0);
  await expect(inspector(page).getByRole('meter', { name: 'Playback copy' })).toHaveCount(0);
});

test('Settings → Storage counts the copies, moves them, clears them when asked, and shows FFmpeg’s licences (2.3b)', async ({ page }) => {
  await linkFromInspector(page);
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);

  await openSettings(page, 'Storage');
  await expect(copies(page)).toContainText('1 copy, 2.4 MB, of a 50 GB cap.');
  await expect(storage(page).getByRole('meter', { name: /^Of the cap/ })).toBeVisible();
  // The browser build has no drive to measure, and remembers no videos.
  await expect(copies(page)).toContainText('This drive doesn’t say what it has free, so copies can’t keep 10 GB free on it.');
  await expect(storage(page).getByText('No videos remembered.')).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Forget remembered videos…' })).toBeDisabled();
  expect(await new AxeBuilder({ page }).include('dialog[open]').analyze().then((r) => r.violations)).toEqual([]);

  // Move: to the folder named, and back.
  page.once('dialog', (dialog) => void dialog.accept('/Volumes/Footage'));
  await storage(page).getByRole('button', { name: 'Move to another drive…' }).click();
  await expect(page.getByRole('status').getByText('Moved 1 playback copy.')).toBeVisible();
  await expect(copies(page)).toContainText('/Volumes/Footage/Storiiboard Playback Copies');
  await storage(page).getByRole('button', { name: 'Move back to this computer' }).click();
  await expect(storage(page).getByRole('button', { name: 'Move back to this computer' })).toHaveCount(0);
  await expect(copies(page)).not.toContainText('/Volumes/Footage');

  // Clear asks first: Cancel keeps the copy, agreeing deletes it, and focus is on the line that says so.
  await storage(page).getByRole('button', { name: 'Clear playback copies…' }).click();
  expect(await answerAsk(page, false)).toContain('1 playback copy will be deleted');
  await expect(copies(page)).toContainText('1 copy, 2.4 MB, of a 50 GB cap.');
  await storage(page).getByRole('button', { name: 'Clear playback copies…' }).click();
  await answerAsk(page, true);
  await expect(storage(page).getByText('No playback copies yet.')).toBeFocused();
  await expect(page.getByRole('status').getByText('Cleared 1 playback copy.')).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Clear playback copies…' })).toBeDisabled();

  // The licences, in a window of their own: here, a note that they ship with the desktop app.
  await storage(page).getByRole('button', { name: 'Licences…' }).click();
  const licences = page.getByRole('dialog', { name: 'Licences' });
  await expect(licences.getByRole('textbox', { name: 'FFmpeg: the GNU LGPL 2.1' })).toHaveValue('The licences ship with the desktop app.');
  await licences.getByRole('combobox', { name: 'Licence' }).selectOption({ label: 'zimg' });
  await expect(licences.getByRole('textbox', { name: 'zimg' })).toHaveValue('The licences ship with the desktop app.');
  await page.keyboard.press('Escape');
  // Escape closes that window only, and focus goes back to the button that opened it.
  await expect(licences).toHaveCount(0);
  await expect(settingsWindow(page)).toBeVisible();
  await expect(storage(page).getByRole('button', { name: 'Licences…' })).toBeFocused();

  // The inspector looks again: the copy is gone, and can be made again.
  await closeSettings(page);
  await expect(copyLine(page)).toHaveText('No playback copy yet.');
  await inspector(page).getByRole('button', { name: 'Make playback copy' }).click();
  await expect(copyLine(page)).toHaveText('Playback copy ready.', READY);
});

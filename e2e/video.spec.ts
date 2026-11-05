import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Linking videos to frames (2.2b) in the memory build. The browser build can't run ffmpeg, so a stand-in reads the
// MP4's own boxes and grabs the first frame from a <video> (src/app/video.ts); the desktop app's ffmpeg path has its
// own Rust tests. The fixture: 2 s of H.264 at 24000/1001, 320 x 180, made once and checked in.

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

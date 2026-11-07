import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answerAsk } from './ask';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The Player (2.4) in the memory build: it plays the file the person handed over (the browser build has no copies;
// src/app/videoFiles.ts) once its pretend copy is made. The fixture: 2 s of H.264 at 24000/1001, 320 x 180, 48 frames,
// no source timecode, so it runs from 00:00:00:00.

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
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const player = (page: Page) => page.getByRole('group', { name: 'Player', exact: true });
const timecode = (page: Page) => player(page).locator('[data-player-timecode]');
const range = (page: Page) => inspector(page).locator('[data-video-details]');
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

async function linkAndOpen(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(clipPath);
  // The pretend copy takes 2.5 s; then the Player opens it.
  await expect(player(page).getByRole('slider', { name: 'Playhead' })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => player(page).locator('video').evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
}

test('plays the selected frame’s video: steps a frame at a time, and I and O set its in and out, one undo each', async ({ page }) => {
  await linkAndOpen(page);
  await expect(timecode(page)).toHaveText('00:00:00:00');
  await expect(player(page)).toContainText('In 00:00:00:00 · Out 00:00:01:23 · 48 frames');

  // Comma and period step a frame, with Shift ten, wherever focus is in the Player.
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('.');
  await expect(timecode(page)).toHaveText('00:00:00:03');
  // The picture is that frame: the <video> sits in its middle.
  const shown = await player(page)
    .locator('video')
    .evaluate((video: HTMLVideoElement) => Math.floor((video.currentTime * 24000) / 1001));
  expect(shown).toBe(3);
  await page.keyboard.press('i');
  await expect(range(page)).toContainText('00:00:00:03 – 00:00:01:23 · 45 frames');
  // Again on the same frame: no edit, so one undo takes the in point back to where it was.
  await page.keyboard.press('i');
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(range(page)).toContainText('00:00:00:00 – 00:00:01:23 · 48 frames');
  await page.keyboard.press(`${await command(page)}+Shift+z`);
  await expect(range(page)).toContainText('00:00:00:03 – 00:00:01:23 · 45 frames');
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press('Shift+Period');
  await page.keyboard.press(',');
  await expect(timecode(page)).toHaveText('00:00:00:12');
  await page.keyboard.press('o');
  await expect(range(page)).toContainText('00:00:00:03 – 00:00:00:12 · 10 frames');
  await expect(player(page)).toContainText('In 00:00:00:03 · Out 00:00:00:12 · 10 frames');

  // One undo takes the out point back.
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(range(page)).toContainText('00:00:00:03 – 00:00:01:23 · 45 frames');

  // Space plays and pauses; the frame moves on.
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press(' ');
  await expect(player(page).getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  await expect(timecode(page)).not.toHaveText('00:00:00:12', { timeout: 5_000 });
  await page.keyboard.press(' ');
  await expect(player(page).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
  // Paused after playing: the timecode is the frame the <video> shows, not its neighbour.
  await expect
    .poll(async () => {
      const shown = await player(page)
        .locator('video')
        .evaluate((video: HTMLVideoElement) => Math.floor((video.currentTime * 24000) / 1001 + 1e-3));
      const [h = 0, m = 0, s = 0, f = 0] = (await timecode(page).innerText()).split(':').map(Number);
      return ((h * 60 + m) * 60 + s) * 24 + f - shown;
    })
    .toBe(0);

  expect(await new AxeBuilder({ page }).include('[data-player]').analyze().then((r) => r.violations)).toEqual([]);
});

test('says what it waits for: a frame to select, a video to link, the copy being made', async ({ page }) => {
  await expect(player(page)).toContainText('This frame has no video. Link one from the inspector.');
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(clipPath);
  await expect(player(page).locator('[data-player-state]')).toHaveText(/Making the playback copy…|Waiting its turn/);
  await expect(player(page).getByRole('slider', { name: 'Playhead' })).toBeVisible({ timeout: 15_000 });
});

test('a copy cleared or cancelled while it’s shown stays gone until the person makes it again', async ({ page }) => {
  await linkAndOpen(page);
  const storage = await openSettings(page, 'Storage');
  await storage.getByRole('button', { name: 'Clear playback copies…' }).click();
  await answerAsk(page, true);
  await closeSettings(page);
  // Cleared by the person: the Player says so and offers to make it, rather than undoing the Clear.
  await expect(player(page).locator('[data-player-state]')).toHaveText('No playback copy yet.');
  await player(page).getByRole('button', { name: 'Make playback copy' }).click();
  await expect(player(page).getByRole('slider', { name: 'Playhead' })).toBeVisible({ timeout: 15_000 });
});

test('asks for a copy of a video shown without one, but leaves a cancelled one cancelled', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(clipPath);
  await inspector(page).getByRole('button', { name: 'Cancel copy' }).click();
  await expect(player(page).locator('[data-player-state]')).toHaveText('No playback copy yet.');
  // Still cancelled a moment later: the Player didn't ask again behind the person's back.
  await page.waitForTimeout(500);
  await expect(inspector(page).locator('[data-copy-state]')).toHaveText('No playback copy yet.');
});

test('played to the end, it stops on the last frame, and O sets the out point there, not past it', async ({ page }) => {
  await linkAndOpen(page);
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press('Shift+Period');
  await page.keyboard.press('i');
  await expect(range(page)).toContainText('00:00:00:10 – 00:00:01:23 · 38 frames');
  await page.keyboard.press(' ');
  await expect(player(page).getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  // Stopped by itself at the end (and then set back inside the last frame, so it no longer reads as ended).
  await expect(player(page).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
  await expect(timecode(page)).toHaveText('00:00:01:23');
  await page.keyboard.press('o');
  // Out already on the last frame: no edit, and the clip never runs past the video.
  await expect(range(page)).toContainText('00:00:00:10 – 00:00:01:23 · 38 frames');
  await expect(player(page)).toContainText('Out 00:00:01:23');
  // Space again replays from the in point, and pausing at once stops near it, far from the end.
  await page.keyboard.press(' ');
  await expect(player(page).getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(' ');
  await expect(player(page).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
  const [, , sec = 0, f = 0] = (await timecode(page).innerText()).split(':').map(Number);
  // From the in point (frame 10), not the start.
  expect(sec * 24 + f).toBeGreaterThanOrEqual(10);
  expect(sec * 24 + f).toBeLessThan(40);
});

test('a copy the <video> can’t play says so, with Try again, and is remade once at most', async ({ page }) => {
  await linkAndOpen(page);
  const fail = () => player(page).locator('video').dispatchEvent('error');
  await fail();
  await expect(player(page).locator('[data-player-state]')).toContainText('This playback copy can’t be played here.');
  // Try again opens it anew, and it plays.
  await player(page).getByRole('button', { name: 'Try again' }).click();
  await expect(player(page).getByRole('slider', { name: 'Playhead' })).toBeVisible();
  await expect
    .poll(() => player(page).locator('video').evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  // Failing again after playing: said again, never a loop of remakes.
  await fail();
  await expect(player(page).locator('[data-player-state]')).toContainText('This playback copy can’t be played here.');
  await expect(player(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

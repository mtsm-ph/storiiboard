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

test('a move held when the picture goes is dropped, and never saved once it’s back (2.6)', async ({ page }) => {
  await linkAndOpen(page);
  const window = player(page).locator('[data-frame-window]');
  const width = () => window.evaluate((element: HTMLElement) => parseFloat(element.style.width));
  // A zoom held on the slider, never let go, when the copy can't be played.
  await player(page).getByRole('slider', { name: 'Framing' }).focus();
  await page.keyboard.down('ArrowRight');
  await expect.poll(width).toBeLessThan(100);
  await player(page).locator('video').dispatchEvent('error');
  await expect(player(page).locator('[data-player-state]')).toContainText('This playback copy can’t be played here.');
  await page.keyboard.up('ArrowRight');
  await player(page).getByRole('button', { name: 'Try again' }).click();
  await expect(window).toBeVisible();
  // Back: the saved framing, and passing through the slider saves nothing.
  expect(await width()).toBe(100);
  await player(page).getByRole('slider', { name: 'Framing' }).focus();
  await page.keyboard.press('Tab');
  expect(await width()).toBe(100);
  await page.keyboard.press(`${await command(page)}+z`);
  // The one undo takes back the link itself, not a framing: the frame has no video now.
  await expect(player(page).locator('[data-player-state]')).toContainText('This frame has no video.');
});

test('frames the clip over the take: the window zooms and moves by keys and by hand, one undo step each (2.6)', async ({ page }) => {
  await linkAndOpen(page);
  const window = player(page).locator('[data-frame-window]');
  const box = () =>
    window.evaluate((element: HTMLElement) => ({ left: parseFloat(element.style.left), top: parseFloat(element.style.top), width: parseFloat(element.style.width) }));
  // A 16:9 frame over a 16:9 take: the window is the whole picture, with nowhere to go until it's zoomed.
  expect(await box()).toEqual({ left: 0, top: 0, width: 100 });
  // The picture's own box, measured once the copy is ready: the window lies on the picture, not on the bars.
  await expect.poll(() => player(page).locator('[data-player-picture]').evaluate((element: HTMLElement) => element.style.width)).toMatch(/px$/);
  const picture = await player(page).locator('video').evaluate((video: HTMLVideoElement) => {
    const rect = video.getBoundingClientRect();
    // Where the picture is drawn inside the <video>: contained, centred.
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const [width, height] = [video.videoWidth * scale, video.videoHeight * scale];
    return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
  });
  const drawn = await window.boundingBox();
  if (!drawn) throw new Error('the window is drawn');
  for (const side of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(drawn[side] - picture[side])).toBeLessThan(2);
  expect(await new AxeBuilder({ page }).include('[data-player]').analyze().then((r) => r.violations)).toEqual([]);

  await window.focus();
  await page.keyboard.press('+');
  // Focused from the keyboard, the window shows its two-tone ring, inside its edge.
  await expect(window.locator('span[aria-hidden="true"]')).toBeVisible();

  await expect.poll(async () => (await box()).width).toBeCloseTo(100 / 1.1, 1);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await box()).left).toBeCloseTo(0, 1);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await box()).left).toBeGreaterThan(1);
  await expect(window).toHaveAttribute('aria-label', 'The frame’s window over the take, zoom 110%');
  // Quick taps with no wait between them: each counts, each built on the last, though its edit hasn't landed yet.
  const quick = (await box()).left;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await box()).left).toBeCloseTo(quick + 2, 1);
  // The Player's own keys still work with the window focused: period steps a frame.
  await page.keyboard.press('.');
  await expect(timecode(page)).toHaveText('00:00:00:01');

  // Dragged by hand: down and to the right.
  const before = await box();
  const at = await window.boundingBox();
  if (!at) throw new Error('the window is drawn');
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 10, at.y + at.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box()).top).toBeGreaterThan(before.top);


  // Focus elsewhere: no ring, the edge alone.
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await expect(window.locator('span[aria-hidden="true"]')).toBeHidden();
  // Each move was one step (zoom, three by key, three quick taps, a drag): undone in turn, back to the whole picture;
  // Centre is off once it's there.
  for (let i = 0; i < 7; i += 1) await page.keyboard.press(`${await command(page)}+z`);
  await expect.poll(box).toEqual({ left: 0, top: 0, width: 100 });
  await expect(player(page).getByRole('button', { name: 'Centre' })).toBeDisabled();
  // Redone, and taken back to the centre with Centre in one step.
  await page.keyboard.press(`${await command(page)}+Shift+z`);
  await expect.poll(async () => (await box()).width).toBeCloseTo(100 / 1.1, 1);
  await player(page).getByRole('button', { name: 'Centre' }).click();
  await expect.poll(box).toEqual({ left: 0, top: 0, width: 100 });
});

test('grabs the frame showing into its frame: the picture changes, says its timecode, and one undo takes it back (2.7)', async ({ page }) => {
  await linkAndOpen(page);
  const card = page.getByRole('region', { name: 'Storyboard', exact: true }).locator('[data-shot-id]').first();
  const picture = () => card.locator('img[data-frame-image]').getAttribute('src');
  await expect(card.locator('img[data-frame-image]')).toBeVisible();
  const first = await picture();
  // Ten frames in, then G (the key, from anywhere in the Player).
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press('Shift+Period');
  await expect(timecode(page)).toHaveText('00:00:00:10');
  await page.keyboard.press('g');
  await expect.poll(picture, { timeout: 10_000 }).not.toBe(first);
  await expect(inspector(page)).toContainText('Still at 00:00:00:10');
  // The frame still plays its clip; its in and out are as they were.
  await expect(player(page)).toContainText('In 00:00:00:00 · Out 00:00:01:23 · 48 frames');
  // One undo takes the grab back: the first frame's picture again.
  await page.keyboard.press(`${await command(page)}+z`);
  await expect.poll(picture).toBe(first);
  await expect(inspector(page)).toContainText('Still at 00:00:00:00');
  // The button does the same.
  await player(page).getByRole('button', { name: 'Grab still' }).click();
  await expect.poll(picture, { timeout: 10_000 }).not.toBe(first);
});

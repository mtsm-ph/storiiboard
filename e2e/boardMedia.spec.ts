import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answerAsk } from './ask';
import { skipOnboarding } from './onboarding';

// Pictures, video cards and links on a board (5.1b) in the memory build: a picture dropped or pasted, still there after a
// reload, drawn as a thumbnail until it is zoomed past 640 screen pixels, a video card that opens the Player and plays, a
// link made with L and by pasting an address, a picture deleted and brought back, and axe on all three kinds in light and
// dark. The canvas is pixels, so the board is read from the data its wrapper keeps (data-board-data, data-picture-levels).

test.use({ viewport: { width: 1440, height: 900 } });

const imagePath = fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url));
const clipPath = fileURLToPath(new URL('./fixtures/video/A001_C003_2398.mp4', import.meta.url));

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The address that failed rides along: "Failed to load resource" alone doesn't say which one was refused.
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  url: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const canvas = (page: Page) => page.getByRole('application', { name: 'Camera board' });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const wrapper = (page: Page) => tile(page).locator('[data-board-data]');
const data = async (page: Page): Promise<Item[]> => JSON.parse((await wrapper(page).getAttribute('data-board-data')) ?? '[]') as Item[];
const levels = async (page: Page): Promise<Record<string, string>> => JSON.parse((await wrapper(page).getAttribute('data-picture-levels')) ?? '{}') as Record<string, string>;
const properties = (page: Page) => tile(page).getByRole('group', { name: 'Properties of the selection' });
const player = (page: Page) => page.getByRole('group', { name: 'Player', exact: true });

async function openCamera(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  // Opened from the picker: started the first time, listed under Boards after.
  const start = tile(page).locator('[data-department-board="camera"]').or(tile(page).getByRole('region', { name: 'Boards', exact: true }).getByRole('button', { name: /^Camera/ }));
  await expect(canvas(page).or(start.first())).toBeVisible();
  if (await start.first().isVisible()) await start.first().click();
  await expect(canvas(page)).toBeVisible();
  await page.waitForTimeout(100);
}

/** Where a world point is on screen, at the standard view. */
async function world(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y };
}

/** Files as a drag or the clipboard carries them, built in the page. */
function files(page: Page, list: { name: string; type: string; data: number[] }[]) {
  return page.evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const { name, type, data } of list) transfer.items.add(new File([new Uint8Array(data)], name, { type }));
    return transfer;
  }, list);
}

const jpeg = (name = 'srgb.jpg') => ({ name, type: 'image/jpeg', data: [...readFileSync(imagePath)] });
const clip = () => ({ name: 'A001_C003_2398.mp4', type: 'video/mp4', data: [...readFileSync(clipPath)] });

/** A drop of files on the board, at a world point. */
async function dropFiles(page: Page, list: { name: string; type: string; data: number[] }[], x = 0, y = 0) {
  const at = await world(page, x, y);
  await wrapper(page).dispatchEvent('drop', { dataTransfer: await files(page, list), clientX: at.x, clientY: at.y });
}

/** A paste sent to whatever has focus, as ⌘V would. */
async function paste(page: Page, list: { name: string; type: string; data: number[] }[], text?: string, custom?: { type: string; value: string }) {
  await canvas(page).focus();
  const transfer = await page.evaluateHandle(
    ({ list, text, custom }) => {
      const transfer = new DataTransfer();
      for (const { name, type, data } of list) transfer.items.add(new File([new Uint8Array(data)], name, { type }));
      if (text !== undefined) transfer.setData('text/plain', text);
      if (custom) transfer.setData(custom.type, custom.value);
      return transfer;
    },
    { list, text, custom },
  );
  await page.evaluate((transfer) => {
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, transfer);
}

test('a picture dropped on a board is an item, drawn as a thumbnail, and is still there after a reload', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture']);
  const [item] = await data(page);
  expect(item?.width).toBe(400);
  // Selected once made; the browser build keeps no path to a file, so the strip says there is no original file.
  await expect(properties(page).locator('[data-picture-original]')).toHaveText('Pasted, no original file');
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await openCamera(page);
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture']);
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
});

test('zooming in past 640 screen pixels draws the stored picture; zooming out goes back to the thumbnail', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
  await canvas(page).focus();
  // 400 units at 1.25^3 = 195% is 781 px on its long edge: past the threshold of 640.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('=');
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['original']);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('-');
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
});

test('zooming out from 400% over 40 pictures does not ask the ones coming into view for their full size (5.7)', async ({ page }) => {
  await openCamera(page);
  await dropFiles(
    page,
    Array.from({ length: 40 }, (_, i) => jpeg(`p${String(i)}.jpg`)),
    -300,
    0,
  );
  await expect.poll(async () => (await data(page)).length, { timeout: 30_000 }).toBe(40);
  await expect.poll(async () => Object.keys(await levels(page)).length).toBeGreaterThan(0);
  // In close on the first: 6 steps of 125% from 100% is 381%.
  const [first] = await data(page);
  const at = await world(page, (first?.x ?? 0) + (first?.width ?? 0) / 2, (first?.y ?? 0) + (first?.height ?? 0) / 2);
  await page.mouse.click(at.x, at.y);
  await canvas(page).focus();
  await page.keyboard.press('Shift+Digit0');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('=');
  await expect.poll(async () => Object.values(await levels(page)).filter((l) => l === 'original').length).toBeGreaterThanOrEqual(1);
  // Held still long enough for the pictures to be drawn for this zoom.
  await page.waitForTimeout(300);
  // Ctrl + wheel out, one step a frame for a second, then the levels at once: before the zoom has settled.
  const original = await page.evaluate(async () => {
    const element = document.querySelector('[data-canvas]');
    if (!element) throw new Error('no canvas');
    const rect = element.getBoundingClientRect();
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      element.dispatchEvent(new WheelEvent('wheel', { deltaY: 15, ctrlKey: true, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const levels = JSON.parse(document.querySelector('[data-picture-levels]')?.getAttribute('data-picture-levels') ?? '{}') as Record<string, string>;
    return { original: Object.values(levels).filter((l) => l === 'original').length, zoom: Number(element.getAttribute('data-zoom')) };
  });
  expect(original.zoom).toBeLessThan(0.5);
  // The pictures that were in view at 381% may still be at full size; none that came into view since asked for it.
  expect(original.original).toBeLessThanOrEqual(2);
  // And once the zoom settles every one is the thumbnail it is drawn as.
  await expect.poll(async () => Object.values(await levels(page)).filter((l) => l === 'original').length).toBe(0);
});

test('pastes a picture at the pointer; three files dropped at once land side by side and one ⌘Z takes them all back', async ({ page }) => {
  await openCamera(page);
  const pointer = await world(page, 100, 50);
  await page.mouse.move(pointer.x, pointer.y);
  await paste(page, [jpeg('pasted.jpg')]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  const [pasted] = await data(page);
  // Pasted with its middle at the pointer.
  expect(Math.round((pasted?.x ?? 0) + (pasted?.width ?? 0) / 2)).toBe(100);

  await dropFiles(page, [jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')], -600, -300);
  await expect.poll(async () => (await data(page)).length).toBe(4);
  const row = (await data(page)).slice(1);
  expect(row.map((i) => i.y)).toEqual([row[0]?.y, row[0]?.y, row[0]?.y]);
  expect(row.map((i) => i.x - (row[0]?.x ?? 0))).toEqual([0, 416, 832]);

  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await data(page)).length).toBe(1);
});

test('deletes a picture and brings it back with ⌘Z', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await data(page)).length).toBe(0);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture']);
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
});

// Show in Finder / Explorer (5.9). The memory build has no Rust and no disk: window.__sbdDevOriginals (src/app/opener.ts) says
// which pictures' originals "exist" and records the hashes the reveal was asked for. `*` is every picture's.
interface DevOriginals {
  shown: string[];
  revealed: string[];
  failing?: boolean;
}
const standIn = (page: Page, value: DevOriginals) =>
  page.evaluate((value) => {
    (window as unknown as { __sbdDevOriginals: DevOriginals }).__sbdDevOriginals = value;
  }, value);
const revealed = (page: Page) => page.evaluate(() => (window as unknown as { __sbdDevOriginals: DevOriginals }).__sbdDevOriginals.revealed);
const showOriginal = (page: Page) => properties(page).getByRole('button', { name: /^(Show in Explorer|Show in Finder|Show in folder)$/ });

test('Show in folder is a button for a picture whose original exists, pressed from the keyboard, and asks for that picture by its hash', async ({ page }) => {
  await standIn(page, { shown: ['*'], revealed: [] });
  await openCamera(page);
  await dropFiles(page, [jpeg()], -300, 0);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await expect(showOriginal(page)).toBeVisible();
  await showOriginal(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await revealed(page)).length).toBe(1);
  const [first] = await revealed(page);
  expect(first).toMatch(/^[0-9a-f]{64}$/);

  // Another picture, selected on its own: its own hash. Two items selected: no action at all.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  const photo = { name: 'photo-a.jpg', type: 'image/jpeg', data: [...readFileSync(fileURLToPath(new URL('./fixtures/images/photo-a.jpg', import.meta.url)))] };
  await dropFiles(page, [photo], 300, 0);
  await expect.poll(async () => (await data(page)).length).toBe(2);
  await expect(showOriginal(page)).toBeVisible();
  await showOriginal(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await revealed(page)).length).toBe(2);
  expect((await revealed(page))[1]).not.toBe(first);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await expect(showOriginal(page)).toHaveCount(0);
});

test('a picture whose original is not recorded or is not there shows no such action, and a video card none either', async ({ page }) => {
  await standIn(page, { shown: [], revealed: [] });
  await openCamera(page);
  await dropFiles(page, [jpeg()], -300, 0);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await expect(properties(page).locator('[data-picture-original]')).toHaveText('Pasted, no original file');
  await expect(showOriginal(page)).toHaveCount(0);
  await standIn(page, { shown: ['*'], revealed: [] });
  await dropFiles(page, [clip()], 300, 0);
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture', 'video']);
  await expect(properties(page).getByRole('button', { name: /^Show in / })).toHaveCount(0);
});

test('a reveal that fails says so and the action goes', async ({ page }) => {
  await standIn(page, { shown: ['*'], revealed: [], failing: true });
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect(showOriginal(page)).toBeVisible();
  await showOriginal(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').getByText("That picture's original isn't where it was.")).toBeVisible();
  await expect(showOriginal(page)).toHaveCount(0);
});

test('a video card opens the Player on a double-click and plays; in and out are for storyboard frames', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [clip()], -200, -100);
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['video']);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  const [card] = await data(page);
  const centre = await world(page, (card?.x ?? 0) + (card?.width ?? 0) / 2, (card?.y ?? 0) + (card?.height ?? 0) / 2);
  await page.mouse.dblclick(centre.x, centre.y);

  // The pretend copy takes 2.5 s; then the Player opens it.
  await expect(player(page).getByRole('slider', { name: 'Playhead' })).toBeVisible({ timeout: 15_000 });
  await expect(player(page)).toContainText('A001_C003_2398.mp4');
  await expect(player(page).locator('[data-player-card-only]')).toBeVisible();
  await expect(player(page).getByRole('button', { name: 'Set in' })).toHaveCount(0);
  await expect(player(page).getByRole('button', { name: 'Grab still' })).toHaveCount(0);
  await expect.poll(() => player(page).locator('video').evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  const timecode = player(page).locator('[data-player-timecode]');
  await expect(timecode).toHaveText('00:00:00:00');
  await player(page).getByRole('slider', { name: 'Playhead' }).focus();
  await page.keyboard.press('.');
  await expect(timecode).toHaveText('00:00:00:01');
  await player(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(player(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => await timecode.textContent()).not.toBe('00:00:00:01');
});

test('makes a link card with L, asking for the address, and one from a pasted address; Open goes through the opener', async ({ page }) => {
  await openCamera(page);
  await canvas(page).focus();
  await page.keyboard.press('l');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'link');
  const at = await world(page, -300, -100);
  await page.mouse.click(at.x, at.y);
  const dialog = page.getByRole('dialog', { name: 'Link' });
  await expect(dialog).toBeVisible();
  // Only web addresses: anything else is refused and the window stays.
  await dialog.getByLabel('Address').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog.getByText('Type a web address that starts with http or https.')).toBeVisible();
  await dialog.getByLabel('Address').fill('vimeo.com/123456');
  await dialog.getByLabel('Title').fill('Look book');
  await dialog.getByRole('button', { name: 'Add link' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await data(page)).map((i) => [i.kind, i.url, i.title])).toEqual([['link', 'https://vimeo.com/123456', 'Look book']]);

  // The address and title are editable in the strip.
  await properties(page).getByLabel('Title').fill('Mood reel');
  await properties(page).getByLabel('Title').press('Enter');
  await expect.poll(async () => (await data(page))[0]?.title).toBe('Mood reel');

  // An address pasted onto the canvas makes a card at the pointer; other text does not.
  const pointer = await world(page, 150, 80);
  await page.mouse.move(pointer.x, pointer.y);
  await paste(page, [], 'https://example.com/lookbook');
  await expect.poll(async () => (await data(page)).length).toBe(2);
  await paste(page, [], 'just some words');
  await page.waitForTimeout(150);
  expect((await data(page)).length).toBe(2);
  const pasted = (await data(page))[1];
  expect(pasted).toMatchObject({ kind: 'link', url: 'https://example.com/lookbook' });
  expect(Math.round((pasted?.x ?? 0) + (pasted?.width ?? 0) / 2)).toBe(150);

  // Open: the page opens it in a new tab, with no opener.
  await page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    };
  });
  const card = await world(page, (pasted?.x ?? 0) + 20, (pasted?.y ?? 0) + 20);
  await page.mouse.dblclick(card.x, card.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://example.com/lookbook']);
});

test('a deleted picture waits in the Trash as "Picture on Camera board", and Restore from there brings it back', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await data(page)).length).toBe(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash.getByRole('row', { name: /Picture on Camera board/ })).toBeVisible();
  await trash.getByRole('button', { name: 'Restore board item Picture on Camera board' }).click();
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture']);
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
});

/** What the board's copy put on the system clipboard, read from the copy event as the page sees it. */
async function watchCopies(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('copy', (event) => {
      const data = event.clipboardData;
      (window as unknown as { __copied: { text: string; token: string } }).__copied = {
        text: data?.getData('text/plain') ?? '',
        token: data?.getData('application/x-storiiboard-board') ?? '',
      };
    });
  });
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: { text: string; token: string } }).__copied);

test('a paste carrying our token or our text pastes the copied items; what replaced our text wins', async ({ page }) => {
  await openCamera(page);
  await watchCopies(page);
  await dropFiles(page, [jpeg('IMG_4012.JPG')]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+c`);
  // The system clipboard got the picture's file name, and a token.
  await expect.poll(async () => (await copied(page)).text).toBe('IMG_4012.JPG');
  const mark = await copied(page);
  expect(mark.token).not.toBe('');
  // Our token on a paste, with an old address as its text: the copied picture, by the marker (not by freshness).
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await paste(page, [], 'https://example.com/stale', { type: 'application/x-storiiboard-board', value: mark.token });
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture', 'picture']);
  // Exactly our text, no token: ours too.
  await paste(page, [], mark.text);
  await expect.poll(async () => (await data(page)).length).toBe(3);
  // Other words replaced ours (Copy hex, say): not the board's, and nothing is pasted.
  await paste(page, [], '#DF5E27');
  await page.waitForTimeout(250);
  expect((await data(page)).length).toBe(3);
  // A copied address replaced it: a link card. A picture too.
  await paste(page, [], 'https://example.com/fresh');
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture', 'picture', 'picture', 'link']);
  await paste(page, [jpeg('screenshot.jpg')]);
  await expect.poll(async () => (await data(page)).length).toBe(5);
});

test('Copy from the context menu marks the system clipboard, and a stale address does not beat the copied items', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg('IMG_4012.JPG')]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  // The clipboard API refuses here, as it can: the write is recorded, and fails.
  await page.evaluate(() => {
    (window as unknown as { __wrote: string[] }).__wrote = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { __wrote: string[] }).__wrote.push(text);
          return Promise.reject(new Error('refused'));
        },
      },
    });
  });
  const [item] = await data(page);
  const at = await world(page, (item?.x ?? 0) + 40, (item?.y ?? 0) + 40);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await canvas(page).getByRole('group', { name: 'Board actions' }).getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wrote: string[] }).__wrote)).toEqual(['IMG_4012.JPG']);
  // A stale address, as if copied in a browser earlier: the items just copied are pasted.
  await paste(page, [], 'https://example.com/stale');
  await expect.poll(async () => (await data(page)).map((i) => i.kind)).toEqual(['picture', 'picture']);
});

test('Empty Trash leaves the pictures still on the board drawing', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()], -300, -100);
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
  // A rectangle, drawn and deleted: something for the Trash to empty.
  await tile(page).getByRole('button', { name: 'Rectangle' }).click();
  const a = await world(page, 100, 100);
  const b = await world(page, 250, 200);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await data(page)).length).toBe(2);
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await trash.getByRole('button', { name: 'Empty Trash…' }).click();
  await answerAsk(page, true);
  await expect(trash.getByText('The Trash is empty.', { exact: false })).toBeVisible();
  // The picture is still drawn: the thumbnail was not forgotten with the Trash's pictures.
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['thumbnail']);
  await page.waitForTimeout(300);
  expect(Object.values(await levels(page))).toEqual(['thumbnail']);
});

test('⌘C then ⌘V pastes the picture once, and a held ⌘V does not paste again and again', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  await canvas(page).focus();
  const key = await mod(page);
  await page.keyboard.press(`${key}+c`);
  await page.keyboard.press(`${key}+v`);
  await expect.poll(async () => (await data(page)).length).toBe(2);
  await page.waitForTimeout(300);
  expect((await data(page)).length).toBe(2);
  // Held: key repeat sends more keydowns; only the first pastes.
  await page.keyboard.down(key);
  await page.keyboard.down('v');
  for (let i = 0; i < 4; i += 1) await page.keyboard.down('v');
  await page.keyboard.up('v');
  await page.keyboard.up(key);
  await expect.poll(async () => (await data(page)).length).toBe(3);
  await page.waitForTimeout(300);
  expect((await data(page)).length).toBe(3);
});

test('a picture or video keeps its shape when resized: corner handles only', async ({ page }) => {
  await openCamera(page);
  await dropFiles(page, [jpeg()]);
  await expect.poll(async () => (await data(page)).length).toBe(1);
  const [item] = await data(page);
  const ratio = (item?.width ?? 1) / (item?.height ?? 1);
  // The bottom right corner, pulled out and down unevenly.
  const corner = await world(page, (item?.x ?? 0) + (item?.width ?? 0), (item?.y ?? 0) + (item?.height ?? 0));
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 120, corner.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await data(page))[0]?.width ?? 0)).toBeGreaterThan(450);
  const [after] = await data(page);
  expect(Math.abs((after?.width ?? 1) / (after?.height ?? 1) - ratio)).toBeLessThan(0.02);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with a picture, a video card and a link on the board, ${scheme}`, async ({ page }) => {
    await openCamera(page);
    await dropFiles(page, [jpeg(), clip()], -500, -150);
    await expect.poll(async () => (await data(page)).length).toBe(2);
    await canvas(page).focus();
    await paste(page, [], 'https://example.com/lookbook');
    await expect.poll(async () => (await data(page)).length).toBe(3);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
    await openCamera(page);
    await expect.poll(async () => (await data(page)).map((i) => i.kind).sort()).toEqual(['link', 'picture', 'video']);
    // The link is selected last: its strip is in the band while axe looks.
    const link = (await data(page)).find((i) => i.kind === 'link');
    const at = await world(page, (link?.x ?? 0) + 20, (link?.y ?? 0) + 20);
    await page.mouse.click(at.x, at.y);
    await expect(properties(page).getByLabel('Address')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Sketching a frame (1.13) in the memory build: the editor draws with Konva, the cards with SVG; strokes are records,
// so undo, the eraser and a reload all go through the same path as every other edit.

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
  await expect(frame(page)).toBeFocused();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const frame = (page: Page) => board(page).locator('[data-shot-id]').first();
const editor = (page: Page) => page.getByRole('dialog', { name: 'Sketch 1A' });
const cardStrokes = (page: Page) => frame(page).locator('svg[data-sketch] > *');
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

/** Draws on the editor's frame from one point to another (fractions of its size), in a few steps. */
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = await editor(page).locator('[data-sketch-frame]').boundingBox();
  if (!box) throw new Error('no frame');
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    const t = i / 6;
    await page.mouse.move(box.x + box.width * (from[0] + (to[0] - from[0]) * t), box.y + box.height * (from[1] + (to[1] - from[1]) * t));
  }
  await page.mouse.up();
}

test('S on a frame opens its sketch; a pen stroke shows on the card, and ⌘Z takes it back', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(editor(page)).toBeVisible();
  await draw(page, [0.2, 0.3], [0.8, 0.6]);
  await expect(cardStrokes(page)).toHaveCount(1);
  await expect(page.getByText('Pen drawn.')).toBeAttached();

  await page.keyboard.press(`${await command(page)}+z`);
  await expect(cardStrokes(page)).toHaveCount(0);

  // Escape closes the editor and focus goes back where it was.
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(frame(page)).toBeFocused();
});

test('an arrow can be two clicks, and a release outside the frame still ends a stroke', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(editor(page)).toBeVisible();
  const box = await editor(page).locator('[data-sketch-frame]').boundingBox();
  if (!box) throw new Error('no frame');
  await page.keyboard.press('a');
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await expect(page.getByText('Click again where it ends.')).toBeAttached();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await expect(cardStrokes(page)).toHaveCount(1);

  await page.keyboard.press('p');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 3 });
  // Let go well outside the frame.
  await page.mouse.move(box.x - 40, box.y - 40, { steps: 3 });
  await page.mouse.up();
  await expect(cardStrokes(page)).toHaveCount(2);
});

test('in dark mode the editor draws in the theme’s text colour, as the cards do', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  // The app has switched to dark before the editor opens.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('s');
  await draw(page, [0.2, 0.5], [0.8, 0.5]);
  await expect(cardStrokes(page)).toHaveCount(1);
  // Konva redraws on the next frame, so the canvas is read until it has caught up (or the test times out).
  const read = () => page.evaluate(() => {
    // The text colour as the page resolves it, in rgb() like the canvas reads back.
    const probe = document.createElement('span');
    probe.style.color = 'var(--text)';
    document.body.append(probe);
    const text = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.querySelector<HTMLCanvasElement>('[data-sketch-frame] canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('no canvas');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) === 255) return [text, `rgb(${String(data[i])}, ${String(data[i + 1])}, ${String(data[i + 2])})`];
    }
    return [text, 'nothing drawn'];
  });
  await expect.poll(async () => {
    const [ink, drawn] = await read();
    return drawn === ink ? 'ink' : `${drawn ?? ''} vs ${ink ?? ''}`;
  }).toBe('ink');
});

test('the editor closes when its frame goes, and focus doesn’t fall off the board', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(editor(page)).toBeVisible();
  // The last edit was adding this frame: Undo takes the frame back, and the editor with it.
  await editor(page).getByRole('button', { name: 'Undo' }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(0);
  // Its card went with it, so focus goes to the board's Tab stop: the empty scene's + Frame.
  await expect(board(page).getByRole('button', { name: '+ Frame in SC 01' })).toBeFocused();
});

test('a tool picked after one click starts afresh, and a drag after a click draws from where it began', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(editor(page)).toBeVisible();
  const box = await editor(page).locator('[data-sketch-frame]').boundingBox();
  if (!box) throw new Error('no frame');
  const svg = frame(page).locator('svg[data-sketch]');
  const across = async () => Number((await svg.getAttribute('viewBox'))?.split(' ')[2]);

  await page.keyboard.press('a');
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await expect(page.getByText('Click again where it ends.')).toBeAttached();
  // Box from the toolbar drops the arrow's first click: the box takes two clicks of its own. Had the first click
  // been kept, the box would run from it (x 0.2) and the next click would start another.
  await editor(page).getByRole('radio', { name: 'Box' }).click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.2);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await expect(cardStrokes(page)).toHaveCount(1);
  const rect = svg.locator('rect');
  expect(Number(await rect.getAttribute('x')) / (await across())).toBeCloseTo(0.6, 1);
  expect(Number(await rect.getAttribute('width')) / (await across())).toBeCloseTo(0.3, 1);

  // One click, then a drag somewhere else: an arrow of its own, from the drag's start.
  await page.keyboard.press('a');
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.9);
  await draw(page, [0.3, 0.3], [0.5, 0.3]);
  await expect(cardStrokes(page)).toHaveCount(2);
  const line = svg.locator('g > line');
  expect(Number(await line.getAttribute('x1')) / (await across())).toBeCloseTo(0.3, 1);
  expect(Number(await line.getAttribute('y1')) / 1000).toBeCloseTo(0.3, 1);
});

test('draws an arrow and a box with their keys, and the eraser takes off what it touches', async ({ page }) => {
  await inspector(page).getByRole('button', { name: 'Sketch' }).click();
  // The editor loads on first use; keys before it's open go to the board.
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('a');
  await expect(editor(page).getByRole('radio', { name: 'Arrow' })).toHaveAttribute('aria-checked', 'true');
  await draw(page, [0.1, 0.8], [0.5, 0.2]);
  await page.keyboard.press('b');
  await draw(page, [0.6, 0.2], [0.9, 0.5]);
  await expect(cardStrokes(page)).toHaveCount(2);

  await page.keyboard.press('e');
  // Across the box's left side only.
  await draw(page, [0.55, 0.35], [0.65, 0.35]);
  await expect(cardStrokes(page)).toHaveCount(1);
  await expect(page.getByText('1 stroke erased.')).toBeAttached();

  await editor(page).getByRole('button', { name: 'Clear' }).click();
  await expect(cardStrokes(page)).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Undo' }).click();
  await expect(cardStrokes(page)).toHaveCount(1);
});

test('a sketch is still there after a reload', async ({ page }) => {
  await page.keyboard.press('s');
  await draw(page, [0.3, 0.3], [0.7, 0.7]);
  await editor(page).getByRole('button', { name: 'Done' }).click();
  await expect(inspector(page).getByRole('button', { name: 'Edit sketch' })).toBeVisible();

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(cardStrokes(page)).toHaveCount(1);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the sketch editor passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.keyboard.press('s');
    await draw(page, [0.2, 0.2], [0.6, 0.6]);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

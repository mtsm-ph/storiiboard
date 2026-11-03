import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The storyboard on real projects (the memory build, as in projects.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const rows = (page: Page) => scenesTile(page).getByRole('list', { name: 'Scenes' }).locator('[data-scene-row]');

test('lists the scenes with their summary, and shares the active scene with the sidebar', async ({ page }) => {
  await expect(scenesTile(page)).toContainText('No scenes yet.');
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await sidebar(page).getByRole('button', { name: '+ Add Scene' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('01');
  await expect(rows(page).first()).toContainText('— · 0 fr');

  await rows(page).nth(0).click();
  await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(sidebar(page).getByRole('button', { name: /^SC 01/ })).toHaveAttribute('aria-current', 'true');
  // Selecting in the sidebar moves the tile's marker too.
  await sidebar(page).getByRole('button', { name: /^SC 02/ }).click();
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows(page).nth(0)).not.toHaveAttribute('aria-current');

  // Up and Down move between scenes.
  await rows(page).nth(1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows(page).nth(0)).toBeFocused();
});

test('locks a scene’s shot numbers, and the lock survives a reload', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  const lock = scenesTile(page).getByRole('button', { name: 'Lock shot numbers for SC 01' });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(scenesTile(page).getByRole('button', { name: 'Lock shot numbers for SC 01' })).toHaveAttribute('aria-pressed', 'true');
});

test('sets the project’s aspect ratio and shot letters in Settings → Project', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: /^Settings/ }).click();
  const tile = page.getByRole('region', { name: 'Project', exact: true });
  await tile.getByLabel('Aspect ratio').selectOption('2.39:1');
  const letters = tile.getByRole('switch', { name: 'Use I and O in shot letters' });
  await expect(letters).toHaveAttribute('aria-checked', 'false');
  await letters.click();
  await expect(letters).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sidebar(page).getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('region', { name: 'Project', exact: true }).getByLabel('Aspect ratio')).toHaveValue('2.39:1');
});

const grid = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const frames = (page: Page, scene: string) =>
  grid(page).getByRole('list', { name: `Frames in ${scene}` }).locator('[data-shot-id]');
/** The shot numbers in a scene, in board order. */
async function numbers(page: Page, scene: string): Promise<string[]> {
  return frames(page, scene).locator('[data-number]').allTextContents();
}
const command = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

test('adds frames numbered by the slate rules, and moves through them with the arrow keys', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
  await add.click();
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
  // The new frame is selected and focused, and the board is one Tab stop.
  await expect(frames(page, 'SC 01').nth(2)).toBeFocused();
  await expect(frames(page, 'SC 01').nth(2)).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(frames(page, 'SC 01').nth(1)).toBeFocused();
  await expect(frames(page, 'SC 01').nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Home');
  await expect(frames(page, 'SC 01').nth(0)).toBeFocused();
  await expect(grid(page).getByText('3 frames')).toBeVisible();
});

test('Delete sends a frame to the Trash and closes up the letters; ⌘Z brings it back', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
  for (let i = 0; i < 3; i += 1) await add.click();
  await frames(page, 'SC 01').nth(1).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B']);
  // Focus moves on to the next frame, where the keys can carry on.
  await expect(frames(page, 'SC 01').nth(1)).toBeFocused();

  await page.keyboard.press(`${await command(page)}+z`);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B', '1C']);
});

test('⌘ with an arrow moves a frame, across scenes too, renumbering both', async ({ page }) => {
  const newScene = scenesTile(page).getByRole('button', { name: '+ New scene' });
  await newScene.click();
  await newScene.click();
  for (let i = 0; i < 2; i += 1) await grid(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await grid(page).getByRole('button', { name: '+ Frame in SC 02' }).click();

  await frames(page, 'SC 01').nth(1).click();
  const mod = await command(page);
  await page.keyboard.press(`${mod}+ArrowRight`);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A']);
  await expect.poll(() => numbers(page, 'SC 02')).toEqual(['2A', '2B']);
  await expect(frames(page, 'SC 02').nth(0)).toBeFocused();

  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1B']);
});

test('a locked scene keeps its numbers when a frame goes, and a new frame takes the next letter', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
  for (let i = 0; i < 3; i += 1) await add.click();
  await scenesTile(page).getByRole('button', { name: 'Lock shot numbers for SC 01' }).click();
  await expect(grid(page).getByText('Numbers locked')).toBeVisible();

  await frames(page, 'SC 01').nth(1).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1C']);
  await add.click();
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A', '1C', '1D']);
});

test('draws frames at the project’s aspect ratio', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await grid(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  const picture = frames(page, 'SC 01').first().locator('span').first();
  const ratio = async () => {
    const box = await picture.boundingBox();
    return box ? box.width / box.height : 0;
  };
  expect(await ratio()).toBeCloseTo(16 / 9, 1);

  await sidebar(page).getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('region', { name: 'Project', exact: true }).getByLabel('Aspect ratio').selectOption('2.39:1');
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  expect(await ratio()).toBeCloseTo(2.39, 1);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the board with a selected frame passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
    const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
    await add.click();
    await add.click();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the Storyboard workspace with scenes passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
    await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
    await rows(page).first().click();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

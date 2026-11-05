import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

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
  await skipOnboarding(page);
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
  const tile = await openSettings(page, 'Project');
  await tile.getByLabel('Aspect ratio').selectOption('2.39:1');
  const letters = tile.getByRole('switch', { name: 'Use I and O in shot letters' });
  await expect(letters).toHaveAttribute('aria-checked', 'false');
  await letters.click();
  await expect(letters).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect((await openSettings(page, 'Project')).getByLabel('Aspect ratio')).toHaveValue('2.39:1');
});

const grid = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
/** A scene's frames in whichever view: a list in the grid and strip, a group of rows in the shot list. */
const frames = (page: Page, scene: string) => grid(page).locator(`[aria-label="Frames in ${scene}"] [data-shot-id]`);
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

  await (await openSettings(page, 'Project')).getByLabel('Aspect ratio').selectOption('2.39:1');
  await closeSettings(page);
  expect(await ratio()).toBeCloseTo(2.39, 1);
});

const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });

/** One scene with two frames, the first selected. */
async function twoFrames(page: Page) {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  const add = grid(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
  await frames(page, 'SC 01').nth(0).click();
}

test('sets a frame’s camera in the inspector, and the card shows it', async ({ page }) => {
  await twoFrames(page);
  await expect(inspector(page).getByText('1A', { exact: true })).toBeVisible();
  await inspector(page).getByRole('radio', { name: 'MCU' }).click();
  const lens = inspector(page).getByLabel('Lens (mm)');
  await lens.fill('35');
  await lens.press('Enter');
  await inspector(page).getByLabel('T-stop').selectOption('2');
  await inspector(page).getByRole('combobox', { name: 'Move', exact: true }).selectOption('push in');
  await expect(frames(page, 'SC 01').nth(0)).toContainText('MCU · 35MM · T2.0');

  // A refused lens snaps back and says why.
  await lens.fill('fifty');
  await lens.press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('A focal length in mm, such as 35.');
  await expect(lens).toHaveValue('35');

  // ⌘Z takes back one field at a time, newest first.
  await grid(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${await command(page)}+z`);
  await page.keyboard.press(`${await command(page)}+z`);
  await expect(frames(page, 'SC 01').nth(0)).toContainText('MCU · 35MM');
  await expect(frames(page, 'SC 01').nth(0)).not.toContainText('T2.0');
});

test('marks a frame Have, and the scene and film coverage follow', async ({ page }) => {
  await twoFrames(page);
  await inspector(page).getByRole('radio', { name: 'Have' }).click();
  await expect(frames(page, 'SC 01').nth(0).getByRole('img', { name: 'Have' })).toBeVisible();
  await expect(scenesTile(page).locator('[data-scene-row]').first()).toContainText('2 fr · 50%');
  await expect(scenesTile(page).getByText('50%', { exact: true })).toBeVisible();
});

test('edits the scene: number, name, INT/EXT, time and length, renumbering its frames', async ({ page }) => {
  await twoFrames(page);
  const number = inspector(page).getByLabel('Number');
  await number.fill('4');
  await number.press('Enter');
  await expect.poll(() => numbers(page, 'SC 04')).toEqual(['4A', '4B']);

  const name = inspector(page).getByLabel('Name', { exact: true });
  await name.fill('Penn Station');
  await name.press('Enter');
  await inspector(page).getByRole('radio', { name: 'INT', exact: true }).click();
  await inspector(page).getByLabel('Time').selectOption('DAY');
  const length = inspector(page).getByLabel('Length');
  await length.fill('1 3/8');
  await length.press('Enter');
  await expect(grid(page).getByRole('heading', { name: /SC 04 INT\. PENN STATION — DAY 1 3\/8 pg/ })).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /^SC 04 Penn Station/ })).toBeVisible();

  // Another scene's number is refused.
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await scenesTile(page).locator('[data-scene-row]').nth(1).click();
  await inspector(page).getByLabel('Number').fill('4');
  await inspector(page).getByLabel('Number').press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText("There's already a scene 4.");
});

test('Enter on a frame goes to its details, and Escape comes back to the frame', async ({ page }) => {
  await twoFrames(page);
  await frames(page, 'SC 01').nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('radio', { name: 'EWS' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(frames(page, 'SC 01').nth(0)).toContainText('WS');
  await page.keyboard.press('Escape');
  await expect(frames(page, 'SC 01').nth(0)).toBeFocused();
});

test('the strip lays every frame along one row, and Up and Down step along it', async ({ page }) => {
  await twoFrames(page);
  await grid(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await grid(page).getByRole('radio', { name: 'Strip' }).click();
  const tops = await frames(page, 'SC 01').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // The frame selected in the grid (the new one, added after 1A) is still the one selected.
  await expect(frames(page, 'SC 01').nth(1)).toHaveAttribute('aria-current', 'true');
  await frames(page, 'SC 01').nth(0).click();
  await page.keyboard.press('ArrowDown');
  await expect(frames(page, 'SC 01').nth(1)).toBeFocused();
});

test('the shot list shows a row per shot with its columns, and the board’s keys work on it', async ({ page }) => {
  await twoFrames(page);
  await inspector(page).getByRole('radio', { name: 'MCU' }).click();
  await grid(page).getByRole('radio', { name: 'Shot list' }).click();
  const table = grid(page).getByRole('table', { name: 'Shot list' });
  await expect(table.getByRole('columnheader')).toHaveText(['Shot', 'Size', 'Lens', 'T-stop', 'Support', 'Height', 'Move', 'Status', 'Action', 'Departments']);
  const rows = table.locator('tr:has([data-shot-id])');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('MCU');

  await frames(page, 'SC 01').nth(0).click();
  await page.keyboard.press('ArrowDown');
  await expect(frames(page, 'SC 01').nth(1)).toBeFocused();
  await expect(inspector(page).getByText('1B', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Delete');
  await expect.poll(() => numbers(page, 'SC 01')).toEqual(['1A']);
});

test('keeps the chosen view across a reload', async ({ page }) => {
  await twoFrames(page);
  await grid(page).getByRole('radio', { name: 'Shot list' }).click();
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(grid(page).getByRole('radio', { name: 'Shot list' })).toHaveAttribute('aria-checked', 'true');
  await expect(grid(page).getByRole('table', { name: 'Shot list' })).toBeVisible();
});

for (const view of ['Strip', 'Shot list'] as const) {
  test(`the ${view.toLowerCase()} passes axe`, async ({ page }) => {
    await twoFrames(page);
    await grid(page).getByRole('radio', { name: view }).click();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

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

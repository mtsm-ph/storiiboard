import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Docking on real pointer events, in both engines. Layouts persist in localStorage, so each test starts clean.
// Reduced motion turns the 180ms reflow off, so a tile's box is final the moment it's measured.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
});

const tile = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not on screen');
  return b;
}

/** Presses on a tile's title bar and drags to a point, in steps, as a hand would. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }, release = true) {
  const bar = await box(from.locator('div').first());
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (release) await page.mouse.up();
}

test('drops a tile on an edge to split, and on the centre to stack it as a tab', async ({ page }) => {
  const board = await box(tile(page, 'Storyboard'));
  await drag(page, tile(page, 'Frame inspector'), { x: board.x + 20, y: board.y + board.height / 2 });
  const inspector = await box(tile(page, 'Frame inspector'));
  expect(inspector.x).toBeLessThan((await box(tile(page, 'Storyboard'))).x);
  // A drag never selects text: a selection under the next press would start the browser's own drag instead.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  const target = await box(tile(page, 'Storyboard'));
  await drag(page, tile(page, 'Player'), { x: target.x + target.width / 2, y: target.y + target.height / 2 });
  const tabs = page.getByRole('tablist', { name: 'Player tabs' });
  await expect(tabs.getByRole('tab', { name: 'Player' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Storyboard' }).click();
  await expect(page.getByRole('tablist', { name: 'Storyboard tabs' })).toBeVisible();
});

test('shows the drop zone while dragging, and Escape cancels the move', async ({ page }) => {
  const before = await box(tile(page, 'Player'));
  const board = await box(tile(page, 'Storyboard'));
  await drag(page, tile(page, 'Player'), { x: board.x + board.width - 10, y: board.y + board.height / 2 }, false);
  await expect(page.getByText('Split right')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByText('Split right')).toBeHidden();
  expect(await box(tile(page, 'Player'))).toEqual(before);
});

test('resizes two tiles with a splitter, evens them on double-click, and moves it from the keyboard', async ({ page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize Scenes and Storyboard' });
  const start = (await box(tile(page, 'Scenes'))).width;
  const line = await box(splitter);
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
  await page.mouse.down();
  // Hold the modifier so the magnet doesn't pull the line onto another one.
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.move(line.x + 160, line.y + line.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('ControlOrMeta');
  expect((await box(tile(page, 'Scenes'))).width).toBeGreaterThan(start + 100);

  await splitter.dblclick();
  const scenes = (await box(tile(page, 'Scenes'))).width;
  const board = (await box(tile(page, 'Storyboard'))).width;
  expect(Math.abs(scenes - board)).toBeLessThan(4);

  await splitter.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await box(tile(page, 'Scenes'))).width).toBeLessThan(scenes - 4);
});

test('maximizes with backtick, folds the others into chips, and restores every size exactly', async ({ page }) => {
  const sizes = await Promise.all(['Scenes', 'Storyboard', 'Player'].map(async (name) => box(tile(page, name))));
  await page.getByRole('button', { name: 'Move Storyboard' }).focus();
  await page.keyboard.press('`');
  await expect(tile(page, 'Scenes')).toBeHidden();
  const chips = page.getByRole('list', { name: 'Folded tiles' });
  await expect(chips.getByRole('button', { name: '01 Scenes' })).toBeVisible();

  await page.keyboard.press('`');
  const after = await Promise.all(['Scenes', 'Storyboard', 'Player'].map(async (name) => box(tile(page, name))));
  expect(after).toEqual(sizes);
});

test('closes a tile into its neighbour; ⌘Z leaves the layout alone and the Layout menu brings it back', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Frame inspector' }).click();
  await expect(tile(page, 'Frame inspector')).toBeHidden();
  // The app picks ⌘ or Ctrl from the user agent, and Playwright's Chromium profile reports Windows even on a Mac.
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+z`);
  await expect(tile(page, 'Frame inspector')).toBeHidden();

  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Undo layout change' }).click();
  await expect(tile(page, 'Frame inspector')).toBeVisible();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await expect(page.getByRole('button', { name: 'Undo layout change' })).toBeDisabled();
});

test('keeps the layout after a reload, marks it unsaved, and resets', async ({ page }) => {
  await page.getByRole('button', { name: 'Close Player' }).click();
  const tab = page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ });
  await expect(tab.getByRole('img', { name: 'unsaved layout' })).toBeVisible();
  await page.reload();
  await expect(tile(page, 'Player')).toBeHidden();

  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Update “Storyboard”' }).click();
  await expect(tab.getByRole('img', { name: 'unsaved layout' })).toBeHidden();

  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Reset to default layout' }).click();
  await expect(tile(page, 'Player')).toBeVisible();
});

test('opens any tile in any workspace from the Layout menu', async ({ page }) => {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Calendar' }).click();
  await expect(tile(page, 'Calendar')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Layout/ })).toBeFocused();
});

test('moves a tile from the keyboard alone', async ({ page }) => {
  await page.getByRole('button', { name: 'Move Player' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Move Player' })).toHaveAttribute('aria-pressed', 'true');
  // The first target is Scenes; Space stacks Player onto it as a tab.
  await page.keyboard.press(' ');
  await expect(page.getByText('Add as tab', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tablist', { name: 'Player tabs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Player' })).toBeFocused();
});

test('passes axe with tiles docked as tabs and the Layout menu open', async ({ page }) => {
  const board = await box(tile(page, 'Storyboard'));
  await drag(page, tile(page, 'Player'), { x: board.x + board.width / 2, y: board.y + board.height / 2 });
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
});

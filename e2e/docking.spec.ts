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
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(tab.getByRole('img', { name: 'unsaved layout' })).toBeHidden();

  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Reset to default layout' }).click();
  await expect(tile(page, 'Player')).toBeVisible();
});

test('opens any built tile in any workspace from the Layout menu, and only built ones', async ({ page }) => {
  await page.getByRole('button', { name: /^Layout/ }).click();
  // A later phase's placeholder (the bird's-eye plan) isn't offered: what isn't built is hidden (Kevin, Nov 5).
  await expect(page.getByRole('group', { name: 'Open tile' }).getByRole('button', { name: 'Set plan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(tile(page, 'Trash')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Layout/ })).toBeFocused();

  // With every built tile open, the group offers nothing, though the plan and the rest aren't open.
  for (const name of ['History', 'Color script', 'Moodboard', 'Locations', 'Cast and crew', 'Team', 'Department', 'Shoot days', 'Calendar', 'Gear', 'Notifications', 'Assets', 'Call sheet', 'Setups']) {
    await page.getByRole('button', { name: /^Layout/ }).click();
    await page.getByRole('group', { name: 'Open tile' }).getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: /^Layout/ }).click();
  const group = page.getByRole('group', { name: 'Open tile' });
  await expect(group.getByRole('button')).toHaveCount(0);
  await expect(group.getByText('Every built tile is open.')).toBeVisible();
});

test('Settings opened with its shortcut while a menu is open closes the menu (PB’s low)', async ({ page }) => {
  await page.getByRole('button', { name: /^Layout/ }).click();
  await expect(page.getByRole('group', { name: 'Open tile' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Open tile' })).toBeHidden();
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

test('docks a tile along the whole bottom, top or right of the window, spanning that side (polish 4)', async ({ page }) => {
  const root = await box(page.locator('[data-dock-root]'));
  const statusBar = await box(page.getByRole('contentinfo'));
  // Thrown at the window's bottom, onto the status bar: the preview spans the whole width at a quarter of the height.
  await drag(page, tile(page, 'Frame inspector'), { x: root.x + root.width / 2, y: statusBar.y + statusBar.height / 2 }, false);
  await expect(page.getByText('Dock along the bottom', { exact: true })).toBeVisible();
  await page.mouse.up();
  const inspector = await box(tile(page, 'Frame inspector'));
  expect(Math.abs(inspector.x - root.x)).toBeLessThan(2);
  expect(Math.abs(inspector.width - root.width)).toBeLessThan(2);
  expect(Math.abs(inspector.y + inspector.height - (root.y + root.height))).toBeLessThan(2);
  expect(Math.abs(inspector.height - (root.height - 8) / 4)).toBeLessThan(12);
  // Every other tile sits above it.
  for (const name of ['Scenes', 'Storyboard', 'Player']) {
    const other = await box(tile(page, name));
    expect(other.y + other.height).toBeLessThanOrEqual(inspector.y);
  }

  // Along the top: past the tiles, over the top bar.
  await drag(page, tile(page, 'Player'), { x: root.x + root.width / 2, y: root.y - 20 });
  const player = await box(tile(page, 'Player'));
  expect(Math.abs(player.y - root.y)).toBeLessThan(2);
  expect(Math.abs(player.width - root.width)).toBeLessThan(2);

  // Along the right, at the window's edge: the whole height.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await drag(page, tile(page, 'Frame inspector'), { x: viewport.width - 2, y: root.y + root.height / 2 });
  const right = await box(tile(page, 'Frame inspector'));
  expect(Math.abs(right.y - root.y)).toBeLessThan(2);
  expect(Math.abs(right.height - root.height)).toBeLessThan(2);
  expect(Math.abs(right.x + right.width - (root.x + root.width))).toBeLessThan(2);
});

test('a tile let go on its own title bar, near the top, stays where it was', async ({ page }) => {
  const before = await box(tile(page, 'Scenes'));
  const bar = await box(tile(page, 'Scenes').locator('div').first());
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 + 12, bar.y + bar.height / 2, { steps: 3 });
  await expect(page.getByText(/^Dock along/)).toHaveCount(0);
  await page.mouse.up();
  expect(await box(tile(page, 'Scenes'))).toEqual(before);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await expect(page.getByRole('button', { name: 'Undo layout change' })).toBeDisabled();
});

test('never docks along the left edge, the sidebar’s: there a tile splits the tile under it', async ({ page }) => {
  const panel = await box(page.getByRole('region', { name: 'Storyboard workspace' }));
  // Inside the leftmost tile, as near the window's left edge as a tile reaches.
  await drag(page, tile(page, 'Player'), { x: panel.x + 14, y: panel.y + panel.height / 2 }, false);
  await expect(page.getByText(/^Dock along/)).toHaveCount(0);
  await expect(page.getByText('Split left', { exact: true })).toBeVisible();
  // Over the sidebar itself: nothing at all.
  await page.mouse.move(panel.x - 40, panel.y + panel.height / 2, { steps: 4 });
  await expect(page.getByText(/^Dock along|^Split/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('docks along a window edge from the keyboard, after every tile, never on the left', async ({ page }) => {
  const said = page.getByRole('region', { name: 'Storyboard workspace' }).locator('[aria-live="polite"]');
  await page.getByRole('button', { name: 'Move Player' }).focus();
  await page.keyboard.press('Enter');
  await expect(said).toContainText('the window’s own edges');
  // Scenes, Storyboard, Frame inspector, then the window.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
  await expect(page.getByText('Dock along the right', { exact: true })).toBeVisible();
  await expect(said).toHaveText('Dock along the right of the window.');
  await page.keyboard.press('ArrowLeft');
  await expect(said).toHaveText('The window’s left edge is the sidebar’s: pick top, right or bottom.');
  await expect(page.getByText('Dock along the right', { exact: true })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(said).toHaveText('The window has no centre: pick top, right or bottom.');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Dock along the bottom', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  const root = await box(page.locator('[data-dock-root]'));
  const player = await box(tile(page, 'Player'));
  expect(Math.abs(player.width - root.width)).toBeLessThan(2);
  await expect(page.getByRole('button', { name: 'Move Player' })).toBeFocused();
});

test('docking along the bottom keeps where the board was scrolled to (P4’s low)', async ({ page }) => {
  await page.goto('/?files=memory');
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('dialog', { name: /^Set up / }).getByRole('button', { name: 'Skip' }).click();
  await tile(page, 'Scenes').getByRole('button', { name: '+ New scene' }).click();
  for (let i = 0; i < 15; i += 1) await tile(page, 'Storyboard').getByRole('button', { name: '+ Frame in SC 01' }).click();
  // The board's scroller: the nearest box round it that scrolls.
  const scroller = `(() => { let el = document.querySelector('[data-board]'); while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; return el; })()`;
  const scrolled = () => page.evaluate(`${scroller}?.scrollTop ?? -1`);
  await page.evaluate(`${scroller}.scrollTo(0, 240)`);
  await expect.poll(scrolled).toBe(240);
  // Player along the bottom, from the keyboard: the whole workspace is drawn again in a new split.
  await page.getByRole('button', { name: 'Move Player' }).focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const root = await box(page.locator('[data-dock-root]'));
  expect(Math.abs((await box(tile(page, 'Player'))).width - root.width)).toBeLessThan(2);
  await expect.poll(scrolled).toBe(240);
});

test('a scene picked in the sidebar from another workspace still opens the board on that scene', async ({ page }) => {
  await page.goto('/?files=memory');
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await page.getByRole('dialog', { name: /^Set up / }).getByRole('button', { name: 'Skip' }).click();
  for (let s = 1; s <= 3; s += 1) {
    await tile(page, 'Scenes').getByRole('button', { name: '+ New scene' }).click();
    for (let i = 0; i < 8; i += 1) await tile(page, 'Storyboard').getByRole('button', { name: `+ Frame in SC 0${String(s)}` }).click();
  }
  // The board scrolled to its end, then another workspace, then SC 01 from the sidebar.
  const scroller = `(() => { let el = document.querySelector('[data-board]'); while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement; return el; })()`;
  await page.evaluate(`${scroller}.scrollTo(0, 1e6)`);
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await sections.getByRole('button', { name: /^Production/ }).click();
  await sections.getByRole('button', { name: /^SC 01/ }).click();
  // Its heading is in view: the remembered scroll position never overrides the scene picked (Q1 review).
  await expect(tile(page, 'Storyboard').getByText('SC 01', { exact: true }).first()).toBeInViewport();
});

test('the Layout menu: four labelled groups, shortcuts at the right, Undo layout change alone at the bottom (polish A)', async ({ page }) => {
  const layout = page.getByRole('button', { name: /^Layout/ });
  await layout.click();
  const panel = page.locator(`[id="${(await layout.getAttribute('aria-controls')) ?? ''}"]`);
  // Three labelled groups, then Undo layout change on its own at the bottom, under a rule but no label.
  const groups = panel.getByRole('group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAccessibleName('Workspace · Storyboard');
  await expect(groups.nth(1)).toHaveAccessibleName('View');
  await expect(groups.nth(2)).toHaveAccessibleName('Open tile');
  await expect(panel.getByRole('button').last()).toHaveText('Undo layout change');
  // Shortcuts at the right, given to assistive tech too.
  const save = groups.nth(0).getByRole('button', { name: 'Save layout' });
  await expect(save).toHaveAttribute('aria-keyshortcuts', /Shift\+S/);
  await expect(save.locator('kbd')).toHaveText(/⇧S|Shift\+S/);
  await expect(save).toHaveAccessibleName('Save layout');
  await expect(save).toHaveAccessibleDescription(/⇧S|Shift\+S/);

  // View: before any tile is used there's nothing to maximize.
  await expect(panel.getByRole('button', { name: 'Maximize tile' })).toBeDisabled();
  // A press anywhere on a tile, even where nothing takes focus, makes it the one; the item names it.
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Player', exact: true }).locator('[data-player-state]').click();
  await layout.click();
  await panel.getByRole('button', { name: 'Maximize Player' }).click();
  await expect(page.getByRole('region', { name: 'Scenes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Player', exact: true })).toBeVisible();
  await layout.click();
  await panel.getByRole('button', { name: 'Restore tile' }).click();
  await expect(page.getByRole('region', { name: 'Scenes', exact: true })).toBeVisible();

  // And the sidebar.
  await layout.click();
  await panel.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  await expect(layout).toBeFocused();
  await layout.click();
  await panel.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`both menus pass axe, open (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const name of [/^Layout/, /^Project$/]) {
      await page.getByRole('button', { name }).click();
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
      await page.keyboard.press('Escape');
    }
  });
}

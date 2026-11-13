import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { gear, openSettings, settingsWindow } from './settings';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const section = (page: Page, name: string) => sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) });

test('lists the six sections in order, only Setup still showing its phase, and opens one per click', async ({ page }) => {
  const sections = sidebar(page).locator('[id^="section-"]');
  await expect(sections).toHaveText([
    'Storyboard',
    'Assets',
    'Team',
    'SetupPhase 6',
    'Production',
    'Moodboard',
  ]);
  // Only Setup is still to come (Phase 6; Kevin, Nov 11): it alone is muted. The built sections read as live.
  await expect(section(page, 'Setup')).toHaveClass(/text-text-muted/);
  for (const built of ['Assets', 'Team', 'Production', 'Moodboard']) {
    await expect(section(page, built)).not.toHaveClass(/text-text-muted/);
  }
  // Settings is a window of the app's own (polish B), behind the gear at the sidebar's foot (polish C).
  await expect(gear(page)).toBeVisible();
  await expect(section(page, 'Storyboard')).toHaveAttribute('aria-current', 'page');

  await section(page, 'Production').click();
  await expect(section(page, 'Production')).toHaveAttribute('aria-current', 'page');
  await expect(section(page, 'Storyboard')).not.toHaveAttribute('aria-current', 'page');
  for (const tile of ['Shoot days', 'Calendar', 'Call sheet', 'Locations', 'Gear', 'Cast and crew']) {
    await expect(page.getByRole('region', { name: tile, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Workspace: Production')).toBeVisible();

  await section(page, 'Setup').click();
  await expect(page.getByRole('region', { name: 'Set plan' })).toBeVisible();
});

test('arrow keys move through the sidebar, Enter opens, and Tab enters at the active section', async ({ page }) => {
  await page.getByRole('button', { name: /^Project:/ }).focus();
  await page.keyboard.press('Tab');
  await expect(section(page, 'Storyboard')).toBeFocused();

  // + Add Scene is disabled with no project open, so the arrows skip it.
  await page.keyboard.press('ArrowDown');
  await expect(section(page, 'Assets')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(section(page, 'Setup')).toBeFocused();
  await expect(section(page, 'Storyboard')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Enter');
  await expect(section(page, 'Setup')).toHaveAttribute('aria-current', 'page');

  // The last entry is the foot's Web version, still to come: on the arrows so its phase is heard.
  await page.keyboard.press('End');
  await expect(sidebar(page).getByRole('button', { name: /^Web version/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(section(page, 'Storyboard')).toBeFocused();
});

test('Alt+1 to Alt+6 jump to a section, and focus follows from the tiles', async ({ page }) => {
  // Focus inside a tile: the switch unmounts that tile, so focus must not drop to <body>.
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press('Alt+5');
  await expect(section(page, 'Production')).toHaveAttribute('aria-current', 'page');
  await expect(section(page, 'Production')).toBeFocused();
  await page.keyboard.press('Alt+6');
  await expect(page.getByRole('region', { name: 'Moodboard', exact: true })).toBeVisible();
  await expect(section(page, 'Moodboard')).toBeFocused();
  // The workspace already open: nothing unmounts, so focus stays where it is.
  await page.getByRole('button', { name: 'Maximize Moodboard' }).focus();
  await page.keyboard.press('Alt+6');
  await expect(page.getByRole('button', { name: 'Maximize Moodboard' })).toBeFocused();
  // Alt+7 is no section any more.
  await page.keyboard.press('Alt+7');
  await expect(section(page, 'Moodboard')).toHaveAttribute('aria-current', 'page');
});

test('Settings opens in a window of the app’s own: ⌘, or the sidebar, Escape closes, focus stays inside', async ({ page }) => {
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press(`${mod}+Comma`);
  const settings = settingsWindow(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('tabpanel', { name: 'Project' })).toContainText('No project open.');
  // The arrows move through the tabs, which follow focus.
  await settings.getByRole('tab', { name: 'Project' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(settings.getByRole('tab', { name: 'App' })).toBeFocused();
  await expect(settings.getByRole('tabpanel', { name: 'App' }).getByLabel('App language')).toBeVisible();
  // Tab never leaves the window: twenty presses later, focus is still inside it.
  for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab');
  expect(await settings.evaluate((window) => window.contains(document.activeElement))).toBe(true);
  // Escape closes it, and focus goes back to where it was.
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Maximize Scenes' })).toBeFocused();
  // It opens again at the tab last open, from the gear too.
  await gear(page).click();
  await expect(settings.getByRole('tab', { name: 'App' })).toHaveAttribute('aria-selected', 'true');
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await expect(settings).toBeHidden();
});

test('the project menu and switcher show what each command waits for', async ({ page }) => {
  const project = page.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  // Every command is built; with no project open there's nothing for them to act on. In the menu's own panel: the top
  // bar has a History button too (polish 3).
  const menu = page.locator(`[id="${(await project.getAttribute('aria-controls')) ?? ''}"]`);
  for (const name of ['History', 'Watermark Settings…', 'Export Project…', 'Archive Project']) {
    await expect(menu.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeFocused();

  // The browser build has no files to open, so the switcher says where projects open.
  await page.getByRole('button', { name: /^Project:/ }).click();
  await expect(page.getByRole('button', { name: 'New project… Desktop app' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects… Desktop app' })).toBeFocused();
});

// Paper ink on orange is 2.9:1, under the 3:1 a focus ring needs, so the ring on the active section stays ink.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the orange section keeps an ink focus ring, and the sidebar passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    const storyboard = section(page, 'Storyboard');
    await page.getByRole('button', { name: /^Project:/ }).focus();
    await page.keyboard.press('Tab');
    await expect(storyboard).toBeFocused();
    const style = await storyboard.evaluate((el) => ({
      visible: el.matches(':focus-visible'),
      ring: getComputedStyle(el).outlineColor,
    }));
    expect(style.visible).toBe(true);
    expect(style.ring).toBe('rgb(22, 21, 15)');

    await section(page, 'Team').hover();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .include('nav')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

test('a tile maximizes to fill the workspace and restores', async ({ page }) => {
  await page.getByRole('button', { name: 'Maximize Storyboard' }).click();
  await expect(page.getByRole('region', { name: 'Scenes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore Storyboard' }).click();
  await expect(page.getByRole('region', { name: 'Scenes' })).toBeVisible();
});

test('the Backups tile keeps its settings for every project, across a reload, and refuses a bad number', async ({ page }) => {
  const backups = await openSettings(page, 'Backups');
  const copies = backups.getByLabel('Keep the last');
  await expect(copies).toHaveValue('12');
  await copies.fill('20');
  await copies.press('Enter');
  const days = backups.getByLabel('Plus one a day for');
  await days.fill('-3');
  await days.press('Enter');
  await expect(days).toHaveValue('14');

  await page.reload();
  await expect((await openSettings(page, 'Backups')).getByLabel('Keep the last')).toHaveValue('20');
});

test('the sidebar hides to a strip and shows again, by button or shortcut, and stays as it was left', async ({ page }) => {
  const shortcut = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+Backslash' : 'Control+Backslash';
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  await expect(scenes).toBeVisible();
  const before = (await scenes.boundingBox())?.width ?? 0;
  expect(before).toBeGreaterThan(0);
  const strip = page.getByRole('complementary', { name: 'Sidebar, folded' });
  const show = strip.getByRole('button', { name: /^Show sidebar/ });
  const hide = page.getByRole('button', { name: /^Hide sidebar/ });

  await hide.click();
  await expect(sidebar(page)).toHaveCount(0);
  // Focus goes to the button that brings it back, never to the page.
  await expect(show).toBeFocused();
  // The workspace takes the room: each tile keeps its share, so it widens.
  await expect.poll(async () => (await scenes.boundingBox())?.width ?? 0).toBeGreaterThan(before);

  await page.reload();
  await expect(sidebar(page)).toHaveCount(0);
  await show.click();
  await expect(sidebar(page)).toBeVisible();
  await expect(hide).toBeFocused();
  await page.reload();
  await expect(sidebar(page)).toBeVisible();

  // From the keyboard, focus follows only from what folds away: in the sidebar, it goes to Show sidebar and back.
  await section(page, 'Team').focus();
  await page.keyboard.press(shortcut);
  await expect(show).toBeFocused();
  await page.keyboard.press(shortcut);
  await expect(hide).toBeFocused();
  // Anywhere else it stays where it was.
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Maximize Scenes' })).toBeFocused();

  // Not mid-drag: the workspace would move from under the pointer.
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toBeVisible();
  const line = await page.getByRole('separator', { name: 'Resize Scenes and Storyboard' }).boundingBox();
  if (!line) throw new Error('no splitter');
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + 40, line.y + line.height / 2, { steps: 4 });
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toBeVisible();
  await page.mouse.up();
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toHaveCount(0);

  // Alt+number still opens a section while it's hidden; with no section to land on, the workspace takes focus.
  await page.keyboard.press('Alt+6');
  await expect(page.getByText('Workspace: Moodboard')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Moodboard workspace' })).toBeFocused();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the folded strip keeps an ink focus ring and passes axe (${colorScheme})`, async ({ page }) => {
    // Without motion, so the ring is read at its colour rather than partway through the theme's 200ms ease.
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.getByRole('button', { name: /^Hide sidebar/ }).click();
    const show = page.getByRole('button', { name: /^Show sidebar/ });
    await expect(show).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const style = await show.evaluate((el) => ({ visible: el.matches(':focus-visible'), ring: getComputedStyle(el).outlineColor }));
    expect(style.visible).toBe(true);
    expect(style.ring).toBe(colorScheme === 'light' ? 'rgb(22, 21, 15)' : 'rgb(238, 233, 223)');
    const { violations } = await new AxeBuilder({ page })
      .include('aside')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

test('the sidebar’s foot holds the web version to come, Hide sidebar, the Settings gear and the profile', async ({ page }) => {
  // Visible, marked with its phase, and going nowhere yet.
  const web = sidebar(page).getByRole('button', { name: /^Web version/ });
  await expect(web).toHaveText(/Web version\s*Phase 9/);
  await expect(web).toHaveAttribute('aria-disabled', 'true');
  // Reachable from the keyboard, so its phase is heard; Enter does nothing.
  await web.focus();
  await page.keyboard.press('Enter');
  await expect(web).toBeFocused();
  await expect(settingsWindow(page)).toHaveCount(0);

  // The profile, empty at first: it opens Settings at its own tab.
  const profile = page.getByRole('button', { name: 'Set up your profile' });
  await profile.click();
  const tab = settingsWindow(page).getByRole('tabpanel', { name: 'Profile' });
  await tab.getByLabel('Your name').fill('Kevin Matos');
  await tab.getByLabel('Your name').press('Enter');
  await tab.getByLabel('Usual role').selectOption('dp');
  await page.keyboard.press('Escape');
  // The avatar shows the initials, the name is its label.
  const filled = page.getByRole('button', { name: 'Profile: Kevin Matos' });
  await expect(filled).toHaveText('KM');

  // Remembered across a restart.
  await page.reload();
  await expect(filled).toHaveText('KM');
  await filled.click();
  await expect(settingsWindow(page).getByRole('tabpanel', { name: 'Profile' }).getByLabel('Usual role')).toHaveValue('dp');
  await page.keyboard.press('Escape');

  // Folded, the strip keeps the profile and the gear in reach.
  await page.getByRole('button', { name: /^Hide sidebar/ }).click();
  const strip = page.getByRole('complementary', { name: 'Sidebar, folded' });
  await expect(strip.getByRole('button', { name: 'Profile: Kevin Matos' })).toBeVisible();
  await strip.getByRole('button', { name: /^Settings \(/ }).click();
  await expect(settingsWindow(page)).toBeVisible();
});

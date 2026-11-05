import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const section = (page: Page, name: string) => sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) });

test('lists the seven sections in order, each showing its phase, and opens one per click', async ({ page }) => {
  const sections = sidebar(page).locator('[id^="section-"]');
  await expect(sections).toHaveText([
    'StoryboardPhase 1',
    'AssetsPhase 2',
    'TeamPhase 3',
    'SetupPhase 5',
    'ProductionPhases 3–4',
    'MoodboardPhase 6',
    // Built in 0.7, so no phase.
    'Settings',
  ]);
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

  await page.keyboard.press('End');
  await expect(section(page, 'Settings')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(section(page, 'Storyboard')).toBeFocused();
});

test('Alt+1 to Alt+7 jump to a section, and focus follows from the tiles', async ({ page }) => {
  // Focus inside a tile: the switch unmounts that tile, so focus must not drop to <body>.
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press('Alt+5');
  await expect(section(page, 'Production')).toHaveAttribute('aria-current', 'page');
  await expect(section(page, 'Production')).toBeFocused();
  await page.keyboard.press('Alt+7');
  await expect(page.getByRole('region', { name: 'Project', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Project', exact: true })).toContainText('No project open.');
  await expect(section(page, 'Settings')).toBeFocused();
  // The workspace already open: nothing unmounts, so focus stays where it is.
  await page.getByRole('button', { name: 'Maximize Project' }).focus();
  await page.keyboard.press('Alt+7');
  await expect(page.getByRole('button', { name: 'Maximize Project' })).toBeFocused();
});

test('the project menu and switcher show what each command waits for', async ({ page }) => {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  // Every command is built; with no project open there's nothing for them to act on.
  for (const name of ['History', 'Watermark Settings', 'Export Project…', 'Archive Project']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
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
  await section(page, 'Settings').click();
  const backups = page.getByRole('region', { name: 'Backups', exact: true });
  const copies = backups.getByLabel('Keep the last');
  await expect(copies).toHaveValue('12');
  await copies.fill('20');
  await copies.press('Enter');
  const days = backups.getByLabel('Plus one a day for');
  await days.fill('-3');
  await days.press('Enter');
  await expect(days).toHaveValue('14');

  await page.reload();
  await section(page, 'Settings').click();
  await expect(page.getByRole('region', { name: 'Backups', exact: true }).getByLabel('Keep the last')).toHaveValue('20');
});

test('the sidebar hides to a strip and shows again, by button or shortcut, and stays as it was left', async ({ page }) => {
  const shortcut = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+Backslash' : 'Control+Backslash';
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  const before = (await scenes.boundingBox())?.width ?? 0;

  await page.getByRole('button', { name: /^Hide sidebar/ }).click();
  await expect(sidebar(page)).toHaveCount(0);
  const show = page.getByRole('complementary', { name: 'Sidebar, hidden' }).getByRole('button', { name: /^Show sidebar/ });
  // Focus goes to the button that brings it back, never to the page.
  await expect(show).toBeFocused();
  // The workspace takes the room: each tile keeps its share, so it widens.
  await expect.poll(async () => (await scenes.boundingBox())?.width ?? 0).toBeGreaterThan(before);

  await page.reload();
  await expect(sidebar(page)).toHaveCount(0);
  await show.click();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Hide sidebar/ })).toBeFocused();

  // From the keyboard, anywhere: focus stays where it is unless it was in what folds away.
  await page.getByRole('button', { name: 'Maximize Scenes' }).focus();
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Maximize Scenes' })).toBeFocused();
  await page.keyboard.press(shortcut);
  await expect(sidebar(page)).toBeVisible();
  // The sections still answer Alt+number while it's hidden.
  await page.keyboard.press(shortcut);
  await page.keyboard.press('Alt+7');
  await expect(page.getByText('Workspace: Settings')).toBeVisible();
});

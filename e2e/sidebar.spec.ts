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
    'Settings0.7',
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
  await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
  await expect(section(page, 'Settings')).toBeFocused();
  // The workspace already open: nothing unmounts, so focus stays where it is.
  await page.getByRole('button', { name: 'Maximize Settings' }).focus();
  await page.keyboard.press('Alt+7');
  await expect(page.getByRole('button', { name: 'Maximize Settings' })).toBeFocused();
});

test('the project menu and switcher show what each command waits for', async ({ page }) => {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  for (const [name, phase] of [
    ['History', 'Phase 1'],
    ['Watermark Settings', 'Phase 1'],
    ['Export Project', 'Phase 1'],
    ['Archive Project', '0.7'],
  ] as const) {
    await expect(page.getByRole('button', { name: `${name} ${phase}` })).toHaveAttribute('aria-disabled', 'true');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeFocused();

  await page.getByRole('button', { name: /^Project:/ }).click();
  await expect(page.getByRole('button', { name: 'New project… 0.7' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects… 0.7' })).toBeFocused();
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

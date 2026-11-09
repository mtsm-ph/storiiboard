import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Department workspaces (3.6a) in the memory build: a department's name on a frame opens its workspace, with the
// frame and the scene as that department sees them; it stays in the sidebar until taken off.

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
  const add = board(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const departments = (page: Page) => sections(page).getByRole('list', { name: 'Departments' });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const view = (page: Page) => page.getByRole('region', { name: 'Department', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a department’s row on a frame opens its workspace: the frame, the scene and the people as it sees them', async ({ page }) => {
  // Someone in Camera, for the view's people.
  await sections(page).getByRole('button', { name: /^Production/ }).click();
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Ana Ruiz');
  await page.keyboard.press('Enter');
  await people.locator('[data-person-editor]').getByRole('button', { name: 'Camera', exact: true }).click();
  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(departments(page)).toHaveCount(0);

  // From the keyboard: down from Direction's Priority to Camera's, Left to its name; Enter opens the workspace.
  await board(page).locator('[data-shot-id]').first().click();
  const grid = inspector(page).getByRole('grid', { name: 'Departments on this frame' });
  await grid.getByRole('checkbox', { name: 'Direction: Priority', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(grid.getByRole('button', { name: 'Camera: open its workspace' })).toBeFocused();
  await page.keyboard.press('Enter');

  // On screen and in the sidebar, focus on the view's heading.
  await expect(page.getByRole('region', { name: 'Camera workspace' })).toBeVisible();
  await expect(departments(page).getByRole('button', { name: 'Camera' })).toHaveAttribute('aria-current', 'page');
  await expect(view(page).getByRole('heading', { name: 'Camera', level: 2 })).toBeFocused();
  await expect(view(page)).toContainText('SC 01');

  // This frame, with Camera's row alone, ticked here and seen in the inspector beside it: one edit, one undo.
  const row = view(page).getByRole('grid', { name: 'Departments on this frame' });
  await expect(row.getByRole('rowheader')).toHaveText(['Camera']);
  await row.getByRole('checkbox', { name: 'Camera: Priority', exact: true }).click();
  await expect(inspector(page).getByRole('checkbox', { name: 'Camera: Priority', exact: true })).toHaveAttribute('aria-checked', 'true');
  const frames = view(page).getByRole('list', { name: 'The scene’s frames for Camera' }).getByRole('button');
  await expect(frames).toHaveCount(2);
  await expect(frames.first()).toHaveAttribute('aria-current', 'true');
  await expect(frames.first()).toHaveAccessibleName(/, Priority/);
  await expect(view(page)).toContainText('Priority: 1');
  await page.keyboard.press(await undoKey(page));
  await expect(row.getByRole('checkbox', { name: 'Camera: Priority', exact: true })).toHaveAttribute('aria-checked', 'false');

  // Picking another frame in the list picks it for the inspector too; the people are Camera's.
  await frames.nth(1).click();
  await expect(frames.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(inspector(page).getByRole('checkbox', { name: 'Camera: Priority', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(view(page).getByRole('region', { name: 'People' })).toContainText('Ana Ruiz');
  await axe(page, '[aria-label="Department"]');
  await axe(page, '[data-sidebar]');

  // The person's, not the project's: still in the sidebar after a reload.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(departments(page).getByRole('button', { name: 'Camera' })).toBeVisible();
});

test('a department workspace leaves the sidebar by Delete or the Layout menu, its layout kept', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  const grid = inspector(page).getByRole('grid', { name: 'Departments on this frame' });
  await grid.getByRole('button', { name: 'Sound: open its workspace' }).click();
  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await grid.getByRole('button', { name: 'Camera: open its workspace' }).click();
  // Listed in the call sheet's order, whichever opened first.
  await expect(departments(page).getByRole('button')).toHaveText(['Camera', 'Sound']);

  // A layout change of its own, kept for the next time it's opened.
  await view(page).getByRole('button', { name: /^Close/ }).click();
  await expect(view(page)).toHaveCount(0);

  // Delete on the one on screen takes it off: the Storyboard takes its place, and focus goes with it.
  const camera = departments(page).getByRole('button', { name: 'Camera' });
  await camera.focus();
  await page.keyboard.press('Delete');
  await expect(departments(page).getByRole('button')).toHaveText(['Sound']);
  await expect(sections(page).getByRole('button', { name: /^Storyboard/ })).toHaveAttribute('aria-current', 'page');
  await expect(sections(page).getByRole('button', { name: /^Storyboard/ })).toBeFocused();

  // The Layout menu's Remove from sidebar, on Sound's own workspace.
  await departments(page).getByRole('button', { name: 'Sound' }).click();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Remove from sidebar' }).click();
  await expect(departments(page)).toHaveCount(0);
  await expect(sections(page).getByRole('button', { name: /^Storyboard/ })).toBeFocused();

  // Opened again, Camera's layout is as it was left: no Department tile, until Reset to default layout.
  await board(page).locator('[data-shot-id]').first().click();
  await grid.getByRole('button', { name: 'Camera: open its workspace' }).click();
  await expect(view(page)).toHaveCount(0);
  // With no view to land on, focus goes to the workspace itself, never back to the page.
  await expect(page.getByRole('region', { name: 'Camera workspace' })).toBeFocused();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Reset to default layout' }).click();
  await expect(view(page)).toBeVisible();
});

test('the Department tile opened into another workspace has a department picker, starting on your own', async ({ page }) => {
  await board(page).locator('[data-shot-id]').first().click();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('group', { name: 'Open tile' }).getByRole('button', { name: 'Department', exact: true }).click();
  // No role here yet: the first department, Direction.
  const picker = view(page).getByRole('combobox', { name: 'Department' });
  await expect(picker).toHaveValue('direction');
  await expect(view(page).getByRole('heading', { level: 2 })).toHaveText('Direction');
  await picker.selectOption({ label: 'Sound' });
  await expect(view(page).getByRole('heading', { level: 2 })).toHaveText('Sound');
  await expect(view(page).getByRole('grid', { name: 'Departments on this frame' }).getByRole('rowheader')).toHaveText(['Sound']);
  // Opening the tile here adds nothing to the sidebar: that list is for a department's own workspace.
  await expect(departments(page)).toHaveCount(0);
});

/** WCAG 2.2 AA, as the app's other checks run it, light and dark. */
async function axe(page: Page, selector: string) {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    expect((await new AxeBuilder({ page }).include(selector).withTags(tags).analyze()).violations).toEqual([]);
  }
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'light');
  });
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Perspective views (3.6c) in the memory build: picked as yourself in Cast and crew, a gaffer sees Grip & electric
// first on a frame and a scene, the other departments folded under Rest of crew; Full view brings back everything.

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
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const people = (page: Page) => page.getByRole('region', { name: 'Cast and crew', exact: true });
const editor = (page: Page) => people(page).locator('[data-person-editor]');

/** A new person in Cast and crew with a role and departments, back on the Storyboard after. */
async function addPerson(page: Page, name: string, role: string, departments: readonly string[], me = false) {
  await sections(page).getByRole('button', { name: /^Production/ }).click();
  await people(page).getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await editor(page).getByRole('combobox', { name: 'Role' }).selectOption({ label: role });
  for (const department of departments) await editor(page).getByRole('button', { name: department, exact: true }).click();
  if (me) await editor(page).getByRole('button', { name: 'This is me' }).click();
}

test('a gaffer sees Grip & electric first, the rest under Rest of crew; Full view shows every department again', async ({ page }) => {
  // The DP's Full view is on by default; a gaffer's is off.
  await addPerson(page, 'Kevin Matos', 'Director of photography', ['Camera']);
  await expect(editor(page).getByRole('switch', { name: 'Full view' })).toHaveAttribute('aria-checked', 'true');
  await addPerson(page, 'Sam Ortiz', 'Gaffer', ['Grip & electric'], true);
  const fullView = editor(page).getByRole('switch', { name: 'Full view' });
  await expect(fullView).toHaveAttribute('aria-checked', 'false');
  await expect(editor(page)).toContainText('anyone with the project file can open everything');

  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const mine = inspector(page).getByRole('grid', { name: 'Your departments on this frame' });
  await expect(mine.getByRole('rowheader')).toHaveText(['Grip & electric']);
  await expect(inspector(page).getByRole('grid', { name: 'Departments on this frame', exact: true })).toHaveCount(0);
  const rest = inspector(page).locator('[data-rest-of-crew="frame"]');
  await expect(rest).toHaveAttribute('aria-expanded', 'false');
  await expect(rest).not.toHaveAttribute('aria-controls');
  await expect(rest).toHaveAccessibleName('Rest of crew 10 departments');
  // The scene's approvals fold the same way.
  await expect(inspector(page).getByRole('grid', { name: 'Your departments’ approvals for SC 01' }).getByRole('checkbox')).toHaveCount(1);
  await expect(inspector(page).locator('[data-rest-of-crew="scene"]')).toHaveAttribute('aria-expanded', 'false');

  // Your own tick, and the frame card counts your departments alone.
  await mine.getByRole('checkbox', { name: 'Grip & electric: Done', exact: true }).click();
  const card = board(page).locator('[data-shot-id]').first();
  await expect(card).toHaveAccessibleDescription('Your departments: 1 seen and 1 done');

  // One click opens Rest of crew; a tick there doesn't count on your card.
  await rest.click();
  await expect(rest).toHaveAttribute('aria-expanded', 'true');
  const others = inspector(page).getByRole('grid', { name: 'Rest of crew on this frame' });
  await expect(others.getByRole('rowheader')).toHaveCount(10);
  await expect(rest).toHaveAttribute('aria-controls', /.+/);
  // The key naming the shapes is said once, under the last grid.
  await expect(inspector(page).getByRole('list', { name: 'Key' })).toHaveCount(1);
  await others.getByRole('checkbox', { name: 'Camera: Priority', exact: true }).click();
  await expect(card).toHaveAccessibleDescription('Your departments: 1 seen and 1 done');
  const results = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(results.violations).toEqual([]);

  // It stays open on the next frame, for the session.
  await board(page).locator('[data-shot-id]').nth(1).click();
  await expect(inspector(page).locator('[data-rest-of-crew="frame"]')).toHaveAttribute('aria-expanded', 'true');

  // The shot list names your departments, and how many of the rest have anything.
  await board(page).getByRole('radio', { name: 'Shot list' }).click();
  const row = board(page).getByRole('table', { name: 'Shot list' }).locator('tr:has([data-shot-id])').first();
  await expect(row).toContainText('Grip & electric');
  await expect(row).toContainText('Rest of crew: 1 more');
  // Muted on a plain row; on the selected row's fill, ink (DESIGN.md: muted never sits on oatmeal).
  await expect(row.getByText('Rest of crew: 1 more')).toHaveClass(/text-text-muted/);
  await row.locator('[data-shot-id]').click();
  await expect(row.getByText('Rest of crew: 1 more')).not.toHaveClass(/text-text-muted/);
  await expect(row).not.toContainText('Camera');

  // Full view on: every department, as the director and the DP see them.
  await sections(page).getByRole('button', { name: /^Production/ }).click();
  await people(page).getByRole('list', { name: 'Cast and crew' }).getByRole('button', { name: /^Sam Ortiz/ }).click();
  await fullView.click();
  await expect(fullView).toHaveAttribute('aria-checked', 'true');
  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(board(page).getByRole('table', { name: 'Shot list' }).locator('tr:has([data-shot-id])').first()).toContainText('Camera');
  await board(page).getByRole('radio', { name: 'Grid' }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await expect(inspector(page).getByRole('grid', { name: 'Departments on this frame', exact: true }).getByRole('rowheader')).toHaveCount(11);
  await expect(inspector(page).locator('[data-rest-of-crew]')).toHaveCount(0);
  await expect(board(page).locator('[data-shot-id]').first()).toHaveAccessibleDescription('Departments: 1 priority, 1 seen and 1 done');
});

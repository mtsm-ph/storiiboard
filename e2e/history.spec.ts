import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The History tile (1.22) in the memory build: every step in words, newest first; Restore to here as a step of its
// own; and one frame's own changes, field by field, with an old value to put back.

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
  for (let i = 0; i < 3; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

async function setLens(page: Page, mm: string) {
  const lens = inspector(page).getByLabel('Lens (mm)');
  await lens.fill(mm);
  await lens.press('Enter');
}

test('lists every step in words, newest first, and Restore to here is a step undo takes back', async ({ page }) => {
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Added frame 1C');
  await expect(steps(page).nth(3)).toContainText('Added scene SC 01');

  // Back to just after the first frame: two frames go, as one new step.
  await steps(page).nth(2).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText('Restored the project to: Added frame 1A');

  await frames(page).first().click();
  await page.keyboard.press(await undoKey(page));
  await expect(frames(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Undid: Restored the project to');
});

test('one frame’s own changes, field by field, with an old value to put back', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '35');
  await setLens(page, '50');
  await openHistory(page);
  await expect(steps(page).first()).toContainText('1A: lens 35mm → 50mm');

  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  await expect(changes.getByRole('row').nth(1)).toContainText('35mm');
  await expect(changes.getByRole('row').nth(1)).toContainText('50mm');
  await changes.getByRole('button', { name: 'Put back lens 35mm' }).click();
  await expect(inspector(page).getByLabel('Lens (mm)')).toHaveValue('35');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`History passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openHistory(page);
    await expect(steps(page)).toHaveCount(4);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// How much work the Export dialog does while a PNG export runs (1.24). Each frame written re-renders the dialog to
// say how far it got; working the board out again on each of those renders cost a feature-size board a second or
// more per frame. Counted, not timed: the dev server's storyboard module is wrapped so each board() call adds one to
// a counter in the page.

const FRAMES = 12;
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export' });

test.beforeEach(async ({ page }) => {
  // Routed before the page loads, so the app imports the wrapped module. (Routing also turns off the HTTP cache.)
  await page.route(/\/src\/features\/storyboard\/board\.ts(\?|$)/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const declaration = 'export function board(';
    if (!source.includes(declaration)) throw new Error('board() is no longer declared as the counter expects');
    const counted = source.replace(
      declaration,
      'export function board(...args) {\n  globalThis.__boardCalls = (globalThis.__boardCalls ?? 0) + 1;\n  return countedBoard(...args);\n}\nfunction countedBoard(',
    );
    await route.fulfill({ response, body: counted });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (prompt) => void prompt.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  for (let i = 0; i < FRAMES; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const boardCalls = (page: Page) => page.evaluate(() => (globalThis as unknown as { __boardCalls?: number }).__boardCalls ?? 0);

test('a PNG export works the board out a few times, not once per frame written', async ({ page }) => {
  expect(await boardCalls(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await dialog(page).getByRole('radio', { name: 'Frames (PNG)' }).check();
  await expect(dialog(page).getByText(`${String(FRAMES)} frames, leaving out the Trash.`, { exact: false })).toBeVisible();
  const before = await boardCalls(page);
  await dialog(page).getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByRole('status').getByText(`Exported ${String(FRAMES)} frames to “Bey County frames”.`)).toBeVisible();
  // The export's own pass over the scope, and the board behind the dialog redrawn once it closes, but not one call
  // per progress line: that was more than two per frame (31 for these 12, in the dev build).
  expect((await boardCalls(page)) - before).toBeLessThan(FRAMES);
});

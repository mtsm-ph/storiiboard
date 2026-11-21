import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Undoing from History (item 7, Kevin, Nov 18): a run of undos gets one Truffle outline and "Bring back what was
// undone", which takes the whole run back as one step; after Restore to here the step before carries "Before
// restoring", whose Go back link waits until the outline settles (Ctrl+S here). The button pulses, except under
// reduced motion.

async function start(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.emulateMedia({ reducedMotion });
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
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const bringBack = (page: Page) => history(page).getByRole('button', { name: 'Bring back what was undone' });
const goBack = (page: Page) => history(page).getByRole('button', { name: /^Go back to this point/ });
const mac = async (page: Page) => page.evaluate(() => /Mac/i.test(navigator.userAgent));
const key = async (page: Page, letter: string) => `${(await mac(page)) ? 'Meta' : 'Control'}+${letter}`;
const outlineEdges = (row: ReturnType<typeof steps>) =>
  row.evaluate((li) => {
    const style = getComputedStyle(li);
    return { top: style.borderTopColor, bottom: style.borderBottomColor, left: style.borderLeftColor };
  });

test('three undos are one outline and one button, which brings them all back as one step', async ({ page }) => {
  await start(page);
  await expect(steps(page).first()).toContainText('Added frame 1C');
  await expect(bringBack(page)).toHaveCount(0);
  await frames(page).first().click();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press(await key(page, 'z'));
  await expect(frames(page)).toHaveCount(0);

  // Newest first: the three undos, then the three frames they undid, marked Undone inside one box.
  const undone = history(page).locator('li[data-undone]');
  await expect(undone).toHaveCount(3);
  for (const i of [3, 4, 5]) await expect(steps(page).nth(i)).toHaveAttribute('data-undone', '');
  await expect(steps(page).nth(3)).toContainText('Undone');
  const first = await outlineEdges(steps(page).nth(3));
  const middle = await outlineEdges(steps(page).nth(4));
  const last = await outlineEdges(steps(page).nth(5));
  // One outline: its sides down every row, its top on the first row only, its bottom on the last only.
  expect(middle.left).toBe(first.left);
  expect(first.top).toBe(first.left);
  expect(middle.top).not.toBe(first.left);
  expect(last.bottom).toBe(first.left);
  expect(middle.bottom).not.toBe(first.left);
  // Never a mark: only a restore makes one.
  await expect(history(page).getByText('Before restoring')).toHaveCount(0);

  await expect(bringBack(page)).toBeVisible();
  await bringBack(page).click();
  await expect(frames(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Brought back: Added frame 1A');
  await expect(page.getByRole('status').getByText('Brought back 3 changes.')).toBeVisible();
  await expect(bringBack(page)).toHaveCount(0);
  await expect(undone).toHaveCount(0);
});

test('Restore to here marks the step before it; the link waits for Ctrl+S, then goes back', async ({ page }) => {
  await start(page);
  // Newest first: 1C, 1B, 1A, the scene. Back to just after 1A.
  await steps(page).nth(2).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText('Restored the project to: Added frame 1A');

  // The step that was current just before: its words, and no link while the button is the way back.
  const marked = history(page).locator('li[data-before-restoring]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText('Added frame 1C');
  await expect(marked).toContainText('Before restoring');
  await expect(goBack(page)).toHaveCount(0);
  await expect(bringBack(page)).toBeVisible();
  await expect(history(page).locator('li[data-undone]')).toHaveCount(2);

  // Ctrl+S settles it: the outline and the button go, the mark stays with its link.
  await page.keyboard.press(await key(page, 's'));
  await expect(bringBack(page)).toHaveCount(0);
  await expect(history(page).locator('li[data-undone]')).toHaveCount(0);
  await expect(marked).toContainText('Before restoring');
  await expect(goBack(page)).toHaveCount(1);

  // Go back to this point: a whole restore to after 1C. After the rows settle, as for Restore to here (writeGate.ts:
  // a click straight after a write is taken for one on a row that moved under the pointer).
  await page.waitForTimeout(700);
  await goBack(page).click();
  await expect(frames(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Restored the project to: Added frame 1C');
});

test('the button pulses, and is still under reduced motion', async ({ page }) => {
  await start(page, 'no-preference');
  await frames(page).first().click();
  await page.keyboard.press(await key(page, 'z'));
  await expect(bringBack(page)).toBeVisible();
  expect(await bringBack(page).evaluate((button) => getComputedStyle(button).animationName)).toBe('sb-pulse');
  expect(await bringBack(page).evaluate((button) => getComputedStyle(button).animationDuration)).toBe('2s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => bringBack(page).evaluate((button) => getComputedStyle(button).animationName)).toBe('none');
  expect(await bringBack(page).evaluate((button) => getComputedStyle(button).opacity)).toBe('1');
});

import { devices, expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { pressLikeWebKit } from './webkitClicks';

// What the Mac's first whole-suite WebKit run found (6.19), covered in Chromium. A Mac's WebKit gives a clicked button
// no focus and blurs what had it (e2e/webkitClicks.ts makes Chromium do the same): a board's context menu must not close
// on that blur before its command's click (src/ui/canvas/CanvasMenu.tsx), and a clicked button takes focus all the same
// (src/ui/clickFocus.ts), so focus can come back to it. And it never moves Tab to a colour input, so the Tab wrap must
// not count one as a stop there (src/ui/tabWrap.ts).

test.use({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await pressLikeWebKit(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '');

test('a board’s context menu stays open through a press that gives its command no focus, and the command runs', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Moodboard/ }).click();
  const tile = page.getByRole('region', { name: 'Moodboard', exact: true });
  await tile.locator('[data-department-board="camera"]').click();
  const canvas = page.getByRole('application', { name: 'Camera board' });
  await expect(canvas).toBeVisible();
  const count = async () => (JSON.parse((await canvas.getAttribute('data-items')) ?? '[]') as unknown[]).length;
  // A rectangle from the keyboard, selected.
  await canvas.focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect.poll(count).toBe(1);
  await page.keyboard.press('Shift+F10');
  const menu = canvas.getByRole('group', { name: 'Board actions' });
  await expect(menu.getByRole('button', { name: 'Copy' })).toBeFocused();
  const box = await menu.getByRole('button', { name: 'Duplicate' }).boundingBox();
  if (!box) throw new Error('no Duplicate');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Pressed, not yet let go: the menu is still there for the click to reach.
  await expect(menu).toBeVisible();
  await page.mouse.up();
  await expect.poll(count).toBe(2);
  await expect(menu).toBeHidden();
});

test('a clicked button takes focus though the press gives it none, so focus comes back to it when its window closes', async ({ page }) => {
  const gear = page.getByRole('button', { name: /^Settings \(/ });
  const box = await gear.boundingBox();
  if (!box) throw new Error('no Settings button');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // As WebKit has it: the press alone focuses nothing.
  await expect(gear).not.toBeFocused();
  await page.mouse.up();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(gear).toBeFocused();
});

test('the clicked button’s focus comes before its own handler, never from the keyboard, nor when the press kept focus', async ({ page }) => {
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:600px;top:300px;z-index:10000;display:flex;gap:8px;background:white';
    const plain = Object.assign(document.createElement('button'), { id: 'probe-plain', type: 'button', textContent: 'Plain' });
    const opens = Object.assign(document.createElement('button'), { id: 'probe-opens', type: 'button', textContent: 'Opens a field' });
    const keeps = Object.assign(document.createElement('button'), { id: 'probe-keeps', type: 'button', textContent: 'Keeps focus' });
    const field = Object.assign(document.createElement('input'), { id: 'probe-field', 'aria-label': 'Probe field' });
    opens.addEventListener('click', () => {
      field.focus();
    });
    // As a canvas's own handles do: the press keeps focus where it is.
    keeps.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    box.append(plain, opens, keeps, field);
    document.body.append(box);
  });
  await page.locator('#probe-plain').click();
  expect(await focused(page)).toBe('probe-plain');
  // A handler that moves focus on has the last word.
  await page.locator('#probe-opens').click();
  expect(await focused(page)).toBe('probe-field');
  // The press kept focus in the field: the click leaves it there.
  await page.locator('#probe-keeps').click();
  expect(await focused(page)).toBe('probe-field');
  // A click from script or the keyboard (detail 0) moves nothing.
  await page.locator('#probe-plain').evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
  expect(await focused(page)).toBe('probe-field');
});

test('the menu key opens a frame’s and a scene heading’s menu, once, where the browser sends no contextmenu for it', async ({ page }) => {
  // As a Mac's WebKit: Shift+F10 and the menu key send no contextmenu event (a right click still does).
  await page.evaluate(() => {
    window.addEventListener(
      'contextmenu',
      (event) => {
        if (event.button !== 2) event.stopImmediatePropagation();
      },
      true,
    );
  });
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
  const frame = board.locator('[data-shot-id]').first();
  await expect(frame).toBeFocused();
  const menu = page.locator('[data-add-to-board-menu]');
  await page.keyboard.press('Shift+F10');
  await expect(menu).toHaveCount(1);
  await expect(menu.getByRole('button', { name: 'Add to board…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(frame).toBeFocused();
  await page.keyboard.press('ContextMenu');
  await expect(menu).toHaveCount(1);
  await page.keyboard.press('Escape');
  const pencil = board.getByRole('button', { name: 'Edit name of SC 01' });
  await pencil.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toHaveCount(1);
  await expect(menu.getByRole('button', { name: 'Add to board…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pencil).toBeFocused();
});

test.describe('with Safari’s user agent', () => {
  test.use({ userAgent: devices['Desktop Safari'].userAgent });

  test('Tab from the last stop before Settings → Theme’s colour input goes round the window, not out of it', async ({ page }) => {
    await page.getByRole('button', { name: /^Settings \(/ }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Theme' }).click();
    // The hex field, then the colour input, the window's last stop in Chromium: WebKit skips that one.
    await settings.getByRole('textbox', { name: 'Hex' }).focus();
    await page.keyboard.press('Tab');
    await expect(settings.getByRole('button', { name: 'Close Settings' })).toBeFocused();
  });
});

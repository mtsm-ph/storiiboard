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

test('the keyboard’s own contextmenu after Shift+F10 neither moves the frame’s menu nor opens the browser’s over it', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
  const frame = board.locator('[data-shot-id]').first();
  await expect(frame).toBeFocused();
  const menu = page.locator('[data-add-to-board-menu]');
  const addToBoard = menu.getByRole('button', { name: 'Add to board…' });
  await page.keyboard.press('Shift+F10');
  await expect(addToBoard).toBeFocused();
  const place = () =>
    menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top };
    });
  const before = await place();
  // A browser that also sends the keys' contextmenu (no right button) on the frame: the keydown opened the menu
  // already, so this one opens nothing again and moves nothing (src/ui/menuKey.ts, fromKeyboard).
  await frame.evaluate((el) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 700 }));
  });
  await expect(menu).toHaveCount(1);
  expect(await place()).toEqual(before);
  await expect(addToBoard).toBeFocused();
  // Windows' Chromium sends the menu key's contextmenu on key up, to the command its keydown focused: the panel keeps
  // the browser's own menu (Back, Refresh, Inspect in WebView2) from opening over the app's.
  const prevented = await addToBoard.evaluate((el) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(addToBoard).toBeFocused();
});

test('a menu’s focused command keeps the browser’s own menu out too', async ({ page }) => {
  await page.getByRole('button', { name: /^Layout/ }).click();
  const prevented = await page.evaluate(() => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 });
    document.activeElement?.dispatchEvent(event);
    return document.activeElement?.tagName === 'BUTTON' && event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test('a sticky’s colour is chosen by a swatch whose press sends focus to the workspace, not the swatch (6.19b)', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Moodboard/ }).click();
  const tile = page.getByRole('region', { name: 'Moodboard', exact: true });
  await tile.locator('[data-department-board="camera"]').click();
  const canvas = page.getByRole('application', { name: 'Camera board' });
  await expect(canvas).toBeVisible();
  const colour = async () => (JSON.parse((await tile.locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as { color: string | null }[])[0]?.color;
  await tile.getByRole('button', { name: 'Sticky', exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2 - 300, box.y + box.height / 2 - 200);
  await page.keyboard.type('Rain cover?');
  await page.keyboard.press('Escape');
  await expect.poll(colour).toBe('#FFE97A');
  const properties = tile.getByRole('group', { name: 'Properties of the selection' });
  const trigger = properties.getByRole('button', { name: /^Sticky colour:/ });
  await trigger.click();
  // The clicked button took focus (src/ui/clickFocus.ts): the press on a swatch moves it to the workspace panel, as
  // WebKit's does, and the panel stays open for the swatch's click (src/features/moodboards/ColourControl.tsx).
  await expect(trigger).toBeFocused();
  await properties.getByRole('group', { name: 'Sticky colour' }).getByRole('button', { name: 'Peach', exact: true }).click();
  await expect.poll(colour).toBe('#FFC9A8');
  await expect(properties.getByRole('group', { name: 'Sticky colour' })).toBeHidden();
  await expect(trigger).toBeFocused();
});

/** A camera board with one sticky note selected, its Sticky colour trigger and the panel the trigger opens. */
async function stickyColourPanel(page: Page) {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Moodboard/ }).click();
  const tile = page.getByRole('region', { name: 'Moodboard', exact: true });
  await tile.locator('[data-department-board="camera"]').click();
  const canvas = page.getByRole('application', { name: 'Camera board' });
  await expect(canvas).toBeVisible();
  await tile.getByRole('button', { name: 'Sticky', exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2 - 300, box.y + box.height / 2 - 200);
  await page.keyboard.type('Rain cover?');
  await page.keyboard.press('Escape');
  const properties = tile.getByRole('group', { name: 'Properties of the selection' });
  const trigger = properties.getByRole('button', { name: /^Sticky colour:/ });
  await trigger.click();
  const panel = properties.getByRole('group', { name: 'Sticky colour' });
  await expect(panel).toBeVisible();
  await expect(trigger).toBeFocused();
  return { trigger, panel };
}

test('a press on the colour panel’s padding leaves it open with focus back in it, so Escape closes it (6.19b review)', async ({ page }) => {
  const { trigger, panel } = await stickyColourPanel(page);
  const box = await panel.boundingBox();
  if (!box) throw new Error('no panel');
  // The panel's own padding, no swatch: Chromium itself sends focus to the nearest focusable ancestor (the workspace).
  await page.mouse.click(box.x + 3, box.y + 3);
  await expect(panel).toBeVisible();
  // The press's end gave focus back to the control that had it, where the panel's keys are heard.
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Tab from the colour panel’s last swatch to outside it closes the panel (6.19b review)', async ({ page }) => {
  const { panel } = await stickyColourPanel(page);
  await panel.getByRole('button').last().focus();
  await page.keyboard.press('Tab');
  await expect(panel).toBeHidden();
});

test('focus moved to what holds the colour panel other than by a press in it closes the panel (6.19b review)', async ({ page }) => {
  const { panel } = await stickyColourPanel(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#workspace-panel')?.focus();
  });
  await expect(panel).toBeHidden();
});

test('a frame’s menu opened from the keyboard takes a click on its command though the press moves focus out (6.19b)', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board.locator('[data-shot-id]').first()).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[data-add-to-board-menu]');
  const addToBoard = menu.getByRole('button', { name: 'Add to board…' });
  await expect(addToBoard).toBeFocused();
  // Focus on the menu's command: the press sends it to the nearest focusable ancestor, outside the menu
  // (src/features/storyboard/AddToBoardMenu.tsx keeps the menu open for the click).
  await addToBoard.click();
  await expect(menu).toHaveCount(1);
  await expect(menu.getByRole('button', { name: 'Add to board…' })).toHaveCount(0);
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

test('trackpad mode off: the wheel zooms at the pointer, and a pinch zooms from its gesture events, its wheel left alone (6.5.3)', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Moodboard/ }).click();
  const tile = page.getByRole('region', { name: 'Moodboard', exact: true });
  await tile.locator('[data-department-board="camera"]').click();
  const canvas = page.getByRole('application', { name: 'Camera board' });
  await expect(canvas).toBeVisible();
  const toggle = tile.getByRole('switch', { name: 'Trackpad mode' });
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const view = async () => ({ cx: Number(await canvas.getAttribute('data-cx')), cy: Number(await canvas.getAttribute('data-cy')), zoom: Number(await canvas.getAttribute('data-zoom')) });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const at = { x: middle.x + 140, y: middle.y - 70 };
  // The world point under the pointer, and where it is on the page now.
  const worldAt = async () => {
    const v = await view();
    return { x: v.cx + (at.x - middle.x) / v.zoom, y: v.cy + (at.y - middle.y) / v.zoom };
  };
  const pageAt = async (world: { x: number; y: number }) => {
    const v = await view();
    return { x: middle.x + (world.x - v.cx) * v.zoom, y: middle.y + (world.y - v.cy) * v.zoom };
  };

  // A plain wheel zooms, the point under the pointer held within 1 px.
  let before = await view();
  let under = await worldAt();
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await view()).zoom).toBeGreaterThan(before.zoom * 1.1);
  let now = await pageAt(under);
  expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);

  // A pinch as WebKit sends it: gesture events, and a Ctrl-flagged wheel with them that must not zoom twice.
  before = await view();
  under = await worldAt();
  const fire = (type: string, scale: number) =>
    canvas.evaluate(
      (el, [kind, value, x, y]) => {
        const event = new Event(kind, { bubbles: true, cancelable: true });
        Object.assign(event, { scale: value, clientX: x, clientY: y });
        el.dispatchEvent(event);
      },
      [type, scale, at.x, at.y] as const,
    );
  await fire('gesturestart', 1);
  await fire('gesturechange', 1.1);
  await expect.poll(async () => (await view()).zoom).toBeCloseTo(before.zoom * 1.1, 3);
  await canvas.evaluate(
    (el, [x, y]) => {
      el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -4.5, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    [at.x, at.y] as const,
  );
  await page.waitForTimeout(100);
  expect((await view()).zoom).toBeCloseTo(before.zoom * 1.1, 3);
  await fire('gestureend', 1.1);
  now = await pageAt(under);
  expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);
});

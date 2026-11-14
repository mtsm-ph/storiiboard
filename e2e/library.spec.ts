import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The library (6.3) in the memory build: a sofa dragged from the Library onto a scene's room reads 2.00 m by 0.90 m in
// the Selection tile; a C-stand placed from the keyboard goes into the setup and the arrows nudge it; the scene's other
// setup shows the sofa, not the C-stand; a table resized and turned by typing; a light, not placeable yet, says why;
// undo, redo and a reload; the plan stays paper in dark; and axe on the Library tile. The canvas is pixels, so the tests
// read the plan from the data its tile keeps (data-plan-data, in metres).

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
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Icon {
  id: string;
  kind: string;
  icon: string;
  level: string;
  layer: string;
  width: number;
  height: number;
  rotation: number;
  centre: { x: number; y: number };
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const libraryIcon = (page: Page, id: string) => libraryTile(page).locator(`[data-library-icon="${id}"]`);
const icons = async (page: Page): Promise<Icon[]> =>
  (JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Icon[]).filter((item) => item.kind === 'icon');
const iconNames = async (page: Page) => (await icons(page)).map((i) => i.icon);
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const field = (page: Page, name: string): Locator => selectionTile(page).getByRole('textbox', { name, exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** An icon dragged from the Library to a world point on the plan, by the pointer. */
async function dragIcon(page: Page, id: string, to: { x: number; y: number }) {
  const button = libraryIcon(page, id);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error(`no ${id} in the Library`);
  const target = await screen(page, to.x, to.y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x - 40, target.y - 40, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  // The ghost is over the plan, at the icon's real size.
  await expect(page.locator(`[data-library-ghost="${id}"]`)).toHaveAttribute('data-library-ghost-over', 'plan');
  await page.mouse.up();
}

async function setUnits(page: Page, label: 'Metres' | 'Feet and inches') {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label });
  await closeSettings(page);
}

/** The Setup workspace on SC 01's Setup 1, its room started. */
async function startRoom(page: Page) {
  await setUnits(page, 'Metres');
  await toSection(page, 'Setup');
  await expect(libraryTile(page).locator('[data-library-says]')).toHaveText('Pick a setup, or a scene’s heading, in the Setups tile to place items on its plan.');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await expect(libraryTile(page).locator('[data-library-says]')).toContainText('SC 01 has no room yet.');
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(libraryTile(page).locator('[data-library-tile]')).toHaveAttribute('data-library-state', 'ready');
}

test('drags a sofa into the room, places a C-stand from the keyboard into the setup, and the other setup shows only the sofa', async ({ page }) => {
  await startRoom(page);
  await dragIcon(page, 'set-art/sofa', { x: 0, y: 0 });
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  const [sofa] = await icons(page);
  expect(sofa).toMatchObject({ level: 'room', layer: 'set-art', width: 2, height: 0.9 });
  // Under the pointer, give or take the grid's pull.
  expect(Math.abs(sofa?.centre.x ?? 9)).toBeLessThanOrEqual(0.06);
  expect(Math.abs(sofa?.centre.y ?? 9)).toBeLessThanOrEqual(0.06);
  await expect.poll(() => selection(page)).toEqual([sofa?.id]);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Sofa');
  await expect(field(page, 'Width')).toHaveValue('2.00 m');
  await expect(field(page, 'Depth')).toHaveValue('0.90 m');
  // A set piece can be made this setup's only.
  await expect(selectionTile(page).locator('[data-setup-only]')).toHaveAttribute('data-setup-only', 'off');

  // A C-stand from the keyboard: Tab from the filter reaches each group once, the arrows move within it, and Enter
  // puts it in the middle of the view, selected, and the plan takes the focus (6.3 review).
  await libraryTile(page).getByRole('searchbox', { name: 'Filter' }).focus();
  await page.keyboard.press('Tab');
  await expect(libraryIcon(page, 'camera/camera')).toBeFocused();
  await page.keyboard.press('End');
  await expect(libraryIcon(page, 'camera/sticks')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(libraryIcon(page, 'camera/camera')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(libraryIcon(page, 'camera/dolly-track')).toBeFocused();
  // Lighting, then grip, each one stop.
  await page.keyboard.press('Tab');
  await expect(libraryIcon(page, 'lighting/beam-cone')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(libraryIcon(page, 'grip/apple-box')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(libraryIcon(page, 'grip/c-stand')).toBeFocused();
  // A row down, to the icon under it as the grid lays them out, and back.
  const below = await libraryTile(page)
    .locator('[data-library-group="grip"]')
    .evaluate((group) => {
      const buttons = [...group.querySelectorAll<HTMLElement>('[data-library-icon]')];
      const top = buttons[0]?.offsetTop ?? 0;
      const columns = buttons.filter((b) => b.offsetTop === top).length;
      const at = buttons.findIndex((b) => b.dataset.libraryIcon === 'grip/c-stand');
      return buttons[at + columns]?.dataset.libraryIcon ?? '';
    });
  expect(below).not.toBe('');
  await page.keyboard.press('ArrowDown');
  await expect(libraryIcon(page, below)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(libraryIcon(page, 'grip/c-stand')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa', 'grip/c-stand']);
  const stand = (await icons(page)).find((i) => i.icon === 'grip/c-stand');
  expect(stand).toMatchObject({ level: 'setup', layer: 'grip', width: 0.9, height: 0.9 });
  await expect.poll(() => selection(page)).toEqual([stand?.id]);
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await icons(page)).find((i) => i.icon === 'grip/c-stand')?.centre.x).toBeCloseTo((stand?.centre.x ?? 0) + 0.01, 4);
  // A setup's own icon has no "This setup only" switch: it is only the setup's already.
  await expect(selectionTile(page).locator('[data-setup-only]')).toHaveCount(0);

  // The scene's other setup shows the sofa (the room's), not the C-stand (Setup 1's).
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 2');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  // And the scene with no setup shows the room's sofa too.
  await setupsTile(page).locator('[data-setups-scene-pick]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
});

test('resizes and turns a table by typing, refuses a light with words, and keeps it all through undo, redo and a reload', async ({ page }) => {
  await startRoom(page);
  await libraryIcon(page, 'set-art/table').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/table']);
  await expect(field(page, 'Width')).toHaveValue('1.50 m');
  await expect(field(page, 'Depth')).toHaveValue('0.80 m');
  const placed = (await icons(page))[0];

  await field(page, 'Width').fill('2.4');
  await field(page, 'Width').press('Enter');
  await expect.poll(async () => (await icons(page))[0]?.width).toBe(2.4);
  await expect(field(page, 'Width')).toHaveValue('2.40 m');
  // Resized about its middle.
  expect((await icons(page))[0]?.centre).toEqual(placed?.centre);
  await field(page, 'Rotation').fill('90');
  await field(page, 'Rotation').press('Enter');
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(90);

  // A light comes later in this phase (cameras are placed from 6.4): greyed out, and it says so when dragged (with no
  // ghost) or pressed.
  const camera = libraryIcon(page, 'lighting/fresnel');
  await expect(camera).toHaveAttribute('aria-disabled', 'true');
  await expect(libraryTile(page).locator('[data-library-group="lighting"]')).toContainText('Coming in this phase');
  const comingNotice = page.getByText('Fresnel: coming in this phase.', { exact: true });
  await expect(comingNotice).toHaveCount(0);
  // The Library scrolled down to the table when it was placed.
  await camera.scrollIntoViewIfNeeded();
  const box = await camera.boundingBox();
  const target = await screen(page, 200, 200);
  if (!box) throw new Error('no light in the Library');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.locator('[data-library-ghost]')).toHaveCount(0);
  await page.mouse.up();
  await expect(comingNotice).toBeVisible();
  expect(await iconNames(page)).toEqual(['set-art/table']);
  await camera.focus();
  await page.keyboard.press('Enter');
  await expect(comingNotice).toBeVisible();
  expect(await iconNames(page)).toEqual(['set-art/table']);

  // Undo the turn, then redo it.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(0);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(90);

  // After a reload, it is all there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await icons(page)).map((i) => [i.icon, i.width, i.height, i.rotation])).toEqual([['set-art/table', 2.4, 0.8, 90]]);
});

test('says what a scene with no setup takes, filters by name, stays paper in dark, and passes axe on the Library', async ({ page }) => {
  await startRoom(page);
  // The scene's heading: set pieces go in its room; a C-stand needs a setup, and says so.
  await setupsTile(page).locator('[data-setups-scene-pick]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01');
  await expect(libraryTile(page).locator('[data-library-says]')).toHaveText('No setup is shown: set pieces go in the scene’s room, the rest need a setup picked in the Setups tile.');
  await libraryIcon(page, 'grip/c-stand').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('C-stand goes in a setup: pick one in the Setups tile.', { exact: true })).toBeVisible();
  await libraryIcon(page, 'set-art/chair').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/chair']);

  // The filter narrows by name.
  await libraryTile(page).getByRole('searchbox', { name: 'Filter' }).fill('sofa');
  await expect(libraryTile(page).locator('[data-library-icon]')).toHaveCount(1);
  await libraryTile(page).getByRole('searchbox', { name: 'Filter' }).fill('');
  await expect(libraryTile(page).locator('[data-library-icon]')).toHaveCount(68);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  const axe = async () => {
    expect((await new AxeBuilder({ page }).include('[data-library-tile]').withTags(tags).analyze()).violations).toEqual([]);
  };
  await axe();

  // Dark: the app around it follows the theme, the plan stays paper.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect(await canvas(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(238, 233, 223)');
  await axe();
});

// 6.3 review: a drag cancelled places nothing, its click included; "This setup only" for a set piece; several icons
// selected; the Library in Spanish; the tool entries' names.

const historyTile = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => historyTile(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');

/** The sofa pressed and dragged over the plan, its ghost there, the button still held. */
async function holdSofaOverPlan(page: Page) {
  const button = libraryIcon(page, 'set-art/sofa');
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error('no sofa in the Library');
  const target = await screen(page, 0, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.locator('[data-library-ghost="set-art/sofa"]')).toHaveAttribute('data-library-ghost-over', 'plan');
  return { box, target };
}

test('a drag cancelled by Escape or by the system places nothing, not even with the click that follows', async ({ page }) => {
  await startRoom(page);
  // Escape mid-drag: the ghost goes, and letting go over the plan places nothing.
  await holdSofaOverPlan(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-library-ghost]')).toHaveCount(0);
  await page.mouse.up();
  // Let go back over the button it began on: still nothing.
  const { box } = await holdSofaOverPlan(page);
  await page.keyboard.press('Escape');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  // The system cancels the pointer (a palm, a dialog): nothing either.
  await holdSofaOverPlan(page);
  await libraryIcon(page, 'set-art/sofa').evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true }));
  });
  await expect(page.locator('[data-library-ghost]')).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await iconNames(page)).toEqual([]);
  // No step was written: the newest in History is still the room's.
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(steps(page).first()).toContainText('Started room');
  await page.keyboard.press('Escape');
  // And the button still places from the keyboard afterwards.
  await libraryIcon(page, 'set-art/sofa').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
});

test('makes a set piece this setup’s only and back, and edits several icons at once', async ({ page }) => {
  await startRoom(page);
  await libraryIcon(page, 'set-art/sofa').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  const setupOnly = selectionTile(page).getByRole('switch', { name: 'This setup only' });
  await setupOnly.click();
  await expect(selectionTile(page).locator('[data-setup-only]')).toHaveAttribute('data-setup-only', 'on');
  await expect.poll(async () => (await icons(page))[0]?.level).toBe('setup');
  // The scene's other setup doesn't show it; Setup 1 still does.
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 2');
  await expect.poll(() => iconNames(page)).toEqual([]);
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  // Off again: back in the room, so Setup 2 shows it.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await selectionTile(page).getByRole('switch', { name: 'This setup only' }).click();
  await expect.poll(async () => (await icons(page))[0]?.level).toBe('room');

  // Two icons selected: the fields they share, a typed width goes to both, one step that one undo takes back.
  await libraryIcon(page, 'set-art/table').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa', 'set-art/table']);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('2 items');
  await expect(field(page, 'Width')).toHaveValue('');
  await expect(field(page, 'Rotation')).toHaveValue('0°');
  await field(page, 'Width').fill('3');
  await field(page, 'Width').press('Enter');
  await expect.poll(async () => (await icons(page)).map((i) => i.width)).toEqual([3, 3]);
  await expect(field(page, 'Width')).toHaveValue('3.00 m');
  // Under a centimetre: refused, nothing saved.
  await field(page, 'Depth').fill('0.005');
  await field(page, 'Depth').press('Enter');
  expect((await icons(page)).map((i) => i.height)).toEqual([0.9, 0.8]);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await icons(page)).map((i) => i.width)).toEqual([2, 1.5]);
});

test('the Library in Spanish: its labels, its filter finds “sofá”, and the tools say what they pick', async ({ page }) => {
  await startRoom(page);
  await expect(libraryIcon(page, 'set-art/wall')).toHaveAccessibleName('Wall: selects the Wall tool');
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'App language' }).selectOption('es');
  await page.keyboard.press('Escape');
  const biblioteca = page.getByRole('region', { name: 'Íconos', exact: true });
  await expect(biblioteca.locator('[data-library-says]')).toHaveText('Arrastra un ícono a la planta, o pulsa Intro sobre él para colocarlo en el centro de la vista.');
  await expect(biblioteca.locator('[data-library-group="set-art"] h3')).toHaveText('Escenografía y arte');
  await expect(biblioteca.locator('[data-library-icon="set-art/chair"]')).toContainText('Silla');
  await expect(biblioteca.locator('[data-library-icon="set-art/wall"]')).toHaveAccessibleName('Muro: elige la herramienta Muro');
  await biblioteca.getByRole('searchbox', { name: 'Filtrar' }).fill('sofá');
  await expect(biblioteca.locator('[data-library-icon]')).toHaveCount(1);
  await expect(biblioteca.locator('[data-library-icon="set-art/sofa"]')).toContainText('Sofá');
  // Without the accent, and by the kit's English name, too.
  await biblioteca.getByRole('searchbox', { name: 'Filtrar' }).fill('sofa');
  await expect(biblioteca.locator('[data-library-icon]')).toHaveCount(1);
});

// 6.3 third review: Enter and Space during a press place nothing and leave the ghost following; a drag whose button is
// found up, or a context menu, ends it; a tap places one icon in the middle of the view and a touch never drags.

const ghost = (page: Page) => page.locator('[data-library-ghost]');

test('Enter and Space during a drag place nothing and the ghost keeps following; Enter before a move is a plain click, one icon', async ({ page }) => {
  await startRoom(page);
  const { box, target } = await holdSofaOverPlan(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await page.waitForTimeout(150);
  expect(await iconNames(page)).toEqual([]);
  // Not frozen: it follows the pointer on.
  const before = await ghost(page).boundingBox();
  await page.mouse.move(target.x + 60, target.y + 40, { steps: 4 });
  await expect.poll(async () => (await ghost(page).boundingBox())?.x).not.toBe(before?.x);
  // Let go back over the Library: nothing placed, the ghost gone.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(ghost(page)).toHaveCount(0);
  await page.waitForTimeout(150);
  expect(await iconNames(page)).toEqual([]);

  // Pressed, Enter before any move, let go: the press is a plain click, so exactly one sofa, never two.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  expect(await iconNames(page)).toEqual([]);
  await page.mouse.up();
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  await page.waitForTimeout(200);
  expect(await iconNames(page)).toEqual(['set-art/sofa']);
});

test('a drag ends when its button is found up or a context menu opens, and places nothing', async ({ page }) => {
  await startRoom(page);
  // A move with no button down (the release was lost): over.
  const { target } = await holdSofaOverPlan(page);
  await libraryIcon(page, 'set-art/sofa').evaluate((el, at) => {
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: at.x + 10, clientY: at.y + 10, bubbles: true }));
  }, target);
  await expect(ghost(page)).toHaveCount(0);
  await page.mouse.up();
  // A context menu during a drag: over too.
  await holdSofaOverPlan(page);
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await expect(ghost(page)).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await iconNames(page)).toEqual([]);
});

test.describe('by touch', () => {
  test.use({ hasTouch: true });

  test('a tap places one icon in the middle of the view; a touch drag never starts', async ({ page }) => {
    await startRoom(page);
    const sofa = libraryIcon(page, 'set-art/sofa');
    await sofa.scrollIntoViewIfNeeded();
    // A finger pressed and moved over the plan: no ghost, nothing placed.
    const target = await screen(page, 0, 0);
    await sofa.evaluate((el, at) => {
      const box = el.getBoundingClientRect();
      const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...init, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
      el.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: at.x, clientY: at.y }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: at.x, clientY: at.y }));
    }, target);
    await expect(ghost(page)).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(await iconNames(page)).toEqual([]);
    // A tap: one sofa, in the middle of the view (give or take the grid's pull), selected.
    await sofa.tap();
    await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
    const [placed] = await icons(page);
    const middle = { x: Number(await canvas(page).getAttribute('data-cx')) / 100, y: Number(await canvas(page).getAttribute('data-cy')) / 100 };
    expect(Math.abs((placed?.centre.x ?? 99) - middle.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((placed?.centre.y ?? 99) - middle.y)).toBeLessThanOrEqual(0.5);
    await expect.poll(() => selection(page)).toEqual([placed?.id]);
    await page.waitForTimeout(200);
    expect(await iconNames(page)).toEqual(['set-art/sofa']);
  });
});

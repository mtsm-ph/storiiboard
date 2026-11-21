import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The plan's layers (6.8) in the memory build: a plan with a wall, a sofa, a camera, a light and a mark. Lighting
// hidden (the light leaves the plan's data, the header says so), art locked (a click on the wall picks nothing, Select
// all leaves it and the sofa out), cast dimmed, camera soloed and back by the tile and by the keys, "This is me" a
// gaffer and My department; the state through a reload; no History step for any of it; axe on the Layers tile. The
// canvas is pixels, so the tests read the plan from the data its tile keeps.

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
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  layer: string | null;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  dim?: boolean;
  locked?: boolean;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const layersTile = (page: Page) => page.getByRole('region', { name: 'Layers', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const row = (page: Page, layer: string) => layersTile(page).locator(`[data-layer="${layer}"]`);
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const kinds = async (page: Page) => (await items(page)).map((i) => i.kind).sort();
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const shows = async (page: Page): Promise<Record<string, string | null>> =>
  Object.fromEntries(await layersTile(page).locator('[data-layer]').evaluateAll((rows) => rows.map((r) => [r.getAttribute('data-layer') ?? '', r.getAttribute('data-layer-show')] as const)));

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

async function clickAt(page: Page, x: number, y: number) {
  const at = await screen(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** SC 01's Setup 1 in metres with its room: a wall drawn above the middle, then a sofa, a camera, a light and a mark. */
async function buildPlan(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('w');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:wall');
  await clickAt(page, -200, -200);
  await clickAt(page, 200, -200);
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['wall']);
  const sofa = libraryTile(page).locator('[data-library-icon="set-art/sofa"]');
  await sofa.scrollIntoViewIfNeeded();
  await sofa.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['icon', 'wall']);
  for (const key of ['c', 'l', 'm']) {
    await canvas(page).focus();
    await page.keyboard.press(key);
    await page.keyboard.press('Enter');
  }
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'light', 'mark', 'wall']);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
}

const byKind = async (page: Page, kind: string): Promise<Item> => {
  const found = (await items(page)).find((i) => i.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found;
};

/** How many steps History lists. */
async function historySteps(page: Page): Promise<number> {
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'History', exact: true });
  await expect(history).toBeVisible();
  await expect(history.locator('[aria-busy="true"]')).toHaveCount(0);
  return history.getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem').count();
}

test('hides, locks, dims and solos layers, starts a gaffer on lighting and grip, keeps the state, and writes no History', async ({ page }) => {
  await buildPlan(page);
  await expect(row(page, 'set-art').locator('[data-layer-count]')).toHaveAttribute('data-layer-count', '2');
  await expect(row(page, 'sound')).toHaveAttribute('data-layer-empty', 'true');
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  const before = await historySteps(page);
  await toSection(page, 'Setup');
  await expect(layersTile(page)).toBeVisible();

  // Lighting hidden: the light leaves the plan, and the header says so.
  await row(page, 'lighting').getByRole('radio', { name: 'Lighting: hidden', exact: true }).click();
  await expect(row(page, 'lighting').getByRole('radio', { name: 'Lighting: hidden', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'mark', 'wall']);
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden');

  // Art locked: the wall is drawn but a click on it picks nothing, and Select all leaves it and the sofa out.
  await layersTile(page).getByRole('button', { name: 'Lock the Set and art layer' }).click();
  await expect(layersTile(page).getByRole('button', { name: 'Lock the Set and art layer' })).toHaveAttribute('aria-pressed', 'true');
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden · 1 layer locked');
  const wall = await byKind(page, 'wall');
  expect(wall).toMatchObject({ layer: 'set-art', locked: true });
  await clickAt(page, 0, -200);
  await expect.poll(() => selection(page)).toEqual([]);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  const camera = await byKind(page, 'camera');
  const mark = await byKind(page, 'mark');
  await expect.poll(async () => (await selection(page)).sort()).toEqual([camera.id, mark.id].sort());
  // Delete after Select all changes nothing on the hidden or locked layers.
  await page.keyboard.press('Delete');
  await expect.poll(() => kinds(page)).toEqual(['icon', 'wall']);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'mark', 'wall']);

  // Cast dimmed: the mark is drawn dimmed and still picked.
  await row(page, 'cast').getByRole('radio', { name: 'Cast: dimmed', exact: true }).click();
  await expect.poll(async () => (await byKind(page, 'mark')).dim).toBe(true);

  // Solo camera, and back to what was before.
  await row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ }).click();
  await expect(row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'dimmed', grip: 'dimmed', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' });
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'light', 'mark', 'wall']);
  // During the solo the other layers are locked too, their locks on and held, saying why (6.8 review, M3).
  const heldLock = row(page, 'lighting').locator('[data-layer-lock]');
  await expect(heldLock).toHaveAttribute('aria-pressed', 'true');
  await expect(heldLock).toHaveAttribute('aria-disabled', 'true');
  await expect(heldLock).toHaveAttribute('title', 'Locked while Camera is solo');
  await heldLock.click({ force: true });
  await expect(heldLock).toHaveAttribute('aria-pressed', 'true');
  // Select all then Delete during the solo touches only the camera.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  await expect.poll(() => selection(page)).toEqual([camera.id]);
  await page.keyboard.press('Delete');
  await expect.poll(() => kinds(page)).toEqual(['icon', 'light', 'mark', 'wall']);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'light', 'mark', 'wall']);
  await row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ }).click();
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'hidden', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'dimmed' });
  await expect(row(page, 'set-art')).toHaveAttribute('data-layer-locked', 'true');

  // The keys on the plan: 2 solos lighting, 2 again puts it back, 0 shows all.
  await canvas(page).focus();
  await page.keyboard.press('2');
  await expect.poll(async () => (await shows(page)).lighting).toBe('shown');
  await expect.poll(async () => (await shows(page)).camera).toBe('dimmed');
  await page.keyboard.press('2');
  await expect.poll(async () => (await shows(page)).lighting).toBe('hidden');
  await page.keyboard.press('0');
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'shown', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' });
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  await expect(row(page, 'set-art')).not.toHaveAttribute('data-layer-locked', 'true');
  // None of it is a step in History: only the two Deletes and their undos are.
  expect(await historySteps(page)).toBe(before + 4);

  // "This is me" a gaffer, then My department: lighting and grip shown, the rest dimmed.
  await toSection(page, 'Production');
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Sam Ortiz');
  await page.keyboard.press('Enter');
  const editor = people.locator('[data-person-editor]');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Gaffer' });
  await editor.getByRole('button', { name: 'This is me' }).click();
  const withSam = await historySteps(page);
  await toSection(page, 'Setup');
  await layersTile(page).getByRole('button', { name: 'My department' }).click();
  const gaffer = { camera: 'dimmed', lighting: 'shown', grip: 'shown', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' };
  await expect.poll(() => shows(page)).toEqual(gaffer);
  await expect.poll(async () => (await byKind(page, 'light')).dim).toBeUndefined();
  await expect.poll(async () => (await byKind(page, 'camera')).dim).toBe(true);

  // A reload keeps the state: it is this computer's.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => shows(page)).toEqual(gaffer);

  // My department and the reload wrote no step either.
  expect(await historySteps(page)).toBe(withSam);
});

test('the Layers tile is reached and read by the keyboard, and passes axe', async ({ page }) => {
  await buildPlan(page);
  const show = row(page, 'camera').getByRole('radiogroup', { name: 'Camera layer' });
  await expect(show.getByRole('radio', { name: 'Camera: shown', exact: true })).toHaveAttribute('aria-checked', 'true');
  // Tab reaches the camera row's choice; the arrows pick, without the pointer.
  await layersTile(page).getByRole('button', { name: 'My department' }).focus();
  await page.keyboard.press('Tab');
  await expect(show.getByRole('radio', { name: 'Camera: shown', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(show.getByRole('radio', { name: 'Camera: dimmed', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(show.getByRole('radio', { name: 'Camera: dimmed', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const lock = layersTile(page).getByRole('button', { name: 'Lock the Camera layer' });
  await expect(lock).toBeFocused();
  await page.keyboard.press('Space');
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ })).toBeFocused();
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer locked');
  // The header's Show all puts everything back.
  await planTile(page).getByRole('button', { name: 'Show all' }).click();
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  await expect(show.getByRole('radio', { name: 'Camera: shown', exact: true })).toHaveAttribute('aria-checked', 'true');

  await row(page, 'lighting').getByRole('radio', { name: 'Lighting: hidden', exact: true }).click();
  await layersTile(page).getByRole('button', { name: 'Lock the Set and art layer' }).click();
  const results = await new AxeBuilder({ page }).include('[data-layers-tile]').analyze();
  expect(results.violations).toEqual([]);
  // WCAG 2.2's target size (M-b): axe skips a radio group's unfocusable cells, so each is made focusable first and
  // judged on its own; every cell, lock and Solo is 24 px square or more.
  await layersTile(page).locator('[role="radio"]').evaluateAll((cells) => {
    for (const cell of cells) cell.setAttribute('tabindex', '0');
  });
  const targets = await new AxeBuilder({ page }).include('[data-layers-tile]').withRules(['target-size']).analyze();
  expect(targets.violations).toEqual([]);
  const sizes = await layersTile(page)
    .locator('[role="radio"], [data-layer-lock], [data-layer-solo], [data-layer-set-scale]')
    .evaluateAll((list) => list.map((b) => b.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
  expect(sizes.length).toBeGreaterThan(20);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(24);
  const plan = await new AxeBuilder({ page }).include('[data-plan-heading]').analyze();
  expect(plan.violations).toEqual([]);
});

/**
 * Each row's layout (the Underlay's too): whether it is one line (every control within the row's 24 px), and whether
 * its name shows whole (never cut off, never under its controls), first in the row (L7: a row reads top to bottom),
 * with the controls at the row's right, inside the row and the tile.
 */
async function rowLayout(page: Page) {
  return layersTile(page)
    .locator('[data-layer], [data-underlay-layer]')
    .evaluateAll((list) =>
      list.map((r) => {
        const box = r.getBoundingClientRect();
        const name = r.querySelector<HTMLElement>('[data-layer-name]');
        if (!name) throw new Error('no name');
        const nameBox = name.getBoundingClientRect();
        const controls = [...r.querySelectorAll('[data-layer-count], [role="radiogroup"], button:not([role="radio"])')].map((c) => c.getBoundingClientRect());
        const tile = r.closest('[data-layers-tile]')?.getBoundingClientRect();
        const overlaps = (k: DOMRect) => k.left < nameBox.right - 1 && k.right > nameBox.left + 1 && k.top < nameBox.bottom - 1 && k.bottom > nameBox.top + 1;
        return {
          layer: r.getAttribute('data-layer') ?? 'underlay',
          height: box.height,
          // The underlay's row adds its rule and the room above it.
          oneLine: box.height - parseFloat(getComputedStyle(r).paddingTop) - parseFloat(getComputedStyle(r).borderTopWidth) <= 26 && controls.every((k) => k.top >= box.top - 2 && k.bottom <= box.bottom + 2),
          whole: name.scrollWidth <= name.clientWidth + 1 && !controls.some(overlaps),
          // The name on the row's first line (no control above it), the controls at its right, beside it or below.
          nameFirst: controls.every((k) => k.bottom >= nameBox.bottom - 1 && k.right <= box.right + 1),
          inTile: tile !== undefined && box.right <= tile.right + 1 && nameBox.right <= tile.right + 1,
          // The controls on a line of their own under the name, and the name on one line.
          controlsBelow: controls.every((k) => k.top >= nameBox.bottom - 2) && nameBox.height <= 20,
        };
      }),
    );
}

// 6.8 second review: a row is one line wherever its name fits beside its controls; where it doesn't, in any language,
// the name keeps the first line, whole, and the controls go onto the line below at the right (L7), never cut short.
test('each layer is one line where its name fits and wraps where it doesn’t, never cut off; every row shows without scrolling', async ({ page }) => {
  await buildPlan(page);
  const rows = layersTile(page).locator('[data-layer], [data-underlay-layer]');
  await expect(rows).toHaveCount(8);
  // In the default layout at 900 px, in English: each row whole, its name first; a name with no room beside the 24 px
  // controls takes the first line and the controls the next (M-b, L7), and the list ends inside the tile (no scrolling
  // to reach a row).
  for (const r of await rowLayout(page)) {
    expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
    expect(r.oneLine || r.controlsBelow, r.layer).toBe(true);
  }
  expect((await rowLayout(page)).find((r) => r.layer === 'grip')).toMatchObject({ oneLine: true });
  const fits = async () => {
    const tile = await layersTile(page).boundingBox();
    const last = await rows.last().boundingBox();
    return tile !== null && last !== null && last.y + last.height <= tile.y + tile.height;
  };
  expect(await fits()).toBe(true);
  // At 200 px every row is whole, and Show all and My department share one row above the list.
  const squeeze = (px: number) =>
    layersTile(page).evaluate((el, width) => {
      el.style.width = `${String(width)}px`;
      el.style.flex = 'none';
    }, px);
  await squeeze(200);
  for (const r of await rowLayout(page)) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
  const all = await layersTile(page).locator('[data-layers-all]').boundingBox();
  const mine = await layersTile(page).locator('[data-layers-mine]').boundingBox();
  expect(all && mine && Math.abs(all.y - mine.y) < 1).toBe(true);
  // Squeezed to 170 px: a longer name keeps its line, whole, and the controls go onto the line below it.
  await squeeze(170);
  expect((await layersTile(page).boundingBox())?.width).toBeLessThanOrEqual(171);
  const squeezed = await rowLayout(page);
  for (const r of squeezed) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
  expect(squeezed.find((r) => r.layer === 'set-art')).toMatchObject({ controlsBelow: true });
  await expect(row(page, 'set-art').locator('[data-layer-name]')).toHaveText('Set and art');
});

test('in Spanish at 1280 × 720 no layer’s name is cut off', async ({ page }) => {
  await buildPlan(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  // Applied as Settings closes (Kevin, Nov 17).
  await closeSettings(page);
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
  const capas = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(capas).toBeVisible();
  await expect(capas.locator('[data-layer="set-art"] [data-layer-name]')).toHaveText('Escenografía y arte');
  for (const r of await rowLayout(page)) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
});

test('the start follows “This is me” until a layer is first changed, and the settings keep nothing till then', async ({ page }) => {
  await buildPlan(page);
  const stored = () => page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { planLayers?: unknown }).planLayers ?? null, SETTINGS_KEY);
  expect(await shows(page)).toEqual({ camera: 'shown', lighting: 'shown', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' });
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  const editor = people.locator('[data-person-editor]');
  const addPerson = async (name: string, role: string) => {
    await toSection(page, 'Production');
    await people.getByRole('button', { name: '+ New person' }).click();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: role });
    await editor.getByRole('button', { name: 'This is me' }).click();
    await toSection(page, 'Setup');
  };
  // A gaffer: lighting and grip shown, the rest dimmed, with no button pressed.
  await addPerson('Sam Ortiz', 'Gaffer');
  await expect.poll(() => shows(page)).toEqual({ camera: 'dimmed', lighting: 'shown', grip: 'shown', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' });
  expect(await stored()).toBeNull();
  // Another "This is me": the layers follow.
  await addPerson('Mia Ruiz', 'Sound');
  await expect.poll(() => shows(page)).toEqual({ camera: 'dimmed', lighting: 'dimmed', grip: 'dimmed', 'set-art': 'dimmed', sound: 'shown', production: 'dimmed', cast: 'dimmed' });
  expect(await stored()).toBeNull();
  // A first change: from then on the layers are what was chosen, whoever this is.
  await row(page, 'cast').getByRole('radio', { name: 'Cast: hidden', exact: true }).click();
  await expect.poll(stored).not.toBeNull();
  await toSection(page, 'Production');
  await people.locator('[data-person-id]').filter({ hasText: 'Sam Ortiz' }).click();
  await editor.getByRole('button', { name: 'This is me' }).click();
  await toSection(page, 'Setup');
  await expect.poll(() => shows(page)).toEqual({ camera: 'dimmed', lighting: 'dimmed', grip: 'dimmed', 'set-art': 'dimmed', sound: 'shown', production: 'dimmed', cast: 'hidden' });
});

test('digits typed during a wall run are its length, never a solo; a wall or door tool shows the set’s layer', async ({ page }) => {
  await buildPlan(page);
  const allShown = { camera: 'shown', lighting: 'shown', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' };
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, -200, 100);
  await page.keyboard.type('25');
  await expect(planTile(page).locator('[data-path-length]')).toHaveAttribute('data-path-length', '25');
  expect(await shows(page)).toEqual(allShown);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Art hidden, then the Door tool: the layer is shown again, and said, so the door has its walls to go into.
  await row(page, 'set-art').getByRole('radio', { name: 'Set and art: hidden', exact: true }).click();
  await expect.poll(async () => (await kinds(page)).includes('wall')).toBe(false);
  await canvas(page).focus();
  await page.keyboard.press('d');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:door');
  await expect.poll(async () => (await shows(page))['set-art']).toBe('shown');
  await expect(page.getByText('Layer shown so you can see what you’re working on: Set and art.')).toBeVisible();
  await expect.poll(async () => (await kinds(page)).includes('wall')).toBe(true);
});

test('a layer key is said aloud on the plan, a change of several rows in the tile, and a single control by itself', async ({ page }) => {
  await buildPlan(page);
  await canvas(page).focus();
  await page.keyboard.press('1');
  await expect(canvas(page).getByRole('status')).toHaveText('Camera layer solo, the others dimmed and locked');
  // Key 0 during the solo ends it, and says so first.
  await page.keyboard.press('0');
  await expect(canvas(page).getByRole('status')).toHaveText('Camera solo ended. All layers shown, none locked');
  // A selection made on the plan takes the layer words off its line (L3).
  await page.keyboard.press(`${await mod(page)}+a`);
  await expect(canvas(page).getByRole('status')).not.toContainText('layers shown');
  // A single control speaks its own new state: neither line repeats it (L3).
  await row(page, 'lighting').getByRole('radio', { name: 'Lighting: hidden', exact: true }).click();
  await expect(layersTile(page).locator('[data-layers-said]')).toHaveText('');
  await layersTile(page).getByRole('button', { name: 'Lock the Grip layer' }).click();
  await expect(layersTile(page).locator('[data-layers-said]')).toHaveText('');
  // A solo from the tile is said in the tile, never on the canvas's line too.
  await row(page, 'cast').getByRole('button', { name: /^Solo the Cast layer/ }).click();
  await expect(layersTile(page).locator('[data-layers-said]')).toHaveText('Cast layer solo, the others dimmed and locked');
  await expect(canvas(page).getByRole('status')).not.toContainText('solo');
  await layersTile(page).getByRole('button', { name: 'My department' }).click();
  await expect(layersTile(page).locator('[data-layers-said]')).toHaveText('Cast solo ended. Your department’s layers shown, the rest dimmed');
});

/** The camera row's Solo, to read whether its solo is still on. */
const cameraSolo = (page: Page) => row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ });

test('during a solo the other rows are held, the solo row works, and the header offers End solo', async ({ page }) => {
  await buildPlan(page);
  await row(page, 'lighting').getByRole('radio', { name: 'Lighting: hidden', exact: true }).click();
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden');
  await cameraSolo(page).click();
  const soloed = { camera: 'shown', lighting: 'dimmed', grip: 'dimmed', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' };
  await expect.poll(() => shows(page)).toEqual(soloed);
  // The header says the solo, not a count of its locks (L2), and ends it.
  await expect(planTile(page).locator('[data-layers-note]')).toHaveText(/^Camera solo\s*End solo$/);
  // Another row's choices are held: shown as they are, saying why, and a press changes nothing (M-a).
  const held = row(page, 'cast').getByRole('radio', { name: 'Cast: hidden', exact: true });
  await expect(held).toHaveAttribute('aria-disabled', 'true');
  await expect(held).toHaveAccessibleDescription('Locked while Camera is solo');
  await expect(held).toHaveAttribute('title', 'Dimmed while Camera is solo');
  await held.click({ force: true });
  await row(page, 'cast').getByRole('radio', { name: 'Cast: dimmed', exact: true }).click({ force: true });
  await expect(cameraSolo(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await shows(page)).toEqual(soloed);
  // The arrows on a held choice move nothing.
  await row(page, 'cast').getByRole('radio', { name: 'Cast: dimmed', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  expect(await shows(page)).toEqual(soloed);
  // The underlay's row is held too.
  await expect(layersTile(page).locator('[data-underlay-layer] [role="radio"]').first()).toHaveAttribute('aria-disabled', 'true');
  // The solo row's own choice and lock work, and keep the solo.
  await row(page, 'camera').getByRole('radio', { name: 'Camera: dimmed', exact: true }).click();
  await expect.poll(async () => (await shows(page)).camera).toBe('dimmed');
  await layersTile(page).getByRole('button', { name: 'Lock the Camera layer' }).click();
  await expect(row(page, 'camera')).toHaveAttribute('data-layer-locked', 'true');
  await expect(cameraSolo(page)).toHaveAttribute('aria-pressed', 'true');
  // End solo in the header: back as before, the solo row's changes kept.
  await planTile(page).getByRole('button', { name: 'End solo' }).click();
  await expect.poll(() => shows(page)).toEqual({ camera: 'dimmed', lighting: 'hidden', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' });
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden · 1 layer locked');
  // Show all during a solo ends it.
  await row(page, 'grip').getByRole('button', { name: /^Solo the Grip layer/ }).click();
  await layersTile(page).getByRole('button', { name: 'Show all' }).click();
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'shown', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' });
  await expect(row(page, 'grip').getByRole('button', { name: /^Solo the Grip layer/ })).toHaveAttribute('aria-pressed', 'false');
});

test('a reveal during a solo ends it and the notice says so; the Library’s Measure shows production’s layer', async ({ page }) => {
  await buildPlan(page);
  await row(page, 'set-art').getByRole('radio', { name: 'Set and art: hidden', exact: true }).click();
  await cameraSolo(page).click();
  // The Door tool draws on the set's layer: the solo ends, and the notice says what was shown and that the solo ended.
  await canvas(page).focus();
  await page.keyboard.press('d');
  await expect(page.getByText('Layer shown so you can see what you’re working on: Set and art. Camera solo ended so you can pick what you’re working on.')).toBeVisible();
  await expect(cameraSolo(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await shows(page))['set-art']).toBe('shown');
  await page.keyboard.press('Escape');
  // Measure picked in the Library reveals production's layer at once, as the toolbar's does (6.9).
  await layersTile(page).getByRole('button', { name: 'Lock the Production layer' }).click();
  const measure = libraryTile(page).locator('[data-library-icon="production/measure"]');
  await measure.scrollIntoViewIfNeeded();
  await measure.focus();
  await page.keyboard.press('Enter');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:measure');
  await expect(row(page, 'production')).not.toHaveAttribute('data-layer-locked', 'true');
  await expect(page.getByText('Layer unlocked so you can pick what you’re working on: Production.')).toBeVisible();
});

test('the Frames tile shows a hidden camera’s layer when a frame is pressed, and the Selection tile never edits a locked item', async ({ page }) => {
  // A frame on the board for the setup to shoot.
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await buildPlan(page);
  const camera = await byKind(page, 'camera');
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  const frames = page.getByRole('region', { name: 'Frames in setup', exact: true });
  await frames.getByRole('combobox', { name: 'Camera for 1A' }).selectOption({ label: 'Camera' });
  await row(page, 'camera').getByRole('radio', { name: 'Camera: hidden', exact: true }).click();
  await expect.poll(async () => (await kinds(page)).includes('camera')).toBe(false);
  await frames.getByRole('button', { name: /^1A.*shot from/ }).click();
  await expect.poll(async () => (await shows(page)).camera).toBe('shown');
  await expect.poll(() => selection(page)).toEqual([camera.id]);
  await expect(page.getByText('Layer shown so you can see what you’re working on: Camera.')).toBeVisible();

  // An item on a locked layer forced into the stored selection, past every pruning: the Selection tile shows nothing
  // to edit for it (6.8 review, M1); unlocked, the same selection is editable.
  const light = await byKind(page, 'light');
  await layersTile(page).getByRole('button', { name: 'Lock the Lighting layer' }).click();
  await page.evaluate(async (id) => {
    // The page's own module, as the dev server serves it to the app.
    const url = '/src/features/birdseye/plan/planStore.ts';
    type Selections = { selections: Record<string, string[]> };
    const mod = (await import(/* @vite-ignore */ url)) as { planStore: { setState: (next: (s: Selections) => Selections) => void } };
    mod.planStore.setState((s) => ({ selections: Object.fromEntries(Object.keys(s.selections).map((key) => [key, [id]])) }));
  }, light.id);
  const selectionTile = page.locator('[data-selection-tile]');
  await expect(selectionTile).toBeVisible();
  await expect(selectionTile.locator('[data-selection-items]')).toHaveCount(0);
  await layersTile(page).getByRole('button', { name: 'Lock the Lighting layer' }).click();
  await expect(selectionTile.locator('[data-selection-items]')).toHaveAttribute('data-selection-items', light.id);
});

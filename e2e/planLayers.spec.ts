import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  await closeSettings(page, 'apply');
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
async function rowLayout(page: Page, tile: Locator = layersTile(page)) {
  return tile
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

/** What the tile's layout reads as: its rows, its lane and whether the keys line shows. */
const layoutNow = async (page: Page, tile?: Locator) => {
  const { lane, shown } = await keysLine(page);
  return JSON.stringify([await rowLayout(page, tile), lane, shown]);
};

/** Waits for the tile's layout to settle: the same answer on two reads two frames apart. The lane and the keys line
 *  answer a resize in the next frame, so a read straight after one can catch the layout mid-change. */
async function layoutSettled(page: Page, tile?: Locator) {
  await expect
    .poll(async () => {
      const before = await layoutNow(page, tile);
      await settle(page);
      return (await layoutNow(page, tile)) === before;
    })
    .toBe(true);
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
  await layoutSettled(page);
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
  await layoutSettled(page);
  for (const r of await rowLayout(page)) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
  const all = await layersTile(page).locator('[data-layers-all]').boundingBox();
  const mine = await layersTile(page).locator('[data-layers-mine]').boundingBox();
  expect(all && mine && Math.abs(all.y - mine.y) < 1).toBe(true);
  // Squeezed to 170 px: a longer name keeps its line, whole, and the controls go onto the line below it.
  await squeeze(170);
  await layoutSettled(page);
  expect((await layersTile(page).boundingBox())?.width).toBeLessThanOrEqual(171);
  const squeezed = await rowLayout(page);
  for (const r of squeezed) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
  expect(squeezed.find((r) => r.layer === 'set-art')).toMatchObject({ controlsBelow: true });
  await expect(row(page, 'set-art').locator('[data-layer-name]')).toHaveText('Set and art');
});

// #222: where the controls don't fit on the line below the name either (a squeezed tile, the lane beside it), they wrap
// again, at the right, so none runs past the row.
test('squeezed to 150 and 130 px every row is whole, its name first and its controls inside it, in English and in Spanish', async ({ page }) => {
  await buildPlan(page);
  const inside = (tile: Locator) =>
    tile.locator('[data-layer], [data-underlay-layer]').evaluateAll((list) =>
      list.map((r) => {
        const box = r.getBoundingClientRect();
        const controls = [...r.querySelectorAll('[data-layer-count], [role="radiogroup"], button')].map((c) => c.getBoundingClientRect());
        return { layer: r.getAttribute('data-layer') ?? 'underlay', inside: controls.every((k) => k.left >= box.left - 1 && k.right <= box.right + 1 && k.bottom <= box.bottom + 2) };
      }),
    );
  const check = async (tile: Locator, language: string) => {
    await expect(tile.locator('[data-layer], [data-underlay-layer]')).toHaveCount(8);
    for (const px of [150, 130]) {
      await tile.evaluate((el, width) => {
        el.style.width = `${String(width)}px`;
        el.style.flex = 'none';
      }, px);
      await layoutSettled(page, tile);
      expect((await tile.boundingBox())?.width, `${language} at ${String(px)} px`).toBeLessThanOrEqual(px + 1);
      for (const r of await rowLayout(page, tile)) expect(r, `${language} at ${String(px)} px, ${r.layer}`).toMatchObject({ whole: true, nameFirst: true, inTile: true });
      for (const r of await inside(tile)) expect(r.inside, `${language} at ${String(px)} px, ${r.layer}`).toBe(true);
    }
  };
  await check(layersTile(page), 'English');
  await layersTile(page).evaluate((el) => {
    el.style.width = '';
    el.style.flex = '';
  });
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
  const capas = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(capas).toBeVisible();
  await check(capas, 'Spanish');
});

test('in Spanish at 1280 × 720 no layer’s name is cut off', async ({ page }) => {
  await buildPlan(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  // Applied as Settings closes (Kevin, Nov 17).
  await closeSettings(page, 'apply');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
  const capas = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(capas).toBeVisible();
  await expect(capas.locator('[data-layer="set-art"] [data-layer-name]')).toHaveText('Escenografía y arte');
  // The Spanish tile, by its Spanish name: read in English ("Layers") it would find no rows and check none.
  const rows = await rowLayout(page, capas);
  expect(rows).toHaveLength(8);
  for (const r of rows) expect(r, r.layer).toMatchObject({ whole: true, nameFirst: true, inTile: true });
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

// The keys line (#222, Kevin Nov 20): it shows only when the tile has room for it whole, never cut off and never the
// reason the tile's body scrolls; where it doesn't show, the list still carries its words as its description. These
// tests don't force the overlay case: headless Chromium measures its bars as overlay by itself (scrollLane.spec), so the
// lane is read as the app sets it.
const KEYS_EN = 'On the plan, 1 to 7 solo a layer and 0 shows all. A focus view on this computer: nothing is saved in the project.';

interface KeysLine {
  shown: boolean;
  /** The line takes more than a visually hidden pixel. */
  visible: boolean;
  /** The line's box lies wholly inside what the body shows. */
  inside: boolean;
  scrolls: boolean;
  lane: string | null;
}

const keysLine = (page: Page): Promise<KeysLine> =>
  page.locator('[data-layers-tile]').evaluate((tile) => {
    const body = tile.closest('[data-scroll-root]');
    const line = tile.querySelector('[data-layers-keys]');
    if (!(body instanceof HTMLElement) || !(line instanceof HTMLElement)) throw new Error('no body or line');
    const b = body.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    return {
      shown: line.getAttribute('data-layers-keys') === 'shown',
      visible: l.width > 1 && l.height > 1,
      inside: l.top >= b.top - 0.5 && l.bottom <= b.top + body.clientHeight + 0.5 && l.left >= b.left - 0.5 && l.right <= b.right + 0.5,
      scrolls: body.scrollHeight > body.clientHeight,
      lane: body.getAttribute('data-scroll-lane'),
    };
  });

/** Lets the tile's measures settle: two frames, as the lane and the line are measured in the next one. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );

test('in English at the default size the keys line is not shown and the tile neither scrolls nor takes a lane', async ({ page }) => {
  await buildPlan(page);
  await settle(page);
  expect(await keysLine(page)).toMatchObject({ shown: false, visible: false, scrolls: false, lane: null });
  // Its words are still the list's description.
  await expect(layersTile(page).getByRole('list')).toHaveAccessibleDescription(KEYS_EN);
});

// In Spanish the buttons and the wrapped rows overflow the default size by themselves (content 431 in a body of 376
// with the lane, 415 without), so this test doesn't say the body doesn't scroll: how that should fit waits for Kevin.
test('in Spanish at the default size the keys line is not shown, takes no room and is never partly shown', async ({ page }) => {
  await buildPlan(page);
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
  const capas = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(capas).toBeVisible();
  await settle(page);
  expect(await keysLine(page)).toMatchObject({ shown: false, visible: false });
  // No room: the body's content ends at the list's bottom plus the tile's padding, so the hidden line and its copy
  // add nothing to what the body scrolls.
  const room = await page.locator('[data-layers-tile]').evaluate((tile) => {
    const body = tile.closest('[data-scroll-root]');
    const list = tile.querySelector('ul');
    if (!(body instanceof HTMLElement) || !(list instanceof HTMLElement)) throw new Error('no body or list');
    const end = list.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop + parseFloat(getComputedStyle(tile).paddingBottom);
    return { scrollHeight: body.scrollHeight, expected: Math.max(body.clientHeight, Math.ceil(end)) };
  });
  expect(Math.abs(room.scrollHeight - room.expected)).toBeLessThanOrEqual(1);
  await expect(capas.getByRole('list')).toHaveAccessibleDescription(
    'En el plano, de 1 a 7 dejan una capa sola y 0 las muestra todas. Una vista de enfoque en esta computadora: nada se guarda en el proyecto.',
  );
});

test('made taller the keys line shows whole, inside the body, and the body still doesn’t scroll', async ({ page }) => {
  await buildPlan(page);
  await layersTile(page).getByRole('button', { name: 'Maximize Layers' }).click();
  await expect.poll(async () => (await keysLine(page)).shown).toBe(true);
  expect(await keysLine(page)).toMatchObject({ shown: true, visible: true, inside: true, scrolls: false, lane: null });
  await expect(layersTile(page).locator('[data-layers-keys]')).toHaveText(KEYS_EN);
  // Shown, it is read in its place: the list carries no second copy.
  await expect(layersTile(page).getByRole('list')).not.toHaveAccessibleDescription(KEYS_EN);
});

test('made short the body scrolls and the keys line is not shown, and at no height in between is it partly shown', async ({ page }) => {
  await buildPlan(page);
  await page.setViewportSize({ width: 1440, height: 560 });
  await settle(page);
  await expect.poll(async () => (await keysLine(page)).scrolls).toBe(true);
  expect(await keysLine(page)).toMatchObject({ shown: false, visible: false });
  await expect(layersTile(page).getByRole('list')).toHaveAccessibleDescription(KEYS_EN);
  // From short to tall in steps, then maximized, and back: the line is either whole and the body still, or not shown.
  const seen: KeysLine[] = [];
  for (const height of [600, 640, 680, 720, 760, 800, 840, 880, 900, 960, 1040, 1200, 1400]) {
    await page.setViewportSize({ width: 1440, height });
    await settle(page);
    const now = await keysLine(page);
    seen.push(now);
    expect(now.visible, `${String(height)} px`).toBe(now.shown);
    if (now.shown) expect(now, `${String(height)} px`).toMatchObject({ inside: true, scrolls: false });
  }
  // Tall enough at the end for the line to show, so both states were met.
  expect(seen.some((s) => s.shown)).toBe(true);
  expect(seen.some((s) => !s.shown)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 560 });
  await settle(page);
  await expect.poll(async () => (await keysLine(page)).shown).toBe(false);
  expect(await keysLine(page)).toMatchObject({ visible: false, scrolls: true });
});

/**
 * Sets the tile's width (null: back to the default), then reads, on each of the next 20 frames, whether the keys line
 * shows and the body's lane, as one string per frame.
 */
const framesAfterWidth = (tile: Locator, width: number | null) =>
  tile.evaluate(
    (el, px) =>
      new Promise<{ keys: string[]; lane: string[] }>((done) => {
        const section = el.querySelector('[data-layers-tile]');
        const body = section?.closest('[data-scroll-root]');
        if (!(section instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error('no tile or body');
        const keys: string[] = [];
        const lane: string[] = [];
        el.style.width = px === null ? '' : `${String(px)}px`;
        el.style.flex = px === null ? '' : 'none';
        const read = () => {
          keys.push(section.querySelector('[data-layers-keys]')?.getAttribute('data-layers-keys') ?? 'none');
          lane.push(body.getAttribute('data-scroll-lane') ?? 'none');
          if (keys.length < 20) requestAnimationFrame(read);
          else done({ keys, lane });
        };
        requestAnimationFrame(read);
      }),
    width,
  );

/** The frame from which a list of reads stays at its last value, and whether any value came back after it left. */
const settling = (reads: string[]) => {
  const last = reads[reads.length - 1];
  let from = reads.length - 1;
  while (from > 0 && reads[from - 1] === last) from -= 1;
  const runs = reads.filter((v, i) => i === 0 || v !== reads[i - 1]);
  return { from, swings: runs.length !== new Set(runs).size };
};

test('after each resize the lane and the keys line settle within 3 frames and never swing, in English and in Spanish', async ({ page }) => {
  await buildPlan(page);
  const check = async (tile: Locator, language: string) => {
    for (const width of [170, null, 200]) {
      const seen = await framesAfterWidth(tile, width);
      const what = `${language} at ${width === null ? 'the default width' : `${String(width)} px`}`;
      for (const [name, reads] of Object.entries(seen)) {
        // Frame 3 (index 2) and every one after it read the same; no value returns once it has changed.
        const { from, swings } = settling(reads);
        expect(from, `${what}, ${name}: ${reads.join(' ')}`).toBeLessThanOrEqual(2);
        expect(swings, `${what}, ${name}: ${reads.join(' ')}`).toBe(false);
      }
    }
  };
  await settle(page);
  await check(layersTile(page), 'English');
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configuración' })).toBeHidden();
  const capas = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(capas).toBeVisible();
  await settle(page);
  await check(capas, 'Spanish');
});

test('each Solo’s title says its key on the plan, 1 to 7 in the rows’ order, and Show all’s says 0', async ({ page }) => {
  await buildPlan(page);
  const layers = await layersTile(page).locator('[data-layer]').evaluateAll((list) => list.map((r) => r.getAttribute('data-layer') ?? ''));
  expect(layers).toEqual(['camera', 'lighting', 'grip', 'set-art', 'sound', 'production', 'cast']);
  for (const [i, layer] of layers.entries()) {
    const solo = row(page, layer).locator('[data-layer-solo]');
    const title = (await solo.getAttribute('title')) ?? '';
    expect(title, layer).toContain('On the plan');
    expect(title.endsWith(`press ${String(i + 1)}.`), layer).toBe(true);
    // The accessible name stays the short one; the title is the longer text.
    await expect(solo).toHaveAccessibleName(/^Solo the .+ layer: it shown, the others dimmed and locked$/);
  }
  const all = layersTile(page).locator('[data-layers-all]');
  await expect(all).toHaveAttribute('title', 'Show every layer, none locked. On the plan, press 0.');
  await expect(all).toHaveAccessibleName('Show all');
});

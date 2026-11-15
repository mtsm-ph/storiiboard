import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// North and the sun path on a plan (6.6) in the memory build: a location given a place on the map and a time zone in
// the Locations tile, a shoot day on 21 June 2026 with a frame of the setup in it; the sun path placed says "No north in
// this room" until north is placed and turned; then at 13:00 its label reads New York's sun within the US Naval
// Observatory's values (azimuth 181.63°, altitude 72.72°: 0.5° and 0.3°); its time stepped from the keyboard; the frame
// taken out of the day says "No shoot day"; undo, redo and a reload; axe on the Selection tile. The canvas is pixels,
// so the tests read the plan from the data its tile keeps (data-plan-data).
//
// The browser build's address search answers only from its recorded answer (Cusco): the place is picked from it by
// hand, then its pin moved to New York through the app's own pin edit (movePin, the one a drag of the pin writes),
// since no drag in a test can cross a continent.

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
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  level: string;
  rotation: number;
  time?: string;
  drawn?: boolean;
  says?: string;
  sun?: { bearing: number; altitude: number; up: boolean; hours: number[] } | null;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const locations = (page: Page) => page.getByRole('region', { name: 'Locations', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const sunItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'sun');
const northItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'north');
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** The sun path selected by a click on its middle (it is drawn over everything). */
async function selectSun(page: Page): Promise<string> {
  const sun = (await sunItem(page)) as (Item & { centre: { x: number; y: number } }) | undefined;
  if (!sun) throw new Error('no sun path');
  const at = await screen(page, sun.centre.x * 100, sun.centre.y * 100);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selection(page)).toEqual([sun.id]);
  return sun.id;
}

test('the sun path over New York: what it lacks, north placed and turned, the sun at 13:00, its time stepped, undo, redo and a reload', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);

  // A scene at the Diner, and its frame.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({ name: 'Bey County.fountain', mimeType: 'text/plain', buffer: Buffer.from('EXT. DINER - DAY\n\nMary wipes the window.\n') });
  await page.getByRole('dialog', { name: /^Import / }).getByRole('button', { name: 'Import 1 scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');

  // The location's place, picked by hand, then moved to New York; its zone chosen by hand.
  await toSection(page, 'Production');
  const editor = locations(page).locator('[data-location-editor]');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await editor.getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York');
  const moved = await page.evaluate(async () => {
    const load = async (path: string) => (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    const { projectStore } = (await load('/src/app/projectStore.ts')) as {
      projectStore: {
        getState: () => {
          records: Record<string, { id: string; type: string; trashedAt: string | null; props: Record<string, unknown> }>;
          applyWith: (build: (records: unknown) => { changes: unknown[] }) => Promise<boolean>;
        };
      };
    };
    const { movePin } = (await load('/src/features/locations/locationEdits.ts')) as { movePin: (records: unknown, id: string, latitude: number, longitude: number) => unknown[] };
    // The scene's location, the one the Locations tile shows.
    const scene = Object.values(projectStore.getState().records).find((r) => r.type === 'scene' && r.trashedAt === null);
    const id = scene?.props.location_id;
    if (typeof id !== 'string') return false;
    return projectStore.getState().applyWith((now) => ({ changes: movePin(now, id, 40.7128, -74.006) }));
  });
  expect(moved).toBe(true);

  // A shoot day on 21 June 2026 with the frame in it.
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const day = days(page).locator('[data-day-editor]');
  await day.getByLabel('Date').fill('2026-06-21');
  await day.getByLabel('Date').blur();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  await expect(day.getByRole('list', { name: /^Frames on Day 1/ })).toContainText('1A');

  // The setup with the frame in it, its room started.
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(1);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();

  // The sun path from the Library: in the setup's plan, at noon; it says the room has no north and draws nothing.
  const sunButton = libraryTile(page).locator('[data-library-icon="lighting/sun-path"]');
  await sunButton.scrollIntoViewIfNeeded();
  await sunButton.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sunItem(page))?.says).toBe('No north in this room');
  expect(await sunItem(page)).toMatchObject({ level: 'setup', time: '12:00', drawn: false, sun: null });
  await expect(selectionTile(page).locator('[data-sun-missing]')).toHaveAttribute('data-sun-missing', 'noNorth');
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // "Place north" takes the focus to north in the Library; Enter places it in the room, selected; typed and turned.
  await selectionTile(page).getByRole('button', { name: 'Place north' }).click();
  await expect(libraryTile(page).locator('[data-library-icon="production/north"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await northItem(page))?.level).toBe('room');
  const north = (await northItem(page))?.id ?? '';
  await expect.poll(() => selection(page)).toEqual([north]);
  const northField = selectionTile(page).getByRole('textbox', { name: 'North', exact: true });
  await northField.fill('35');
  await northField.press('Enter');
  await expect.poll(async () => (await northItem(page))?.rotation).toBe(35);
  // The turn keys turn it too: ] is 5° clockwise.
  await canvas(page).focus();
  await page.keyboard.press(']');
  await expect.poll(async () => (await northItem(page))?.rotation).toBe(40);
  await expect(northField).toHaveValue('40°');
  // A second north from the Library selects this one, and none is added.
  const northButton = libraryTile(page).locator('[data-library-icon="production/north"]');
  await northButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('This room has its north already: it’s selected. Turn it to set the room’s north.')).toBeVisible();
  expect((await items(page)).filter((i) => i.kind === 'north')).toHaveLength(1);

  // The sun path at 13:00: New York's sun as USNO publishes it, on the plan and in the Selection tile.
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
  await selectSun(page);
  const time = selectionTile(page).getByRole('textbox', { name: 'Time', exact: true });
  await time.fill('13:00');
  await time.press('Enter');
  await expect.poll(async () => (await sunItem(page))?.time).toBe('13:00');
  const drawn = await sunItem(page);
  expect(Math.abs((drawn?.sun?.bearing ?? 0) - 181.63)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((drawn?.sun?.altitude ?? 0) - 72.72)).toBeLessThanOrEqual(0.3);
  expect(drawn?.says).toMatch(/^13:00 · 18[12]° · 73° high$/);
  expect(drawn?.sun?.hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  const sun = selectionTile(page).locator('[data-sun-numbers]');
  await expect(sun.locator('[data-sun-height]')).toHaveText('73° above the horizon');
  await expect(sun.locator('[data-sun-rise]')).toHaveText(/^05:2\d$/);
  await expect(sun.locator('[data-sun-set]')).toHaveText(/^20:3\d$/);
  await expect(selectionTile(page).locator('[data-sun-for]')).toContainText(/Day 1 · Sun, Jun 21 at Diner/i);
  await expect(selectionTile(page).locator('[data-sun-zone]')).toHaveText('Times in America/New_York');
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // From the keyboard: up a quarter of an hour, then Shift and up an hour, each one edit.
  await time.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await sunItem(page))?.time).toBe('13:15');
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await sunItem(page))?.time).toBe('14:00');
  await expect(time).toHaveValue('14:00');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await sunItem(page))?.time).toBe('13:45');
  await expect.poll(async () => (await sunItem(page))?.says).toMatch(/^13:45 · \d+° · \d+° high$/);

  // The frame taken out of the day: the sun path says it has no shoot day, and draws nothing.
  await toSection(page, 'Production');
  await days(page).getByRole('combobox', { name: 'Move to, for 1A' }).selectOption({ label: 'Not scheduled' });
  await days(page).getByRole('button', { name: 'Move 1A' }).click();
  await toSection(page, 'Setup');
  await expect.poll(async () => (await sunItem(page))?.says).toBe('No shoot day');
  expect((await sunItem(page))?.drawn).toBe(false);
  await expect(selectionTile(page).locator('[data-sun-missing]')).toHaveAttribute('data-sun-missing', 'noDay');
  await expect(selectionTile(page).getByRole('button', { name: 'Open Shoot days' })).toBeVisible();

  // Undo puts the frame back in the day (drawn again); redo takes it out; undo again.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await sunItem(page))?.says).toBe('No shoot day');
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);

  // After a reload, it is all there: north at 40°, the sun path at 13:45, drawn.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await northItem(page))?.rotation).toBe(40);
  await expect.poll(async () => (await sunItem(page))?.time).toBe('13:45');
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
});

// The 6.6 review: on a computer set to Madrid, a location in New York with no zone of its own reads "No time zone" (the
// browser build has no lookup, and never takes this computer's zone in its place); each "what's missing" button opens a
// tile the Setup layout doesn't have, on the right thing, with the focus there: Open Shoot days, Place north with the
// Library closed, and Open Locations with two locations, the one asked for current and focused, not the first. With the
// zone set there, it draws New York's sun. The rotate handle is offered for north and never for the sun path.
test.describe('on a computer in Madrid', () => {
  test.use({ timezoneId: 'Europe/Madrid' });

  test('no stand-in zone; Open Shoot days, Place north and Open Locations open their tiles on the right thing', async ({ page }) => {
    const app = await openSettings(page, 'App');
    await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
    await closeSettings(page);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Europe/Madrid');

    // A scene at the Diner and its frame; the Diner in New York with no zone of its own; a second place, the Alley,
    // first in the list by name; a dated day with no frame in it yet.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Import script…' }).click();
    await (await chooser).setFiles({ name: 'Bey County.fountain', mimeType: 'text/plain', buffer: Buffer.from('EXT. DINER - DAY\n\nMary wipes the window.\n') });
    await page.getByRole('dialog', { name: /^Import / }).getByRole('button', { name: 'Import 1 scene' }).click();
    await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
    await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
    await page.keyboard.press('/');
    await page.keyboard.type('loc');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Diner');
    await page.keyboard.press('Enter');
    await toSection(page, 'Production');
    const editor = locations(page).locator('[data-location-editor]');
    await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
    await editor.getByRole('button', { name: 'Search address' }).click();
    await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
    await expect(editor.getByText('On the map')).toBeVisible();
    const diner = await page.evaluate(async () => {
      const load = async (path: string) => (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
      const { projectStore } = (await load('/src/app/projectStore.ts')) as {
        projectStore: {
          getState: () => {
            records: Record<string, { id: string; type: string; trashedAt: string | null; props: Record<string, unknown> }>;
            applyWith: (build: (records: unknown) => { changes: unknown[] }) => Promise<boolean>;
          };
        };
      };
      const { movePin } = (await load('/src/features/locations/locationEdits.ts')) as { movePin: (records: unknown, id: string, latitude: number, longitude: number) => unknown[] };
      const scene = Object.values(projectStore.getState().records).find((r) => r.type === 'scene' && r.trashedAt === null);
      const id = scene?.props.location_id;
      if (typeof id !== 'string') return null;
      return (await projectStore.getState().applyWith((now) => ({ changes: movePin(now, id, 40.7128, -74.006) }))) ? id : null;
    });
    expect(diner).not.toBeNull();
    await locations(page).getByRole('button', { name: '+ New location' }).click();
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
    await page.keyboard.type('Alley');
    await page.keyboard.press('Enter');
    await expect(locations(page).locator('[data-location-id]').first()).toContainText('Alley');
    await days(page).getByRole('button', { name: '+ New day' }).click();
    const day = days(page).locator('[data-day-editor]');
    await day.getByLabel('Date').fill('2026-06-21');
    await day.getByLabel('Date').blur();

    // The setup with the frame, its room, the sun path: the frame is in no day.
    await toSection(page, 'Setup');
    await expect(days(page)).toHaveCount(0);
    await expect(locations(page)).toHaveCount(0);
    await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
    await setupsTile(page).locator('[data-setup-add-frame]').first().click();
    await planTile(page).getByRole('button', { name: 'New room' }).click();
    await expect(canvas(page)).toBeVisible();
    const sunButton = libraryTile(page).locator('[data-library-icon="lighting/sun-path"]');
    await sunButton.scrollIntoViewIfNeeded();
    await sunButton.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await sunItem(page))?.says).toBe('No shoot day');
    // The sun path is never turned: no rotate handle while it is selected.
    await expect(canvas(page)).toHaveAttribute('data-turnable', 'false');

    // Open Shoot days: the tile opens in this workspace, its day focused; the frame put in the day there.
    await selectionTile(page).getByRole('button', { name: 'Open Shoot days' }).click();
    await expect(days(page)).toBeVisible();
    await expect(days(page).locator('[data-day-id]').first()).toBeFocused();
    await days(page).locator('[data-day-editor]').getByRole('button', { name: /^Add 1A to Day 1/ }).click();
    await expect.poll(async () => (await sunItem(page))?.says).toBe('No north in this room');

    // Place north with the Library closed: the Library opens, north focused; Enter places it, selected, turnable.
    await libraryTile(page).getByRole('button', { name: 'Close Library' }).click();
    await expect(libraryTile(page)).toHaveCount(0);
    await selectSun(page);
    await selectionTile(page).getByRole('button', { name: 'Place north' }).click();
    await expect(libraryTile(page).locator('[data-library-icon="production/north"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await northItem(page))?.level).toBe('room');
    await expect(canvas(page)).toHaveAttribute('data-turnable', 'true');

    // No zone of its own: "No time zone", never Madrid's (which would put New York's sun six hours off).
    await expect.poll(async () => (await sunItem(page))?.says).toBe('No time zone');
    expect((await sunItem(page))?.drawn).toBe(false);
    await selectSun(page);
    await expect(selectionTile(page).locator('[data-sun-missing]')).toHaveAttribute('data-sun-missing', 'noZone');

    // Open Locations: the tile opens on the Diner, not the Alley first in its list, its row current and focused.
    await selectionTile(page).getByRole('button', { name: 'Open Locations' }).click();
    await expect(locations(page)).toBeVisible();
    const current = locations(page).locator('[data-location-id][aria-current="true"]');
    await expect(current).toHaveAttribute('data-location-id', diner ?? '');
    await expect(current).toBeFocused();
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(/^diner$/i);

    // Its zone set there: New York's sun at 13:00, as USNO publishes it.
    await editor.getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York');
    await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
    await selectSun(page);
    const time = selectionTile(page).getByRole('textbox', { name: 'Time', exact: true });
    await time.fill('13:00');
    await time.press('Enter');
    await expect.poll(async () => (await sunItem(page))?.time).toBe('13:00');
    const drawn = await sunItem(page);
    expect(Math.abs((drawn?.sun?.bearing ?? 0) - 181.63)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((drawn?.sun?.altitude ?? 0) - 72.72)).toBeLessThanOrEqual(0.3);
    await expect(selectionTile(page).locator('[data-sun-zone]')).toHaveText('Times in America/New_York');
    // The time field's keyboard help is its description.
    const described = await time.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${described ?? ''}"]`)).toHaveText(/arrows step 15 minutes/);
  });
});

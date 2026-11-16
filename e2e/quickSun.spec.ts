import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Quick sun, pasted coordinates and the compass (6.5.5) in the memory build. A setup with no location and no shoot day:
// the compass at the plan's top right says north isn't set and there's no sun path; north placed, it opens on "Add sun
// path"; the sun path's own place pasted as Google Maps copies it and its own date typed, it draws and says "Its own".
// The frame then given a location put on the map by pasted coordinates (no request leaves the page: the test's network
// log has none, and the address search's recorded answer is never loaded) and a shoot day: the sun path says it uses
// them, its own fields marked unused. axe on the compass and the new fields, in the app's light and dark themes, on a
// Paper and a Dark canvas.
//
// The browser build has no time-zone finder; for a sun path's own coordinates it answers with this computer's zone, as
// a call sheet's stand-in does, so the browser is set to New York here.

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
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
  drawn?: boolean;
  says?: string;
  from?: { place: string | null; date: string | null };
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
const compass = (page: Page) => planTile(page).locator('[data-compass-button]');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const sunItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'sun');
const northItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'north');
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Whether two boxes on screen meet. */
const meet = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return box;
}

test('quick sun: its own place and date for a setup with none, then the setup’s location and day win; pasted coordinates request nothing; the compass', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);

  // A scene and its frame, with no location and no shoot day; its setup and room.
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(1);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();

  // The compass: at the plan's top right, inside the top ruler, clear of the zoom, the Paper/Dark row and the minimap.
  await expect(compass(page)).toHaveAccessibleName('North is not set. Sun: no sun path in this setup');
  await expect(planTile(page).locator('[data-plan-compass]')).toHaveAttribute('data-compass-north', 'unset');
  const frame = await boxOf(canvas(page));
  const dial = await boxOf(planTile(page).locator('[data-plan-compass]'));
  expect(Math.abs(frame.x + frame.width - 8 - (dial.x + dial.width))).toBeLessThanOrEqual(1.5);
  expect(Math.abs(frame.y + 18 + 8 - dial.y)).toBeLessThanOrEqual(1.5);
  for (const other of [
    planTile(page).getByRole('group', { name: 'Canvas view' }),
    planTile(page).getByRole('button', { name: 'Zoom in' }),
    planTile(page).getByRole('button', { name: 'Fit all' }),
    planTile(page).getByRole('button', { name: 'Minimap' }),
    planTile(page).locator('[data-tool-strip]'),
  ]) {
    expect(meet(dial, await boxOf(other))).toBe(false);
  }

  // North from the Library: the compass points it, still no sun path.
  const northButton = libraryTile(page).locator('[data-library-icon="production/north"]');
  await northButton.scrollIntoViewIfNeeded();
  await northButton.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await northItem(page))?.level).toBe('room');
  await expect(compass(page)).toHaveAccessibleName('North is 0°. Sun: no sun path in this setup');

  // The compass opens on "Add sun path"; it adds one, selected, which lacks a shoot day and a place.
  await compass(page).click();
  await expect(compass(page)).toHaveAttribute('aria-expanded', 'true');
  await planTile(page).getByRole('button', { name: 'Add sun path' }).click();
  await expect.poll(async () => (await sunItem(page))?.level).toBe('setup');
  const sun = (await sunItem(page))?.id ?? '';
  await expect.poll(() => selection(page)).toEqual([sun]);
  await expect.poll(async () => (await sunItem(page))?.says).toBe('No shoot day');
  const sources = selectionTile(page).locator('[data-sun-sources]');
  await expect(sources.locator('[data-sun-place-from]')).toHaveAttribute('data-sun-place-from', 'none');
  await expect(sources.locator('[data-sun-date-from]')).toHaveAttribute('data-sun-date-from', 'none');

  // Its own place pasted as Google Maps copies it, its own date typed: it draws, and says it uses its own.
  const ownPlace = selectionTile(page).getByRole('textbox', { name: 'Its own place', exact: true });
  await ownPlace.fill('40.8677, -73.9212');
  await ownPlace.press('Enter');
  // Its own place alone draws nothing yet: still no shoot day, its own date named as what would complete it.
  await expect(selectionTile(page).locator('[data-sun-own-completes]')).toHaveAttribute('data-sun-own-completes', 'date');
  expect((await sunItem(page))?.from).toEqual({ place: null, date: null });
  expect((await sunItem(page))?.says).toBe('No shoot day');
  const ownDate = selectionTile(page).getByLabel('Its own date', { exact: true });
  await ownDate.fill('2026-06-21');
  await ownDate.press('Enter');
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
  expect((await sunItem(page))?.from).toEqual({ place: 'own', date: 'own' });
  expect((await sunItem(page))?.says).toMatch(/^12:00 · \d+° · \d+° high$/);
  await expect(sources.locator('[data-sun-place-from]')).toHaveText('Place Its own');
  await expect(sources.locator('[data-sun-date-from]')).toHaveText('Date Its own');
  await expect(selectionTile(page).locator('[data-sun-zone]')).toHaveText('Times in America/New_York, from the coordinates');
  await expect(ownPlace).toHaveValue('40.8677, -73.9212');
  // The compass shows the sun at the sun path's time, its arc round the rim.
  await expect(compass(page)).toHaveAccessibleName(/^North is 0°\. Sun: \d+° at 12:00, \d+° high$/);
  await expect(planTile(page).locator('[data-compass-arc]')).toHaveCount(1);
  await expect(planTile(page).locator('[data-compass-time]')).toHaveAttribute('data-compass-time', 'item');

  // A decimal comma is refused, saying why, and the field shows what's stored.
  await ownPlace.fill('40,8677, -73,9212');
  await ownPlace.press('Enter');
  await expect(page.getByText('Write decimals with a point, not a comma: 40.8677, -73.9212. The comma separates latitude from longitude.')).toBeVisible();
  await expect(ownPlace).toHaveValue('40.8677, -73.9212');

  // The compass opens the settings of north and the sun: both selected, both shown.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  await compass(page).click();
  const north = (await northItem(page))?.id ?? '';
  await expect.poll(async () => [...(await selection(page))].sort()).toEqual([north, sun].sort());
  await expect(selectionTile(page).locator(`[data-north="${north}"]`)).toBeVisible();
  await expect(selectionTile(page).locator(`[data-sun="${sun}"]`)).toBeVisible();

  // axe on the compass and the new fields, in the light and dark themes, on a Paper and a Dark canvas.
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    for (const view of ['Paper', 'Dark'] as const) {
      const group = planTile(page).getByRole('group', { name: 'Canvas view' });
      await group.getByRole('button', { name: view, exact: true }).click();
      await expect(group).toHaveAttribute('data-canvas-view', view.toLowerCase());
      const { violations } = await new AxeBuilder({ page }).include('[data-plan-compass]').include('[data-sun-sources]').withTags(tags).analyze();
      expect(violations, `${theme} theme, ${view} canvas`).toEqual([]);
    }
  }
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  // The frame's location, from the "/" menu: the Diner, put on the map by pasted coordinates.
  await toSection(page, 'Storyboard');
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');
  await toSection(page, 'Production');
  const editor = locations(page).locator('[data-location-editor]');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Margaret Corbin Dr, New York');
  await editor.getByRole('textbox', { name: 'Parking' }).click();
  // Every request from here to the pin moving, by its address.
  const requests: string[] = [];
  const log = (request: { url: () => string }) => requests.push(request.url());
  page.on('request', log);
  const coordinates = editor.getByRole('textbox', { name: 'Coordinates', exact: true });
  await coordinates.fill('40.7128, -74.006');
  await editor.getByRole('button', { name: 'Place pin' }).click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(editor.locator('[data-address-search]')).toContainText('40.71280, -74.00600');
  await expect(editor.locator('[data-location-map]')).toBeVisible();
  await expect(editor.locator('[data-coordinates-said]')).toHaveText('Pin placed at 40.7128, -74.0060.');
  await expect(coordinates).toHaveValue('');
  // The address as typed.
  await expect(editor.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('Margaret Corbin Dr, New York');
  page.off('request', log);
  expect(requests.filter((url) => !url.startsWith('http://localhost:1421/'))).toEqual([]);
  // No address search either: its recorded answer, the browser build's stand-in for Nominatim, is never loaded.
  expect(requests.filter((url) => /recordedSearch|nominatim/i.test(url))).toEqual([]);
  // Its zone set, so the location's place draws (the browser build looks up no zone for a location).
  await editor.getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York');

  // A shoot day on 21 June 2026 with the frame in it.
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const day = days(page).locator('[data-day-editor]');
  await day.getByLabel('Date').fill('2026-06-21');
  await day.getByLabel('Date').blur();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  await expect(day.getByRole('list', { name: /^Frames on Day 1/ })).toContainText('1A');

  // The sun path now uses the location and the shoot day, says so, and marks its own fields unused (kept as typed).
  await toSection(page, 'Setup');
  await expect.poll(async () => (await sunItem(page))?.from).toEqual({ place: 'location', date: 'shootDay' });
  expect((await sunItem(page))?.drawn).toBe(true);
  await compass(page).click();
  await expect(selectionTile(page).locator(`[data-sun="${sun}"]`)).toBeVisible();
  await expect(sources.locator('[data-sun-place-from]')).toHaveText('Place From the location: Diner');
  await expect(sources.locator('[data-sun-date-from]')).toHaveText(/^Date From the shoot day: Day 1 · Sun, Jun 21$/i);
  await expect(sources.locator('[data-sun-own-place-unused]')).toHaveText('Not used while the setup has a location with a place on the map.');
  await expect(sources.locator('[data-sun-own-date-unused]')).toHaveText('Not used while the setup has a shoot day with a date.');
  await expect(selectionTile(page).getByRole('textbox', { name: 'Its own place', exact: true })).toHaveValue('40.8677, -73.9212');
  await expect(selectionTile(page).getByLabel('Its own date', { exact: true })).toHaveValue('2026-06-21');
  await expect(selectionTile(page).locator('[data-sun-zone]')).toHaveText('Times in America/New_York');
  const { violations } = await new AxeBuilder({ page }).include('[data-sun-sources]').withTags(tags).analyze();
  expect(violations).toEqual([]);
});

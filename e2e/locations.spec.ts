import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Locations tile (3.3) in the memory build: a location set on a scene from the "/" menu shows there with its
// scene; its details are edited once for every scene, one edit each; Delete sends it to the Trash and Restore brings it
// back, its scene with it.

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
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
  // The scene's location, from the "/" menu.
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).locator('span', { hasText: /^Diner$/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const tile = (page: Page) => page.getByRole('region', { name: 'Locations', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a scene’s location shows with its scene, and its details are edited once, each one edit', async ({ page }) => {
  const locations = tile(page);
  // At its size in Production's layout (a column), the list sits above the editor, and the fields have room.
  const name = locations.locator('[data-location-editor]').getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toBeVisible();
  expect((await name.boundingBox())?.width ?? 0).toBeGreaterThan(160);
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*TBD · 1 scene/]);
  const editor = locations.locator('[data-location-editor]');
  await expect(editor.getByText('SC 01')).toBeVisible();
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('12 Route 9, Bey County');
  await editor.getByRole('textbox', { name: 'Parking' }).click();
  await editor.getByRole('textbox', { name: 'Parking' }).fill('Lot behind the diner');
  await editor.getByRole('radio', { name: 'Confirmed' }).click();
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*Confirmed · 1 scene/]);
  await expect(editor.getByRole('textbox', { name: 'Parking' })).toHaveValue('Lot behind the diner');
  // One ⌘Z: the status back to TBD, the address and parking as they are.
  await editor.getByRole('radio', { name: 'Confirmed' }).focus();
  await page.keyboard.press(await undoKey(page));
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Diner.*TBD · 1 scene/]);
  await expect(editor.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('12 Route 9, Bey County');
  // A new one, named straight away.
  await locations.getByRole('button', { name: '+ New location' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await page.keyboard.type('Barn');
  await page.keyboard.press('Enter');
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button')).toHaveText([/Barn.*0 scenes/, /Diner/]);
  // WCAG 2.2 AA, as the app's other checks run it, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);
});

test('Delete sends a location to the Trash; Restore brings it back with its scene', async ({ page }) => {
  const locations = tile(page);
  await locations.getByRole('button', { name: 'Delete location' }).click();
  await expect(locations.getByText('No locations yet.', { exact: false })).toBeVisible();
  // The scene no longer reads as there.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).locator('span', { hasText: /^Diner$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await trash.getByRole('button', { name: 'Restore location Diner' }).click();
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).locator('span', { hasText: /^Diner$/ })).toBeVisible();
});

test('one name per place: a trashed location holds its name, and the Trash won’t restore one beside a namesake', async ({ page }) => {
  const locations = tile(page);
  const editor = locations.locator('[data-location-editor]');
  await locations.getByRole('button', { name: 'Delete location' }).click();
  // A new one can't take the trashed one's name.
  await locations.getByRole('button', { name: '+ New location' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await page.keyboard.type('diner');
  await page.keyboard.press('Enter');
  await expect(page.getByText('A location in the Trash is called “diner”.', { exact: false })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
  // "Diner" typed on a scene brings the trashed one back rather than make a second: still one.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
  await expect(locations.getByRole('list', { name: 'Locations' }).getByRole('button', { name: /^Diner/ })).toHaveCount(1);
});

test('a location’s photos and own fields, and a frame shot somewhere other than its scene’s location (3.3b)', async ({ page }) => {
  const locations = tile(page);
  const editor = locations.locator('[data-location-editor]');
  // A recce photo, kept in the project.
  const chooser = page.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Add photos…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect(editor.getByRole('img', { name: 'Photo 1 of Diner' })).toBeVisible();
  // A field of its own.
  await editor.getByRole('combobox', { name: 'New field' }).fill('Curfew');
  await editor.getByRole('button', { name: 'Add field' }).click();
  await expect(editor.getByRole('textbox', { name: 'Curfew' })).toBeFocused();
  await page.keyboard.type('10 pm');
  await page.keyboard.press('Tab');
  await expect(editor.getByRole('button', { name: 'Remove Curfew from this location' })).toBeVisible();
  // A photo removed goes to the Trash; the focus moves on to Add photos.
  await editor.getByRole('button', { name: 'Remove Photo 1 of Diner' }).click();
  await expect(editor.getByRole('img', { name: 'Photo 1 of Diner' })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Add photos…' })).toBeFocused();
  // A second location, and the frame shot there rather than at its scene's.
  await locations.getByRole('button', { name: '+ New location' }).click();
  await page.keyboard.type('Barn');
  await page.keyboard.press('Enter');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  const shotAt = inspector.getByRole('combobox', { name: 'This frame shot at' });
  await expect(shotAt).toHaveValue('');
  await expect(shotAt.locator('option')).toHaveText(['The scene’s location (Diner)', 'Barn']);
  await shotAt.selectOption({ label: 'Barn' });
  // The shot list's location column says Barn for it.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Export' }).getByRole('radio', { name: 'Shot list (CSV)' }).check();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Save…' }).click();
  const csv = readFileSync(await (await downloaded).path(), 'utf8');
  expect(csv.replace(/^\uFEFF/, '').split('\r\n')[1]?.split(',')[3]).toBe('Barn');
});

test('Search address looks up only when pressed, puts a place on the map in one edit, and keeps the search', async ({ page }) => {
  // The memory build answers from a recorded Nominatim answer (src/core/net/recordedSearch.ts): nothing goes online.
  const editor = tile(page).locator('[data-location-editor]');
  const search = editor.getByRole('button', { name: 'Search address' });
  const status = editor.locator('[data-address-search] [role="status"]');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  // Typing looks nothing up.
  await expect(editor.getByRole('list', { name: 'Places found' })).toHaveCount(0);
  await search.click();
  await expect(status).toHaveText('5 places found.');
  const found = editor.getByRole('list', { name: 'Places found' }).getByRole('button');
  await expect(found).toHaveCount(5);
  await expect(found.first()).toContainText('-13.51677, -71.97878');
  await expect(editor.getByText('Search by Nominatim. Map data © OpenStreetMap contributors, ODbL.')).toBeVisible();
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);

  // Picked: on the map, the address as typed, focus back on Search.
  await found.first().click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(editor.getByText('-13.51677, -71.97878')).toBeVisible();
  await expect(found).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(editor.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('Plaza de Armas, Cusco');
  // Open map (3.12) shows the pin on OpenStreetMap, in a new tab here (the browser, on the desktop); answered here.
  await page.context().route('https://www.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const mapTab = page.waitForEvent('popup');
  await editor.getByRole('button', { name: 'Open map' }).click();
  await (await mapTab).waitForURL(/openstreetmap\.org\/\?mlat=-13\.516767&mlon=-71\.978779/);
  await search.focus();
  // One ⌘Z takes it off the map.
  await page.keyboard.press(await undoKey(page));
  await expect(editor.getByText('On the map')).toHaveCount(0);

  // Pressed again: the search saved in the project, with Search again to ask afresh.
  await search.click();
  await expect(status).toContainText('5 places found. From the search saved');
  await editor.getByRole('button', { name: 'Search again' }).click();
  await expect(status).toHaveText('5 places found.');
  await found.nth(1).click();
  await expect(editor.getByText(/Yauri/)).toBeVisible();
  await editor.getByRole('button', { name: 'Clear map place' }).click();
  await expect(editor.getByText('On the map')).toHaveCount(0);

  // Places found for words since changed are never put on the location; a new address takes the old pin off.
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await search.click();
  await found.first().click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await search.click();
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Lima');
  await found.first().click();
  await expect(status).toHaveText('The address or name changed since that search. Search again for it.');
  await expect(search).toBeFocused();
  await expect(editor.getByText('On the map')).toHaveCount(0);

  // Nothing found, and no connection, each said in words.
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Nowhere at all');
  await search.click();
  await expect(status).toHaveText('Nothing found for “Nowhere at all”. Try the street and town, or fewer words.');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('offline');
  await search.click();
  await expect(status).toHaveText('Storiiboard couldn\'t reach the service. Check the connection and try again.');
});

test('a location’s time zone is chosen from the zones, kept across a reload, and one ⌘Z takes it back (4.3)', async ({ page }) => {
  const editor = tile(page).locator('[data-location-editor]');
  const zone = editor.getByRole('combobox', { name: 'Time zone' });
  // No place on the map yet: the first option says so, and the credit sits under the field.
  await expect(zone.locator('option').first()).toHaveText('From the map: none yet');
  await expect(zone).toHaveValue('');
  await expect(editor.getByText('Time zones from timezone-boundary-builder. Data © OpenStreetMap contributors, ODbL.')).toBeVisible();
  expect(await zone.locator('option').count()).toBeGreaterThan(100);

  await zone.selectOption('Europe/Madrid');
  await expect(zone).toHaveValue('Europe/Madrid');
  // A new address leaves a zone chosen by hand as it is.
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Calle Mayor, Madrid');
  await editor.getByRole('textbox', { name: 'Parking' }).click();
  await expect(zone).toHaveValue('Europe/Madrid');

  // Landed once History lists it; then reload.
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.locator('[data-tile="history"]').click();
  await expect(page.getByRole('region', { name: 'History', exact: true })).toContainText(/time zone/i);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
  await expect(zone).toHaveValue('Europe/Madrid');

  // The address was the last edit, so the first ⌘Z takes it back (the zone stays); the next takes the zone back.
  await zone.focus();
  await page.keyboard.press(await undoKey(page));
  await expect(editor.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('');
  await expect(zone).toHaveValue('Europe/Madrid');
  await zone.focus();
  await page.keyboard.press(await undoKey(page));
  await expect(zone).toHaveValue('');
});

test('a place shows its map (a grid here), with the credit; the pin moved from the keyboard saves in one edit', async ({ page }) => {
  // Nothing may reach a tile server from a browser build.
  const tileRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().includes('tile.openstreetmap.org')) tileRequests.push(request.url());
  });
  const editor = tile(page).locator('[data-location-editor]');
  // No place yet, no map.
  await expect(editor.locator('[data-location-map]')).toHaveCount(0);
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  const map = editor.locator('[data-location-map]');
  await expect(map).toBeVisible();
  await expect(map.locator('canvas').first()).toBeVisible();
  await expect(map.getByRole('application', { name: /^Map of / })).toBeVisible();
  await expect(map.getByText('Map tiles show in the desktop app')).toBeVisible();
  // The credit is on the map, a link to OpenStreetMap's copyright page.
  const credit = map.locator('[data-map-credit]');
  await expect(credit).toBeVisible();
  // A button, not a link: it opens through the app (open.rs), which a middle-click on a link would skip.
  await expect(credit.getByRole('button', { name: '© OpenStreetMap contributors' })).toBeVisible();
  await expect(credit.getByRole('link')).toHaveCount(0);
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 16');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-location-map]').withTags(tags).analyze()).violations).toEqual([]);

  // The wheel scrolls the editor past an unfocused map; it zooms once the map has focus, or with Ctrl held.
  const canvas = map.getByRole('application');
  await canvas.hover();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(250);
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 16');
  // The unfocused wheel scrolled the editor, so the pointer goes back over the map.
  await canvas.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 17');
  await page.waitForTimeout(250);
  await canvas.click();
  await expect(map.getByRole('application')).toBeFocused();
  await page.mouse.wheel(0, 120);
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 16');

  // Zoom with the buttons and the keyboard.
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 17');
  await map.getByRole('application').focus();
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 15');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 17');
  await page.keyboard.press('ArrowLeft');
  await expect(map.locator('[data-map-zoom]')).toHaveText('Zoom 17');
  await expect(editor.getByText('-13.51677, -71.97878')).toBeVisible();
  await expect(map.locator('[data-map-hand]')).toHaveCount(0);

  // Move pin, then the arrows, then Enter: the new coordinates are saved in one edit.
  await map.getByRole('button', { name: 'Move pin' }).click();
  await expect(map.getByRole('application')).toBeFocused();
  await expect(map.locator('[data-map-status]')).toContainText('Moving the pin: -13.51677, -71.97878');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(map.locator('[data-map-status]')).not.toContainText('-13.51677, -71.97878');
  // Escape drops the move.
  await page.keyboard.press('Escape');
  await expect(editor.getByText('-13.51677, -71.97878')).toBeVisible();
  await expect(map.getByRole('button', { name: 'Move pin' })).toBeFocused();
  await map.getByRole('button', { name: 'Move pin' }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(map.locator('[data-map-hand]')).toHaveText('Pin placed by hand');
  await expect(editor.getByText('-13.51677, -71.97878')).toHaveCount(0);
  const moved = await editor.locator('[data-address-search] p', { hasText: 'On the map' }).locator('span.font-mono').textContent();
  expect(moved).toMatch(/^-13\.5\d{4}, -71\.97\d{3}$/);
  expect(moved).not.toBe('-13.51677, -71.97878');
  // The name on the map stays; the address as typed stays.
  await expect(editor.getByText('Plaza de Armas', { exact: false }).first()).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Address', exact: true })).toHaveValue('Plaza de Armas, Cusco');

  // One ⌘Z puts the place back, and the hand-placed note goes.
  await page.keyboard.press(await undoKey(page));
  await expect(editor.getByText('-13.51677, -71.97878')).toBeVisible();
  await expect(map.locator('[data-map-hand]')).toHaveCount(0);
  expect(tileRequests).toEqual([]);
  // No React warnings from the map (keys, effects, controlled values).
  expect(consoleErrors).toEqual([]);
});

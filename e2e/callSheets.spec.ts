import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The call sheet (4.1) in the memory build: a project with a scene at a location, a character cast, a crew member and
// a shoot day with the scene's frames; the Production workspace's Call sheet tile shows the day, the location, the
// scene with its character and actor, the cast and the crew; a general note is kept across a reload, and one ⌘Z takes
// it off.

// Sun times (4.3) are written in the location's zone; the memory build looks a place's zone up as this browser's, so
// the spec sets it.
test.use({ timezoneId: 'America/New_York' });

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const sheet = (page: Page) => page.getByRole('region', { name: 'Call sheet', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

/** A project with a scene at a location, an actor cast as MARY, a crew member in Camera, and a day with the scene's frame. */
async function setUp(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);

  // A script with one scene and a speaking character; its first frame.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({
    name: 'Bey County.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. DINER - NIGHT\n\nMary wipes the counter.\n\nMARY\nWe’re closed.\n'),
  });
  await page.getByRole('dialog', { name: /^Import / }).getByRole('button', { name: 'Import 1 scene' }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board.locator('[data-shot-id]').first()).toBeFocused();
  // The scene's location, from the "/" menu (the import may have made one: whichever it is, the scene has a location).
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');

  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await expect(sheet(page)).toContainText('No shoot days yet.');
  const locations = page.getByRole('region', { name: 'Locations', exact: true });
  await locations.locator('[data-location-editor]').getByRole('textbox', { name: 'Address', exact: true }).fill('12 Route 9, Bey County');
  await locations.locator('[data-location-editor]').getByRole('textbox', { name: 'Parking' }).fill('Lot behind the diner');
  await locations.locator('[data-location-editor]').getByRole('textbox', { name: 'Parking' }).blur();

  // An actor cast as MARY, and a crew member.
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  const person = people.locator('[data-person-editor]');
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Ana Ruiz');
  await page.keyboard.press('Enter');
  await person.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Cast' });
  await person.getByRole('button', { name: 'Cast', exact: true }).click();
  await person.getByRole('group', { name: 'Plays' }).getByRole('button', { name: 'MARY', exact: true }).click();
  await person.getByRole('textbox', { name: 'Phone' }).fill('555 0101');
  await person.getByRole('textbox', { name: 'Phone' }).blur();
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await person.getByRole('button', { name: 'Camera', exact: true }).click();
  await person.getByRole('textbox', { name: 'Phone' }).fill('555 0102');
  await person.getByRole('textbox', { name: 'Phone' }).blur();

  // A shoot day with the scene's frame.
  const days = page.getByRole('region', { name: 'Shoot days', exact: true });
  const day = days.locator('[data-day-editor]');
  await days.getByRole('button', { name: '+ New day' }).click();
  await day.getByLabel('Date').fill('2030-11-16');
  await day.getByLabel('Date').blur();
  await day.getByLabel('Call').fill('07:00');
  await day.getByLabel('Call').blur();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
}

test('a day’s call sheet is built from the project, and its note survives a reload and takes one ⌘Z', async ({ page }) => {
  await setUp(page);

  // A new day has nobody on it (4.2): the people are put on from the call sheet.
  await expect(sheet(page)).toContainText('Nobody on this day yet.');
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();

  // The sheet: the day, the location, the scene with its character and actor, the cast and the crew.
  await expect(sheet(page).getByText('Day 1 of 1')).toBeVisible();
  await expect(sheet(page)).toContainText('Bey County');
  await expect(sheet(page)).toContainText('Saturday, November 16, 2030');
  await expect(sheet(page)).toContainText('07:00');
  const location = sheet(page).locator('[data-sheet-location]');
  await expect(location).toContainText(/diner/i);
  await expect(location).toContainText('12 Route 9, Bey County');
  await expect(location).toContainText('Lot behind the diner');
  const scene = sheet(page).locator('[data-sheet-scene]');
  await expect(scene).toContainText('SC 01');
  await expect(scene).toContainText('1 frame');
  await expect(scene.getByRole('list', { name: 'Characters in SC 01' }).getByRole('listitem')).toHaveText([/MARY\s*Ana Ruiz/]);
  await expect(sheet(page).locator('[data-sheet-cast]')).toHaveText([/Ana Ruiz\s*as MARY/]);
  const camera = sheet(page).locator('[data-sheet-department="camera"]');
  await expect(camera).toContainText('Kevin Matos');
  // The actor is not crew.
  await expect(sheet(page).locator('[data-sheet-department]')).toHaveCount(1);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);

  // A general note: one edit when the box is left.
  const note = sheet(page).getByLabel('General notes');
  await note.fill('Park behind the diner; quiet after 10.');
  await note.blur();
  await expect(note).toHaveValue('Park behind the diner; quiet after 10.');

  // The edit has landed once History lists it (the note itself is never shown there): only then reload.
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.locator('[data-tile="history"]').click();
  await expect(page.getByRole('region', { name: 'History', exact: true })).toContainText('Call sheet · Sat, Nov 16: general notes');

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await expect(sheet(page).getByLabel('General notes')).toHaveValue('Park behind the diner; quiet after 10.');

  // One ⌘Z takes the note off (and the call sheet record with it).
  // Not from inside the box, where the browser keeps its own undo of typed text.
  await sheet(page).getByLabel('Shoot day').focus();
  await page.keyboard.press(await undoKey(page));
  await expect(sheet(page).getByLabel('General notes')).toHaveValue('');
});

test('who is on the day and when they are called: add, take off, calls, cast times, contacts, one ⌘Z', async ({ page }) => {
  await setUp(page);
  const days = page.getByRole('region', { name: 'Shoot days', exact: true });
  const crew = sheet(page).locator('[data-sheet-department]');
  const field = (label: string) => sheet(page).getByLabel(label, { exact: true });

  // A new day has nobody; the Shoot days tile says where to add people.
  await expect(sheet(page)).toContainText('Nobody on this day yet.');
  await expect(crew).toHaveCount(0);
  await expect(days.locator('[data-day-editor]')).toContainText('Nobody on this day yet. Add people on its call sheet.');

  // Add person, then Add everyone for the rest.
  await sheet(page).getByLabel('Add person').selectOption({ label: 'Kevin Matos' });
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet(page).locator('[data-on-day]')).toHaveCount(1);
  await expect(crew).toHaveCount(1);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  await expect(sheet(page).locator('[data-on-day]')).toHaveCount(2);
  await expect(sheet(page).locator('[data-sheet-cast]')).toHaveCount(1);
  await expect(days.locator('[data-day-editor]')).toContainText('Crew · 0 of 2 confirmed');

  // Take one off and see them gone from Crew; adding them back brings them back.
  await sheet(page).getByRole('button', { name: /^Take off Kevin Matos/ }).click();
  await expect(sheet(page).locator('[data-on-day]')).toHaveCount(1);
  await expect(crew).toHaveCount(0);
  // Focus goes to the next row's Take off, not to the page.
  await expect(sheet(page).getByRole('button', { name: /^Take off Ana Ruiz/ })).toBeFocused();
  await expect(days.locator('[data-day-editor]')).toContainText('Crew · 0 of 1 confirmed');
  await sheet(page).getByLabel('Add person').selectOption({ label: 'Kevin Matos' });
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(crew).toHaveCount(1);
  // Everyone is on again, so the Add row is gone: focus goes to the first Take off.
  await expect(sheet(page).getByRole('button', { name: /^Take off/ }).first()).toBeFocused();

  // Passing through a member's call while the department's lands stores nothing of his own: he goes on following it.
  await field('Call, Camera').fill('06:45');
  await field('Call, Kevin Matos').focus();
  await expect(field('Call, Kevin Matos')).toHaveValue('06:45');
  await field('Call, Kevin Matos').blur();
  await field('Call, Camera').fill('05:45');
  await field('Call, Camera').blur();
  await expect(field('Call, Kevin Matos')).toHaveValue('05:45');

  // Camera's call, a person's own call (the other keeps the department's), and the cast's three times.
  await field('Call, Camera').fill('06:30');
  await field('Call, Camera').blur();
  await expect(field('Call, Kevin Matos')).toHaveValue('06:30');
  // Clearing a worked-out call has nothing to take off: the call stays on the field.
  await field('Call, Kevin Matos').fill('');
  await field('Call, Kevin Matos').blur();
  await expect(field('Call, Kevin Matos')).toHaveValue('06:30');
  // Typing the call the department gives still sets it as his own: it stays when the department's moves.
  await field('Call, Kevin Matos').fill('06:30');
  await field('Call, Kevin Matos').blur();
  await field('Call, Camera').fill('06:15');
  await sheet(page).getByLabel('Shoot day').focus();
  await expect(field('Call, Camera')).toHaveValue('06:15');
  await expect(field('Call, Kevin Matos')).toHaveValue('06:30');
  // Leaving one time field for another never costs the second its focus when the first one's edit lands.
  await field('Call, Camera').fill('06:20');
  await field('Call, Kevin Matos').click();
  await expect(field('Call, Camera')).toHaveValue('06:20');
  await expect(field('Call, Kevin Matos')).toBeFocused();
  await field('Call, Kevin Matos').fill('08:15');
  await field('Call, Kevin Matos').blur();
  await expect(field('Call, Kevin Matos')).toHaveValue('08:15');
  await field('HMU ready, Ana Ruiz').fill('08:00');
  await field('HMU ready, Ana Ruiz').blur();
  await field('On set, Ana Ruiz').fill('10:30');
  await field('On set, Ana Ruiz').blur();
  await expect(field('Call, Ana Ruiz')).toHaveValue('07:00');

  // The edits have landed once History lists the last (call times show their before and after).
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.locator('[data-tile="history"]').click();
  const history = page.getByRole('region', { name: 'History', exact: true });
  await expect(history).toContainText('Ana Ruiz’s time on set — → 10:30');
  await expect(history).toContainText('Camera’s call');
  await expect(history).toContainText('Kevin Matos’s call');
  await expect(history).toContainText('Took Kevin Matos off');
  await expect(history).not.toContainText('555');

  // ⌘Z with a time field focused shows the undone time at once, and leaving the field doesn't put it back.
  await field('On set, Ana Ruiz').fill('11:00');
  await field('On set, Ana Ruiz').blur();
  await expect(history).toContainText('Ana Ruiz’s time on set 10:30 → 11:00');
  await field('On set, Ana Ruiz').focus();
  await page.keyboard.press(await undoKey(page));
  await expect(field('On set, Ana Ruiz')).toHaveValue('10:30');
  await field('On set, Ana Ruiz').blur();

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await expect(field('Call, Camera')).toHaveValue('06:20');
  await expect(field('Call, Kevin Matos')).toHaveValue('08:15');
  await expect(field('HMU ready, Ana Ruiz')).toHaveValue('08:00');
  await expect(field('On set, Ana Ruiz')).toHaveValue('10:30');

  // Contacts: Kevin's phone prints (crew), Ana's does not (cast) until her switch is turned on, and again off.
  await expect(sheet(page).locator('[data-sheet-department="camera"]')).toContainText('555 0102');
  const cast = sheet(page).locator('[data-sheet-cast]');
  await expect(cast).not.toContainText('555 0101');
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  await people.locator('[data-person-id]').filter({ hasText: 'Ana Ruiz' }).click();
  const contact = people.getByRole('switch', { name: 'Phone and email on call sheets' });
  await expect(contact).toHaveAttribute('aria-checked', 'false');
  await contact.click();
  await expect(contact).toHaveAttribute('aria-checked', 'true');
  await expect(cast).toContainText('555 0101');
  await contact.click();
  await expect(cast).not.toContainText('555 0101');
  await people.locator('[data-person-id]').filter({ hasText: 'Kevin Matos' }).click();
  await expect(contact).toHaveAttribute('aria-checked', 'true');

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);

  // One ⌘Z takes the last time edit back.
  await field('On set, Ana Ruiz').fill('11:00');
  await field('On set, Ana Ruiz').blur();
  await expect(field('On set, Ana Ruiz')).toHaveValue('11:00');
  await sheet(page).getByLabel('Shoot day').focus();
  await page.keyboard.press(await undoKey(page));
  await expect(field('On set, Ana Ruiz')).toHaveValue('10:30');
  await expect(field('HMU ready, Ana Ruiz')).toHaveValue('08:00');
});

test('sun times: a note without a place, then sunrise and sunset in the location’s zone, which can be changed (4.3)', async ({ page }) => {
  await setUp(page);
  const locations = page.getByRole('region', { name: 'Locations', exact: true });
  const editor = locations.locator('[data-location-editor]');
  const sun = sheet(page).locator('[data-sheet-location] [data-sun]');

  // No place on the map: the sheet says so and guesses nothing from the address text.
  await expect(sheet(page).locator('[data-sun-note]')).toHaveText('Pick the address on the map for sun times');
  await expect(sun).toHaveCount(0);

  // A place from the address search (the recorded answer), then the Sun block: sunrise, sunset, golden and blue hours.
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Time zone' }).locator('option').first()).toHaveText('From the map: America/New_York');
  await expect(editor.getByText('Time zones from timezone-boundary-builder. Data © OpenStreetMap contributors, ODbL.')).toBeVisible();
  await expect(sun).toBeVisible();
  const clock = /^\d\d:\d\d$/;
  const rise = sun.locator('[data-sun-rise]');
  const set = sun.locator('[data-sun-set]');
  await expect(rise).toHaveText(clock);
  await expect(set).toHaveText(clock);
  await expect(sun.locator('[data-sun-range="golden-morning"]')).toContainText('Morning');
  await expect(sun.locator('[data-sun-range="golden-evening"]')).toContainText(/\d\d:\d\d–\d\d:\d\d/);
  await expect(sun.locator('[data-sun-range="blue-evening"]')).toBeVisible();
  await expect(sun).toContainText('Golden hour');
  await expect(sun.locator('[data-sun-zone]')).toHaveText('Times in America/New_York');
  await expect(sheet(page).locator('[data-times-in]')).toHaveText('Times in America/New_York');
  const before = [await rise.textContent(), await set.textContent()];

  // A different zone chosen on the location moves the times (Tokyo is 14 hours ahead of New York in November).
  await editor.getByRole('combobox', { name: 'Time zone' }).selectOption('Asia/Tokyo');
  await expect(sun.locator('[data-sun-zone]')).toHaveText('Times in Asia/Tokyo');
  await expect(sheet(page).locator('[data-times-in]')).toHaveText('Times in Asia/Tokyo');
  await expect(rise).not.toHaveText(before[0] ?? '');
  await expect(set).not.toHaveText(before[1] ?? '');
  const hour = async (clockText: Promise<string | null>) => Number((await clockText)?.slice(0, 2));
  expect((await hour(rise.textContent()) - Number(before[0]?.slice(0, 2)) + 24) % 24).toBe(14);

  // First option goes back to the zone from the map.
  await editor.getByRole('combobox', { name: 'Time zone' }).selectOption({ index: 0 });
  await expect(sun.locator('[data-sun-zone]')).toHaveText('Times in America/New_York');
  await expect(rise).toHaveText(before[0] ?? '');

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);
});

test.describe('the forecast (4.4)', () => {
  // The region decides the units: this browser's is en-US, so °F, mph and inches until Settings says otherwise.
  test('a location without a place has a note; with one, the recorded forecast, its credit, Refresh, and units that can be switched', async ({ page }) => {
    // The page's clock is set to Nov 16, 2026 (a day before the recorded forecast's days), so the test means the same on
    // any date: 2026-11-17 is a day to come, not one gone by, and the recorded answer's hour of life is counted from it.
    await page.clock.install({ time: new Date('2026-11-16T15:00:00Z') });
    await setUp(page);
    expect(await page.evaluate(() => new Date().toISOString().slice(0, 10))).toBe('2026-11-16');
    const locations = page.getByRole('region', { name: 'Locations', exact: true });
    const editor = locations.locator('[data-location-editor]');
    const weather = sheet(page).locator('[data-sheet-location] [data-weather]');
    const fact = (kind: string) => weather.locator(`[data-weather-fact="${kind}"]`);

    // No place on the map: the note, and no forecast asked or shown.
    await expect(sheet(page).locator('[data-weather-note]')).toHaveText('Pick the address on the map for the forecast');
    await expect(weather).toHaveCount(0);

    await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
    await editor.getByRole('button', { name: 'Search address' }).click();
    await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
    await expect(editor.getByText('On the map')).toBeVisible();

    // The day (2030) is beyond what the recorded forecast reaches, and the credit and the fetch time show.
    await expect(weather.locator('[data-weather-beyond]')).toHaveText('No forecast yet: it reaches as far as Thu, Nov 19');
    await expect(weather.locator('[data-weather-fetched]')).toHaveText(/^Forecast fetched \d\d:\d\d · Data from MET Norway$/);

    // A day the forecast covers (the memory build asks nothing online: it reads the recorded answer).
    const days = page.getByRole('region', { name: 'Shoot days', exact: true });
    const day = days.locator('[data-day-editor]');
    await day.getByLabel('Date').fill('2026-11-17');
    await day.getByLabel('Date').blur();
    await expect(sheet(page)).toContainText('Tuesday, November 17, 2026');
    await expect(fact('high')).toHaveText('65°F');
    await expect(fact('low')).toHaveText('48°F');
    await expect(fact('wind')).toHaveText('10 mph');
    await expect(fact('precipitation')).toHaveText('0.26 in');
    // The call is 07:00 in New York: 12Z, the start of the span that says fair.
    await expect(weather).toContainText('Conditions at 07:00');
    await expect(fact('conditions')).toHaveText('Fair');
    await expect(weather.locator('[data-weather-fetched]')).toContainText('Data from MET Norway');

    // Refresh within the expiry reads what is held and says until when it is good.
    await weather.getByRole('button', { name: 'Refresh forecast' }).click();
    await expect(weather.locator('[data-weather-up-to-date]')).toHaveText(/^Up to date until \d\d:\d\d$/);

    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);

    // Settings → App → Weather units: Metric reads °C, km/h and mm, and By this computer's region brings the US back.
    const app = await openSettings(page, 'App');
    const units = app.getByLabel('Weather units');
    await expect(units).toHaveValue('region');
    await units.selectOption('metric');
    await closeSettings(page);
    await expect(fact('high')).toHaveText('18°C');
    await expect(fact('low')).toHaveText('9°C');
    await expect(fact('wind')).toHaveText('16 km/h');
    await expect(fact('precipitation')).toHaveText('6.5 mm');
    await openSettings(page, 'App');
    await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Weather units').selectOption('region');
    await closeSettings(page);
    await expect(fact('high')).toHaveText('65°F');
  });
});

test('the nearest hospital: Find needs a place, the list is recorded, the safety box prints the number and the hospital, Clear takes it off (4.5)', async ({ page }) => {
  await setUp(page);
  const locations = page.getByRole('region', { name: 'Locations', exact: true });
  const editor = locations.locator('[data-location-editor]');
  const find = editor.getByRole('button', { name: 'Find nearest hospital' });
  const safety = sheet(page).locator('[data-sheet-location] [data-safety]');
  const number = safety.locator('[data-emergency-number]');

  // No place on the map: Find is disabled and says why; the safety box says what is missing.
  await expect(find).toBeDisabled();
  await expect(editor.getByText('Search the address and pick a place first: the hospital is looked for around it.')).toBeVisible();
  await expect(number).toHaveText('Emergency number: check locally');
  await expect(safety.locator('[data-hospital-none]')).toHaveText('No hospital set: find one on the location');

  // A place from the address search (recorded), then Find: the recorded hospitals, emergency departments first, each with
  // its distance (miles: this browser's region is the US) and the check note when the emergency room is not known.
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  await expect(find).toBeEnabled();
  await find.click();
  await expect(editor.locator('[data-hospital-finder] [role="status"]')).toHaveText('5 hospitals found.');
  const options = editor.getByRole('list', { name: 'Hospitals found' }).locator('[data-hospital-option]');
  await expect(options).toHaveCount(5);
  await expect(options.first()).toContainText('Hospital EsSalud Adolfo Guevara Velasco');
  await expect(options.first()).toContainText(/\d\.\d mi/);
  await expect(options.first()).toContainText('24-hour emergency room');
  await expect(options.nth(3)).toContainText('Check it has a 24-hour emergency room');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Locations"]').withTags(tags).analyze()).violations).toEqual([]);

  // Picking the first is the edit: the hospital and its country (Peru: 106) are on the location, and on the sheet.
  await options.first().click();
  await expect(options).toHaveCount(0);
  await expect(find).toBeFocused();
  await expect(editor.getByRole('textbox', { name: 'Hospital', exact: true })).toHaveValue('Hospital EsSalud Adolfo Guevara Velasco');
  await expect(editor.getByRole('textbox', { name: 'Hospital phone' })).toHaveValue('+51 84 223 691');
  await expect(editor.getByRole('combobox', { name: 'Country' })).toHaveValue('PE');
  await expect(editor.locator('[data-hospital-finder] [data-emergency-number]')).toHaveText('Emergency number: 106');
  await expect(number).toHaveText('106');
  await expect(safety.locator('[data-hospital]')).toContainText('Hospital EsSalud Adolfo Guevara Velasco');
  await expect(safety.locator('[data-hospital]')).toContainText('+51 84 223 691');
  await expect(safety.locator('[data-hospital-distance]')).toHaveText(/^\d\.\d mi$/);
  await expect(safety.locator('[data-hospital-emergency]')).toHaveText('24-hour emergency room');
  await expect(safety.locator('[data-hospital-credit]')).toHaveText('© OpenStreetMap contributors');
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);

  // One ⌘Z takes the whole pick back, the country with it.
  await find.focus();
  await page.keyboard.press(await undoKey(page));
  await expect(safety.locator('[data-hospital-none]')).toBeVisible();
  await expect(number).toHaveText('Emergency number: check locally');
  await page.keyboard.press(`${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+Shift+z`);
  await expect(safety.locator('[data-hospital]')).toContainText('Hospital EsSalud Adolfo Guevara Velasco');

  // A new name typed after a pick may be another hospital: the address, phone and credit stay, but the emergency room
  // and the distance (OpenStreetMap's facts about the old one) go, and the sheet says to check.
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).fill('EsSalud Guevara Velasco');
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).blur();
  await expect(safety.locator('[data-hospital]')).toContainText('EsSalud Guevara Velasco');
  await expect(safety.locator('[data-hospital]')).toContainText('+51 84 223 691');
  await expect(safety.locator('[data-hospital]')).toContainText('Avenida Collasuyo');
  await expect(safety.locator('[data-hospital-emergency]')).toHaveCount(0);
  await expect(safety.locator('[data-hospital-check]')).toHaveText('▲ Check it has a 24-hour emergency room');
  await expect(safety.locator('[data-hospital-distance]')).toHaveCount(0);
  await expect(safety.locator('[data-hospital-credit]')).toHaveText('© OpenStreetMap contributors');

  // Clear hospital takes the hospital off in one edit; the country stays. The search is saved, so Find shows it at once.
  await editor.getByRole('button', { name: 'Clear hospital' }).click();
  await expect(safety.locator('[data-hospital-none]')).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Hospital', exact: true })).toHaveValue('');
  await expect(number).toHaveText('106');
  await find.click();
  await expect(editor.locator('[data-hospital-finder] [role="status"]')).toContainText('5 hospitals found. From the search saved');
  await editor.getByRole('button', { name: 'Find again' }).click();
  await expect(editor.locator('[data-hospital-finder] [role="status"]')).toHaveText('5 hospitals found.');

  // By hand: a name and a country with two numbers. No credit for a hospital nobody searched for, and the check note.
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).fill('Posta Local');
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).blur();
  await editor.getByRole('combobox', { name: 'Country' }).selectOption('GB');
  await expect(number).toHaveText('999 or 112');
  await expect(safety.locator('[data-hospital]')).toContainText('Posta Local');
  await expect(safety.locator('[data-hospital-check]')).toHaveText('▲ Check it has a 24-hour emergency room');
  await expect(safety.locator('[data-hospital-credit]')).toHaveCount(0);
  await expect(safety.locator('[data-hospital-distance]')).toHaveCount(0);
  await editor.getByRole('combobox', { name: 'Country' }).selectOption('');
  await expect(number).toHaveText('Emergency number: check locally');
});

/** Each page's text in an exported PDF, as a reader finds it. */
async function pdfText(path: string): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await pdf.destroy();
  return texts.join(' ').replace(/\s+/g, ' ');
}

test('Export PDF writes the day’s sheet: its words, the directions link for the app chosen, A4 on request, a map link to copy (4.6)', async ({ page }) => {
  await setUp(page);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  // A place and a hospital for the location, from the recorded searches.
  const editor = page.getByRole('region', { name: 'Locations', exact: true }).locator('[data-location-editor]');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await editor.getByRole('button', { name: 'Find nearest hospital' }).click();
  await editor.getByRole('list', { name: 'Hospitals found' }).locator('[data-hospital-option]').first().click();
  await expect(sheet(page).locator('[data-safety] [data-hospital]')).toContainText('Hospital EsSalud Adolfo Guevara Velasco');
  // A call typed and Export pressed with no other step between: the click is what blurs the box and starts the save, and
  // the PDF still has the new time.
  await sheet(page).getByLabel('Call, Ana Ruiz', { exact: true }).fill('09:15');

  // The paper starts on this browser's region (en-US: Letter), and the file is named for the project, day and date.
  await expect(sheet(page).getByLabel('Paper')).toHaveValue('region');
  await expect(sheet(page).getByLabel('Paper').locator('option').first()).toHaveText('By region (Letter)');
  const first = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Export PDF…' }).click();
  const letter = await first;
  expect(letter.suggestedFilename()).toBe('Bey County — Call sheet — Day 1 — 2030-11-16.pdf');
  await expect(page.getByRole('status').getByText(/^Exported the call sheet to “Bey County — Call sheet — Day 1 — 2030-11-16\.pdf”\.$/)).toBeVisible();
  const path = await letter.path();
  expect((await PDFDocument.load(readFileSync(path))).getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  const text = await pdfText(path);
  const coordinates = /(-?\d+\.\d{6}), (-?\d+\.\d{6})/.exec(text);
  expect(coordinates).not.toBeNull();
  for (const expected of [
    'Bey County',
    'Day 1 of 1',
    'Saturday, November 16, 2030',
    '07:00',
    'Plaza de Armas, Cusco',
    'Lot behind the diner',
    'Ana Ruiz',
    '09:15',
    'Kevin Matos',
    'Hospital EsSalud Adolfo Guevara Velasco',
    '106',
    'Made with Storiiboard',
    '© OpenStreetMap contributors',
  ]) {
    expect(text, expected).toContain(expected);
  }
  // Google Maps by default, from the place's coordinates; a person's phone prints only where their record allows it.
  expect(text).toContain(`https://www.google.com/maps/dir/?api=1&destination=${coordinates?.[1] ?? ''},${coordinates?.[2] ?? ''}`);
  expect(text).toContain('555 0102');
  expect(text).not.toContain('555 0101');

  // A4 on request, and it is kept: the choice is this computer's.
  await sheet(page).getByLabel('Paper').selectOption('a4');
  const second = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Export PDF…' }).click();
  const { width, height } = (await PDFDocument.load(readFileSync(await (await second).path()))).getPage(0).getSize();
  expect(Math.round(width)).toBe(595);
  expect(Math.round(height)).toBe(842);

  // Settings → App → Directions open in: Apple Maps changes the link, in the PDF and in Copy map link.
  const app = await openSettings(page, 'App');
  await expect(app.getByLabel('Directions open in')).toHaveValue('google');
  await app.getByLabel('Directions open in').selectOption('apple');
  await closeSettings(page);
  const third = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Export PDF…' }).click();
  const apple = await pdfText(await (await third).path());
  expect(apple).toContain(`https://maps.apple.com/?daddr=${coordinates?.[1] ?? ''},${coordinates?.[2] ?? ''}`);
  expect(apple).not.toContain('google.com');
  await sheet(page).getByRole('button', { name: /^Copy map link/ }).click();
  await expect(page.locator('[data-notice]')).toContainText(/Copied a map link for this location\.|https:\/\/maps\.apple\.com\/\?daddr=/);
  // The Locations tile's button gives the same link; its Open on the map keeps the OpenStreetMap pin.
  await editor.getByRole('button', { name: 'Copy map link', exact: true }).click();
  await expect(page.locator('[data-notice]')).toContainText(/Copied a map link for this location\.|https:\/\/maps\.apple\.com\/\?daddr=/);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);
});

test('Issue keeps the PDF as sent, locks the day’s scenes, says when the sheet changed, and one ⌘Z takes an issue back (4.7)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await setUp(page);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  const issue = sheet(page).locator('[data-issue-button]');
  const status = sheet(page).locator('[data-issue-status]');
  await expect(issue).toHaveText('Issue');
  await expect(sheet(page).locator('[data-issued-versions]')).toHaveCount(0);

  // The scene isn't locked until the sheet is issued.
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  const lock = page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Lock shot numbers for SC 01' });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();

  await issue.click();
  await expect(status).toHaveText('Issued · v1');
  await expect(issue).toBeDisabled();
  await expect(sheet(page).locator('[data-issue-reason]')).toHaveText('Nothing has changed since version 1');
  const rows = sheet(page).locator('[data-issue-row]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/^v1 · Issued \w{3}, \w{3} \d{1,2} \d\d:\d\d \S+/);

  // The scene is locked, in the Scenes tile.
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await sidebar(page).getByRole('button', { name: /^Production/ }).click();

  // The issued PDF as sent: version 1, not "Revised", and the call as it was.
  const first = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Save a copy of version 1' }).click();
  const v1 = await first;
  expect(v1.suggestedFilename()).toBe('Bey County — Call sheet — Day 1 — 2030-11-16.pdf');
  const v1Bytes = readFileSync(await v1.path());
  const v1Text = await pdfText(await v1.path());
  expect(v1Text).toMatch(/Version 1 · Issued \w{3}, \w{3} \d{1,2} \d\d:\d\d \S+/);
  expect(v1Text).not.toContain('Revised');
  expect(v1Text).not.toContain('09:15');
  // What was saved is what was stored: its SHA-256 is the media record's `file`.
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  await expect(sheet(page).locator('[data-issue-row="1"]')).toHaveAttribute('data-issue-file', sha(v1Bytes));

  // A call changed: the sheet says so, and the button offers the next version.
  await sheet(page).getByLabel('Call, Ana Ruiz', { exact: true }).fill('09:15');
  await sheet(page).getByLabel('Call, Ana Ruiz', { exact: true }).blur();
  await expect(status).toHaveText('▲ Changed since issued (v1)');
  await expect(issue).toHaveText('Issue version 2');
  await expect(issue).toBeEnabled();

  // Version 1 stays as it was sent, byte for byte, whatever the sheet says now.
  const again = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Save a copy of version 1' }).click();
  expect(readFileSync(await (await again).path()).equals(v1Bytes)).toBe(true);

  await issue.click();
  await expect(status).toHaveText('Issued · v2');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(/^v2 · Issued /);
  const second = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Save a copy of version 2' }).click();
  const v2 = await second;
  expect(v2.suggestedFilename()).toBe('Bey County — Call sheet — Day 1 — 2030-11-16 v2.pdf');
  const v2Text = await pdfText(await v2.path());
  expect(v2Text).toContain('Revised');
  expect(v2Text).toMatch(/Version 2 · Issued /);
  expect(v2Text).toContain('09:15');
  await expect(sheet(page).locator('[data-issue-row="2"]')).toHaveAttribute('data-issue-file', sha(readFileSync(await v2.path())));

  // History: one line for the whole issue.
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.locator('[data-tile="history"]').click();
  await expect(page.getByRole('region', { name: 'History', exact: true })).toContainText('Issued the call sheet for Sat, Nov 16 (version 2)');

  // One ⌘Z takes version 2 off; the warning comes back, and the next number is 2 again.
  await sheet(page).getByLabel('Shoot day').focus();
  await page.keyboard.press(await undoKey(page));
  await expect(rows).toHaveCount(1);
  await expect(status).toHaveText('▲ Changed since issued (v1)');
  await expect(issue).toHaveText('Issue version 2');

  // ⌘⇧Z brings version 2 back, with its stored PDF.
  await page.keyboard.press(`${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+Shift+z`);
  await expect(rows).toHaveCount(2);
  await expect(status).toHaveText('Issued · v2');
  const third = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Save a copy of version 2' }).click();
  expect(sha(readFileSync(await (await third).path()))).toBe(sha(readFileSync(await v2.path())));

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

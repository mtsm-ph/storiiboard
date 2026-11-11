import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { decodePDFRawStream, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { answerAsk } from './ask';
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
  await expect(editor.locator('[data-hospital-finder] [data-emergency-number]')).toHaveText('Ambulance 106');
  await expect(number).toHaveText('Ambulance 106');
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
  await expect(number).toHaveText('Ambulance 106');
  await find.click();
  await expect(editor.locator('[data-hospital-finder] [role="status"]')).toContainText('5 hospitals found. From the search saved');
  await editor.getByRole('button', { name: 'Find again' }).click();
  await expect(editor.locator('[data-hospital-finder] [role="status"]')).toHaveText('5 hospitals found.');

  // By hand: a name and a country with two numbers. No credit for a hospital nobody searched for, and the check note.
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).fill('Posta Local');
  await editor.getByRole('textbox', { name: 'Hospital', exact: true }).blur();
  await editor.getByRole('combobox', { name: 'Country' }).selectOption('GB');
  await expect(number).toHaveText('Emergency 999 or 112');
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
    'Ambulance 106',
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

test('the location block shows its place on a map (the browser grid, with its credit), and Export PDF holds the map frame and credit (4.10)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await setUp(page);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  // No place yet: no map on the sheet.
  await expect(sheet(page).locator('[data-sheet-location]')).toHaveCount(1);
  await expect(sheet(page).locator('[data-sheet-map]')).toHaveCount(0);

  const editor = page.getByRole('region', { name: 'Locations', exact: true }).locator('[data-location-editor]');
  await editor.getByRole('textbox', { name: 'Address', exact: true }).fill('Plaza de Armas, Cusco');
  await editor.getByRole('button', { name: 'Search address' }).click();
  await editor.getByRole('list', { name: 'Places found' }).getByRole('button').first().click();
  await expect(editor.getByText('On the map')).toBeVisible();

  // A read-only map: the grid of a browser build, the pin's canvas and the credit, and none of the editor's controls.
  const map = sheet(page).locator('[data-sheet-map]');
  await expect(map).toHaveCount(1);
  await expect(map.locator('canvas').first()).toBeVisible();
  await expect(map.locator('[data-sheet-map-credit]')).toHaveText('© OpenStreetMap contributors');
  await expect(map.getByText('Map tiles show in the desktop app')).toBeVisible();
  await expect(map.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Move pin' })).toHaveCount(0);
  const box = await map.locator('canvas').first().boundingBox();
  expect(box?.height).toBe(160);

  const download = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Export PDF…' }).click();
  const text = await pdfText(await (await download).path());
  // The frame's own words (the grid's marker in a browser build) and the credit under it, besides the footer's.
  expect(text).toContain('Map tiles show in the desktop app');
  expect(text.split('© OpenStreetMap contributors').length - 1).toBeGreaterThanOrEqual(2);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-sheet-map]').withTags(tags).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

for (const fallback of [false, true]) {
test(`the map picture is composed from the frame’s tiles on a canvas into one JPEG that is far smaller than the tiles themselves (4.10)${fallback ? ', with no OffscreenCanvas (macOS 13.0 to 13.2): the <canvas> fallback' : ''}`, async ({ page }, testInfo) => {
  if (fallback) {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'OffscreenCanvas');
    });
  }
  await page.goto('/?files=memory');
  // Tiles drawn like a street map (blocks, roads, a label) as PNG; the first sent as WebP and the second as JPEG, which the
  // browser decodes just the same. Then the module under test makes the picture from them.
  const made = await page.evaluate(async () => {
    const load = async (path: string) => (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    const { composeMap } = (await load('/src/features/callsheets/composeMap.ts')) as {
      composeMap: (place: { latitude: number; longitude: number }, tiles: Map<string, Uint8Array>) => Promise<Uint8Array | null>;
    };
    const { mapTilesFor, tileKey } = (await load('/src/features/callsheets/sheetMap.ts')) as {
      mapTilesFor: (place: { latitude: number; longitude: number }) => { z: number; x: number; y: number; left: number }[];
      tileKey: (tile: { z: number; x: number; y: number }) => string;
    };
    const { makeCanvas, canvasBlob } = (await load('/src/core/media/canvas.ts')) as {
      makeCanvas: (w: number, h: number) => { canvas: unknown; ctx: CanvasRenderingContext2D | null };
      canvasBlob: (canvas: unknown, type: string, quality?: number) => Promise<Blob | null>;
    };
    const blobOf = async (canvas: unknown, type: string) => {
      const blob = await canvasBlob(canvas, type);
      if (!blob) throw new Error('no encoder');
      return blob;
    };
    const place = { latitude: -13.5167674, longitude: -71.9787787 };
    const tiles = mapTilesFor(place);
    const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
    const drawTile = async (n: number, type: string) => {
      const { canvas, ctx: g } = makeCanvas(256, 256);
      if (!g) throw new Error('no canvas');
      // Solid colour all over, so a seam or a missing edge shows as white; roads and blocks over it.
      g.fillStyle = 'rgb(200, 60, 60)';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = 'rgb(240, 235, 225)';
      for (let i = 0; i < 6; i += 1) g.fillRect(10 + ((i * 41 + n * 17) % 200), 12 + ((i * 53 + n * 29) % 200), 38, 26);
      g.strokeStyle = 'rgb(255, 255, 255)';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, 80 + n * 9);
      g.lineTo(256, 120 - n * 7);
      g.moveTo(90 + n * 5, 0);
      g.lineTo(130, 256);
      g.stroke();
      g.fillStyle = 'rgb(40, 40, 40)';
      g.font = '12px sans-serif';
      g.fillText('Calle del Sol ' + String(n), 20, 200);
      return bytesOf(await blobOf(canvas, type));
    };
    const pngs = new Map<string, Uint8Array>();
    const mixed = new Map<string, Uint8Array>();
    for (const [n, tile] of tiles.entries()) {
      pngs.set(tileKey(tile), await drawTile(n, 'image/png'));
      mixed.set(tileKey(tile), await drawTile(n, n === 0 ? 'image/webp' : n === 1 ? 'image/jpeg' : 'image/png'));
    }
    const jpeg = await composeMap(place, pngs);
    const fromMixed = await composeMap(place, mixed);
    const fromNone = await composeMap(place, new Map());
    const fromBroken = await composeMap(place, new Map([[tileKey(tiles[0] ?? { z: 0, x: 0, y: 0 }), new Uint8Array([1, 2, 3])]]));
    if (!jpeg || !fromMixed) throw new Error('no picture');
    // The same frame from plain red tiles, so that anything not covered shows as white.
    const { canvas: solidTile, ctx: solidContext } = makeCanvas(256, 256);
    if (!solidContext) throw new Error('no canvas');
    solidContext.fillStyle = 'rgb(200, 60, 60)';
    solidContext.fillRect(0, 0, 256, 256);
    const solidBytes = await bytesOf(await blobOf(solidTile, 'image/png'));
    const solid = await composeMap(place, new Map(tiles.map((tile) => [tileKey(tile), solidBytes])));
    if (!solid) throw new Error('no picture');
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(solid)]));
    const { ctx: context } = makeCanvas(bitmap.width, bitmap.height);
    if (!context) throw new Error('no canvas');
    context.drawImage(bitmap, 0, 0);
    // Pixels on the joins between tiles (a seam would be white) and in the four corners.
    const joins: number[][] = [];
    for (const tile of tiles) {
      const x = Math.round(tile.left * 2);
      if (x > 2 && x < bitmap.width - 2) joins.push([...context.getImageData(x, 5, 1, 1).data]);
    }
    const corners = [[1, 1], [bitmap.width - 2, 1], [1, bitmap.height - 2], [bitmap.width - 2, bitmap.height - 2]].map(([x, y]) => [...context.getImageData(x ?? 0, y ?? 0, 1, 1).data]);
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    return {
      count: tiles.length,
      width: bitmap.width,
      height: bitmap.height,
      isJpeg: jpeg[0] === 0xff && jpeg[1] === 0xd8,
      mixedIsJpeg: fromMixed[0] === 0xff && fromMixed[1] === 0xd8,
      fromNone,
      fromBroken,
      joins,
      corners,
      jpeg: b64(jpeg),
      pngs: [...pngs.values()].map(b64),
    };
  });
  // About 680 x 454 px for the 60 x 40 mm frame (twice the tile pixels it covers), at most 6 tiles, one JPEG.
  expect(made.width).toBe(680);
  expect(made.height).toBe(454);
  expect(made.count).toBeLessThanOrEqual(6);
  expect(made.isJpeg).toBe(true);
  expect(made.mixedIsJpeg).toBe(true);
  // No tile drawn: nothing to print. A tile that cannot be decoded is not a picture either.
  expect(made.fromNone).toBeNull();
  expect(made.fromBroken).toBeNull();
  // No white seam where tiles meet, and the frame is covered to its corners.
  const notWhite = (pixel: number[]) => (pixel[0] ?? 0) > 150 && (pixel[1] ?? 255) < 140;
  expect(made.joins.every(notWhite)).toBe(true);
  expect(made.corners.every(notWhite)).toBe(true);

  // The file: one composed picture against each tile embedded whole.
  const composed = await PDFDocument.create();
  await composed.embedJpg(Buffer.from(made.jpeg, 'base64'));
  const perTile = await PDFDocument.create();
  for (const png of made.pngs) await perTile.embedPng(Buffer.from(png, 'base64'));
  const composedSize = (await composed.save()).length;
  const perTileSize = (await perTile.save()).length;
  testInfo.annotations.push({ type: 'map sizes', description: `${String(made.count)} tiles embedded whole: ${String(perTileSize)} bytes; one composed JPEG: ${String(composedSize)} bytes` });
  expect(composedSize).toBeLessThan(perTileSize);
});
}

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
  // The sheet has problems (4.8): Issue asks once.
  await answerAsk(page, true);
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
  await answerAsk(page, true);
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

test('the Checks strip says what is likely wrong, links to it, and Issue with problems asks once (4.8)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await setUp(page);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  const checks = sheet(page).locator('[data-checks]');
  const check = (kind: string) => checks.locator(`[data-check="${kind}"]`);
  const days = page.getByRole('region', { name: 'Shoot days', exact: true });
  const editor = page.getByRole('region', { name: 'Locations', exact: true }).locator('[data-location-editor]');

  // The location has an address and parking but no contact; nobody is in Direction, Sound, HMU or Wardrobe.
  await expect(check('location-missing')).toHaveText(/is missing a contact \(name or phone\)Show$/);
  await expect(check('department-missing')).toHaveCount(4);
  await expect(check('department-missing').first()).toContainText('Nobody from Direction is on the day');
  await expect(checks.locator('[data-checks-none]')).toHaveCount(0);

  // Parking taken off: the finding lists it too; typed again, it clears.
  await editor.getByRole('textbox', { name: 'Parking' }).fill('');
  await editor.getByRole('textbox', { name: 'Parking' }).blur();
  await expect(check('location-missing')).toContainText('a contact (name or phone) and a parking note');
  await editor.getByRole('textbox', { name: 'Parking' }).fill('Lot behind the diner');
  await editor.getByRole('textbox', { name: 'Parking' }).blur();
  await expect(check('location-missing')).not.toContainText('parking note');

  // An HMU time 20 minutes after the call is too short for the 45 minutes HMU needs; Show moves focus to the field.
  await expect(check('hmu-too-short')).toHaveCount(0);
  await sheet(page).getByLabel('HMU ready, Ana Ruiz', { exact: true }).fill('07:20');
  await sheet(page).getByLabel('HMU ready, Ana Ruiz', { exact: true }).blur();
  await expect(check('hmu-too-short')).toContainText('HMU too short: Ana Ruiz is ready at 07:20, 20 min after the 07:00 call (HMU needs at least 45 min)');
  await check('hmu-too-short').getByRole('button', { name: /^Show: HMU too short/ }).click();
  await expect(sheet(page).getByLabel('HMU ready, Ana Ruiz', { exact: true })).toBeFocused();

  // The minimum is on the Cast heading: 15 minutes makes 20 enough; the project keeps it across a reload.
  const minutes = sheet(page).getByLabel('HMU needs at least (min)');
  await expect(minutes).toHaveValue('45');
  await minutes.fill('15');
  // Enter commits and keeps focus in the field.
  await minutes.press('Enter');
  await expect(check('hmu-too-short')).toHaveCount(0);
  await expect(minutes).toBeFocused();
  await expect(minutes).toHaveValue('15');
  await minutes.fill('45');
  await minutes.blur();
  await expect(check('hmu-too-short')).toHaveCount(1);
  await sheet(page).getByLabel('HMU ready, Ana Ruiz', { exact: true }).fill('08:00');
  await sheet(page).getByLabel('HMU ready, Ana Ruiz', { exact: true }).blur();
  await expect(check('hmu-too-short')).toHaveCount(0);

  // The Shoot days tile counts the day's checks and opens the call sheet.
  const count = days.locator('[data-day-checks]');
  await expect(count).toHaveText(/▲ 5 checks/);
  await count.click();
  await expect(sheet(page).getByLabel('Shoot day')).toBeFocused();

  // Issue with problems asks once, with how many; Cancel issues nothing.
  const issue = sheet(page).locator('[data-issue-button]');
  await issue.click();
  await expect(page.getByRole('alertdialog')).toContainText('Issue with 5 problems?');
  await answerAsk(page, false);
  await expect(sheet(page).locator('[data-issued-versions]')).toHaveCount(0);
  await expect(issue).toHaveText('Issue');
  await issue.click();
  await answerAsk(page, true);
  await expect(sheet(page).locator('[data-issue-status]')).toHaveText('Issued · v1');

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Call sheet"]').withTags(tags).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('a frame marked Have leaves the call sheet, which says nothing is left to shoot; the Calendar still lists the scene (4.11)', async ({ page }) => {
  await setUp(page);
  await expect(sheet(page).locator('[data-sheet-scene]')).toContainText('SC 01');
  await expect(sheet(page).locator('[data-sheet-location]')).toHaveCount(1);

  // Mark the day's only frame Have, from the Storyboard.
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await page.getByRole('region', { name: 'Storyboard', exact: true }).locator('[data-shot-id]').first().click();
  await page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('radio', { name: 'Have' }).click();

  await sidebar(page).getByRole('button', { name: /^Production/ }).click();
  await expect(sheet(page).locator('[data-sheet-scene]')).toHaveCount(0);
  await expect(sheet(page).locator('[data-sheet-location]')).toHaveCount(0);
  await expect(sheet(page)).toContainText('Nothing left to shoot on this day.');
  await expect(sheet(page)).toContainText('Saturday, November 16, 2030');

  // The Calendar keeps showing the day's scene and location.
  const calendar = page.getByRole('region', { name: 'Calendar', exact: true });
  await expect(calendar.locator('[data-schedule-day]')).toContainText('SC 01');
  await expect(calendar.locator('[data-schedule-day]')).toContainText(/diner/i);
  // Its frame count is need-only, as before.
  await expect(calendar.locator('[data-schedule-day]')).toContainText('0 frames');
});

test('a company attached in Settings → Project prints its name and logo at the top of the sheet and in the PDF (4.12)', async ({ page }) => {
  await setUp(page);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();
  // A profile saved once with a logo, then attached to this project.
  let panel = await openSettings(page, 'App');
  await panel.getByRole('button', { name: 'Add company' }).click();
  const company = panel.getByRole('list', { name: 'Company profiles' }).getByRole('group').first();
  await company.getByRole('textbox', { name: 'Name' }).fill('Zima Blue Pictures');
  await company.getByRole('textbox', { name: 'Website' }).click();
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('group', { name: 'Zima Blue Pictures' }).getByRole('button', { name: 'Choose logo…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect(panel.getByRole('img', { name: 'Logo of Zima Blue Pictures' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  await panel.getByRole('combobox', { name: 'Company', exact: true }).selectOption({ label: 'Zima Blue Pictures' });
  await panel.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(panel.locator('[data-project-company]')).toContainText('The same as its profile on this computer.');
  await closeSettings(page);

  // On screen: the name and a small logo above the title.
  const header = sheet(page).locator('[data-sheet-company]');
  await expect(header).toContainText('Zima Blue Pictures');
  await expect(header.locator('img')).toBeVisible();
  // Where the engine can draw in Display P3 (Chromium, WebView2, Safari), prepareImage stores the logo tagged P3, so the
  // pixel check below really tests the PDF's sRGB redraw; where it can't, the logo is sRGB. The profile's name is
  // written in ASCII or UTF-16 (isTaggedP3 looks for both), and the engine's P3 support is probed as media.spec does.
  const { tagged, engineP3 } = await header.locator('img').evaluate(async (img) => {
    const bytes = new Uint8Array(await (await fetch((img as HTMLImageElement).src)).arrayBuffer());
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
    const probe = new OffscreenCanvas(1, 1).getContext('2d', { colorSpace: 'display-p3' });
    if (!probe) throw new Error('no 2d context');
    probe.fillStyle = 'rgb(255, 0, 0)';
    probe.fillRect(0, 0, 1, 1);
    return {
      tagged: ['Display P3', 'Display P3'.replace(/./g, '\u0000$&')].some((name) => head.includes(name)),
      engineP3: (probe.getImageData(0, 0, 1, 1).data[1] ?? 0) > 20,
    };
  });
  expect(tagged).toBe(engineP3);

  // In the PDF: the name is in its text.
  const download = page.waitForEvent('download');
  await sheet(page).getByRole('button', { name: 'Export PDF…' }).click();
  const path = await (await download).path();
  expect(await pdfText(path)).toContain('ZIMA BLUE PICTURES');

  // The logo in the PDF was redrawn in sRGB: a pixel of the picture is the fixture's own colour (200, 80, 40), not the
  // P3 numbers read as sRGB (which print shifted).
  const pdf = await PDFDocument.load(readFileSync(path));
  const images = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [object] : []));
  // The logo is the Flate-encoded RGB picture (a map, if one is ever drawn here, is a JPEG: DCTDecode).
  const logo = images.find((image) => image.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB') && image.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode'));
  if (!logo) throw new Error('no logo picture in the PDF');
  const width = (logo.dict.get(PDFName.of('Width')) as PDFNumber).asNumber();
  const height = (logo.dict.get(PDFName.of('Height')) as PDFNumber).asNumber();
  const rgb = decodePDFRawStream(logo).decode();
  const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
  const [red = 0, green = 0, blue = 0] = rgb.subarray(at, at + 3);
  expect(Math.abs(red - 200)).toBeLessThanOrEqual(8);
  expect(Math.abs(green - 80)).toBeLessThanOrEqual(8);
  expect(Math.abs(blue - 40)).toBeLessThanOrEqual(8);
});

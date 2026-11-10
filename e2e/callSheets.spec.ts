import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The call sheet (4.1) in the memory build: a project with a scene at a location, a character cast, a crew member and
// a shoot day with the scene's frames; the Production workspace's Call sheet tile shows the day, the location, the
// scene with its character and actor, the cast and the crew; a general note is kept across a reload, and one ⌘Z takes
// it off.

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const sheet = (page: Page) => page.getByRole('region', { name: 'Call sheet', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a day’s call sheet is built from the project, and its note survives a reload and takes one ⌘Z', async ({ page }) => {
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
  await locations.locator('[data-location-editor]').getByRole('textbox', { name: 'Address' }).fill('12 Route 9, Bey County');
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
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await person.getByRole('button', { name: 'Camera', exact: true }).click();

  // A shoot day with the scene's frame.
  const days = page.getByRole('region', { name: 'Shoot days', exact: true });
  const day = days.locator('[data-day-editor]');
  await days.getByRole('button', { name: '+ New day' }).click();
  await day.getByLabel('Date').fill('2030-11-16');
  await day.getByLabel('Date').blur();
  await day.getByLabel('Call').fill('07:00');
  await day.getByLabel('Call').blur();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();

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

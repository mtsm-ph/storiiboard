import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Camera bodies and lenses (6.1) in the memory build: a body from the table of camera modes, its width typed over by
// hand; a prime and an anamorphic zoom; each picked on a frame, the Inspector reading out the field of view the
// project's frame sees (Kevin's figures, decision 6); a focal length outside the zoom's range refused; the lens to the
// Trash and the frame reading "No lens picked"; all there after a reload; and the Gear tile from the keyboard.

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
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(1);
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const editor = (page: Page) => gear(page).locator('[data-gear-editor]');
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const lensChoice = (page: Page) => inspector(page).getByRole('combobox', { name: 'Lens', exact: true });
const lensMm = (page: Page) => inspector(page).getByRole('textbox', { name: 'Lens (mm)', exact: true });
const fieldOfView = (page: Page) => inspector(page).locator('[data-field-of-view]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;
const rangeQuestion = (page: Page) => page.getByRole('alertdialog', { name: 'Change the focal range?' });

async function newItem(page: Page, name: string, kind: 'Camera body' | 'Lens') {
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await editor(page).getByRole('radio', { name: kind, exact: true }).click();
  await expect(editor(page).getByRole('radio', { name: kind, exact: true })).toHaveAttribute('aria-checked', 'true');
}

async function setAspect(page: Page, aspect: string) {
  const tile = await openSettings(page, 'Project');
  await tile.getByLabel('Aspect ratio').selectOption(aspect);
  await closeSettings(page);
}

async function fill(page: Page, label: string, value: string) {
  const field = editor(page).getByRole('textbox', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
}

async function openFrame(page: Page) {
  await toSection(page, 'Storyboard');
  await storyboard(page).locator('[data-shot-id]').first().click();
  await expect(lensChoice(page)).toBeVisible();
}

test('a body from the table, a prime and an anamorphic zoom, each picked on a frame with its field of view; kept after a reload', async ({ page }) => {
  await setAspect(page, '2.39:1');
  // With no body yet, the Inspector says where to add one.
  await openFrame(page);
  await expect(fieldOfView(page)).toContainText('Add a camera body in Gear to see the field of view.');
  await expect(lensChoice(page).locator('option:checked')).toHaveText('No lens picked');

  await toSection(page, 'Production');
  await newItem(page, 'FX3', 'Camera body');
  await editor(page).getByLabel('Camera and recording mode').selectOption({ label: 'Sony FX3: Full frame 16:9, 35.6 × 20 mm' });
  await expect(editor(page).getByRole('textbox', { name: 'Recording mode', exact: true })).toHaveValue('Full frame 16:9');
  await expect(editor(page).getByRole('textbox', { name: 'Sensor width (mm)', exact: true })).toHaveValue('35.6');
  await expect(editor(page).getByRole('textbox', { name: 'Sensor height (mm)', exact: true })).toHaveValue('20');
  await expect(editor(page).getByLabel('Camera letter').locator('option:checked')).toHaveText('A cam');
  // Typed over by hand: kept as typed, and the choice says so.
  await fill(page, 'Sensor width (mm)', '35.9');
  await expect(editor(page).getByRole('textbox', { name: 'Sensor width (mm)', exact: true })).toHaveValue('35.9');
  await expect(editor(page).getByLabel('Camera and recording mode').locator('option:checked')).toHaveText('Typed by hand');
  await expect(editor(page).getByRole('textbox', { name: 'Recording mode', exact: true })).toHaveValue('Full frame 16:9');
  // A size the field can't take is refused, and the typed one stays.
  await fill(page, 'Sensor width (mm)', '0');
  await expect(editor(page).getByRole('textbox', { name: 'Sensor width (mm)', exact: true })).toHaveValue('35.9');
  await fill(page, 'Sensor width (mm)', '35.6');
  await expect(editor(page).getByLabel('Camera and recording mode').locator('option:checked')).toHaveText('Sony FX3: Full frame 16:9, 35.6 × 20 mm');

  // A spherical prime.
  await newItem(page, 'Cooke S4', 'Lens');
  await fill(page, 'Focal length (mm)', '24');
  // An anamorphic zoom, 2×.
  await newItem(page, 'Angénieux Optimo', 'Lens');
  await editor(page).getByRole('radio', { name: 'Zoom', exact: true }).click();
  await fill(page, 'To (mm)', '72');
  await fill(page, 'From (mm)', '30');
  // From longer than To is refused.
  await fill(page, 'From (mm)', '80');
  await expect(editor(page).getByRole('textbox', { name: 'From (mm)', exact: true })).toHaveValue('30');
  await editor(page).getByRole('combobox', { name: 'Squeeze', exact: true }).selectOption('2');
  const list = gear(page).getByRole('list', { name: 'Gear' });
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toContainText('30–72 mm 2×');
  await expect(list.getByRole('button', { name: /^FX3/ })).toContainText('A cam');
  const results = await new AxeBuilder({ page }).include('[aria-label="Gear"]').analyze();
  expect(results.violations).toEqual([]);

  // The zoom on the frame: it takes the wide end, then 50 mm inside the range; 51.1°, not the 70.9° of the whole sensor.
  await openFrame(page);
  await expect(fieldOfView(page)).toContainText('Type a focal length to see the field of view.');
  await lensChoice(page).selectOption({ label: 'Angénieux Optimo · 30–72 mm 2×' });
  await expect(lensMm(page)).toHaveValue('30');
  await lensMm(page).fill('50');
  await lensMm(page).press('Enter');
  await expect(fieldOfView(page)).toContainText('51.1° · 47.8 mm of 35.6 × 20.0');
  // Outside the zoom's range: refused in the field, never saved.
  await lensMm(page).fill('100');
  await lensMm(page).press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('This lens goes from 30 to 72 mm.');
  await expect(lensMm(page)).toHaveValue('50');
  const inInspector = await new AxeBuilder({ page }).include('[data-inspector]').analyze();
  expect(inInspector.violations).toEqual([]);
  // With a lens picked, the focal length can't be emptied: the field shows it again.
  await lensMm(page).fill('');
  await lensMm(page).press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('This lens goes from 30 to 72 mm.');
  await expect(lensMm(page)).toHaveValue('50');

  // A shorter range would leave the frame outside it: asked first. Said no to, nothing changes.
  await toSection(page, 'Production');
  await list.getByRole('button', { name: /^Angénieux Optimo/ }).click();
  await fill(page, 'To (mm)', '40');
  await expect(rangeQuestion(page)).toContainText('1 frame uses this lens outside 30–40 mm. It will be set to 40 mm.');
  await rangeQuestion(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(rangeQuestion(page)).toHaveCount(0);
  await expect(editor(page).getByRole('textbox', { name: 'To (mm)', exact: true })).toHaveValue('72');
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toContainText('30–72 mm 2×');
  // Made a prime: asked too; said no to, it stays a zoom.
  await editor(page).getByRole('radio', { name: 'Prime', exact: true }).click();
  await expect(rangeQuestion(page)).toContainText('1 frame uses this lens at another focal length. It will be set to 30 mm.');
  await rangeQuestion(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page).getByRole('radio', { name: 'Zoom', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toContainText('30–72 mm 2×');
  // Said yes to: the range and the frame change together.
  await fill(page, 'To (mm)', '40');
  await rangeQuestion(page).getByRole('button', { name: 'Change the range' }).click();
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toContainText('30–40 mm 2×');
  await openFrame(page);
  await expect(lensMm(page)).toHaveValue('40');
  // One undo brings back both.
  await page.keyboard.press(await undoKey(page));
  await expect(lensMm(page)).toHaveValue('50');
  await toSection(page, 'Production');
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toContainText('30–72 mm 2×');

  // The zoom to the Trash: the frame reads "No lens picked", squeeze 1, its focal length kept.
  await list.getByRole('button', { name: /^Angénieux Optimo/ }).click();
  await editor(page).getByRole('button', { name: 'Delete item' }).click();
  await expect(list.getByRole('button', { name: /^Angénieux Optimo/ })).toHaveCount(0);
  await openFrame(page);
  await expect(lensChoice(page).locator('option:checked')).toHaveText('No lens picked');
  await expect(lensChoice(page).locator('option')).toHaveText(['No lens picked', 'Cooke S4 · 24 mm']);
  await expect(lensMm(page)).toHaveValue('50');
  await expect(fieldOfView(page)).toContainText('35.6 × 20.0');
  // Brought back by undo: the frame kept its lens, so it shows it again.
  await page.keyboard.press(await undoKey(page));
  await expect(lensChoice(page).locator('option:checked')).toHaveText('Angénieux Optimo · 30–72 mm 2×');
  await expect(fieldOfView(page)).toContainText('51.1° · 47.8 mm of 35.6 × 20.0');

  // A 9:16 frame and the 24 mm prime: 26.4° on 11.25 mm of the width.
  await setAspect(page, '9:16');
  await lensChoice(page).selectOption({ label: 'Cooke S4 · 24 mm' });
  await expect(lensMm(page)).toHaveValue('24');
  await expect(fieldOfView(page)).toContainText('26.4° · 11.3 mm of 35.6 × 20.0');
  // One undo takes back the pick whole: the zoom and its 50 mm together.
  await storyboard(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press(await undoKey(page));
  await expect(lensChoice(page).locator('option:checked')).toHaveText('Angénieux Optimo · 30–72 mm 2×');
  await expect(lensMm(page)).toHaveValue('50');
  await lensChoice(page).selectOption({ label: 'Cooke S4 · 24 mm' });
  await expect(lensMm(page)).toHaveValue('24');
  // A prime takes only its own focal length.
  await lensMm(page).fill('35');
  await lensMm(page).press('Enter');
  await expect(inspector(page).getByRole('alert')).toHaveText('This lens is 24 mm.');

  // All of it is in the file.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await openFrame(page);
  await expect(lensChoice(page).locator('option:checked')).toHaveText('Cooke S4 · 24 mm');
  await expect(fieldOfView(page)).toContainText('26.4° · 11.3 mm of 35.6 × 20.0');
  await toSection(page, 'Production');
  await list.getByRole('button', { name: /^FX3/ }).click();
  await expect(editor(page).getByRole('radio', { name: 'Camera body', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(editor(page).getByRole('textbox', { name: 'Sensor width (mm)', exact: true })).toHaveValue('35.6');
  await list.getByRole('button', { name: /^Cooke S4/ }).click();
  await expect(editor(page).getByRole('textbox', { name: 'Focal length (mm)', exact: true })).toHaveValue('24');
});

test('a body and a lens made from the keyboard alone', async ({ page }) => {
  await toSection(page, 'Production');
  const make = gear(page).getByRole('button', { name: '+ New item' });
  await make.focus();
  await page.keyboard.press('Enter');
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('Mini LF');
  // Tab leaves the name (saved) for what it is; the arrows pick Camera body.
  await page.keyboard.press('Tab');
  await expect(editor(page).getByRole('radio', { name: 'Gear', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const body = editor(page).getByRole('radio', { name: 'Camera body', exact: true });
  await expect(body).toHaveAttribute('aria-checked', 'true');
  await expect(body).toBeFocused();
  await page.keyboard.press('Tab');
  const mode = editor(page).getByLabel('Camera and recording mode');
  await expect(mode).toBeFocused();
  await mode.selectOption({ label: 'ARRI ALEXA Mini LF: 4.3K LF 16:9, 35.64 × 20.05 mm' });
  await expect(editor(page).getByRole('textbox', { name: 'Sensor width (mm)', exact: true })).toHaveValue('35.64');
  await expect(gear(page).getByRole('list', { name: 'Gear' }).getByRole('button', { name: /^Mini LF/ })).toContainText('A cam');

  await make.focus();
  await page.keyboard.press('Enter');
  await expect(editor(page).getByLabel('Name')).toHaveValue('');
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('Ultra Prime');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(editor(page).getByRole('radio', { name: 'Lens', exact: true })).toHaveAttribute('aria-checked', 'true');
  // On to Prime, then its focal length.
  await page.keyboard.press('Tab');
  await expect(editor(page).getByRole('radio', { name: 'Prime', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(editor(page).getByRole('textbox', { name: 'Focal length (mm)', exact: true })).toBeFocused();
  await page.keyboard.type('32');
  await page.keyboard.press('Enter');
  await expect(gear(page).getByRole('list', { name: 'Gear' }).getByRole('button', { name: /^Ultra Prime/ })).toContainText('32 mm');

  // On the frame, from the keyboard: the Lens choice is a native select.
  await openFrame(page);
  await lensChoice(page).focus();
  await lensChoice(page).selectOption({ label: 'Ultra Prime · 32 mm' });
  await expect(lensMm(page)).toHaveValue('32');
  await expect(fieldOfView(page)).toContainText('58.2° · 35.6 mm of 35.6 × 20.1');
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { gear, settingsWindow } from './settings';

// Settings presets (6.5.8) in the memory build: Dark theme, a Dark board and a workspace of one's own saved as "Night"
// from the Settings header; changed back; Apply… lists exactly those differences, applies them at once and keeps the
// settings from before as "Before Night"; applying that goes back. The profile's name never changes; another project
// lists none of these presets; reopening the project still lists them. axe on the header button, the list and the
// dialog, in the app's light and dark themes.

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
    // A person with a name: a preset must never change it.
    window.localStorage.setItem('storiiboard.settings', JSON.stringify({ profile: { name: 'Ana Ruiz', initials: 'AR' } }));
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const yours = (page: Page) => sections(page).getByRole('list', { name: 'Your workspaces' });
const profile = (page: Page) => page.getByRole('button', { name: 'Profile: Ana Ruiz' });
const html = (page: Page) => page.locator('html');
/** The Moodboard section, never "Moodboard copy", the workspace made from it. */
const moodboardSection = (page: Page) => sections(page).getByRole('button', { name: /^Moodboard(?! copy)/ });
const boardTile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const viewGroup = (tile: Locator) => tile.getByRole('group', { name: 'Canvas view' });
const presetsPanel = (page: Page) => settingsWindow(page).getByRole('tabpanel', { name: 'Presets', exact: true });
const presetNames = (page: Page) => presetsPanel(page).getByRole('textbox', { name: /^Name of / });

async function theme(page: Page, name: 'Light' | 'Dark') {
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name }).click();
  await expect(html(page)).toHaveAttribute('data-theme', name.toLowerCase());
}

/** The Moodboard's camera board, open, with its view set to `view`. */
/** The Moodboard's camera board, open. */
async function openBoard(page: Page) {
  await moodboardSection(page).click();
  const department = boardTile(page).locator('[data-department-board="camera"]');
  // After a reload the board is made already, and listed by its name.
  const made = boardTile(page).getByRole('region', { name: 'Boards' }).getByRole('button', { name: 'Camera Department' });
  // The boards' list the first time or after a reload, the board itself once it's open: waited for, never guessed.
  await expect(viewGroup(boardTile(page)).or(department).or(made)).toBeVisible();
  if (await department.isVisible()) await department.click();
  else if (await made.isVisible()) await made.click();
  await expect(viewGroup(boardTile(page))).toBeVisible();
}

/** The workspace of one's own's layouts as the layout store wrote them to this computer's storage. */
const storedCustomLayouts = (page: Page) =>
  page.evaluate(() => {
    const all = JSON.parse(window.localStorage.getItem('storiiboard.layouts.2') ?? '{}') as Record<string, unknown>;
    return JSON.stringify(Object.entries(all).filter(([id]) => id.startsWith('custom-')));
  });

async function boardView(page: Page, view: 'Paper' | 'Dark') {
  await openBoard(page);
  await viewGroup(boardTile(page)).getByRole('button', { name: view, exact: true }).click();
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', view.toLowerCase());
}

async function openPresets(page: Page) {
  await gear(page).click();
  await settingsWindow(page).getByRole('tab', { name: 'Presets', exact: true }).click();
  await expect(presetsPanel(page)).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(settingsWindow(page)).toBeHidden();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(results.violations).toEqual([]);
}

/** Apply… on a preset: the window, its list of changes as given, axe, then Apply. */
async function apply(page: Page, name: string, changes: string[]) {
  await presetsPanel(page).getByRole('button', { name: `Apply ${name}…` }).click();
  const asked = page.getByRole('alertdialog', { name: `Apply ${name}` });
  await expect(asked.getByRole('list', { name: 'What would change' }).getByRole('listitem')).toHaveText(changes);
  await expect(asked).toContainText(`kept first, as the preset Before ${name}.`);
  await axe(page);
  await asked.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(asked).toBeHidden();
}

test('a preset saved from the Settings header, applied after a change back, and Before it applied to go back', async ({ page }) => {
  await expect(profile(page)).toBeVisible();
  // Dark, a Dark board, and a workspace of one's own.
  await theme(page, 'Dark');
  await boardView(page, 'Dark');
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Save as new workspace' }).click();
  await expect(yours(page).getByRole('button')).toHaveText(['Moodboard copy']);

  // Save preset… in the Settings header, under a name of its own.
  await gear(page).click();
  const save = settingsWindow(page).getByRole('button', { name: 'Save preset…' });
  await expect(save).toBeEnabled();
  await axe(page);
  await save.click();
  const naming = page.getByRole('dialog', { name: 'Save preset' });
  const name = naming.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Preset 1');
  await expect(name).toBeFocused();
  await name.fill('Night');
  await name.press('Enter');
  await expect(naming).toBeHidden();
  await settingsWindow(page).getByRole('tab', { name: 'Presets', exact: true }).click();
  await expect(presetNames(page)).toHaveCount(1);
  await expect(presetNames(page).first()).toHaveValue('Night');
  // Renamed with Enter, focus stays in the field; and back.
  const field = presetsPanel(page).getByRole('textbox', { name: 'Name of Night' });
  await field.fill('Night shoot');
  await field.press('Enter');
  const renamed = presetsPanel(page).getByRole('textbox', { name: 'Name of Night shoot' });
  await expect(renamed).toBeFocused();
  await renamed.fill('Night');
  await renamed.press('Enter');
  await expect(presetsPanel(page).getByRole('textbox', { name: 'Name of Night' })).toBeFocused();
  await axe(page);
  await closeSettings(page);

  // Changed back: the workspace deleted, the theme light, the board on paper.
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Delete workspace…' }).click();
  await page.getByRole('alertdialog', { name: 'Delete Moodboard copy?' }).getByRole('button', { name: 'Delete workspace' }).click();
  await expect(yours(page)).toHaveCount(0);
  await theme(page, 'Light');
  await boardView(page, 'Paper');

  // Apply… shows exactly what differs; applying changes this computer at once and keeps Before Night.
  await openPresets(page);
  await apply(page, 'Night', ['Theme: Light → Dark', 'Canvas view, boards: Paper → Dark', 'Your workspaces: 0 now, 1 in the preset (Moodboard copy)']);
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  // The way back, in one line.
  await expect(settingsWindow(page)).toContainText('Applied Night. Your settings before are saved as Before Night.');
  await expect(presetNames(page)).toHaveCount(2);
  await expect(presetNames(page).nth(1)).toHaveValue('Before Night');
  await axe(page);
  await closeSettings(page);
  await expect(yours(page).getByRole('button')).toHaveText(['Moodboard copy']);
  // The applied arrangement is written to this computer's storage: after a reload it is still there, unchanged.
  const applied = await storedCustomLayouts(page);
  expect(applied).not.toBe('[]');
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(yours(page).getByRole('button')).toHaveText(['Moodboard copy']);
  await yours(page).getByRole('button', { name: 'Moodboard copy' }).click();
  await expect(page.getByRole('region', { name: 'Moodboard copy workspace' }).getByRole('region', { name: 'Moodboard', exact: true })).toBeVisible();
  expect(await storedCustomLayouts(page)).toBe(applied);
  await openBoard(page);
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', 'dark');
  await expect(profile(page)).toBeVisible();

  // Before Night goes back to how it was.
  await openPresets(page);
  await apply(page, 'Before Night', ['Theme: Dark → Light', 'Canvas view, boards: Dark → Paper', 'Your workspaces: 1 now, none in the preset']);
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await closeSettings(page);
  await expect(yours(page)).toHaveCount(0);
  await expect(viewGroup(boardTile(page))).toHaveAttribute('data-canvas-view', 'paper');
  await expect(profile(page)).toBeVisible();

  // Nothing would change now: Apply is off.
  await openPresets(page);
  await presetsPanel(page).getByRole('button', { name: 'Apply Before Night…' }).click();
  const nothing = page.getByRole('alertdialog', { name: 'Apply Before Night' });
  await expect(nothing).toContainText('Nothing would change');
  await expect(nothing.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await nothing.getByRole('button', { name: 'Cancel' }).click();
  await closeSettings(page);

  // Reopened, the project still lists its presets.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await openPresets(page);
  await expect(presetNames(page)).toHaveCount(3);
  await expect(presetNames(page).nth(0)).toHaveValue('Night');
  await expect(presetNames(page).nth(1)).toHaveValue('Before Night');
  await expect(presetNames(page).nth(2)).toHaveValue('Before Before Night');
  await closeSettings(page);

  // Another project lists none of them.
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Second unit'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await openPresets(page);
  await expect(presetsPanel(page)).toContainText('No presets in this project yet.');
  await expect(presetNames(page)).toHaveCount(0);
  await expect(profile(page)).toBeVisible();
});

test('with no project open, Save preset… is off and the Presets tab says presets live in a project', async ({ page }) => {
  await page.reload();
  await gear(page).click();
  await expect(settingsWindow(page).getByRole('button', { name: 'Save preset…' })).toBeDisabled();
  await settingsWindow(page).getByRole('tab', { name: 'Presets', exact: true }).click();
  await expect(presetsPanel(page)).toContainText('Presets live in a project');
  await axe(page);
});

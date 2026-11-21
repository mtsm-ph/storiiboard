import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';
import { skipOnboarding } from './onboarding';
import { closeQuestion, openSettings, settingsWindow } from './settings';

// Settings wait for Apply (Kevin, Nov 17), and the Measurement system (Kevin, Nov 18): a change in Settings waits until
// Apply changes, Discard changes drops it, and closing with one waiting asks; the Measurement system sets Plan units and
// Weather units together and reads Mixed when they disagree; the m | ft switch by a plan's scale bar sets Plan units
// alone, at once. In the memory build, with a project, so a plan can be drawn.

test.use({ viewport: { width: 1440, height: 900 } });

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
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** This computer's settings as stored. */
const stored = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>, SETTINGS_KEY);
const applyButton = (page: Page) => settingsWindow(page).getByRole('button', { name: 'Apply changes' });
const discardButton = (page: Page) => settingsWindow(page).getByRole('button', { name: 'Discard changes' });

test('a change waits for Apply; closing asks: Keep editing keeps it, Discard drops it, Apply applies it', async ({ page }) => {
  let app = await openSettings(page, 'App');
  const weekStart = app.getByLabel('Week starts on');
  // Nothing waits: both buttons are there, and off.
  await expect(applyButton(page)).toBeDisabled();
  await expect(discardButton(page)).toBeDisabled();
  await weekStart.selectOption('monday');
  await expect(applyButton(page)).toBeEnabled();
  await expect(discardButton(page)).toBeEnabled();
  // Waiting, not written.
  expect((await stored(page)).weekStart ?? 'region').toBe('region');

  // Escape asks, in a question of its own; Keep editing leaves Settings as it was, the change still waiting.
  await page.keyboard.press('Escape');
  const question = closeQuestion(page);
  await expect(question).toBeVisible();
  await expect(question.locator('[data-window-body]').getByRole('button')).toHaveText(['Keep editing', 'Discard changes', 'Apply changes']);
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(question).toHaveCount(0);
  await expect(settingsWindow(page)).toBeVisible();
  await expect(weekStart).toHaveValue('monday');
  await expect(applyButton(page)).toBeEnabled();

  // The close button asks too; Discard closes, nothing written, and Settings shows it as it was.
  await settingsWindow(page).getByRole('button', { name: 'Close Settings' }).click();
  await question.getByRole('button', { name: 'Discard changes' }).click();
  await expect(settingsWindow(page)).toHaveCount(0);
  expect((await stored(page)).weekStart ?? 'region').toBe('region');
  app = await openSettings(page, 'App');
  await expect(app.getByLabel('Week starts on')).toHaveValue('region');

  // Changed again and closed with Apply: written, and shown so when Settings opens again.
  await app.getByLabel('Week starts on').selectOption('monday');
  await page.keyboard.press('Escape');
  await question.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settingsWindow(page)).toHaveCount(0);
  expect((await stored(page)).weekStart).toBe('monday');
  app = await openSettings(page, 'App');
  await expect(app.getByLabel('Week starts on')).toHaveValue('monday');

  // The title bar's own buttons: Apply writes and goes off, focus kept in the window; Discard puts it back.
  await app.getByLabel('Directions open in').selectOption('apple');
  await applyButton(page).click();
  await expect(applyButton(page)).toBeDisabled();
  expect((await stored(page)).directionsApp).toBe('apple');
  expect(await settingsWindow(page).evaluate((window) => window.contains(document.activeElement))).toBe(true);
  await app.getByLabel('Directions open in').selectOption('osm');
  await discardButton(page).click();
  await expect(app.getByLabel('Directions open in')).toHaveValue('apple');
  expect((await stored(page)).directionsApp).toBe('apple');
  // Nothing waiting now: Escape closes at once, without a question.
  await page.keyboard.press('Escape');
  await expect(settingsWindow(page)).toHaveCount(0);
  await expect(question).toHaveCount(0);
});

test('the Project tab’s own fields still save at once, as edits; Your role waits for Apply', async ({ page }) => {
  const project = await openSettings(page, 'Project');
  await project.getByLabel('Aspect ratio').selectOption('2.39:1');
  // An edit of the project: nothing waits for Apply.
  await expect(applyButton(page)).toBeDisabled();
  await project.getByLabel('Your role on this project').selectOption({ label: 'Director of photography' });
  await expect(applyButton(page)).toBeEnabled();
  await page.keyboard.press('Escape');
  await closeQuestion(page).getByRole('button', { name: 'Discard changes' }).click();
  const again = await openSettings(page, 'Project');
  await expect(again.getByLabel('Aspect ratio')).toHaveValue('2.39:1');
  await expect(again.getByLabel('Your role on this project')).toHaveValue('');
});

test('the Measurement system sets plan and weather units together, and reads Mixed, both shown, when they differ', async ({ page }) => {
  const app = await openSettings(page, 'App');
  const system = app.getByRole('combobox', { name: 'Measurement system' });
  const plan = app.getByRole('combobox', { name: 'Plan units' });
  const weather = app.getByRole('combobox', { name: 'Weather units' });
  await expect(system).toHaveValue('region');
  await system.selectOption('us');
  await expect(plan).toHaveValue('feet');
  await expect(weather).toHaveValue('us');
  await applyButton(page).click();
  expect(await stored(page)).toMatchObject({ weatherUnits: 'us', planUnits: 'feet' });
  expect(await stored(page)).not.toHaveProperty('measurementSystem');

  // One of the two on its own: Mixed, with what each is.
  await plan.selectOption('metres');
  await expect(system).toHaveValue('mixed');
  await expect(app.locator('[data-measurement]')).toHaveAttribute('data-measurement', 'mixed');
  await expect(app).toContainText('Mixed. Plans: Metres. Weather and distances: US (°F, mph, in).');
  await discardButton(page).click();
  await expect(system).toHaveValue('us');

  // Metric sets both back the other way.
  await system.selectOption('metric');
  await expect(plan).toHaveValue('metres');
  await expect(weather).toHaveValue('metric');
  await applyButton(page).click();
  expect(await stored(page)).toMatchObject({ weatherUnits: 'metric', planUnits: 'metres' });
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([]);
});

test('a computer from before shows what it showed: its saved units kept, the Measurement system read from them', async ({ page }) => {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({ weatherUnits: 'metric', planUnits: 'feet' }));
  }, SETTINGS_KEY);
  await page.reload();
  const app = await openSettings(page, 'App');
  await expect(app.getByRole('combobox', { name: 'Plan units' })).toHaveValue('feet');
  await expect(app.getByRole('combobox', { name: 'Weather units' })).toHaveValue('metric');
  await expect(app.getByRole('combobox', { name: 'Measurement system' })).toHaveValue('mixed');
  await expect(applyButton(page)).toBeDisabled();
  // Nothing written over them, and no Measurement system stored.
  expect(await stored(page)).toMatchObject({ weatherUnits: 'metric', planUnits: 'feet' });
  expect(await stored(page)).not.toHaveProperty('measurementSystem');
});

test('the m | ft switch by the plan’s scale bar sets Plan units at once and never the weather’s', async ({ page }) => {
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await sections.getByRole('button', { name: /^Setup/ }).click();
  const setups = page.getByRole('region', { name: 'Setups', exact: true });
  await setups.getByRole('button', { name: 'Add setup to SC 01' }).click();
  const planTile = page.getByRole('region', { name: 'Set plan', exact: true });
  await planTile.getByRole('button', { name: 'New room' }).click();
  await expect(planTile.locator('[data-canvas]')).toBeVisible();
  const units = planTile.getByRole('group', { name: 'Plan units' });
  const metres = units.getByRole('button', { name: 'm (metres)' });
  const feet = units.getByRole('button', { name: 'ft (feet)' });
  // By this computer's region (en-US here): feet.
  await expect(feet).toHaveAttribute('aria-pressed', 'true');
  await expect(planTile.locator('[data-scale-bar]')).toHaveAttribute('data-scale-bar', /(ft|in)$/);
  await metres.click();
  await expect(metres).toHaveAttribute('aria-pressed', 'true');
  await expect(planTile.locator('[data-scale-bar]')).toHaveAttribute('data-scale-bar', /m$/);
  expect(await stored(page)).toMatchObject({ planUnits: 'metres' });
  expect((await stored(page)).weatherUnits ?? 'region').toBe('region');
  // Settings reads Mixed now, both shown.
  const app = await openSettings(page, 'App');
  await expect(app.getByRole('combobox', { name: 'Measurement system' })).toHaveValue('mixed');
  await expect(app.getByRole('combobox', { name: 'Plan units' })).toHaveValue('metres');
  await expect(app.getByRole('combobox', { name: 'Weather units' })).toHaveValue('region');
  await page.keyboard.press('Escape');
  await expect(settingsWindow(page)).toHaveCount(0);
  await feet.click();
  await expect(feet).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toMatchObject({ planUnits: 'feet' });
  expect((await new AxeBuilder({ page }).include('[data-scale-units]').analyze()).violations).toEqual([]);
});

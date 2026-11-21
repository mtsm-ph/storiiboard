import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Checks tile (7.4) in the memory build: "Harbor Lights" with a gear mistake (1A needs a slider Day 1's list lacks)
// and Robin Vale, a gaffer, on Day 1 while marked unavailable. The Production workspace shows the tile with both, by day
// and by check; each Show, from the keyboard, goes to its item (the frame selected on the storyboard, Robin's Take off on
// the call sheet); the slider put on the day's list takes that finding away live. axe, light and dark, on the tile.
// The page's clock is fixed, so dates read the same on every run.

const tile = (page: Page) => page.locator('[data-checks-tile]');
const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const people = (page: Page) => page.getByRole('region', { name: 'Cast and crew', exact: true });
const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const day = (page: Page) => days(page).locator('[data-day-editor]');
const sheet = (page: Page) => page.getByRole('region', { name: 'Call sheet', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Harbor Lights'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();

  // A slider in the catalogue; Day 1 on Thu, Nov 26 with 1A on it.
  await sections(page).getByRole('button', { name: /^Production/ }).click();
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  const name = gear(page).locator('[data-gear-editor]').getByLabel('Name');
  await expect(name).toBeFocused();
  await name.fill('Slider');
  await name.press('Enter');
  await expect(gear(page).getByRole('list', { name: 'Gear' }).getByRole('button', { name: /^Slider/ })).toHaveCount(1);
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await day(page).getByLabel('Date').fill('2026-11-26');
  await day(page).getByLabel('Date').blur();
  await day(page).getByRole('button', { name: /^Add 1A to Day 1/ }).click();

  // Robin Vale, a gaffer, away Nov 24 to 28, and everyone on the day.
  await people(page).getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Robin Vale');
  await page.keyboard.press('Enter');
  const editor = people(page).locator('[data-person-editor]');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Gaffer' });
  const unavailable = editor.getByRole('group', { name: 'Unavailable' });
  await unavailable.getByRole('button', { name: 'Add dates…' }).click();
  await unavailable.getByLabel('From').fill('2026-11-24');
  await unavailable.getByLabel('To').fill('2026-11-28');
  await unavailable.getByRole('button', { name: 'Add dates', exact: true }).click();
  await expect(unavailable.locator('[data-stretch]')).toHaveCount(1);
  await sheet(page).getByRole('button', { name: 'Add everyone' }).click();

  // 1A needs the slider, from the Inspector.
  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const needs = page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('group', { name: 'Gear this frame needs' });
  await needs.getByRole('button', { name: /^Slider/ }).click();
  await expect(needs.getByRole('button', { name: /^Slider\s*\(not on its day’s list\)$/ })).toHaveAttribute('aria-pressed', 'true');
  await sections(page).getByRole('button', { name: /^Production/ }).click();
});

test('the Production workspace shows every check over the project; each Show goes to its item, and a fix takes its finding away live, by keyboard', async ({ page }) => {
  await expect(tile(page)).toBeVisible();
  // Named apart from the call sheet's Checks strip (7.4 round 2); its day groups and boxes are groups, never landmarks.
  await expect(page.getByRole('region', { name: 'Project checks', exact: true }).locator('[data-checks-tile]')).toBeVisible();
  await expect(tile(page).getByRole('region')).toHaveCount(0);
  await expect(tile(page).getByRole('group', { name: 'Day 1 · Thu, Nov 26 (4)', exact: true })).toBeVisible();
  await expect(tile(page).getByRole('group', { name: 'By check', exact: true })).toBeVisible();
  // Once the held forecasts and zones are read, the foot no longer says it is reading.
  await expect(tile(page).locator('[data-checks-reading]')).toHaveCount(0);
  const gearCheck = tile(page).locator('[data-check="gear-not-on-day"]');
  const awayCheck = tile(page).locator('[data-check="unavailable-on-day"]');
  await expect(gearCheck).toHaveText(/1A needs Slider, not on Day 1 · Thu, Nov 26’s list/);
  await expect(awayCheck).toHaveText(/Robin Vale \(Gaffer\) is called on Thu, Nov 26 but marked unavailable Nov 24 – Nov 28/);
  // A gaffer alone: nobody from Direction or Camera on a day with frames to shoot.
  await expect(tile(page).locator('[data-check="department-missing"]')).toHaveCount(2);
  // The counts at the top, per check and per day, and everything under Day 1.
  const byKind = tile(page).locator('[data-checks-by-kind]');
  await expect(byKind.locator('[data-kind="gear-not-on-day"]')).toHaveText(/Gear not on the day’s list\s*1/);
  await expect(byKind.locator('[data-kind="unavailable-on-day"]')).toHaveText(/Called while unavailable\s*1/);
  await expect(byKind.locator('[data-kind="plan-lens-differs"]')).toHaveText(/Lens differs from the plan\s*0/);
  await expect(tile(page).locator('[data-checks-by-day] li')).toHaveText([/Day 1 · Thu, Nov 26\s*4/]);
  await expect(tile(page).locator('[data-checks-count]')).toHaveText('4 problems');
  await expect(tile(page).getByRole('heading', { name: 'Day 1 · Thu, Nov 26 (4)' })).toBeVisible();
  // The frame has no location: nothing for the light or the rain to read, so nothing skipped.
  await expect(tile(page).locator('[data-checks-skipped]')).toHaveCount(0);

  // WCAG 2.2 AA on the tile, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-checks-tile]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[data-checks-tile]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.removeAttribute('data-theme');
  });

  // Filtered to one check from the keyboard: only that finding shows; back to all.
  const kind = tile(page).locator('[data-checks-kind]');
  await kind.focus();
  await kind.selectOption({ label: 'Called while unavailable' });
  await expect(tile(page).locator('[data-check]')).toHaveCount(1);
  await expect(awayCheck).toHaveCount(1);
  await kind.selectOption({ label: 'All checks' });
  await expect(tile(page).locator('[data-check]')).toHaveCount(4);

  // Show on Robin's: the call sheet on Day 1, with focus on their Take off, where it's fixed.
  const showAway = awayCheck.getByRole('button', { name: /^Show: Robin Vale/ });
  await showAway.focus();
  await page.keyboard.press('Enter');
  await expect(sheet(page).getByRole('button', { name: /^Take off Robin Vale from / })).toBeFocused();

  // Open day: the Shoot days tile on Day 1.
  const openDay = tile(page).getByRole('button', { name: 'Open Day 1 · Thu, Nov 26 in Shoot days' });
  await openDay.focus();
  await page.keyboard.press('Enter');
  await expect(days(page).locator('[data-day-id]').first()).toBeFocused();

  // Show on the gear: the storyboard, with 1A selected and focused.
  const showGear = gearCheck.getByRole('button', { name: /^Show: 1A needs Slider/ });
  await showGear.focus();
  await page.keyboard.press('Enter');
  await expect(board(page)).toBeVisible();
  await expect(board(page).locator('[data-shot-id][aria-current="true"] [data-number]')).toHaveText('1A');
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();

  // Back to Production from the keyboard; the slider put on Day 1's list from the day's own check takes the finding away.
  await page.keyboard.press('Alt+5');
  await expect(tile(page)).toBeVisible();
  const add = day(page).getByRole('button', { name: /^Add to this day, for 1A/ });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(gearCheck).toHaveCount(0);
  await expect(byKind.locator('[data-kind="gear-not-on-day"]')).toHaveText(/Gear not on the day’s list\s*0/);
  await expect(tile(page).locator('[data-checks-count]')).toHaveText('3 problems');
  await expect(awayCheck).toHaveCount(1);
});

test('says “Reading…” until the held forecasts and zones are read, then what was skipped, never a line that flashes and goes (round 2)', async ({ page }) => {
  // 1A at Harbor Pier, an exterior, its place typed: the forecast the call sheet fetches (the memory build's recorded one)
  // stops before Nov 26, so its rain is said as not checked.
  await sections(page).getByRole('button', { name: /^Storyboard/ }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  await inspector.getByRole('radio', { name: 'EXT', exact: true }).click();
  await board(page).locator('[data-shot-id]').first().click();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Harbor Pier');
  await page.keyboard.press('Enter');
  await sections(page).getByRole('button', { name: /^Production/ }).click();
  const editor = page.getByRole('region', { name: 'Locations', exact: true }).locator('[data-location-editor]');
  await editor.getByRole('textbox', { name: 'Coordinates', exact: true }).fill('40.7128, -74.006');
  await editor.getByRole('button', { name: 'Place pin' }).click();
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(tile(page).locator('[data-skip="forecast-not-covering"]')).toHaveCount(1);

  // The tile closed and opened again, watched from its first draw: "Reading…" comes first, and no line shows beside it.
  await page.getByRole('button', { name: 'Close Project checks' }).click();
  await expect(tile(page)).toHaveCount(0);
  await page.evaluate(() => {
    const seen: { reading: boolean; skips: string[] }[] = [];
    (window as unknown as { checksSeen: typeof seen }).checksSeen = seen;
    new MutationObserver(() => {
      const box = document.querySelector('[data-checks-tile]');
      if (!box) return;
      seen.push({ reading: box.querySelector('[data-checks-reading]') !== null, skips: [...box.querySelectorAll('[data-skip]')].map((e) => e.getAttribute('data-skip') ?? '') });
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('group', { name: 'Open tile' }).getByRole('button', { name: 'Project checks', exact: true }).click();
  await expect(tile(page).locator('[data-skip="forecast-not-covering"]')).toHaveCount(1);
  await expect(tile(page).locator('[data-checks-reading]')).toHaveCount(0);
  await expect(tile(page).locator('[data-skip]')).toHaveCount(1);
  const seen = await page.evaluate(() => (window as unknown as { checksSeen: { reading: boolean; skips: string[] }[] }).checksSeen);
  expect(seen[0]?.reading).toBe(true);
  expect(seen.filter((s) => s.reading && s.skips.length > 0)).toEqual([]);
  // Every line that ever showed is the one that stays.
  expect([...new Set(seen.flatMap((s) => s.skips))]).toEqual(['forecast-not-covering']);
});

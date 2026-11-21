import { expect, test, type Page } from '@playwright/test';
import { changeFileFor, OTHER_PROJECT_ID } from './fixtures/changeFiles';
import { skipOnboarding } from './onboarding';

// Change files in (7.1) in the memory build: Import changes… in the project menu chooses a file through the build's own
// file input, brings its suggestions in as one step, says so on the status line and in History; the same file again
// is "Already brought in", and a file for another project is refused with its words. Made-up projects and people only.

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
});

const projectId = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/app/projectStore.ts';
    const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
    return projectStore.getState().project?.projectId ?? '';
  });

/** How many suggestion records the open project has. */
const suggestionCount = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/app/projectStore.ts';
    const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
    return Object.values(projectStore.getState().records).filter((r) => r.type === 'suggestion').length;
  });

async function importChanges(page: Page, buffer: Buffer, name = 'Robin Vale.sbdchanges') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Import changes…', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer });
}

const notice = (page: Page) => page.locator('[data-notice]');
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');

test('brings a change file in as one step, says so and in History; the same file again is already in', async ({ page }) => {
  const id = await projectId(page);
  expect(id).not.toBe('');
  await importChanges(page, changeFileFor(id, 'Bey County'));
  await expect(notice(page)).toHaveText(/Brought in 2 suggestions from Robin Vale\./);
  expect(await suggestionCount(page)).toBe(2);

  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(steps(page).first()).toContainText('Brought in 2 suggestions from Robin Vale');

  await importChanges(page, changeFileFor(id, 'Bey County'));
  await expect(notice(page)).toHaveText(/Already brought in/);
  expect(await suggestionCount(page)).toBe(2);
  // No step for a file that added nothing.
  await expect(steps(page).first()).toContainText('Brought in 2 suggestions from Robin Vale');
  await expect(steps(page).filter({ hasText: 'Brought in' })).toHaveCount(1);
});

test('a change file for another project is refused with its words, and nothing comes in', async ({ page }) => {
  await importChanges(page, changeFileFor(OTHER_PROJECT_ID, 'Harbor Lights'), 'Harbor Lights.sbdchanges');
  await expect(notice(page)).toHaveText(/This change file is for another project, Harbor Lights\./);
  expect(await suggestionCount(page)).toBe(0);
});

test('a file that isn’t a change file says why, never a stack trace', async ({ page }) => {
  await importChanges(page, Buffer.from('{"format": "storiiboard-project"}'), 'Bey County.sbdchanges');
  await expect(notice(page)).toHaveText(/This isn’t a Storiiboard change file\./);
  expect(await suggestionCount(page)).toBe(0);
});

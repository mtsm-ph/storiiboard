import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { REVIEW_FILE_ID, reviewFileFor, type ReviewTargets } from './fixtures/changeFiles';
import { skipOnboarding } from './onboarding';
import { applySettings, closeSettings, openSettings } from './settings';

// The review screen (7.2) in the memory build: a change file brought in (7.1's way) is one notification that opens its
// group in the Suggestions tile; one suggestion at a time, an update changed since shown with its three values, Apply
// and Reject, Apply the rest (only the new scene and its frames, in order, after a confirmation), ⌘Z taking back only
// the last frame, and the log of what was decided. Driven from the keyboard. Made-up people and projects only.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Harbor Lights'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const tile = (page: Page) => page.locator('[data-suggestions-tile]');
const group = (page: Page) => tile(page).locator(`[data-suggestion-group="${REVIEW_FILE_ID}"]`);
const detail = (page: Page) => tile(page).locator('[data-suggestion-detail]');

/** A scene with frames 1A and 1B, and the ids a change file names. */
async function harbor(page: Page): Promise<ReviewTargets> {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(2);
  return page.evaluate(async () => {
    const url = '/src/app/projectStore.ts';
    const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
    const { project, records } = projectStore.getState();
    const all = Object.values(records);
    const scene = all.find((r) => r.type === 'scene');
    const frame = (n: string) => all.find((r) => r.type === 'shot' && r.props.number === n);
    return {
      projectId: project?.projectId ?? '',
      sceneId: scene?.id ?? '',
      frameA: frame('1A')?.id ?? '',
      frameB: frame('1B')?.id ?? '',
      frameBUpdatedAt: frame('1B')?.updatedAt ?? '',
    };
  });
}

/** Import changes… from the project menu, its words in the language shown. */
async function importChanges(page: Page, buffer: Buffer, words = { menu: 'Project', item: 'Import changes…' }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: words.menu, exact: true }).press('Enter');
  await page.getByRole('button', { name: words.item, exact: true }).press('Enter');
  await (await chooser).setFiles({ name: 'Robin Vale.sbdchanges', mimeType: 'application/json', buffer });
}

test('review one by one, Apply the rest, undo the last frame, the log: from the notification, keyboard only', async ({ page }) => {
  const targets = await harbor(page);
  await importChanges(page, reviewFileFor(targets));
  await expect(page.locator('[data-notice]')).toContainText('Brought in 6 suggestions from Robin Vale.');
  await expect(page.locator('[data-notice]').getByRole('button', { name: 'Review', exact: true })).toBeVisible();

  // The import is one notification, unread though the step was ours; it opens its group.
  const count = page.locator('[data-unread-count]');
  await expect(count).toBeVisible();
  await count.press('Enter');
  const feed = page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('list', { name: 'Notifications, newest first' });
  const note = feed.getByRole('button', { name: /6 suggestions from Robin Vale/ });
  await expect(note).toHaveAccessibleName(/^Unread:/);
  await note.press('Enter');
  await expect(note).not.toHaveAccessibleName(/^Unread:/);
  await expect(group(page)).toBeVisible();
  await expect(group(page).locator('[data-suggestion-item]').first()).toBeFocused();
  await expect(group(page).getByRole('heading', { name: /From Robin Vale/ })).toContainText('6 of 6 to review');
  const rows = group(page).getByRole('list', { name: /Suggestions from Robin Vale/ }).getByRole('button');
  await expect(rows).toHaveText([
    'Move SC 01 · 1B to the Trash',
    /^Change SC 01 · 1AChanged$/,
    'Add a scene after SC 01',
    /^Add a frame at the start of the new sceneHeld$/,
    /^Add a frame after one another suggestion adds, in the new sceneHeld$/,
    'Move SC 01 · 1B',
  ]);

  // The update changed since: then, suggested and now, with the flag's words; Apply writes it.
  await rows.nth(1).press('Enter');
  await expect(detail(page)).toContainText('Changed since it was suggested.');
  const lens = detail(page).locator('dl');
  await expect(lens).toContainText('Then50mm');
  await expect(lens).toContainText('Suggested85mm');
  await expect(lens).toContainText('Now—');
  await detail(page).getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await expect(page.locator('[data-notice]')).toContainText('Applied the suggestion.');
  // The keyboard moves on to the next one waiting: the new scene.
  await expect(detail(page).getByRole('button', { name: 'Apply', exact: true })).toBeFocused();
  await expect(detail(page).getByRole('heading')).toHaveText('Add a scene after SC 01');

  // Reject the trash: 1B stays.
  await rows.first().press('Enter');
  await expect(detail(page)).toContainText('We have this in 1A.');
  await detail(page).getByRole('button', { name: 'Reject', exact: true }).press('Enter');
  await expect(page.locator('[data-notice]')).toContainText('Rejected the suggestion.');
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(2);

  // Apply the rest: the scene and its two frames, listed in order, after the confirmation; never the reorder.
  await group(page).getByRole('button', { name: 'Apply the rest', exact: true }).press('Enter');
  const confirm = page.getByRole('alertdialog', { name: 'Apply the rest' });
  await expect(confirm).toContainText('This applies 3 suggestions in this order');
  await expect(confirm).toContainText('• Add a scene after SC 01\n• Add a frame at the start of the new scene\n• Add a frame after one another suggestion adds, in the new scene', { useInnerText: true });
  await confirm.getByRole('button', { name: 'Apply the rest', exact: true }).press('Enter');
  await expect(page.locator('[data-notice]')).toContainText('Applied 3 suggestions.');
  const pier = board(page).getByRole('list', { name: 'Frames in SC 02' }).getByRole('button', { name: /Need to shoot$/ });
  await expect(board(page).getByRole('heading', { name: /^SC 02 Pier/ })).toBeVisible();
  // The scene's frames in the file's order: the wide, then the close.
  await expect(pier).toHaveText([/2AWS/, /2BCU/]);
  // 1A took the suggested lens.
  await expect(board(page).getByRole('list', { name: 'Frames in SC 01' }).getByRole('button', { name: /^1A 85MM/ })).toBeVisible();
  await expect(rows).toHaveText(['Move SC 01 · 1B']);

  // ⌘Z takes back only the last frame.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(pier).toHaveText([/2AWS/]);
  await expect(rows).toHaveText(['Add a frame after 2A in SC 02', 'Move SC 01 · 1B']);

  // The log: each decision, newest first; a filter.
  const log = tile(page).getByRole('list', { name: 'Decided suggestions, newest first' }).getByRole('listitem');
  await expect(log).toHaveCount(4);
  await expect(log.first()).toContainText('Applied');
  await expect(log.first()).toContainText('Add a frame');
  await expect(log.filter({ hasText: 'Rejected' })).toContainText(['Move SC 01 · 1B to the Trash']);
  await tile(page).getByRole('radio', { name: 'Rejected' }).press('Space');
  await expect(log).toHaveCount(1);
  await expect(log.first()).toContainText('Move SC 01 · 1B to the Trash');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Suggestions tile passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const targets = await harbor(page);
    await importChanges(page, reviewFileFor(targets));
    await page.locator('[data-notice]').getByRole('button', { name: 'Review', exact: true }).press('Enter');
    await expect(group(page)).toBeVisible();
    await group(page).getByRole('list', { name: /Suggestions from Robin Vale/ }).getByRole('button').nth(1).press('Enter');
    await expect(detail(page)).toContainText('Changed since');
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).include('[data-suggestions-tile]').analyze()).violations).toEqual([]);
  });
}

test('in Spanish: Cambios por revisar, Aplicar, Rechazar, Aplicar el resto', async ({ page }) => {
  const targets = await harbor(page);
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  await applySettings(page);
  await closeSettings(page, 'apply');
  await importChanges(page, reviewFileFor(targets), { menu: 'Proyecto', item: 'Importar cambios…' });
  await page.locator('[data-notice]').getByRole('button', { name: 'Revisar', exact: true }).press('Enter');
  await expect(tile(page).getByRole('heading', { name: 'Cambios por revisar' })).toBeVisible();
  await expect(group(page).getByRole('button', { name: 'Aplicar el resto', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('button', { name: 'Aplicar', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('button', { name: 'Rechazar', exact: true })).toBeVisible();
  await expect(detail(page).getByRole('heading')).toHaveText('Mover ESC 01 · 1B a la Papelera');
  await expect(tile(page).getByRole('heading', { name: 'Cambios aplicados' })).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';
import { NO_SLATE_NUMBERS } from '../src/core/model/shotNumbers';
import type { ProjectData } from '../mcp/src/project';
import { checkedChangeFile, suggestNewShots, suggestShotChanges } from '../mcp/src/propose';
import { skipOnboarding } from './onboarding';

// The assistant's suggestions arriving in the app (7.6), in the memory build: the dev build's memory files can't hold a
// folder beside the project, so the change file is made here by the MCP server's own functions (mcp/src/propose.ts,
// the same checks and bytes its propose tools write) from the open project's records, and brought in as 7.1's spec
// brings one in, with Import changes…. It arrives named by the client ("From Claude Desktop, through the assistant"),
// and Apply works. Made-up projects only.

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
const detail = (page: Page) => tile(page).locator('[data-suggestion-detail]');

/** The open project as the server reads one: its records and id, from the page. */
async function projectData(page: Page): Promise<ProjectData> {
  const read = await page.evaluate(async () => {
    const url = '/src/app/projectStore.ts';
    const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
    const { project, records } = projectStore.getState();
    return { projectId: project?.projectId ?? '', name: project?.name ?? '', records };
  });
  return { path: '', name: read.name, projectId: read.projectId, schemaVersion: 0, records: read.records, seen: {}, slate: NO_SLATE_NUMBERS };
}

async function importChanges(page: Page, buffer: Buffer, name: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Project', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Import changes…', exact: true }).press('Enter');
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer });
}

test('the assistant’s change file arrives named by its client, and Apply adds the frame it suggests', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(2);

  // As suggest_new_shots writes it: one frame at the end of scene 1, from Claude Desktop.
  const context = { data: await projectData(page), client: 'Claude Desktop' };
  const built = checkedChangeFile(context, suggestNewShots(context, { scene: '1', frames: [{ size: 'CU', action: 'Her hand on the latch.' }], note: 'An insert for the latch.' }));
  expect(built.name).toMatch(/^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d Claude Desktop [0-9a-f]{8}\.sbdchanges$/);
  await importChanges(page, Buffer.from(built.bytes), built.name);
  await expect(page.locator('[data-notice]')).toContainText('Brought in 1 suggestion from Claude Desktop.');

  await page.locator('[data-notice]').getByRole('button', { name: 'Review', exact: true }).press('Enter');
  const group = tile(page).locator(`[data-suggestion-group="${built.id}"]`);
  await expect(group.getByRole('heading', { name: /From Claude Desktop, through the assistant/ })).toBeVisible();
  await expect(detail(page)).toContainText('An insert for the latch.');
  await detail(page).getByRole('button', { name: 'Apply', exact: true }).press('Enter');
  await expect(page.locator('[data-notice]')).toContainText('Applied the suggestion.');
  const frames = board(page).getByRole('list', { name: 'Frames in SC 01' }).getByRole('button', { name: /Need to shoot$/ });
  await expect(frames).toHaveCount(3);
  await expect(frames.nth(2)).toHaveText(/1CCU/);
});

test('a second suggestion from the assistant is its own file and its own group, and Reject leaves the frame as it was', async ({ page }) => {
  await scenesTile(page).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]')).toHaveCount(1);

  // As suggest_shot_changes writes it: 1A to a CU.
  const context = { data: await projectData(page), client: 'Claude Desktop' };
  const built = checkedChangeFile(context, suggestShotChanges(context, { changes: [{ frame: '1A', fields: { size: 'CU' } }] }));
  await importChanges(page, Buffer.from(built.bytes), built.name);
  await expect(page.locator('[data-notice]')).toContainText('Brought in 1 suggestion from Claude Desktop.');
  await page.locator('[data-notice]').getByRole('button', { name: 'Review', exact: true }).press('Enter');
  const group = tile(page).locator(`[data-suggestion-group="${built.id}"]`);
  await expect(group.getByRole('heading', { name: /From Claude Desktop, through the assistant/ })).toBeVisible();
  await detail(page).getByRole('button', { name: 'Reject', exact: true }).press('Enter');
  await expect(page.locator('[data-notice]')).toContainText('Rejected the suggestion.');
  await expect(board(page).getByRole('list', { name: 'Frames in SC 01' }).getByRole('button', { name: /Need to shoot$/ })).not.toHaveText(/1ACU/);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Script import (1.17) in the memory build: a Fountain or Final Draft file, previewed, then imported as scene shells
// in one step that one undo takes back.

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

const FOUNTAIN = `Title: Bey County

INT. DINER - NIGHT

Rain on the windows.

MARY
We're closed.

TOM (O.S.)
Door was open.

EXT. COUNTY ROAD - DAY

A truck idles.

INT. DINER - MOMENTS LATER

MARY
Still here?
`;

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
<Content>
<Paragraph Number="7" Type="Scene Heading"><SceneProperties Length="1 3/8"/><Text>EXT. BRIDGE - DUSK</Text></Paragraph>
<Paragraph Type="Character"><Text>MARY</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>There.</Text></Paragraph>
</Content>
</FinalDraft>`;

const scenesTile = (page: Page) => page.getByRole('region', { name: 'Scenes', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const preview = (page: Page) => page.getByRole('dialog', { name: /^Import / });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

async function choose(page: Page, name: string, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await scenesTile(page).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(preview(page)).toBeVisible();
}

test('previews a Fountain script, then imports its scenes in one step that ⌘Z takes back', async ({ page }) => {
  await choose(page, 'Bey County.fountain', FOUNTAIN);
  await expect(preview(page).getByRole('heading', { name: 'Import Bey County' })).toBeVisible();
  const rows = preview(page).getByRole('table', { name: 'Scenes in the script' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('INT. DINER — NIGHT');
  await expect(rows.nth(0)).toContainText('MARY, TOM');
  await expect(rows.nth(2)).toContainText('INT. DINER — MOMENTS LATER');
  await expect(preview(page).getByText('3 new scenes · 2 new locations · 2 new characters')).toBeVisible();

  await preview(page).getByRole('button', { name: 'Import 3 scenes' }).click();
  await expect(preview(page)).toHaveCount(0);
  await expect(board(page).getByText('INT. DINER — NIGHT')).toBeVisible();
  await expect(scenesTile(page).getByText('EXT. COUNTY ROAD — DAY')).toBeVisible();

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await expect(scenesTile(page).getByText('INT. DINER — MOMENTS LATER')).toBeVisible();

  await page.keyboard.press(await undoKey(page));
  await expect(scenesTile(page).getByText('No scenes yet. Add one, or import a script.')).toBeVisible();
});

test('a script imported again finds its scenes on the board and leaves them', async ({ page }) => {
  await choose(page, 'Bey County.fountain', FOUNTAIN);
  await preview(page).getByRole('button', { name: 'Import 3 scenes' }).click();
  await choose(page, 'Bey County.fountain', FOUNTAIN);
  await expect(preview(page).getByText('Every scene in this script is on the board already.')).toBeVisible();
  await expect(preview(page).getByText('On the board')).toHaveCount(3);
  await expect(preview(page).getByRole('button', { name: 'Import 0 scenes' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
});

test('reads a Final Draft file with its own scene numbers and lengths', async ({ page }) => {
  await choose(page, 'Bey County.fdx', FDX);
  const row = preview(page).getByRole('table', { name: 'Scenes in the script' }).locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('7');
  await expect(row).toContainText('1 3/8 pg');
  await preview(page).getByRole('button', { name: 'Import 1 scene' }).click();
  await expect(scenesTile(page).getByText('EXT. BRIDGE — DUSK')).toBeVisible();
});

test('a file with no scene headings says what a heading looks like', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await scenesTile(page).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Just some notes.\n') });
  await expect(page.getByRole('alert')).toContainText('No scene headings in “notes.txt”');
  await expect(preview(page)).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the import preview passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await choose(page, 'Bey County.fountain', FOUNTAIN);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).include('dialog').withTags(tags).analyze()).violations).toEqual([]);
  });
}

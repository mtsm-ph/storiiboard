import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Export (1.24) in the memory build, where each file downloads: the shot list CSV's text, the PNG frames' names and
// sizes, and the watermark set in Watermark Settings.

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
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

async function projectMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: item, exact: true }).click();
}

/** A PNG's width and height, from its header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('exports the shot list as CSV, one row per frame', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await expect(dialog(page, 'Export')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await dialog(page, 'Export').getByRole('button', { name: 'Save…' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Bey County shot list.csv');
  const text = readFileSync(await file.path(), 'utf8');
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  expect(lines[0]).toMatch(/^Scene,Heading,Length,Location,Shot,Size/);
  expect(lines.slice(1).map((l) => l.split(',')[4])).toEqual(['1A', '1B']);
  await expect(page.getByRole('status').getByText('Exported 2 frames to “Bey County shot list.csv”.')).toBeVisible();
});

test('exports each frame as a PNG named as on the slate, at full HD', async ({ page }) => {
  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
  const files: Download[] = [];
  page.on('download', (download) => files.push(download));
  await dialog(page, 'Export').getByRole('button', { name: 'Choose folder…' }).click();
  await expect.poll(() => files.length).toBe(2);
  expect(files.map((f) => f.suggestedFilename()).sort()).toEqual(['SC001_1A.png', 'SC001_1B.png']);
  for (const file of files) expect(pngSize(await file.path())).toEqual({ width: 1920, height: 1080 });
});

test('Watermark Settings saves one edit, and the Export dialog says the PNGs carry it', async ({ page }) => {
  await projectMenu(page, 'Watermark Settings');
  const settings = dialog(page, 'Watermark Settings');
  await settings.getByLabel('Text').fill('DRAFT');
  await settings.getByRole('combobox', { name: /^Position/ }).selectOption({ label: 'Centre' });
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await projectMenu(page, 'Export Project…');
  await dialog(page, 'Export').getByLabel('Frames (PNG)').check();
  await expect(dialog(page, 'Export')).toContainText('Watermark “DRAFT”, centre.');
  // The CSV is a report: it carries none.
  await dialog(page, 'Export').getByLabel('Shot list (CSV)').check();
  await expect(dialog(page, 'Export')).toContainText('No watermark.');
});

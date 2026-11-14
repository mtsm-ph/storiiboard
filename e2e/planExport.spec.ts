import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Plans on paper (6.10) in the memory build, where each file downloads: a setup's plan with a 4 m wall and a camera
// shooting two frames exported from the Plan tile's Export menu as a PDF (one A4 landscape page, its words real text:
// the header, the scale, the legend, the frames) and as a PNG at 200 dpi; the scene's plans, a page per setup; a shoot
// day's plans from Shoot days, and a day with nothing to print saying so; the page's words in Spanish; and axe on the
// Export menu and the Export window. The canvas is pixels, so the plan is read from the data its tile keeps.

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
  const add = storyboard(page).getByRole('button', { name: '+ Frame in SC 01' });
  await add.click();
  await add.click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(2);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const framesTile = (page: Page) => page.getByRole('region', { name: 'Frames in setup', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export' });
const planData = async (page: Page): Promise<{ id: string; kind: string; width: number }[]> =>
  JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as { id: string; kind: string; width: number }[];

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/**
 * SC 01's Setup 1 with both frames, its room started, a 4 m wall across it and a camera shooting both frames; in metres
 * whatever this computer's region says.
 */
async function furnishedSetup(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(2);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('w');
  for (const x of [-200, 200]) {
    const at = await screen(page, x, -100);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'wall').map((w) => w.width)).toEqual([4]);
  await canvas(page).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'camera').length).toBe(1);
  for (const frame of ['1A', '1B']) await framesTile(page).getByRole('combobox', { name: `Camera for ${frame}` }).selectOption({ index: 1 });
  await expect(framesTile(page).locator('[data-frames-camera=""]')).toHaveCount(0);
}

/** The Plan tile's Export menu, one of its commands. */
async function fromPlan(page: Page, id: 'plan-setup-pdf' | 'plan-setup-png' | 'plan-scene-pdf') {
  // By its data, so it is found in either language.
  await page.locator('[data-plan-tile] [data-plan-heading]').getByRole('button', { name: /^Export…$|^Exportar…$/ }).click();
  await page.locator(`[data-plan-export="${id}"]`).click();
  await expect(dialog(page).or(page.getByRole('dialog', { name: 'Exportar' }))).toBeVisible();
}

/** Save in the open Export window: what downloads. */
async function save(page: Page, name = 'Save…'): Promise<Download> {
  const waiting = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name }).click();
  return waiting;
}

const bytesOf = async (download: Download): Promise<Uint8Array> => new Uint8Array(readFileSync(await download.path()));

/** Each page's text, as a reader finds it. */
async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    // A reader breaks a line where its runs change face; the words are what count.
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  await pdf.destroy();
  return texts;
}

/** A PNG's width and height, from its header. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

test('exports the setup’s plan as a PDF and a PNG and the scene’s plans from the Plan tile’s Export menu', async ({ page }) => {
  await furnishedSetup(page);

  await fromPlan(page, 'plan-setup-pdf');
  await expect(dialog(page).getByRole('radio', { name: 'Setup plan (PDF)' })).toBeChecked();
  await dialog(page).getByRole('combobox', { name: 'Paper' }).selectOption('a4');
  await expect(dialog(page)).toContainText('1 plan to print');
  // No choice of scenes: it is for the setup shown.
  await expect(dialog(page).getByRole('combobox', { name: /^Scenes/ })).toHaveCount(0);
  const pdf = await save(page);
  expect(pdf.suggestedFilename()).toBe('Bey County SC001 Setup 1 plan.pdf');
  const bytes = await bytesOf(pdf);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const [first] = doc.getPages();
  expect([first?.getWidth(), first?.getHeight()]).toEqual([841.89, 595.28]);
  const [text] = await pdfTexts(bytes);
  expect(text).toContain('Bey County');
  expect(text).toContain('SC 01');
  expect(text).toContain('Setup 1');
  expect(text).toMatch(/Scale 1:\d+/);
  expect(text).toContain('Page 1 of 1');
  expect(text).toContain('LEGEND');
  expect(text).toContain('FRAMES');
  expect(text).toContain('1A');
  expect(text).toContain('1B');

  await fromPlan(page, 'plan-setup-png');
  await expect(dialog(page).getByRole('radio', { name: 'Setup plan (PNG)' })).toBeChecked();
  const png = await save(page);
  expect(png.suggestedFilename()).toBe('Bey County SC001 Setup 1 plan.png');
  const picture = await bytesOf(png);
  expect(Array.from(picture.slice(1, 4), (c) => String.fromCharCode(c)).join('')).toBe('PNG');
  // A4 landscape at 200 dpi.
  expect(pngSize(picture)).toEqual({ width: 2339, height: 1654 });

  // A second setup: the scene's plans are a page for each, in setup order.
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await fromPlan(page, 'plan-scene-pdf');
  await expect(dialog(page).getByRole('radio', { name: 'Scene plans (PDF)' })).toBeChecked();
  await expect(dialog(page)).toContainText('2 plans to print');
  const packet = await save(page);
  expect(packet.suggestedFilename()).toBe('Bey County SC001 plans.pdf');
  const packetBytes = await bytesOf(packet);
  expect((await PDFDocument.load(packetBytes)).getPageCount()).toBe(2);
  const texts = await pdfTexts(packetBytes);
  expect(texts[0]).toContain('Setup 1');
  expect(texts[0]).toContain('Page 1 of 2');
  expect(texts[1]).toContain('Setup 2');
  expect(texts[1]).toContain('Page 2 of 2');
});

test('exports a shoot day’s plans from Shoot days, and a day with nothing to print says so', async ({ page }) => {
  await furnishedSetup(page);
  await toSection(page, 'Production');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const editor = days(page).locator('[data-day-editor]');
  await editor.getByLabel('Date').fill('2026-11-16');
  await editor.getByLabel('Date').blur();
  await editor.getByRole('button', { name: 'Add all 2 from SC 01 to Day 1 · Mon, Nov 16' }).click();
  await editor.getByRole('button', { name: 'Plans (PDF) for Day 1 · Mon, Nov 16' }).click();
  await expect(dialog(page).getByRole('radio', { name: 'Shoot day plans (PDF)' })).toBeChecked();
  await dialog(page).getByRole('combobox', { name: 'Paper' }).selectOption('letter');
  const download = await save(page);
  expect(download.suggestedFilename()).toBe('Bey County Day 1 plans.pdf');
  const bytes = await bytesOf(download);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect([doc.getPages()[0]?.getWidth(), doc.getPages()[0]?.getHeight()]).toEqual([792, 612]);
  const [text] = await pdfTexts(bytes);
  expect(text).toContain('Day 1 · Mon, Nov 16');
  expect(text).toContain('Setup 1');

  // A day with no frames: nothing to print, and nothing is written.
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await editor.getByRole('button', { name: /^Plans \(PDF\) for Day 2/ }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('Nothing to print here: no setup has a frame to shoot.');
  await expect(dialog(page).getByRole('button', { name: 'Save…' })).toBeDisabled();
});

test('prints the page’s words in Spanish with the language set to es', async ({ page }) => {
  await furnishedSetup(page);
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'App language' }).selectOption('es');
  await page.keyboard.press('Escape');
  await fromPlan(page, 'plan-setup-pdf');
  const exportar = page.getByRole('dialog', { name: 'Exportar' });
  await expect(exportar.getByRole('radio', { name: 'Planta del emplazamiento (PDF)' })).toBeChecked();
  const download = await save(page, 'Guardar…');
  expect(download.suggestedFilename()).toBe('planta de Bey County SC001 Emplazamiento 1.pdf');
  const [text] = await pdfTexts(await bytesOf(download));
  expect(text).toContain('ESC 01');
  expect(text).toContain('Emplazamiento 1');
  expect(text).toMatch(/Escala 1:\d+/);
  expect(text).toContain('Página 1 de 1');
  expect(text).toContain('LEYENDA');
  expect(text).toContain('CUADROS');
});

test('the Export menu and the Export window pass axe', async ({ page }) => {
  await furnishedSetup(page);
  await planTile(page).locator('[data-plan-heading]').getByRole('button', { name: 'Export…' }).click();
  await expect(page.locator('[data-plan-export="plan-setup-pdf"]')).toBeFocused();
  const menu = await new AxeBuilder({ page }).include('[data-plan-heading]').analyze();
  expect(menu.violations).toEqual([]);
  await page.locator('[data-plan-export="plan-setup-png"]').click();
  await expect(dialog(page)).toBeVisible();
  const window = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(window.violations).toEqual([]);
});

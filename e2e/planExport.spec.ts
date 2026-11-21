import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
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
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
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

test('Units on paper start as this computer’s plan units; feet on paper print in feet, and the scale bar can show both (Kevin, Nov 18)', async ({ page }) => {
  await furnishedSetup(page);
  // In metres here (furnishedSetup sets them): the export starts in metres, one bar.
  await fromPlan(page, 'plan-setup-pdf');
  const units = dialog(page).getByRole('combobox', { name: 'Printed units' });
  await expect(units).toHaveValue('metres');
  const both = dialog(page).getByRole('switch', { name: 'Scale bar in meters and feet' });
  await expect(both).toHaveAttribute('aria-checked', 'false');
  // Feet on paper: the scale in inches to the foot, the bar in feet, no metres.
  await units.selectOption({ label: 'Feet and inches' });
  const [feet] = await pdfTexts(await bytesOf(await save(page)));
  expect(feet).toMatch(/Scale \d+(\/\d+)?" = 1'-0"/);
  expect(feet).toMatch(/\b\d+(\.\d+)? ft\b/);
  expect(feet).not.toMatch(/\b\d+(\.\d+)? m\b/);

  // The plan's m | ft switch sets this computer's plan units at once: the next export starts in feet.
  const switchUnits = planTile(page).getByRole('group', { name: 'Plan units' });
  await switchUnits.getByRole('button', { name: 'ft (feet)' }).click();
  await expect(switchUnits.getByRole('button', { name: 'ft (feet)' })).toHaveAttribute('aria-pressed', 'true');
  await fromPlan(page, 'plan-setup-pdf');
  await expect(dialog(page).getByRole('combobox', { name: 'Printed units' })).toHaveValue('feet');
  // Both bars, metres above feet, on feet's scale.
  await dialog(page).getByRole('switch', { name: 'Scale bar in meters and feet' }).click();
  const [twice] = await pdfTexts(await bytesOf(await save(page)));
  expect(twice).toMatch(/Scale \d+(\/\d+)?" = 1'-0"/);
  const metresAt = twice?.search(/\b\d+(\.\d+)? m\b/) ?? -1;
  const feetAt = twice?.search(/\b\d+(\.\d+)? ft\b/) ?? -1;
  expect(metresAt).toBeGreaterThan(-1);
  expect(feetAt).toBeGreaterThan(metresAt);
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
  // Applied as Settings closes (Kevin, Nov 17).
  await closeSettings(page, 'apply');
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

// 6.10's review: what the PDF and the PNG hold of the plan's own drawing, read from the files themselves (the unit tests
// read a stand-in for PageStage; these read what PageStage drew): the wall measured in page 1's content stream, the
// cone's transparency in its graphics states, the camera's own label as text, the PNG decoded and looked at, a real
// underlay printed dimmed (and not at all with the switch off), and every entry's count and name against what it wrote.

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
const mul = (first: Matrix, second: Matrix): Matrix => {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
};

/** Page 1's content, its streams in order, decoded. */
function pageContent(doc: PDFDocument): string {
  const node = doc.getPages()[0]?.node;
  const contents = node?.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return refs
    .map((ref) => doc.context.lookup(ref))
    .flatMap((stream) => (stream instanceof PDFRawStream ? [new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())] : []))
    .join('\n');
}

/** Page 1's graphics states by name, each with its non-stroking alpha (ca). */
function graphicsStates(doc: PDFDocument): Map<string, number> {
  const out = new Map<string, number>();
  const states = doc.getPages()[0]?.node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
  for (const [name, ref] of states?.entries() ?? []) {
    const ca = doc.context.lookup(ref, PDFDict).get(PDFName.of('ca'));
    if (ca) out.set(name.asString(), Number(String(ca)));
  }
  return out;
}

/** Page 1's Image XObjects' names. */
function pageImages(doc: PDFDocument): string[] {
  const xobjects = doc.getPages()[0]?.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  return (xobjects?.entries() ?? []).flatMap(([name, ref]) => {
    const object = doc.context.lookup(ref);
    return object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [name.asString()] : [];
  });
}

/**
 * Page 1's content stream walked as a reader draws it: q, Q, cm and gs followed, every filled path's points in PDF points
 * (`filled`, and in `fills` with the fill alpha it was filled at), and each XObject drawn with the fill alpha it was drawn at.
 */
function walk(doc: PDFDocument): { filled: Point[][]; fills: { points: Point[]; alpha: number }[]; drawn: { name: string; alpha: number }[] } {
  const alphas = graphicsStates(doc);
  const stack: { m: Matrix; alpha: number }[] = [{ m: [1, 0, 0, 1, 0, 0], alpha: 1 }];
  const filled: Point[][] = [];
  const fills: { points: Point[]; alpha: number }[] = [];
  const drawn: { name: string; alpha: number }[] = [];
  let operands: string[] = [];
  let path: Point[] = [];
  for (const token of pageContent(doc).split(/\s+/)) {
    const top = stack[stack.length - 1] ?? { m: [1, 0, 0, 1, 0, 0] as Matrix, alpha: 1 };
    if (/^-?[\d.]+$/.test(token) || token.startsWith('/')) {
      operands.push(token);
      continue;
    }
    const n = operands.map(Number);
    if (token === 'q') stack.push({ ...top });
    else if (token === 'Q') stack.pop();
    else if (token === 'cm') top.m = mul(n.slice(-6) as Matrix, top.m);
    else if (token === 'gs') top.alpha = alphas.get(operands[operands.length - 1] ?? '') ?? top.alpha;
    else if (token === 'm' || token === 'l') {
      const [x = 0, y = 0] = n.slice(-2);
      path.push({ x: top.m[0] * x + top.m[2] * y + top.m[4], y: top.m[1] * x + top.m[3] * y + top.m[5] });
    } else if (token === 'f' || token === 'B' || token === 'f*') {
      filled.push(path);
      fills.push({ points: path, alpha: top.alpha });
      path = [];
    } else if (token === 'S' || token === 'n') path = [];
    else if (token === 'Do') drawn.push({ name: operands[operands.length - 1] ?? '', alpha: top.alpha });
    operands = [];
  }
  return { filled, fills, drawn };
}

/** A triangle's area, PDF points squared. */
const triangleArea = ([a, b, c]: readonly Point[]) => (a && b && c ? Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2 : 0);

const longestSide = (points: readonly Point[]) => Math.max(...points.map((p, i) => Math.hypot(p.x - (points[(i + 1) % points.length]?.x ?? p.x), p.y - (points[(i + 1) % points.length]?.y ?? p.y))));

/** The Gear tile's FX3, in full frame, so the camera has a body, and 1A on a 35 mm lens. */
async function bodyAndLens(page: Page) {
  await toSection(page, 'Production');
  const gear = page.getByRole('region', { name: 'Gear', exact: true });
  const editor = gear.locator('[data-gear-editor]');
  await gear.getByRole('button', { name: '+ New item' }).click();
  await expect(editor.getByLabel('Name')).toBeFocused();
  await page.keyboard.type('FX3');
  await page.keyboard.press('Enter');
  await editor.getByRole('radio', { name: 'Camera body', exact: true }).click();
  await editor.getByLabel('Camera and recording mode').selectOption({ label: 'Sony FX3: Full frame 16:9, 35.6 × 20 mm' });
  await toSection(page, 'Storyboard');
  await storyboard(page).locator('[data-shot-id]').first().click();
  const lens = page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('textbox', { name: 'Lens (mm)', exact: true });
  await lens.fill('35');
  await lens.press('Enter');
  await expect(lens).toHaveValue('35');
}

/** Each text item of page 1, as a reader finds it. */
async function pdfItems(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  await pdf.destroy();
  return content.items.map((item) => ('str' in item ? item.str.trim() : '')).filter((s) => s !== '');
}

test('prints the plan’s own drawing: the wall to scale, the cone’s transparency, the camera’s label, and the PNG looks the same', async ({ page }) => {
  await bodyAndLens(page);
  await furnishedSetup(page);
  // A second 4 m wall 3 m below the first, so the room is too tall for 1:25 and prints at 1:50.
  await canvas(page).focus();
  await page.keyboard.press('w');
  for (const x of [-200, 200]) {
    const at = await screen(page, x, 200);
    await page.mouse.click(at.x, at.y);
  }
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'wall').map((w) => w.width)).toEqual([4, 4]);
  // A fresnel from the L tool, its beam a wedge at 18%.
  await canvas(page).focus();
  await page.keyboard.press('l');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'light').length).toBe(1);

  await fromPlan(page, 'plan-setup-pdf');
  await dialog(page).getByRole('combobox', { name: 'Paper' }).selectOption('a4');
  const bytes = await bytesOf(await save(page));
  const doc = await PDFDocument.load(bytes);
  const [text] = await pdfTexts(bytes);
  expect(text).toContain('Scale 1:50');
  expect(text).toContain('Print at actual size (100%)');
  const { filled, fills } = walk(doc);
  // The 4.00 m wall at 1:50: 80 mm of paper, 226.77 pt, a filled four-point path.
  const walls = filled.filter((p) => p.length === 4).map(longestSide);
  expect(walls.some((length) => Math.abs(length - (4000 / 50) * (72 / 25.4)) < 0.1)).toBe(true);
  // The camera's cone, drawn past its box by PageStage itself, at its 8%: the largest filled triangle on the page (its
  // apex at the camera, its two far corners at its length), filled at that alpha, not merely some state holding 0.08.
  expect([...graphicsStates(doc).values()].some((ca) => Math.abs(ca - 0.08) < 1e-6)).toBe(true);
  const triangles = fills.filter((f) => f.points.length === 3).sort((a, b) => triangleArea(b.points) - triangleArea(a.points));
  expect(triangleArea(triangles[0]?.points ?? [])).toBeGreaterThan(1000);
  expect(triangles[0]?.alpha).toBeCloseTo(0.08, 6);
  // The light's beam, a filled wedge (its arc's curves aside, its centre and its start), at its own 18%.
  expect(fills.some((f) => Math.abs(f.alpha - 0.18) < 1e-6)).toBe(true);
  // The frame's lens in the Frames block, and the label only the plan draws, beside the camera: one run of its own.
  expect(text).toMatch(/1A( · \w+)? · 35 mm · 53\.9°/);
  expect(await pdfItems(bytes)).toContain('A · 35 mm · 53.9°');

  // The PNG, decoded in the page: ink along the wall's middle, paper in the margin.
  const wall = filled.find((p) => p.length === 4 && Math.abs(longestSide(p) - (4000 / 50) * (72 / 25.4)) < 0.1) ?? [];
  await fromPlan(page, 'plan-setup-png');
  const picture = await bytesOf(await save(page));
  const height = 595.28;
  const px = 200 / 72;
  const xs = wall.map((p) => p.x);
  const ys = wall.map((p) => p.y);
  const row = (height - (Math.min(...ys) + Math.max(...ys)) / 2) * px;
  const along = Array.from({ length: 9 }, (_, i) => (Math.min(...xs) + ((i + 1) / 10) * (Math.max(...xs) - Math.min(...xs))) * px);
  const samples = await page.evaluate(
    async ({ data, points }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
    },
    { data: Array.from(picture), points: [...along.map((x): [number, number] => [x, row]), [10, 10] as [number, number], [2300, 1640] as [number, number]] },
  );
  const ink = samples.slice(0, along.length);
  const paper = samples.slice(along.length);
  for (const rgb of ink) expect(Math.max(...rgb)).toBeLessThan(80);
  for (const rgb of paper) expect(Math.min(...rgb)).toBeGreaterThan(245);
});

test('prints a real underlay dimmed from its picture, and none with the Underlay switch off', async ({ page }) => {
  await furnishedSetup(page);
  await planTile(page).getByRole('button', { name: /^Room: / }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Add underlay…' }).or(page.locator('[data-add-underlay]')).first().click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'underlay').length).toBe(1);

  await fromPlan(page, 'plan-setup-pdf');
  const withIt = await PDFDocument.load(await bytesOf(await save(page)));
  const images = pageImages(withIt);
  expect(images).toHaveLength(1);
  // Drawn once, at the dimming's alpha (the canvas's DIM_OPACITY, 0.45).
  expect(walk(withIt).drawn.filter((d) => images.includes(d.name)).map((d) => Math.round(d.alpha * 1000) / 1000)).toEqual([0.45]);

  await fromPlan(page, 'plan-setup-pdf');
  await dialog(page).getByRole('switch', { name: 'Underlay' }).click();
  const without = await PDFDocument.load(await bytesOf(await save(page)));
  expect(pageImages(without)).toEqual([]);
  expect(walk(without).drawn).toEqual([]);
});

test('every entry’s count is the pages it writes and its name the file it saves, whichever format is picked', async ({ page }) => {
  await furnishedSetup(page);
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();

  /** Picks a format in the open window, reads its count, saves, and checks the pages and the name against the notice. */
  async function check(format: string, pages: number | null) {
    await dialog(page).getByRole('radio', { name: format }).click();
    const said = Number(/(\d+) plans? to print/.exec((await dialog(page).textContent()) ?? '')?.[1] ?? NaN);
    const download = await save(page);
    const name = download.suggestedFilename();
    await expect(page.getByRole('status').getByText(new RegExp(`to “${name.replace(/[.()]/g, '\\$&')}”\\.`)).last()).toBeVisible();
    const bytes = await bytesOf(download);
    if (name.endsWith('.png')) expect(said).toBe(1);
    else expect((await PDFDocument.load(bytes)).getPageCount()).toBe(said);
    if (pages !== null) expect(said).toBe(pages);
    return { name, bytes };
  }

  // From each of the Plan tile's entries, every plan format.
  for (const entry of ['plan-setup-pdf', 'plan-setup-png', 'plan-scene-pdf'] as const) {
    await fromPlan(page, entry);
    const setup = await check('Setup plan (PDF)', 1);
    expect(setup.name).toMatch(/^Bey County SC001 Setup [12] plan\.pdf$/);
    const shown = /Setup (\d)/.exec(setup.name)?.[1] ?? '';
    expect((await pdfTexts(setup.bytes))[0]).toContain(`Setup ${shown}`);
    await fromPlan(page, entry);
    expect((await check('Setup plan (PNG)', 1)).name).toBe(`Bey County SC001 Setup ${shown} plan.png`);
    await fromPlan(page, entry);
    expect((await check('Scene plans (PDF)', 2)).name).toBe('Bey County SC001 plans.pdf');
  }

  // From Export Project: the scene packet, for the whole project and for the scene.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  expect((await check('Scene plans (PDF)', 2)).name).toBe('Bey County plans.pdf');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await dialog(page).getByRole('radio', { name: 'Scene plans (PDF)' }).click();
  await dialog(page).getByRole('combobox', { name: /^Scenes/ }).selectOption({ index: 1 });
  expect((await check('Scene plans (PDF)', 2)).name).toBe('Bey County SC001 plans.pdf');
});

// 6.10's review, round two: a page is left out only when it has nothing drawn and no frames to list; a packet's result
// says how many it left out.

test('a setup with frames and nothing drawn prints its frames, in the scene’s and the day’s plans, and the packet says what it left out', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
  // SC 01's Setup 1 with both frames and Setup 2 with none; no room, nothing drawn.
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(2);
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(setupsTile(page).locator('[data-setup-select]')).toHaveCount(2);

  // The Plan tile has no Export menu with no room, so the scene's plans come from Export Project.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await dialog(page).getByRole('radio', { name: 'Scene plans (PDF)' }).click();
  await expect(dialog(page)).toContainText('1 plan to print');
  const packet = await bytesOf(await save(page));
  expect((await PDFDocument.load(packet)).getPageCount()).toBe(1);
  const [text] = await pdfTexts(packet);
  for (const words of ['Setup 1', 'No room drawn', 'FRAMES', '1A', '1B']) expect(text).toContain(words);
  // A warning, so it stays until it's dismissed.
  await expect(page.getByRole('alert').filter({ hasText: 'Exported 1 page to “Bey County plans.pdf”. 1 setup left out: nothing drawn and no frames.' })).toBeVisible();

  // The day's plans: the setup with frames that day, every time.
  await toSection(page, 'Production');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const editor = days(page).locator('[data-day-editor]');
  await editor.getByLabel('Date').fill('2026-11-16');
  await editor.getByLabel('Date').blur();
  await editor.getByRole('button', { name: 'Add all 2 from SC 01 to Day 1 · Mon, Nov 16' }).click();
  await editor.getByRole('button', { name: 'Plans (PDF) for Day 1 · Mon, Nov 16' }).click();
  await expect(dialog(page)).toContainText('1 plan to print');
  const day = await bytesOf(await save(page));
  expect((await PDFDocument.load(day)).getPageCount()).toBe(1);
  const [dayText] = await pdfTexts(day);
  for (const words of ['Day 1 · Mon, Nov 16', 'Setup 1', 'No room drawn', '1A', '1B']) expect(dayText).toContain(words);
});

test('prints the lighting department alone: chosen in the Export window, the file named for it, a page for the setup, and the scene’s pages per department (6.17)', async ({ page }) => {
  await furnishedSetup(page);
  // A light beside the camera: the L tool from the keyboard, in the middle of the view.
  await canvas(page).focus();
  await page.keyboard.press('l');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planData(page)).filter((item) => item.kind === 'light').length).toBe(1);

  await fromPlan(page, 'plan-setup-pdf');
  const departments = dialog(page).getByRole('combobox', { name: 'Departments' });
  await expect(departments).toHaveValue('everything');
  await departments.selectOption({ label: 'Lighting' });
  await expect(dialog(page)).toContainText('1 plan to print: Lighting and the room, nothing selected.');
  const pdf = await save(page);
  expect(pdf.suggestedFilename()).toBe('Bey County SC001 Setup 1 Lighting plan.pdf');
  const bytes = await bytesOf(pdf);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  const [text] = await pdfTexts(bytes);
  expect(text).toContain('Setup 1 · Lighting');
  expect(text).toContain('LIGHTING');
  // The camera's department and its frames are left out of lighting's print.
  expect(text).not.toContain('FRAMES');

  // Each department of the scene: the camera's page and the lighting's, the art's left out (the room's walls alone).
  await fromPlan(page, 'plan-scene-pdf');
  await expect(departments).toHaveValue('everything');
  await departments.selectOption({ label: 'Each department' });
  await expect(dialog(page)).toContainText('2 plans to print: a page for each department with something on it, nothing selected.');
  const packet = await save(page);
  expect(packet.suggestedFilename()).toBe('Bey County SC001 departments plans.pdf');
  const texts = await pdfTexts(await bytesOf(packet));
  expect(texts).toHaveLength(2);
  expect(texts[0]).toContain('Setup 1 · Camera');
  expect(texts[1]).toContain('Setup 1 · Lighting');
});

test('a plan’s PDF and PNG carry the project’s watermark when Watermark Settings say so (6.17)', async ({ page }) => {
  await furnishedSetup(page);
  /**
   * How many pixels of a region (shares of the picture's width and height) differ between two PNGs by more than 24 on any
   * channel: the stamp drawn over the plan changes its pixels, whatever colour the plan has under it in either engine.
   */
  const changedPixels = (one: Uint8Array, two: Uint8Array, region: { x: number; y: number; width: number; height: number }) =>
    page.evaluate(
      async ({ a, b, region }) => {
        const pixels = async (base64: string) => {
          const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
          const sheet = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = sheet.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(bitmap, 0, 0);
          const x = Math.round(bitmap.width * region.x);
          const y = Math.round(bitmap.height * region.y);
          return { size: `${String(bitmap.width)}x${String(bitmap.height)}`, data: ctx.getImageData(x, y, Math.round(bitmap.width * region.width), Math.round(bitmap.height * region.height)).data };
        };
        const [first, second] = [await pixels(a), await pixels(b)];
        if (!first || !second || first.size !== second.size) return -1;
        let changed = 0;
        for (let i = 0; i < first.data.length; i += 4) {
          for (let c = 0; c < 4; c += 1) {
            if (Math.abs((first.data[i + c] ?? 0) - (second.data[i + c] ?? 0)) > 24) {
              changed += 1;
              break;
            }
          }
        }
        return changed;
      },
      { a: Buffer.from(one).toString('base64'), b: Buffer.from(two).toString('base64'), region },
    );
  const exportPng = async () => {
    await fromPlan(page, 'plan-setup-png');
    return bytesOf(await save(page));
  };
  // Before any watermark: the PDF has no stamp; the PNG is kept to compare with the stamped one.
  await fromPlan(page, 'plan-setup-pdf');
  await expect(dialog(page)).toContainText('No watermark.');
  const [plain] = await pdfTexts(await bytesOf(await save(page)));
  expect(plain).not.toContain('DRAFT STAMP');
  const before = await exportPng();

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Watermark Settings…', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Watermark Settings' });
  await settings.getByLabel('Text').fill('DRAFT STAMP');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  await fromPlan(page, 'plan-setup-pdf');
  await expect(dialog(page)).toContainText('Watermark “DRAFT STAMP”, bottom right.');
  const [text] = await pdfTexts(await bytesOf(await save(page)));
  expect(text).toContain('DRAFT STAMP');
  const after = await exportPng();
  // The stamp changes the plan box's bottom right corner, where it goes (Kevin, Nov 15: inside the plan box, above its
  // foot band; this plan is wide, so its legend is the band under it), and nothing in the top left quarter, far from it.
  expect(await changedPixels(before, after, { x: 0.73, y: 0.53, width: 0.2, height: 0.04 })).toBeGreaterThan(100);
  // Its old place, the page's own bottom right corner, now inside the legend band, is untouched.
  expect(await changedPixels(before, after, { x: 0.7, y: 0.9, width: 0.3, height: 0.1 })).toBe(0);
  expect(await changedPixels(before, after, { x: 0, y: 0, width: 0.5, height: 0.5 })).toBe(0);
});

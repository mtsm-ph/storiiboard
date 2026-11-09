import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Assets and attachments (3.11) in the memory build: a link on the project, a PDF on a frame (kept in the project,
// checked to be a PDF), saved out as a copy, renamed, deleted to the Trash and restored.

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
  await page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Assets/ }).click();
});

const assets = (page: Page) => page.getByRole('region', { name: 'Assets', exact: true });
const pdf = (name: string, text: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(text) });

test('a link on the project and a PDF on a frame: saved out, renamed, deleted and restored', async ({ page }) => {
  await expect(assets(page)).toContainText('No PDFs or links yet.');

  // A link on the project: a bare address gets https://.
  await assets(page).getByLabel('Link', { exact: true }).fill('vimeo.com/123');
  await assets(page).getByLabel('Title', { exact: true }).fill('Look');
  await assets(page).getByRole('button', { name: 'Add link' }).click();
  const onProject = assets(page).getByRole('region', { name: 'Project' });
  await expect(onProject).toContainText('https://vimeo.com/123');
  await expect(onProject.getByRole('textbox', { name: 'Title, Look' })).toHaveValue('Look');
  // Focus stays in the address, ready for the next.
  await expect(assets(page).getByLabel('Link', { exact: true })).toBeFocused();

  // A PDF on frame 1A; a file that isn't one is said and skipped.
  await assets(page).getByLabel('Attach to').selectOption({ index: 2 });
  const chooser = page.waitForEvent('filechooser');
  await assets(page).getByRole('button', { name: 'Add PDF…' }).click();
  await (await chooser).setFiles([pdf('Contract.pdf', '%PDF-1.4\n% a release\n'), pdf('fake.pdf', 'Hello')]);
  const onFrame = assets(page).getByRole('region', { name: 'Frame 1A' });
  await expect(onFrame).toContainText('1 KB');
  await expect(onFrame.getByRole('textbox', { name: 'File name, Contract.pdf' })).toHaveValue('Contract.pdf');
  await expect(page.getByText('fake.pdf isn’t a PDF.')).toBeVisible();
  await expect(assets(page)).toContainText('2 attachments');

  // Out as a copy, under its name.
  const download = page.waitForEvent('download');
  await onFrame.getByRole('button', { name: 'Save a copy…, Contract.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('Contract.pdf');

  // Opened (3.12): the link in a new tab, the PDF as the browser shows one (the desktop opens a read-only copy in the
  // PDF reader). Nothing leaves the test: the link's page is answered here.
  await page.context().route('https://vimeo.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const linkTab = page.waitForEvent('popup');
  await onProject.getByRole('button', { name: 'Open, Look' }).click();
  await (await linkTab).waitForURL('https://vimeo.com/123');
  // Headless Chromium has no PDF viewer to open the tab with, so what the tab is given is checked instead.
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { opened: string[] }).opened = opened;
    window.open = (url) => {
      opened.push(String(url));
      return null;
    };
  });
  await onFrame.getByRole('button', { name: 'Open, Contract.pdf' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([expect.stringMatching(/^blob:/)]);

  // A name Save a copy couldn't use is refused, and the field goes back.
  const named = onFrame.getByRole('textbox', { name: 'File name, Contract.pdf' });
  await named.fill('a/b.pdf');
  await named.press('Enter');
  await expect(named).toHaveValue('Contract.pdf');
  await expect(page.getByText('That name can’t be used for a PDF', { exact: false })).toBeVisible();

  // Renamed in place.
  const name = onFrame.getByRole('textbox', { name: 'File name, Contract.pdf' });
  await name.fill('Release.pdf');
  await name.press('Enter');
  await expect(onFrame.getByRole('textbox', { name: 'File name, Release.pdf' })).toBeVisible();

  const results = await new AxeBuilder({ page }).include('[aria-label="Assets"]').analyze();
  expect(results.violations).toEqual([]);

  // To the Trash and back.
  await onFrame.getByRole('button', { name: 'Delete, Release.pdf' }).click();
  await expect(assets(page)).toContainText('1 attachment');
  await expect(assets(page).getByLabel('Attach to')).toBeFocused();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: /^Restore attachment Release\.pdf \(PDF\)/ }).click();
  await expect(assets(page)).toContainText('2 attachments');
});

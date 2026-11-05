import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { setLocale, t } from '../src/core/i18n';
import { SETTINGS_KEY } from '../src/core/storage/settings';

// Every screen, in both themes and both languages (quality pass, Nov 5): axe's WCAG 2.2 A and AA checks (names, roles,
// contrast), and a walk with Tab from each screen's first stop: every stop shows a focus ring, and focus never falls
// to nothing. Labels come from the translation files, so the same steps run in English and Spanish.
// Run on a Mac too (`npm run e2e` runs WebKit there): Safari's Tab can differ.

test.setTimeout(300_000);
test.use({ viewport: { width: 1440, height: 900 } });

const picture = fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * What one screen got wrong: axe's rules, and Tab stops without a visible ring, covered by something else, or with
 * focus lost. `from`: the walk starts at the first stop inside that box, rather than wherever focus was left.
 */
async function audit(page: Page, screen: string, problems: string[], { tabs = 25, from }: { tabs?: number; from?: string } = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const say = (problem: string) => {
    problems.push(problem);
    console.log(problem);
  };
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (violations.length > 0) await page.screenshot({ path: test.info().outputPath(`axe-${screen.replace(/\W+/g, '-')}.png`) });
  for (const v of violations) say(`${screen}: axe ${v.id} on ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(', ')}`);
  // Contrast axe couldn't settle (text over overlapping boxes, a semi-transparent fill), worked out here against the
  // nearest solid fill behind the text, and held to AA. Text straight on the shell's paper grain is left out: the grain
  // is a background image under a solid colour, and the colour tokens have their own tests for those pairs.
  const unsettled = incomplete
    .filter((v) => v.id === 'color-contrast')
    .flatMap((v) => v.nodes)
    .filter((node) => !node.any.some((check) => (check.data as { messageKey?: string } | null)?.messageKey === 'bgImage'))
    .map((node) => node.target.join(' '));
  const low = await page.evaluate((selectors) => {
    const rgba = (text: string) => {
      const [r = 0, g = 0, b = 0, a = 1] = (text.match(/[\d.]+/g) ?? []).map(Number);
      return { r, g, b, a: text.startsWith('rgba') ? a : 1 };
    };
    const over = (top: ReturnType<typeof rgba>, under: ReturnType<typeof rgba>) => ({
      r: top.r * top.a + under.r * (1 - top.a),
      g: top.g * top.a + under.g * (1 - top.a),
      b: top.b * top.a + under.b * (1 - top.a),
      a: 1,
    });
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) =>
      {
      const [lr, lg, lb] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const out: string[] = [];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      // The fills behind it, nearest first, down to the first solid one.
      const fills: ReturnType<typeof rgba>[] = [];
      const raw: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        raw.push(colour);
        const fill = rgba(colour);
        if (fill.a > 0) fills.push(fill);
        if (fill.a >= 1) break;
      }
      const style = getComputedStyle(el);
      // Only colours this reads (rgb and rgba); anything else (a color-mix, oklab) is said, not measured wrongly.
      const unread = [style.color, ...raw].find((c) => !c.startsWith('rgb'));
      if (unread !== undefined) {
        out.push(`${selector} has a colour this can't read (${unread})`);
        continue;
      }
      // Only text whose fills are what's behind it: under something else (a picture, a box over it), skipped.
      const box = el.getBoundingClientRect();
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (at && at !== el && !at.contains(el) && !el.contains(at)) continue;
      const background = fills.reverse().reduce((under, top) => over(top, under), { r: 255, g: 255, b: 255, a: 1 });
      const foreground = over(rgba(style.color), background);
      const [hi, lo] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push(`${selector} ${ratio.toFixed(2)}:1 "${el.textContent.trim().slice(0, 20)}"`);
    }
    return out;
  }, unsettled);
  for (const each of low) say(`${screen}: low contrast on ${each}`);
  if (from) {
    await page.evaluate((selector) => {
      const scope = document.querySelector(selector);
      const first = [...(scope?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]') ?? [])].find(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
      );
      first?.focus({ focusVisible: true });
    }, from);
  }
  for (let i = 0; i < tabs; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { lost: true, name: '', ring: false, covered: false };
      const name = `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label') ?? ''}]` : ''} ${el.textContent.trim().slice(0, 24)}`;
      const shows = (node: Element | null) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      };
      const box = el.getBoundingClientRect();
      // A control drawn by another box (an invisible range input under its thumb, a visually hidden input): its ring
      // is on a sibling or the box round it. Anything else shows its own.
      const stand = getComputedStyle(el).opacity === '0' || box.width <= 1 || box.height <= 1;
      const ring = stand ? shows(el.parentElement) || [...(el.parentElement?.children ?? [])].some((other) => other !== el && shows(other)) : shows(el);
      // Not under something else (2.4.11): what's at its middle is it, inside it, or what holds it.
      const hit = stand ? null : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const covered = !stand && hit !== null && !el.contains(hit) && !hit.contains(el);
      return { lost: false, name, ring, covered };
    });
    if (stop.lost) say(`${screen}: Tab ${String(i + 1)} left focus on nothing`);
    else if (!stop.ring) say(`${screen}: no focus ring on ${stop.name}`);
    else if (stop.covered) say(`${screen}: focused but covered: ${stop.name}`);
  }
}

/** Clicks the first visible button whose name is exactly `name`. */
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).first();

for (const language of ['en', 'es'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every screen passes axe and shows its focus, ${scheme}, ${language}`, async ({ page }) => {
      setLocale(language);
      const problems: string[] = [];
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto('/?files=memory');
      await page.evaluate(
        ([key, lang]) => {
          window.localStorage.clear();
          window.localStorage.setItem(key, JSON.stringify({ language: lang }));
        },
        [SETTINGS_KEY, language] as const,
      );
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await audit(page, 'shell, no project', problems);

      page.once('dialog', (dialog) => void dialog.accept('Bey County'));
      await button(page, t('projectsView.newProject')).click();
      const onboarding = page.getByRole('dialog', { name: t('onboarding.setUp', { name: 'Bey County' }) });
      await expect(onboarding).toBeVisible();
      await audit(page, 'onboarding', problems, { tabs: 10 });
      await onboarding.getByRole('button', { name: t('onboardingDialog.skip') }).click();

      const scenes = page.getByRole('region', { name: t('tile.scenes.title'), exact: true });
      const board = page.getByRole('region', { name: 'Storyboard', exact: true });
      await scenes.getByRole('button', { name: t('scenesView.newScene') }).click();
      await scenes.getByRole('button', { name: t('scenesView.newScene') }).click();
      const sc = (n: number) => t('scene.label', { number: String(n).padStart(2, '0') });
      for (let i = 0; i < 3; i += 1) await board.getByRole('button', { name: t('board.addFrameIn', { scene: sc(1) }) }).click();
      await board.getByRole('button', { name: t('board.addFrameIn', { scene: sc(2) }) }).click();
      const frames = board.locator('[data-shot-id]');
      await frames.nth(0).click();
      const inspector = page.getByRole('region', { name: t('tile.inspector.title'), exact: true });
      const chooser = page.waitForEvent('filechooser');
      await inspector.getByRole('button', { name: t('inspector.choosePicture') }).click();
      await (await chooser).setFiles(picture);
      await expect(frames.nth(0).locator('img[data-frame-image]')).toBeVisible();
      // The frame with a picture: its framing editor, its scene's palette (generated), and a field's warning.
      await frames.nth(0).click();
      await expect(inspector.getByRole('application').first()).toBeVisible();
      await inspector.getByRole('button', { name: t('palette.generate') }).click();
      await expect(inspector.getByRole('toolbar').first()).toBeVisible();
      await inspector.getByLabel(t('inspectorView.lensMm')).fill('abc');
      await inspector.getByLabel(t('inspectorView.lensMm')).press('Tab');
      await expect(inspector.getByRole('alert')).toHaveText(t('inspector.lensProblem'));
      await audit(page, 'inspector: picture, framing, palette, a warning', problems, { from: 'section[data-stack-id]:has([role="application"])' });
      await frames.nth(1).click();
      await audit(page, 'board, a frame selected', problems, { from: '[data-dock-root]' });

      for (const view of [t('board.view.strip'), t('storyboardView.shotList'), t('board.view.grid')]) {
        await board.getByRole('radio', { name: view, exact: true }).or(board.getByRole('tab', { name: view, exact: true })).first().click();
        if (view !== t('board.view.grid')) await audit(page, `board, ${view}`, problems, { tabs: 15 });
      }

      // The slash menu and the sketch editor, from a selected frame.
      await frames.nth(1).focus();
      await page.keyboard.press('/');
      await expect(page.getByRole('listbox').or(page.getByRole('menu')).first()).toBeVisible();
      await audit(page, 'slash menu', problems, { tabs: 0 });
      await page.keyboard.press('Escape');
      await frames.nth(1).focus();
      await page.keyboard.press('s');
      await expect(page.getByRole('dialog').first()).toBeVisible();
      await audit(page, 'sketch editor', problems, { tabs: 15 });
      await page.keyboard.press('Escape');

      // Deleted, so the Trash has something and a notice shows.
      await frames.nth(3).focus();
      await page.keyboard.press('Delete');

      // Each other workspace.
      for (let n = 2; n <= 6; n += 1) {
        await page.keyboard.press(`Alt+${String(n)}`);
        await audit(page, `workspace ${String(n)}`, problems, { tabs: 12, from: '[data-dock-root]' });
      }
      await page.keyboard.press('Alt+1');

      // The menus, open.
      await page.getByRole('button', { name: new RegExp(`^${t('layoutMenu.layout')}`) }).click();
      await audit(page, 'Layout menu', problems, { tabs: 0 });
      await page.keyboard.press('Escape');
      await button(page, t('topBar.project')).click();
      await audit(page, 'Project menu', problems, { tabs: 0 });
      await page.keyboard.press('Escape');

      // The tiles any workspace opens.
      for (const tile of [t('tile.history.title'), t('tile.trash.title'), t('tile.colorScript.title')]) {
        await page.getByRole('button', { name: new RegExp(`^${t('layoutMenu.layout')}`) }).click();
        await page.getByRole('group', { name: t('layoutMenu.openTile') }).getByRole('button', { name: tile, exact: true }).click();
        await expect(page.getByRole('region', { name: tile, exact: true })).toBeVisible();
        await audit(page, `${tile} tile`, problems, { tabs: 10 });
      }
      // Empty Trash's question.
      await page.getByRole('region', { name: t('tile.trash.title'), exact: true }).getByRole('button', { name: t('trashTile.emptyTrash') }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await audit(page, 'Empty Trash question', problems, { tabs: 4 });
      await page.keyboard.press('Escape');

      // Settings, every tab.
      await page.getByRole('button', { name: new RegExp(`^${t('settings.title')} \\(`) }).click();
      const settings = page.getByRole('dialog', { name: t('settings.title') });
      const tabs = settings.getByRole('tab');
      for (let i = 0; i < (await tabs.count()); i += 1) {
        await tabs.nth(i).click();
        await audit(page, `Settings, ${(await tabs.nth(i).textContent()) ?? String(i)}`, problems, { tabs: 12 });
      }
      await page.keyboard.press('Escape');

      // Export and Watermark Settings.
      await button(page, t('topBar.project')).click();
      await page.getByRole('button', { name: t('topBar.exportProject') }).click();
      await audit(page, 'Export', problems, { tabs: 12 });
      await page.keyboard.press('Escape');
      await button(page, t('topBar.project')).click();
      await page.getByRole('button', { name: t('topBar.watermarkSettingsDots') }).click();
      await audit(page, 'Watermark Settings', problems, { tabs: 12 });
      await page.keyboard.press('Escape');

      // Import script, before a file is chosen.
      const scriptChooser = page.waitForEvent('filechooser');
      await scenes.getByRole('button', { name: t('scenesView.importScript') }).click();
      await (await scriptChooser).setFiles({ name: 'Bey County.fountain', mimeType: 'text/plain', buffer: Buffer.from('INT. DINER - NIGHT\n\nMary wipes the counter.\n\nEXT. ROAD - DAY\n\nRain.\n') });
      const importing = page.getByRole('dialog').last();
      await expect(importing).toBeVisible();
      await audit(page, 'Import script', problems, { tabs: 6 });
      await page.keyboard.press('Escape');

      // The Projects screen, with this project in Recent.
      await page.getByRole('navigation', { name: t('sidebar.sections') }).getByRole('button', { name: new RegExp(`^${t('sidebar.project')}`) }).click();
      await button(page, t('sidebar.allProjects')).click();
      await audit(page, 'Projects screen', problems, { tabs: 12 });

      expect(problems).toEqual([]);
    });
  }
}

// The wrap itself: from the last stop Tab goes to the first, and Shift+Tab from the first to the last, in the page and
// in a window; from a message scripts focus at the end of the page (not a stop itself) Tab still comes round.
test('Tab goes round the page and a window, never out of them', async ({ page }) => {
  setLocale('en');
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  const stops = () =>
    page.evaluate(() => {
      const scope = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
      return [...scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0,
      ).length;
    });
  const focusStop = (which: 'first' | 'last') =>
    page.evaluate((at) => {
      const scope = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
      const all = [...scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0,
      );
      (at === 'first' ? all[0] : all.at(-1))?.focus();
      return document.activeElement?.outerHTML.slice(0, 60) ?? '';
    }, which);
  const focused = () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60) ?? '');
  for (const where of ['page', 'Settings'] as const) {
    if (where === 'Settings') {
      await page.getByRole('button', { name: /^Settings \(/ }).click();
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    }
    expect(await stops()).toBeGreaterThan(1);
    const first = await focusStop('first');
    const last = await focusStop('last');
    await page.keyboard.press('Tab');
    expect(await focused(), `${where}: Tab from the last stop`).toBe(first);
    await page.keyboard.press('Shift+Tab');
    expect(await focused(), `${where}: Shift+Tab from the first stop`).toBe(last);
  }
  await page.keyboard.press('Escape');
  // Closed, and focus back on the gear that opened it, before the next step moves it.
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^Settings \(/ })).toBeFocused();
  // A message focused by script after the last stop (not a stop itself): Tab comes round to the first stop too.
  const first = await focusStop('first');
  await page.evaluate(() => {
    const note = document.createElement('p');
    note.tabIndex = -1;
    note.textContent = 'Nothing in the Trash.';
    document.body.append(note);
    note.focus();
  });
  await page.keyboard.press('Tab');
  expect(await focused()).toBe(first);

  // A click on blank space at the end of a window (below Storage's last control): Tab comes round to its first stop.
  await page.getByRole('button', { name: /^Settings \(/ }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Storage', exact: true }).click();
  const box = await settings.boundingBox();
  if (!box) throw new Error('Settings not on screen');
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 12);
  const windowFirst = await focusStop('first');
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 12);
  await page.keyboard.press('Tab');
  expect(await focused()).toBe(windowFirst);
});

import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// A 300-frame project with pictures (quality pass, Nov 5): how long the things people do all day take on a big board.
// Run on request, not in the gate (`SB_PERF=1 npx playwright test e2e/perf.spec.ts --project=chromium`); it prints
// its numbers and fails only past budgets set well above what a person notices, so a slow machine doesn't flake it.
// The memory build stands in for the desktop: the same React and edit code, with sql.js in the page in place of
// rusqlite behind the Rust commands. Projects stay in the page (`keep=page`), as localStorage can't hold 300 pictures.
// Saving on the desktop's SQLite is measured on its own, in src/core/storage/perf.test.ts.

test.skip(!process.env.SB_PERF, 'Performance run, on request: SB_PERF=1');
test.setTimeout(900_000);
test.use({ viewport: { width: 1440, height: 900 } });

// SB_PERF_SCENES and SB_PERF_PER_SCENE make a smaller board, to try the spec quickly.
const SCENES = Number(process.env.SB_PERF_SCENES ?? 10);
const PER_SCENE = Number(process.env.SB_PERF_PER_SCENE ?? 30);

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const cards = (page: Page) => board(page).locator('[data-shot-id]');
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

/** `count` different 1920 by 1080 JPEGs, made in the page, as a drop would carry them. */
function pictures(page: Page, scene: number, count: number) {
  return page.evaluateHandle(
    async ({ scene, count }) => {
      const transfer = new DataTransfer();
      const canvas = new OffscreenCanvas(1920, 1080);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('no 2d context');
      for (let i = 0; i < count; i += 1) {
        const hue = (scene * 37 + i * 11) % 360;
        const gradient = g.createLinearGradient(0, 0, 1920, 1080);
        gradient.addColorStop(0, `hsl(${String(hue)} 60% 30%)`);
        gradient.addColorStop(1, `hsl(${String((hue + 120) % 360)} 50% 70%)`);
        g.fillStyle = gradient;
        g.fillRect(0, 0, 1920, 1080);
        // Detail, so the JPEG has a real photo's weight rather than a flat gradient's.
        for (let k = 0; k < 400; k += 1) {
          g.fillStyle = `hsl(${String((hue + k * 7) % 360)} 70% ${String(20 + (k % 60))}%)`;
          g.fillRect((k * 197) % 1920, (k * 113) % 1080, 40 + (k % 90), 30 + (k % 70));
        }
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        transfer.items.add(new File([blob], `sc${String(scene)}_${String(i)}.jpg`, { type: 'image/jpeg' }));
      }
      return transfer;
    },
    { scene, count },
  );
}

/** Runs `act` in the page and returns how long until the screen has drawn the result (two frames later). */
async function timed(page: Page, act: string): Promise<number> {
  return page.evaluate(async (act) => {
    const start = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- a test probe, given its own code by the spec.
    await (new Function(`return (async () => { ${act} })()`) as () => Promise<void>)();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round(performance.now() - start);
  }, act);
}

/** Times from an action until `done` holds, in milliseconds. */
async function untilAfter(act: () => Promise<void>, done: () => Promise<boolean>): Promise<number> {
  const start = Date.now();
  await act();
  await expect.poll(done, { intervals: [5], timeout: 30_000 }).toBe(true);
  return Date.now() - start;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
const ms = (value: number) => `${String(Math.round(value))} ms`;

async function newProject(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
}

test('a 300-frame project with pictures stays quick', async ({ page }) => {
  const results: Record<string, string> = {};
  page.on('pageerror', (error) => {
    console.log('page error:', error.message);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory&keep=page');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  await newProject(page, 'Big Board');
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  for (let s = 0; s < SCENES; s += 1) await scenes.getByRole('button', { name: '+ New scene' }).click();

  // Pictures dropped on each scene, 30 at a time, as from Finder or Explorer.
  const imports: number[] = [];
  for (let s = 1; s <= SCENES; s += 1) {
    const transfer = await pictures(page, s, PER_SCENE);
    const label = `+ Frame in SC ${String(s).padStart(2, '0')}`;
    const start = Date.now();
    await board(page).getByRole('button', { name: label }).dispatchEvent('drop', { dataTransfer: transfer });
    await expect(cards(page)).toHaveCount(s * PER_SCENE, { timeout: 120_000 });
    imports.push(Date.now() - start);
  }
  results[`import, ${String(PER_SCENE)} pictures a drop (median, slowest)`] = `${ms(median(imports))}, ${ms(Math.max(...imports))}`;

  // Scrolling the whole board, top to bottom, a step a frame: how long each frame took to draw.
  const scrollRun = () =>
    page.evaluate(async () => {
      let scroller = document.querySelector('[data-board]')?.parentElement ?? null;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!scroller) throw new Error('no board scroller');
      scroller.scrollTo(0, 0);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const gaps: number[] = [];
      let last = performance.now();
      while (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1) {
        scroller.scrollBy(0, 120);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return { gaps, height: scroller.scrollHeight };
    });
  const first = await scrollRun();
  const again = await scrollRun();
  const describe = ({ gaps, height }: { gaps: number[]; height: number }) =>
    `median ${median(gaps).toFixed(1)} ms, p95 ${p95(gaps).toFixed(1)} ms, slowest ${Math.max(...gaps).toFixed(1)} ms; ${String(gaps.length)} frames over ${String(height)} px`;
  results['scroll top to bottom, first time (frame time)'] = describe(first);
  results['scroll top to bottom, again (frame time)'] = describe(again);

  // Switching the board's views and the workspaces.
  const tab = (name: string) =>
    `[...document.querySelectorAll('[role="tab"], [role="radio"], button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click();`;
  const section = (name: string) =>
    `[...document.querySelectorAll('nav[aria-label="Sections"] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)})).click();`;
  const views: Record<string, number[]> = { strip: [], 'shot list': [], grid: [] };
  for (let i = 0; i < 3; i += 1) {
    views.strip?.push(await timed(page, tab('Strip')));
    views['shot list']?.push(await timed(page, tab('Shot list')));
    views.grid?.push(await timed(page, tab('Grid')));
  }
  for (const [name, values] of Object.entries(views)) results[`switch to ${name} (median of 3)`] = ms(median(values));
  const workspaces: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    await timed(page, section('Assets'));
    workspaces.push(await timed(page, section('Storyboard')));
  }
  results['back to the Storyboard workspace (median of 3)'] = ms(median(workspaces));

  // Selecting frames with the arrow keys, timed in the page: from the key's event to the next frame drawn after the
  // selection moved, without the test runner's own round trips.
  await cards(page).nth(0).click();
  await page.evaluate(() => {
    const w = window as unknown as { __keyAt: number; __lags: number[] };
    w.__lags = [];
    window.addEventListener('keydown', (event) => { w.__keyAt = event.timeStamp; }, true);
    new MutationObserver((records) => {
      if (!records.some((r) => r.attributeName === 'aria-current' && (r.target as Element).getAttribute('aria-current') === 'true')) return;
      requestAnimationFrame(() => { w.__lags.push(performance.now() - w.__keyAt); });
    }).observe(document.body, { attributes: true, attributeFilter: ['aria-current'], subtree: true });
  });
  const arrows: number[] = [];
  for (let i = 1; i <= Math.min(20, SCENES * PER_SCENE - 1); i += 1) {
    arrows.push(
      await untilAfter(
        () => page.keyboard.press('ArrowRight'),
        async () => (await cards(page).nth(i).getAttribute('aria-current')) === 'true',
      ),
    );
  }
  const lags = await page.evaluate(() => (window as unknown as { __lags: number[] }).__lags);
  results['next frame with →, in the page (median, slowest)'] = `${ms(median(lags))}, ${ms(Math.max(...lags))}`;
  results['next frame with →, seen by the test (median)'] = ms(median(arrows));

  // An edit (written to the file before the screen shows it), its undo and its redo.
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  const size = (name: string) => inspector.getByRole('radiogroup', { name: 'Size' }).getByRole('radio', { name, exact: true });
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  const edits: number[] = [];
  const undos: number[] = [];
  const redos: number[] = [];
  for (const name of ['CU', 'WS', 'MS', 'ECU', 'MCU']) {
    edits.push(await untilAfter(() => size(name).click(), async () => (await size(name).getAttribute('aria-checked')) === 'true'));
    undos.push(await untilAfter(() => page.keyboard.press(`${mod}+z`), async () => (await size(name).getAttribute('aria-checked')) !== 'true'));
    redos.push(await untilAfter(() => page.keyboard.press(`${mod}+Shift+z`), async () => (await size(name).getAttribute('aria-checked')) === 'true'));
  }
  // The same in the page: from the click or key to the next frame drawn after the size changed.
  const editLags = await page.evaluate(async () => {
    const lags: number[] = [];
    const group = document.querySelector('section[aria-label="Frame inspector"]');
    if (!group) return lags;
    const radio = (name: string) => [...group.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent.trim() === name);
    for (const name of ['CU', 'WS', 'MS', 'ECU', 'MCU']) {
      const target = radio(name);
      if (!target) continue;
      const start = performance.now();
      target.click();
      while (target.getAttribute('aria-checked') !== 'true') await new Promise((resolve) => setTimeout(resolve, 1));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      lags.push(performance.now() - start);
    }
    return lags;
  });
  results['edit saved and shown, in the page (median, slowest)'] = `${ms(median(editLags))}, ${ms(Math.max(...editLags))}`;
  results['edit saved and shown, seen by the test (median, slowest)'] = `${ms(median(edits))}, ${ms(Math.max(...edits))}`;
  results['undo (median, slowest)'] = `${ms(median(undos))}, ${ms(Math.max(...undos))}`;
  results['redo (median, slowest)'] = `${ms(median(redos))}, ${ms(Math.max(...redos))}`;

  // Opening it again: switch to another project, then back from Recent.
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await newProject(page, 'Small');
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  const reopen = Date.now();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Big Board/ }).click();
  await expect(cards(page)).toHaveCount(SCENES * PER_SCENE, { timeout: 120_000 });
  results['open the project from Recent'] = ms(Date.now() - reopen);

  console.log(`\n${String(SCENES * PER_SCENE)}-frame project, ${test.info().project.name}:`);
  for (const [name, value] of Object.entries(results)) console.log(`  ${name}: ${value}`);

  // Budgets: what a person would call slow, not what this machine does.
  expect(median(again.gaps)).toBeLessThan(50);
  expect(median(views.grid ?? [])).toBeLessThan(1000);
  expect(median(lags)).toBeLessThan(150);
  expect(median(edits)).toBeLessThan(500);
  expect(median(undos)).toBeLessThan(500);
});

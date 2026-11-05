import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// A 300-frame project with pictures (quality pass, Nov 5): how long the things people do all day take on a big board.
// Run on request, not in the gate, in Chromium (WebView2's engine):
//   SB_PERF=1 npx playwright test e2e/perf.spec.ts --project=chromium            (macOS, Linux)
//   $env:SB_PERF='1'; npx playwright test e2e/perf.spec.ts --project=chromium    (PowerShell; the variable lasts the
//   session, so close it or set it to '' before the gate)
// It prints its numbers and fails only past budgets set well above what a person notices, so a slow machine doesn't
// flake it. The memory build stands in for the desktop: the same React and edit code, with sql.js in the page in place
// of rusqlite behind the Rust commands, and the project kept in the page (`keep=page`): "saved" here means written to
// sql.js, with no file and no Rust calls. Saving on the desktop's SQLite is measured in src/core/storage/perf.test.ts.
// SB_PERF_SCENES and SB_PERF_PER_SCENE change the board's shape (e.g. 120 scenes of 8, a feature film's shape).

test.skip(!process.env.SB_PERF, 'Performance run, on request: SB_PERF=1');
test.skip(({ browserName }) => browserName !== 'chromium', 'Performance run in Chromium only');
test.setTimeout(900_000);
test.use({ viewport: { width: 1440, height: 900 } });

const SCENES = Number(process.env.SB_PERF_SCENES ?? 10);
const PER_SCENE = Number(process.env.SB_PERF_PER_SCENE ?? 30);
const FRAMES = SCENES * PER_SCENE;

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const cards = (page: Page) => board(page).locator('[data-shot-id]');
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

/** `count` 1920 by 1080 JPEGs, made in the page, as a drop would carry them; every one in the project different. */
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
        // Its scene and place written in, so no two pictures are alike even where the hues repeat.
        g.fillStyle = '#000';
        g.font = '120px sans-serif';
        g.fillText(`${String(scene)}-${String(i)}`, 80, 200);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        transfer.items.add(new File([blob], `sc${String(scene)}_${String(i)}.jpg`, { type: 'image/jpeg' }));
      }
      return transfer;
    },
    { scene, count },
  );
}

/**
 * Runs `act` in the page, then waits until the screen has drawn it (two frames later) and, with `pictures`, until
 * every frame picture in view has loaded and decoded. Returns both times, in milliseconds.
 */
async function timed(page: Page, act: string, pictures = false): Promise<{ drawn: number; shown: number }> {
  return page.evaluate(
    async ({ act, pictures }) => {
      const start = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- a test probe, given its own code by the spec.
      await (new Function(`return (async () => { ${act} })()`) as () => Promise<void>)();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const drawn = performance.now() - start;
      if (!pictures) return { drawn, shown: drawn };
      // In view of the board's own scroll box, not the window: a card under the tile's edge isn't on screen.
      let scroller = document.querySelector('[data-board]')?.parentElement ?? null;
      while (scroller && !/auto|scroll/.test(`${getComputedStyle(scroller).overflowY} ${getComputedStyle(scroller).overflowX}`)) scroller = scroller.parentElement;
      const view = scroller?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        return box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right;
      };
      // Each frame card in view holds a picture once its turn comes; done when all of them are decoded.
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const shown = [...document.querySelectorAll<HTMLImageElement>('[data-board] img[data-frame-image]')].filter(visible);
        const cardsInView = [...document.querySelectorAll('[data-shot-id]')].filter(visible).length;
        if (shown.length >= cardsInView && shown.every((img) => img.complete && img.naturalWidth > 0)) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { drawn, shown: performance.now() - start };
    },
    { act, pictures },
  );
}

/** Times from an action until `done` holds, in milliseconds. */
async function untilAfter(act: () => Promise<void>, done: () => Promise<boolean>): Promise<number> {
  const start = Date.now();
  await act();
  await expect.poll(done, { intervals: [5], timeout: 30_000 }).toBe(true);
  return Date.now() - start;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? Number.NaN;
const ms = (value: number) => `${String(Math.round(value))} ms`;

async function newProject(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
}

test(`a ${String(FRAMES)}-frame project with pictures stays quick`, async ({ page }) => {
  const results: Record<string, string> = {};
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
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

  // Pictures dropped on each scene, as from Finder or Explorer.
  const imports: number[] = [];
  for (let s = 1; s <= SCENES; s += 1) {
    const transfer = await pictures(page, s, PER_SCENE);
    const label = `+ Frame in SC ${String(s).padStart(2, '0')}`;
    const start = Date.now();
    await board(page).getByRole('button', { name: label, exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
    await expect(cards(page)).toHaveCount(s * PER_SCENE, { timeout: 120_000 });
    imports.push(Date.now() - start);
    // The files stay alive in the page otherwise, through every measurement after.
    await transfer.dispose();
  }
  results[`import, ${String(PER_SCENE)} pictures a drop (median, slowest)`] = `${ms(median(imports))}, ${ms(Math.max(...imports))}`;

  // Scrolling the whole board, top to bottom, a step a frame: how long each frame took to draw. The first time loads
  // and decodes every picture on the way; the main thread's frames are what's timed, so afterwards every picture is
  // checked to be there, not left blank.
  const scrollRun = () =>
    page.evaluate(async () => {
      let scroller = document.querySelector('[data-board]')?.parentElement ?? null;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (!scroller) throw new Error('no board scroller');
      scroller.scrollTo(0, 0);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const gaps: number[] = [];
      let last = performance.now();
      for (let step = 0; step < 5000 && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1; step += 1) {
        scroller.scrollBy(0, 120);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return { gaps, height: scroller.scrollHeight };
    });
  const first = await scrollRun();
  const loaded = () =>
    page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('[data-board] img[data-frame-image]')].filter((img) => img.complete && img.naturalWidth > 0).length);
  await expect.poll(loaded, { timeout: 30_000 }).toBe(FRAMES);
  const again = await scrollRun();
  const describe = ({ gaps, height }: { gaps: number[]; height: number }) =>
    `median ${median(gaps).toFixed(1)} ms, p95 ${p95(gaps).toFixed(1)} ms, slowest ${Math.max(...gaps).toFixed(1)} ms; ${String(gaps.length)} frames over ${String(height)} px`;
  results['scroll top to bottom, first time, loading pictures (frame time)'] = describe(first);
  results['scroll top to bottom, again (frame time)'] = describe(again);

  // Switching the board's views and the workspaces: drawn, then with every picture in view shown.
  const tab = (name: string) =>
    `[...document.querySelectorAll('[role="tab"], [role="radio"], button')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click();`;
  const section = (name: string) =>
    `[...document.querySelectorAll('nav[aria-label="Sections"] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)})).click();`;
  const views: Record<string, { drawn: number; shown: number }[]> = { Strip: [], 'Shot list': [], Grid: [] };
  for (let i = 0; i < 3; i += 1) for (const [name, runs] of Object.entries(views)) runs.push(await timed(page, tab(name), name !== 'Shot list'));
  for (const [name, runs] of Object.entries(views)) {
    results[`switch to ${name} (median of 3)`] = `drawn ${ms(median(runs.map((r) => r.drawn)))}, pictures shown ${ms(median(runs.map((r) => r.shown)))}`;
  }
  const workspaces: { drawn: number; shown: number }[] = [];
  for (let i = 0; i < 3; i += 1) {
    await timed(page, section('Assets'));
    workspaces.push(await timed(page, section('Storyboard'), true));
  }
  results['back to the Storyboard workspace (median of 3)'] = `drawn ${ms(median(workspaces.map((r) => r.drawn)))}, pictures shown ${ms(median(workspaces.map((r) => r.shown)))}`;

  // Selecting frames with the arrow keys, inside the first scene (past its last frame → reaches + Frame, not a frame),
  // timed in the page: from the key's event to the next frame drawn after the selection moved.
  await cards(page).nth(0).click();
  await page.evaluate(() => {
    const w = window as unknown as { __keyAt: number; __lags: number[] };
    w.__lags = [];
    window.addEventListener(
      'keydown',
      (event) => {
        w.__keyAt = event.timeStamp;
      },
      true,
    );
    new MutationObserver((records) => {
      if (!records.some((r) => r.attributeName === 'aria-current' && (r.target as Element).getAttribute('aria-current') === 'true')) return;
      requestAnimationFrame(() => {
        w.__lags.push(performance.now() - w.__keyAt);
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['aria-current'], subtree: true });
  });
  const arrows: number[] = [];
  for (let i = 1; i <= Math.min(20, PER_SCENE - 1); i += 1) {
    arrows.push(
      await untilAfter(
        () => page.keyboard.press('ArrowRight'),
        async () => (await cards(page).nth(i).getAttribute('aria-current')) === 'true',
      ),
    );
  }
  const lags = await page.evaluate(() => (window as unknown as { __lags: number[] }).__lags);
  expect(lags).toHaveLength(arrows.length);
  results['next frame with →, in the page (median, slowest)'] = `${ms(median(lags))}, ${ms(Math.max(...lags))}`;

  // An edit, timed in the page from the click to the next frame drawn after the size changed; then undo and redo.
  const editLags = await page.evaluate(async () => {
    const lags: number[] = [];
    const inspector = document.querySelector('section[aria-label="Frame inspector"]');
    const radio = (name: string) => [...(inspector?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((r) => r.textContent.trim() === name);
    for (const name of ['CU', 'WS', 'MS', 'ECU', 'MCU']) {
      const target = radio(name);
      if (!target) continue;
      const start = performance.now();
      target.click();
      for (let wait = 0; wait < 5000 && target.getAttribute('aria-checked') !== 'true'; wait += 1) await new Promise((resolve) => setTimeout(resolve, 1));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (target.getAttribute('aria-checked') === 'true') lags.push(performance.now() - start);
    }
    return lags;
  });
  expect(editLags).toHaveLength(5);
  results['edit saved and shown, in the page (median, slowest)'] = `${ms(median(editLags))}, ${ms(Math.max(...editLags))}`;
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  const size = (name: string) => inspector.getByRole('radiogroup', { name: 'Size' }).getByRole('radio', { name, exact: true });
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  const undos: number[] = [];
  const redos: number[] = [];
  for (const name of ['CU', 'WS', 'MS', 'ECU', 'MCU']) {
    await size(name).click();
    await expect(size(name)).toHaveAttribute('aria-checked', 'true');
    undos.push(await untilAfter(() => page.keyboard.press(`${mod}+z`), async () => (await size(name).getAttribute('aria-checked')) !== 'true'));
    redos.push(await untilAfter(() => page.keyboard.press(`${mod}+Shift+z`), async () => (await size(name).getAttribute('aria-checked')) === 'true'));
  }
  results['undo, as the test sees it (median, slowest)'] = `${ms(median(undos))}, ${ms(Math.max(...undos))}`;
  results['redo, as the test sees it (median, slowest)'] = `${ms(median(redos))}, ${ms(Math.max(...redos))}`;

  // Opening it again: switch to another project, then back from Recent.
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await newProject(page, 'Small');
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  const reopen = Date.now();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Big Board/ }).click();
  await expect(cards(page)).toHaveCount(FRAMES, { timeout: 120_000 });
  results['open the project from Recent'] = ms(Date.now() - reopen);

  console.log(`\n${String(FRAMES)}-frame project (${String(SCENES)} scenes), ${test.info().project.name}:`);
  for (const [name, value] of Object.entries(results)) console.log(`  ${name}: ${value}`);

  // Numbers measured on a broken page mean nothing.
  expect(errors).toEqual([]);
  // Budgets: what a person would call slow, not what this machine does.
  expect(median(first.gaps)).toBeLessThan(50);
  expect(median(again.gaps)).toBeLessThan(50);
  expect(median((views.Grid ?? []).map((r) => r.shown))).toBeLessThan(1500);
  expect(median(lags)).toBeLessThan(150);
  expect(median(editLags)).toBeLessThan(250);
  expect(median(undos)).toBeLessThan(500);
});

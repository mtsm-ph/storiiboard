import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type JSHandle, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

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
 * A function the spec gives as source, made in the page by Playwright's own evaluation, as page.evaluate's functions
 * are, and handed to page.evaluate as a handle. The page's content security policy (6.13: no 'unsafe-eval') refuses
 * new Function from the page's own code, which is how these probes made them before: Chromium let it through only while
 * page.evaluate's call was still on the stack, so one await moved earlier would have broken a probe.
 */
async function pageFunction<F>(page: Page, source: string): Promise<JSHandle<F>> {
  return page.evaluateHandle(`(${source})`);
}

/**
 * Runs `act` in the page, then waits until the screen has drawn it (two frames later) and, with `pictures`, until
 * every frame picture in view has loaded and decoded. Returns both times, in milliseconds.
 */
async function timed(page: Page, act: string, pictures = false): Promise<{ drawn: number; shown: number }> {
  const run = await pageFunction<() => Promise<void>>(page, `async () => { ${act} }`);
  return page.evaluate(
    async ({ run, pictures }) => {
      const start = performance.now();
      await run();
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
    { run, pictures },
  ).finally(() => run.dispose());
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

// ---------------------------------------------------------------------------------------------------------------------
// A board of 500 items, 150 of them pictures (5.7): pan, zoom, drag and marquee, timed by requestAnimationFrame in the page.
//   SB_PERF=1 npx playwright test e2e/perf.spec.ts --project=chromium -g "500-item"
// The pictures come through the real drop path; the rest is written through the app's own edit code (the createItems and
// createConnectors the tools call), in one group. The dev server stands in for the app, so React runs its development
// build: slower than the release, so these numbers are a ceiling.
// ---------------------------------------------------------------------------------------------------------------------

const BOARD_PICTURES = 150;
const COLUMNS = 25;
const CELL = { width: 320, height: 280 };
const FRAME_MS = 1000 / 60;
// The dev server serves the app's modules by path, so the page can reach the stores the app itself uses.
const SRC = '/src/';
/** Extra stroke records in the 300-item plan's project (SB_PERF_EXTRA, 6.18 last pass): 0 unless asked. */
const PLAN_EXTRA = Number(process.env.SB_PERF_EXTRA ?? 0);

/** `count` JPEGs of mixed shapes, made in the page, as a drop would carry them; every one different. */
function mixedPictures(page: Page, first: number, count: number) {
  return page.evaluateHandle(
    async ({ first, count }) => {
      const transfer = new DataTransfer();
      const shapes = [
        [1920, 1080],
        [1080, 1920],
        [1600, 1200],
        [1200, 1200],
        [2400, 1000],
      ] as const;
      for (let i = first; i < first + count; i += 1) {
        const [w, h] = shapes[i % shapes.length] ?? [1920, 1080];
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext('2d');
        if (!g) throw new Error('no 2d context');
        const hue = (i * 37) % 360;
        const gradient = g.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, `hsl(${String(hue)} 60% 30%)`);
        gradient.addColorStop(1, `hsl(${String((hue + 120) % 360)} 50% 70%)`);
        g.fillStyle = gradient;
        g.fillRect(0, 0, w, h);
        for (let k = 0; k < 200; k += 1) {
          g.fillStyle = `hsl(${String((hue + k * 7) % 360)} 70% ${String(20 + (k % 60))}%)`;
          g.fillRect((k * 197) % w, (k * 113) % h, 40 + (k % 90), 30 + (k % 70));
        }
        g.fillStyle = '#000';
        g.font = '120px sans-serif';
        g.fillText(String(i), 80, 200);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        transfer.items.add(new File([blob], `board_${String(i)}.jpg`, { type: 'image/jpeg' }));
      }
      return transfer;
    },
    { first, count },
  );
}

interface Gaps {
  gaps: number[];
}

/** Frame times (ms between animation frames) while `run` goes on; the first two, which hold the start-up, are left out. */
async function frameTimes(page: Page, run: () => Promise<void>, profile = ''): Promise<Gaps> {
  // SB_PROFILE=1 also keeps Chromium's CPU profile of each gesture in test-results/, for finding where the time goes.
  const session = process.env.SB_PROFILE ? await page.context().newCDPSession(page) : null;
  if (session) {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    await session.send('Profiler.start');
  }
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __on: boolean };
    w.__gaps = [];
    w.__on = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!w.__on) return;
      w.__gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await run();
  const gaps = await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __on: boolean };
    w.__on = false;
    return w.__gaps;
  });
  if (session) {
    const { profile: cpu } = await session.send('Profiler.stop');
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/${profile.replace(/\W+/g, '-')}.cpuprofile`, JSON.stringify(cpu));
    await session.detach();
  }
  return { gaps: gaps.slice(2) };
}

/** How long after a zoom's last wheel step its settle is timed: the items are drawn for the new zoom 150 ms after it. */
const SETTLE_WINDOW = 300;

/**
 * A wheel zoom's frame times as frameTimes gives them, and then the frames of its settle (6.11 review, M1): the timer
 * runs on to SETTLE_WINDOW ms after the last wheel step (the wheel runs set `__lastWheel` in the page), and the frames
 * that began in that window are the settle's, the one where every item in view is drawn for the new zoom among them (a
 * long one that ends past the window included).
 */
async function zoomTimes(page: Page, run: () => Promise<void>, profile = ''): Promise<{ zoom: Gaps; settle: Gaps }> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: { at: number; gap: number }[]; __framesOn: boolean };
    w.__frames = [];
    w.__framesOn = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!w.__framesOn) return;
      w.__frames.push({ at: now, gap: now - last });
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const zoom = await frameTimes(page, run, profile);
  const settle = await page.evaluate(async (window_) => {
    const w = window as unknown as { __frames: { at: number; gap: number }[]; __framesOn: boolean; __lastWheel?: number };
    const from = w.__lastWheel ?? performance.now();
    while (performance.now() < from + window_) await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    w.__framesOn = false;
    return w.__frames.filter((f) => f.at > from && f.at - f.gap < from + window_).map((f) => f.gap);
  }, SETTLE_WINDOW);
  return { zoom, settle: { gaps: settle } };
}

/**
 * How long after a zoom's last wheel step every item of this canvas is drawn for the new zoom (6.11: a plan's items are
 * made again a slice a frame after the settle; the canvas says how many still wait in `data-stale`). Armed before the
 * zoom, an observer notes when the count last came down to 0; read after it, waiting up to 5 s for it to get there.
 */
async function armCaughtUp(page: Page, canvas: string): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as { __caughtUpAt?: number | undefined; __caughtUpWatch?: MutationObserver };
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error('no canvas');
    w.__caughtUpWatch?.disconnect();
    w.__caughtUpAt = undefined;
    w.__caughtUpWatch = new MutationObserver(() => {
      w.__caughtUpAt = element.dataset.stale === '0' ? performance.now() : undefined;
    });
    w.__caughtUpWatch.observe(element, { attributes: true, attributeFilter: ['data-stale'] });
  }, canvas);
}

async function caughtUp(page: Page, canvas: string): Promise<number> {
  return page.evaluate(async (selector) => {
    const w = window as unknown as { __lastWheel?: number; __caughtUpAt?: number | undefined; __caughtUpWatch?: MutationObserver };
    const from = w.__lastWheel ?? performance.now();
    const waiting = () => document.querySelector<HTMLElement>(selector)?.dataset.stale !== '0';
    while ((waiting() || w.__caughtUpAt === undefined) && performance.now() < from + 5000) await new Promise((resolve) => requestAnimationFrame(resolve));
    w.__caughtUpWatch?.disconnect();
    return (w.__caughtUpAt ?? Number.POSITIVE_INFINITY) - from;
  }, canvas);
}

/** Frames missed: each gap over one and a half frames counts the frames it spanned beyond the first. */
const dropped = (gaps: number[]) => gaps.reduce((sum, gap) => (gap > FRAME_MS * 1.5 ? sum + Math.round(gap / FRAME_MS) - 1 : sum), 0);
const summary = ({ gaps }: Gaps) =>
  `median ${median(gaps).toFixed(1)} ms, p95 ${p95(gaps).toFixed(1)} ms, slowest ${Math.max(...gaps).toFixed(1)} ms, ` +
  `dropped ${String(dropped(gaps))} of ${String(gaps.length + dropped(gaps))} frames ` +
  `(p95 is ${(p95(gaps) / FRAME_MS).toFixed(1)}x the 16.7 ms target)`;

test('a 500-item board with 150 pictures pans, zooms, drags and selects smoothly', async ({ page }) => {
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

  // A few frames for the shot cards to name.
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  await scenes.getByRole('button', { name: '+ New scene' }).click();
  const addFrame = board(page).getByRole('button', { name: '+ Frame in SC 01', exact: true });
  for (let i = 0; i < 3; i += 1) await addFrame.click();
  await expect(cards(page)).toHaveCount(3);

  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  const tile = page.getByRole('region', { name: 'Moodboard', exact: true });
  const canvas = page.getByRole('application', { name: 'Camera board' });
  const listed = tile.getByRole('region', { name: 'Boards', exact: true }).getByRole('button', { name: /^Camera/ });
  const start = tile.locator('[data-department-board="camera"]').or(listed);
  await expect(canvas.or(start.first())).toBeVisible();
  if (await start.first().isVisible()) await start.first().click();
  await expect(canvas).toBeVisible();
  const wrapper = tile.locator('[data-board-data]');
  const attribute = async <T,>(locator: Locator, name: string, empty: string) => JSON.parse((await locator.getAttribute(name)) ?? empty) as T;
  const kinds = async () => (await attribute<{ kind: string }[]>(wrapper, 'data-board-data', '[]')).map((i) => i.kind);

  // 150 pictures through the drop path, in batches of 30.
  for (let batch = 0; batch < BOARD_PICTURES / 30; batch += 1) {
    const transfer = await mixedPictures(page, batch * 30, 30);
    await wrapper.dispatchEvent('drop', { dataTransfer: transfer, clientX: 700, clientY: 400 });
    await expect
      .poll(async () => (await kinds()).filter((k) => k === 'picture').length, { timeout: 120_000 })
      .toBe((batch + 1) * 30);
    await transfer.dispose();
  }

  // The rest, in one group, with everything laid out on a grid of cells, the kinds spread through it; the pictures are
  // given their places and mixed sizes in the same group.
  const made = await page.evaluate(
    async ({ columns, cell, src }) => {
      const load = (path: string) => import(/* @vite-ignore */ `${src}${path}`) as Promise<unknown>;
      const { projectStore } = (await load('app/projectStore.ts')) as typeof import('../src/app/projectStore');
      const items = (await load('features/moodboards/items.ts')) as typeof import('../src/features/moodboards/items');
      const connectors = (await load('features/moodboards/connectors.ts')) as typeof import('../src/features/moodboards/connectors');
      const store = (await load('features/moodboards/moodboardStore.ts')) as typeof import('../src/features/moodboards/moodboardStore');
      const boardId = store.moodboardStore.getState().openBoardId;
      if (!boardId) throw new Error('no board open');
      const records = projectStore.getState().records;
      const pictures = Object.values(records).filter(
        (r) => r.type === 'board_item' && r.parentId === boardId && r.props.kind === 'picture',
      );
      const shots = Object.values(records).filter((r) => r.type === 'shot').map((r) => r.id);
      const words = [
        'Warm light through the blinds',
        'Rooftop, golden hour',
        'Handheld, close',
        'Wardrobe: grey wool coat',
        'Rain on the windshield',
        'Practicals only',
      ];
      const seeds: import('../src/features/moodboards/items').ItemSeed[] = [];
      const box = (width: number, height: number, rotation = 0) => ({ x: 0, y: 0, width, height, rotation });
      for (let i = 0; i < 150; i += 1) {
        const color = items.STICKY_COLOURS[i % items.STICKY_COLOURS.length] ?? '#FFE97A';
        seeds.push({ kind: 'sticky', ...box(200, 200), text: `${words[i % words.length] ?? ''} ${String(i)}`, color });
      }
      const shapeKinds = ['rect', 'ellipse', 'triangle', 'diamond'] as const;
      for (let i = 0; i < 100; i += 1) {
        const fill = i % 3 === 0 ? { fill: '#DCE6EE' } : {};
        seeds.push({ kind: shapeKinds[i % 4] ?? 'rect', ...box(120 + (i % 5) * 30, 100 + (i % 4) * 40, i % 7 === 0 ? 15 : 0), ...fill });
      }
      for (let i = 0; i < 50; i += 1) {
        seeds.push({ kind: 'text', ...box(280, 60), text: `${words[(i + 2) % words.length] ?? ''}, take ${String(i)}`, fontSize: 24 });
      }
      for (let i = 0; i < 10; i += 1) seeds.push({ kind: 'shot_card', ...box(280, 158), shotId: shots[i % shots.length] ?? '' });
      for (let i = 0; i < 10; i += 1) {
        const color = items.SECTION_COLOURS[i % items.SECTION_COLOURS.length] ?? '#E4E8D2';
        seeds.push({ kind: 'section', ...box(640, 560), name: `Section ${String(i + 1)}`, color });
      }
      const created = items.createItems(records, boardId, seeds);
      // A fixed shuffle of the 500 cells, so no kind sits in a block.
      const order = Array.from({ length: 500 }, (_, i) => i).sort((a, b) => ((a * 7919) % 503) - ((b * 7919) % 503));
      const cellOf = (n: number) => {
        const slot = order[n] ?? n;
        return { x: (slot % columns) * cell.width + 15, y: Math.floor(slot / columns) * cell.height + 15 };
      };
      const placed: import('../src/core/ops/ops').Change[] = [];
      pictures.forEach((record, n) => {
        const ratio = Number(record.props.width) / Number(record.props.height);
        const long = 280 * (0.7 + ((n * 13) % 10) / 30);
        const at = cellOf(n);
        const width = Math.round(ratio >= 1 ? long : long * ratio);
        const height = Math.round(ratio >= 1 ? long / ratio : long);
        placed.push({ kind: 'update', id: record.id, set: { x: at.x, y: at.y, width, height } });
      });
      created.changes.forEach((change, n) => {
        if (change.kind !== 'create') return;
        const at = cellOf(150 + n);
        change.record.props = { ...change.record.props, x: at.x, y: at.y };
      });
      // 30 connectors, each from a sticky to the next sticky.
      const stickies = created.ids.slice(0, 31);
      const links = connectors.createConnectors(
        records,
        boardId,
        Array.from({ length: 30 }, (_, i) => ({
          from: { item: stickies[i] ?? '', side: 'right' as const },
          to: { item: stickies[i + 1] ?? '', side: 'left' as const },
          route: i % 3 === 0 ? ('elbow' as const) : ('straight' as const),
        })),
      );
      await projectStore.getState().apply([...placed, ...created.changes, ...links.changes]);
      return { boardId, count: created.ids.length };
    },
    { columns: COLUMNS, cell: CELL, src: SRC },
  );
  expect(made.count).toBe(320);

  const itemCount = async () => (JSON.parse((await canvas.getAttribute('data-items')) ?? '[]') as unknown[]).length;
  await expect.poll(itemCount, { timeout: 60_000 }).toBe(470);
  await canvas.focus();
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(() => canvas.getAttribute('data-zoom')).not.toBe('1');
  // Every picture's thumbnail is decoded and drawn before anything is timed: a pan is measured, not the first load.
  const shown = async () => Object.keys(await attribute<object>(wrapper, 'data-picture-levels', '{}')).length;
  await expect.poll(shown, { timeout: 120_000 }).toBe(BOARD_PICTURES);

  const results: Record<string, string> = {};
  const gestures = new Map<string, Gaps>();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const view = async () => ({
    zoom: Number(await canvas.getAttribute('data-zoom')),
    cx: Number(await canvas.getAttribute('data-cx')),
    cy: Number(await canvas.getAttribute('data-cy')),
  });
  const screenOf = async (x: number, y: number) => {
    const v = await view();
    return { x: box.x + box.width / 2 + (x - v.cx) * v.zoom, y: box.y + box.height / 2 + (y - v.cy) * v.zoom };
  };

  /** A wheel event every animation frame for `ms`, shaped by `wheel(frame, frames)`; the page's own wheel listener takes it. */
  type Wheel = (frame: number, total: number, arg: number) => { dx: number; dy: number; ctrl: boolean };
  // How many pictures were drawn at their stored size half way through the last wheel run and just after its last step.
  let originals = { mid: 0, end: 0 };
  const wheelFor = (ms: number, wheel: Wheel, arg = 0) => async () => {
    const shape = await pageFunction<Wheel>(page, wheel.toString());
    originals = await page.evaluate(
      async ({ ms, shape, arg }) => {
        const element = document.querySelector('[data-canvas]');
        if (!element) throw new Error('no canvas');
        const rect = element.getBoundingClientRect();
        const full = () => {
          const at = document.querySelector('[data-picture-levels]')?.getAttribute('data-picture-levels');
          const levels = JSON.parse(at ?? '{}') as Record<string, string>;
          return Object.values(levels).filter((level) => level === 'original').length;
        };
        const total = Math.round(ms / (1000 / 60));
        let mid = 0;
        for (let frame = 0; frame < total; frame += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const { dx, dy, ctrl } = shape(frame, total, arg);
          const clientX = rect.left + rect.width / 2;
          const clientY = rect.top + rect.height / 2;
          element.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true, clientX, clientY }));
          (window as unknown as { __lastWheel: number }).__lastWheel = performance.now();
          if (frame === Math.floor(total / 2)) mid = full();
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // Read at once, within a frame or two of the last step: before the zoom has settled.
        return { mid, end: full() };
      },
      { ms, shape, arg },
    ).finally(() => shape.dispose());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const sway = (frame: number) => ({ dx: Math.cos(frame / 20) * 40, dy: Math.sin(frame / 27) * 30, ctrl: false });

  // A 3-second pan, to and fro, with the whole board in view (the most there is to draw).
  gestures.set('pan, whole board in view (3 s)', await frameTimes(page, wheelFor(3000, sway), 'pan-all'));

  // The same at 100%, the view of someone working on a corner of the board.
  await tile.getByRole('button', { name: /^Zoom \d+%\. Reset/ }).click();
  await expect.poll(() => canvas.getAttribute('data-zoom')).toBe('1');
  gestures.set('pan, at 100% (3 s)', await frameTimes(page, wheelFor(3000, sway), 'pan-100'));

  // Fit to 400% with Ctrl + wheel in 1.5 s, held a moment (the pictures settle at full size), then back out in 1.5 s. The steps
  // are sized to cover the log of the distance. Counted: the pictures at full size half way back and as the zoom out ends,
  // which should be the few that were in view at 400%, not one for every picture that comes into view on the way.
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => (await view()).zoom).toBeLessThan(0.5);
  const fit = (await view()).zoom;
  const turn = Math.log(4 / fit) / 0.004;
  const wheelIn = wheelFor(1500, (_frame, total, arg) => ({ dx: 0, dy: -arg / total, ctrl: true }), turn);
  const wheelOut = wheelFor(1500, (_frame, total, arg) => ({ dx: 0, dy: arg / total, ctrl: true }), turn);
  // Each leg's settle is timed too (6.11 review, M1), reported without a budget: the board's 5.7 budgets are left as they were.
  const { zoom: zoomIn, settle: settleIn } = await zoomTimes(page, wheelIn, 'zoom-in');
  const atFour = Number(await canvas.getAttribute('data-zoom'));
  await page.waitForTimeout(300);
  const { zoom: zoomOut, settle: settleOut } = await zoomTimes(page, wheelOut, 'zoom-out');
  gestures.set('zoom, fit to 400% and back (3 s)', { gaps: [...zoomIn.gaps, ...zoomOut.gaps] });
  gestures.set('settle at 400% (300 ms after the last wheel step)', settleIn);
  gestures.set('settle at fit (300 ms after the last wheel step)', settleOut);
  const zoomNow = Math.round(Number(await canvas.getAttribute('data-zoom')) * 100);
  const percent = (zoom: number) => `${String(Math.round(zoom * 100))}%`;
  results['zoom'] = `in to ${percent(atFour)}, out to ${String(zoomNow)}% (fit was ${percent(fit)})`;
  results['pictures at full size on the way out (half way, at the last step)'] =
    `${String(originals.mid)}, ${String(originals.end)} of ${String(BOARD_PICTURES)}`;
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => Math.abs((await view()).zoom - fit) < 1e-6).toBe(true);

  // Memory after the zooms: the JS heap in use (Chromium).
  await page.waitForTimeout(400);
  const heap = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory?.usedJSHeapSize ?? 0;
  });
  results['memory after the zooms and their settling (JS heap in use)'] = `${(heap / 1024 / 1024).toFixed(0)} MB`;

  // A drag of 20 selected items, one pointer move a frame, 90 frames: 300 px right and 150 px down.
  const ids = await page.evaluate(() => {
    const read = (selector: string, name: string) => JSON.parse(document.querySelector(selector)?.getAttribute(name) ?? '[]') as unknown;
    const data = read('[data-canvas]', 'data-items') as { id: string; x: number; y: number }[];
    const boardData = read('[data-board-data]', 'data-board-data') as { id: string; kind: string }[];
    const plain = new Set(boardData.filter((b) => b.kind !== 'section').map((b) => b.id));
    const inside = data.filter((d) => plain.has(d.id) && d.y > 600 && d.y < 2400 && d.x > 800 && d.x < 3000);
    return inside.slice(0, 20).map((d) => d.id);
  });
  expect(ids).toHaveLength(20);
  await page.evaluate(
    async ({ boardId, ids, src }) => {
      const path = `${src}features/moodboards/moodboardStore.ts`;
      const store = (await import(/* @vite-ignore */ path)) as typeof import('../src/features/moodboards/moodboardStore');
      store.moodboardStore.getState().select(boardId, ids);
    },
    { boardId: made.boardId, ids, src: SRC },
  );
  await expect.poll(async () => (await attribute<string[]>(canvas, 'data-selection', '[]')).length).toBe(20);
  const items = await attribute<{ id: string; x: number; y: number; width: number; height: number }[]>(canvas, 'data-items', '[]');
  const lead = items.find((i) => i.id === ids[0]);
  if (!lead) throw new Error('no lead item');
  const grab = await screenOf(lead.x + lead.width / 2, lead.y + lead.height / 2);
  const nextFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const before = ids.map((id) => items.find((i) => i.id === id)?.x ?? 0);
  gestures.set('drag 20 selected items (90 moves)', await frameTimes(page, async () => {
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let step = 1; step <= 90; step += 1) {
      await page.mouse.move(grab.x + (step * 300) / 90, grab.y + (step * 150) / 90);
      await nextFrame();
    }
    await page.mouse.up();
    await nextFrame();
    await nextFrame();
  }, 'drag'));
  // The drag was a real one: the items moved.
  await expect
    .poll(async () => {
      const now = JSON.parse((await canvas.getAttribute('data-items')) ?? '[]') as { id: string; x: number }[];
      return ids.map((id) => now.find((i) => i.id === id)?.x ?? 0).every((x, n) => x > (before[n] ?? 0));
    })
    .toBe(true);

  // A marquee over about 200 items: from the top left of the grid across 8 of its 20 rows, all columns.
  await canvas.focus();
  await page.keyboard.press('Escape');
  const topLeft = await screenOf(-10, -10);
  const bottomRight = await screenOf(COLUMNS * CELL.width + 10, 8 * CELL.height - 5);
  gestures.set('marquee over about 200 items (90 moves)', await frameTimes(page, async () => {
    await page.mouse.move(topLeft.x, topLeft.y);
    await page.mouse.down();
    for (let step = 1; step <= 90; step += 1) {
      const along = (from: number, to: number) => from + ((to - from) * step) / 90;
      await page.mouse.move(along(topLeft.x, bottomRight.x), along(topLeft.y, bottomRight.y));
      await nextFrame();
    }
    await page.mouse.up();
    await nextFrame();
    await nextFrame();
  }, 'marquee'));
  const picked = (JSON.parse((await canvas.getAttribute('data-selection')) ?? '[]') as string[]).length;
  results['marquee picked'] = `${String(picked)} items and connectors`;
  expect(picked).toBeGreaterThan(150);

  // Opening the board: out to the picker and back, the pictures forgotten, so each is read and decoded again.
  await page.evaluate(async (src) => {
    const path = `${src}core/media/decoded.ts`;
    const decoded = (await import(/* @vite-ignore */ path)) as typeof import('../src/core/media/decoded');
    decoded.forgetDecoded();
  }, SRC);
  await tile.locator('[data-boards-back]').click();
  const reopened = Date.now();
  await tile.getByRole('region', { name: 'Boards', exact: true }).getByRole('button', { name: /^Camera/ }).click();
  await expect(canvas).toBeVisible();
  await expect.poll(itemCount, { timeout: 30_000 }).toBe(470);
  await expect.poll(shown, { timeout: 60_000 }).toBe(BOARD_PICTURES);
  const opened = Date.now() - reopened;
  results['open the board (items and every picture drawn)'] = ms(opened);

  console.log(`\nA 500-item board (150 pictures), ${test.info().project.name}:`);
  for (const [name, gaps] of gestures) console.log(`  ${name}: ${summary(gaps)}`);
  for (const [name, value] of Object.entries(results)) console.log(`  ${name}: ${value}`);

  expect(errors).toEqual([]);
  // Budgets: what a person would call slow, not what this machine does; the target is 16.7 ms a frame. Frames come in whole
  // 16.7 ms steps, so "under 33 ms" is two frames (33.3): the bound is 34.
  for (const name of ['pan, whole board in view (3 s)', 'pan, at 100% (3 s)', 'zoom, fit to 400% and back (3 s)']) {
    expect(p95((gestures.get(name)?.gaps ?? [])), name).toBeLessThan(34);
  }
  expect(p95((gestures.get('drag 20 selected items (90 moves)')?.gaps ?? []))).toBeLessThan(50);
  expect(opened).toBeLessThan(3000);
});

// ---------------------------------------------------------------------------------------------------------------------
// A set plan of 300 items (6.11, decision 15): pan, zoom, drag, marquee, a light turned by its key, typed edits, icons
// placed from the keyboard and lens edits on a linked frame, timed by requestAnimationFrame in the page; then the Setup
// section opened on that setup after a reload.
//   SB_PERF=1 npx playwright test e2e/perf.spec.ts --project=chromium -g "300-item"
// The plan is written through the app's own edit code (placeIconChanges, the wall and measure boxes, placeMarkChanges and
// nextPositionChanges, the Locations and Shoot days tiles' edits) in one group, after a scene with its location and
// characters imported from a script as Import script writes it, its frames, two setups and a room made through the
// screens, and its underlay comes through the real drop path. Everything is in the first setup's view: walls forming eight rooms and a corridor, doors and
// windows in them, set pieces and other icons (some turned), lights with beams (some all round, some with gear and
// watts), flags and diffusion frames, six cameras shooting frames with lenses (two of them moving), eight characters with
// five positions each, measures, production and sound items, north and a sun path (the location has its place and zone,
// the frames a dated day). The gestures run in a page that keeps its projects in the page (`keep=page`, as the board's);
// the reload needs a project that outlives the page, so it is built again in one that keeps them in localStorage.
// ---------------------------------------------------------------------------------------------------------------------

const PLAN_FRAMES = 12;
const planTileOf = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const planCanvasOf = (page: Page) => planTileOf(page).locator('[data-canvas]');
const toSection = (page: Page, name: string) => sidebar(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();

interface PlanEntry {
  id: string;
  kind: string;
  level: string;
  rotation?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cone?: number | null;
  beam?: number | null;
  labels?: string[];
  path?: unknown[];
  drawn?: boolean;
  sha?: string | null;
  owner?: unknown;
  /** A cone's or beam's shape (6.18): its corner count (`corners`; before the 6.18 review, its `points`). */
  sight?: { cut: boolean; corners?: number; points?: unknown[] } | null;
}

/**
 * How many corners the plan's cones and beams have (6.18 review, item 1): a printed line, not a budget. Konva fills and
 * strokes every one of them on every redraw, so it is what a pan costs a slower computer; a cut all-round light's are
 * counted apart (before the review its glow was drawn as 8 stacked copies of its shape).
 */
function sightCorners(entries: readonly PlanEntry[]): string {
  const cornersOf = (e: PlanEntry) => e.sight?.corners ?? e.sight?.points?.length ?? 0;
  const withShape = entries.filter((e) => e.sight);
  const cut = withShape.filter((e) => e.sight?.cut === true);
  const ring = cut.filter((e) => e.kind === 'light' && typeof e.beam === 'number' && e.beam >= 360);
  const sum = (list: readonly PlanEntry[]) => list.reduce((n, e) => n + cornersOf(e), 0);
  return `${String(sum(withShape))} corners in ${String(withShape.length)} shapes (${String(cut.length)} cut: ${String(sum(cut))} corners; ${String(ring.length)} cut all-round lights: ${String(sum(ring))} corners)`;
}

const planEntries = async (page: Page): Promise<PlanEntry[]> =>
  JSON.parse((await planTileOf(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as PlanEntry[];

interface BuiltPlan {
  key: string;
  sceneId: string;
  setupId: string;
  editWall: string;
  light: string;
  dragIds: string[];
  camera: string;
  frame: string;
  /** The 40 walls (6.18 last pass): the corridor's, 8 to 15, each with a door 3 m along it. */
  wallIds: string[];
}

/**
 * A project with SC 01's Setup 1 furnished with 299 items in one group, then an underlay dropped on it: 300. In metres,
 * with an FX3 as the project's camera body, so every camera draws its cone.
 */
async function furnishedPlan(page: Page, url: string, extra = PLAN_EXTRA): Promise<BuiltPlan> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  await newProject(page, 'Big Plan');
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);

  // The project's camera body, through the Gear tile.
  await toSection(page, 'Production');
  const gear = page.getByRole('region', { name: 'Gear', exact: true });
  const editor = gear.locator('[data-gear-editor]');
  await gear.getByRole('button', { name: '+ New item' }).click();
  await expect(editor.getByLabel('Name')).toBeFocused();
  await page.keyboard.type('FX3');
  await page.keyboard.press('Enter');
  await editor.getByRole('radio', { name: 'Camera body', exact: true }).click();
  await editor.getByLabel('Camera and recording mode').selectOption({ label: 'Sony FX3: Full frame 16:9, 35.6 × 20 mm' });

  // The scene, its location and its eight characters from a script, as Import script writes them (6.11 review, L8: the
  // app's own edits, so the plan can't drift from what the app writes); its frames on the board, two setups, the first
  // shown, its room started.
  await toSection(page, 'Storyboard');
  await page.evaluate(async (src) => {
    const load = (path: string) => import(/* @vite-ignore */ `${src}${path}`) as Promise<unknown>;
    const { projectStore } = (await load('app/projectStore.ts')) as typeof import('../src/app/projectStore');
    const fountain = (await load('core/script/fountain.ts')) as typeof import('../src/core/script/fountain');
    const importing = (await load('features/script/importScript.ts')) as typeof import('../src/features/script/importScript');
    const projectId = projectStore.getState().project?.projectId;
    if (!projectId) throw new Error('no project');
    const names = ['ANNA', 'BEN', 'CARA', 'DEV', 'ELI', 'FAY', 'GUS', 'HAL'];
    const script = fountain.parseFountain(['INT. STAGE 4 - DAY', '', ...names.flatMap((name) => [name, 'A line.', ''])].join('\n'));
    await projectStore.getState().applyWith((records) => ({ changes: importing.importChanges(records, projectId, importing.planImport(records, projectId, script)) }));
  }, SRC);
  const addFrame = board(page).getByRole('button', { name: '+ Frame in SC 01', exact: true });
  for (let i = 0; i < PLAN_FRAMES; i += 1) await addFrame.click();
  await expect(cards(page)).toHaveCount(PLAN_FRAMES);
  await toSection(page, 'Setup');
  const setups = page.getByRole('region', { name: 'Setups', exact: true });
  await setups.getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setups.getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(setups.locator('[data-setup-select]')).toHaveCount(2);
  await setups.locator('[data-setup-select]').first().click();
  await planTileOf(page).getByRole('button', { name: 'New room' }).click();
  await expect(planCanvasOf(page)).toBeVisible();

  const built = await page.evaluate(async ({ src, extra }) => {
    const load = (path: string) => import(/* @vite-ignore */ `${src}${path}`) as Promise<unknown>;
    const { projectStore } = (await load('app/projectStore.ts')) as typeof import('../src/app/projectStore');
    const plan = (await load('core/model/plan.ts')) as typeof import('../src/core/model/plan');
    const planItems = (await load('features/birdseye/plan/planItems.ts')) as typeof import('../src/features/birdseye/plan/planItems');
    const sizes = (await load('features/birdseye/plan/iconSizes.ts')) as typeof import('../src/features/birdseye/plan/iconSizes');
    const lights = (await load('core/model/planLight.ts')) as typeof import('../src/core/model/planLight');
    const order = (await load('core/ops/order.ts')) as typeof import('../src/core/ops/order');
    const shownPlan = (await load('features/birdseye/plan/shownPlan.ts')) as typeof import('../src/features/birdseye/plan/shownPlan');
    const blocking = (await load('core/model/planBlocking.ts')) as typeof import('../src/core/model/planBlocking');
    const locations = (await load('features/locations/locationEdits.ts')) as typeof import('../src/features/locations/locationEdits');
    const days = (await load('features/schedule/dayEdits.ts')) as typeof import('../src/features/schedule/dayEdits');
    type SbdRecord = import('../src/core/model/record').SbdRecord;
    type Props = import('../src/core/model/record').Props;
    type Change = import('../src/core/ops/ops').Change;
    const { sceneId, setupId } = shownPlan.useShownPlan.getState();
    const projectId = projectStore.getState().project?.projectId;
    if (sceneId === null || setupId === null || !projectId) throw new Error('no setup shown');
    const view = { sceneId, setupId };
    const out: { plan: Omit<BuiltPlan, 'key'> | null } = { plan: null };
    const written = await projectStore.getState().applyWith((records) => {
      // The records as they will be once each change before is written, so every builder reads what came before it: a new
      // object after each, as the store makes, since the model's readers keep their readings per records object.
      let local: Record<string, SbdRecord> = { ...records };
      const changes: Change[] = [];
      const take = (list: readonly Change[]) => {
        const next = { ...local };
        for (const change of list) {
          changes.push(change);
          if (change.kind === 'create') {
            const id = change.record.id ?? '';
            next[id] = { id, type: change.record.type, parentId: change.record.parentId, sortKey: change.record.sortKey, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
          } else if (change.kind === 'update') {
            const was = next[change.id];
            if (was) {
              const unset = new Set(change.unset ?? []);
              const props: Props = Object.fromEntries(Object.entries({ ...was.props, ...change.set }).filter(([prop]) => !unset.has(prop)));
              next[change.id] = { ...was, props };
            }
          }
        }
        local = next;
      };
      const create = (type: SbdRecord['type'], parentId: string, props: Props): string => {
        const id = crypto.randomUUID();
        const sortKey = order.keyBetween(plan.lastKeyUnder(local, parentId, type), null);
        take([{ kind: 'create', record: { id, type, parentId, sortKey, props } }]);
        return id;
      };
      /** An icon placed as the Library places it, then given what it carries. */
      const place = (icon: string, centre: { x: number; y: number }, extra: Props = {}): string => {
        const id = crypto.randomUUID();
        const list = planItems.placeIconChanges(local, view, icon, centre, id);
        const made = list.find((c) => c.kind === 'create' && c.record.id === id);
        if (!made || made.kind !== 'create') throw new Error(`could not place ${icon}`);
        made.record.props = { ...made.record.props, ...extra };
        take(list);
        return id;
      };
      const roomId = plan.sceneRoomId(local, local[sceneId]);
      if (roomId === null) throw new Error('no room');

      // The place, its zone and a dated day: everything the sun path reads, through the Locations and Shoot days tiles'
      // edits (the address search's pick, the zone set by hand, a new day on a date, the scene's frames put in it).
      const placeId = local[sceneId]?.props.location_id;
      const location = typeof placeId === 'string' ? placeId : '';
      const characters = blocking.sceneCharacterIds(local, sceneId);
      if (location === '' || characters.length !== 8) throw new Error('the script made no location or characters');
      take(locations.placeLocation(local, location, { name: 'Stage 4, Los Angeles', latitude: 34.0522, longitude: -118.2437 }));
      take(locations.timeZoneChange(local, location, 'America/Los_Angeles'));
      const newDay = days.newDay(local, projectId, '2026-06-21');
      take([newDay]);
      const day = newDay.record.id ?? '';
      const frames = Object.values(local)
        .filter((r) => r.type === 'shot' && r.parentId === sceneId && r.trashedAt === null)
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
        .map((r) => r.id);
      take(days.scheduleFrames(local, frames, day));
      // 1A starts at 18 mm; the lens edits type 21 to 40, which no other frame uses.
      const lenses = [18, 50, 65, 75, 85, 100, 135, 150, 180, 200, 14, 12];
      frames.forEach((id, i) => {
        take([{ kind: 'update', id, set: { setup_id: setupId, lens_mm: lenses[i % lenses.length] ?? 50 } }]);
      });
      const gearItems = Array.from({ length: 8 }, (_, i) => create('gear_item', projectId, { name: `Fixture ${String(i + 1)}`, department: 'grip-electric', quantity: 1, watts: 300 + i * 150 }));

      // 40 walls: the outer walls, a corridor across the middle, rooms either side of it, a closet in each room.
      const walls: { id: string; room: number }[] = [];
      const wall = (a: { x: number; y: number }, b: { x: number; y: number }, room = -1) => {
        const n = walls.length;
        const props: Props = plan.wallProps(plan.wallBetween(a, b));
        if (n % 4 === 1) props.height_m = 2.4 + (n % 3) * 0.3;
        walls.push({ id: create('plan_item', roomId, props), room });
      };
      const xs = [0, 6, 12, 18, 24];
      for (const y of [0, 16, 7, 9]) for (let k = 0; k < 4; k += 1) wall({ x: xs[k] ?? 0, y }, { x: xs[k + 1] ?? 0, y });
      for (const x of [0, 24]) for (const [from, to] of [[0, 7], [7, 9], [9, 16]] as const) wall({ x, y: from }, { x, y: to });
      for (const x of [6, 12, 18]) for (const [from, to] of [[0, 7], [9, 16]] as const) wall({ x, y: from }, { x, y: to });
      for (let r = 0; r < 8; r += 1) {
        const rx = (r % 4) * 6;
        const ry = r < 4 ? 0 : 9;
        wall({ x: rx, y: ry + 3.5 }, { x: rx + 2, y: ry + 3.5 }, r);
      }
      for (let r = 0; r < 4; r += 1) wall({ x: r * 6 + 2, y: 3.5 }, { x: r * 6 + 2, y: 2 }, r);
      // 12 doors and windows: a door in each corridor wall, a window in each top outer wall.
      const corridor = walls.slice(8, 16);
      for (const w of corridor) create('plan_item', roomId, planItems.openingProps('door', w.id, 3));
      for (const w of walls.slice(0, 4)) create('plan_item', roomId, planItems.openingProps('window', w.id, 3));
      // 20 measures along the rooms and the corridor.
      for (let i = 0; i < 20; i += 1) {
        const r = i % 8;
        const rx = (r % 4) * 6;
        const ry = r < 4 ? 0 : 9;
        const [a, b] =
          i < 8
            ? [{ x: rx + 0.3, y: ry + 0.4 }, { x: rx + 5.7, y: ry + 0.4 }]
            : i < 16
              ? [{ x: rx + 5.6, y: ry + 0.3 }, { x: rx + 5.6, y: ry + 6.7 }]
              : [{ x: (i - 16) * 6 + 0.3, y: 8 }, { x: (i - 16) * 6 + 5.7, y: 8 }];
        create('plan_item', roomId, planItems.measureProps(plan.wallBetween(a, b, plan.MEASURE_THICKNESS)));
      }

      // Cells on a 1.2 m grid, mixed in a fixed order; the bottom right room is kept for the 20 pieces the drag moves.
      const cells: { x: number; y: number }[] = [];
      for (let cy = 0; cy < 13; cy += 1) for (let cx = 0; cx < 20; cx += 1) {
        const at = { x: 0.6 + cx * 1.2, y: 0.6 + cy * 1.2 };
        if (!(at.x > 18 && at.y > 9)) cells.push(at);
      }
      const shuffled = cells.map((c, i) => ({ c, k: (i * 7919) % 233 })).sort((a, b) => a.k - b.k).map((e) => e.c);
      let next = 0;
      const cell = () => {
        const at = shuffled[next % shuffled.length] ?? { x: 1, y: 1 };
        next += 1;
        return at;
      };

      // 91 set pieces and other icons, every fifth turned; 20 of them the drag's, in the bottom right room.
      const dragIds: string[] = [];
      for (let i = 0; i < 20; i += 1) dragIds.push(place(i % 2 === 0 ? 'set-art/chair' : 'set-art/plant-tree', { x: 20.6 + (i % 4) * 0.9, y: 9.8 + Math.floor(i / 4) * 1.2 }));
      const pieces = ['set-art/sofa', 'set-art/table', 'set-art/chair', 'set-art/bed', 'set-art/counter-bar', 'set-art/plant-tree', 'set-art/column', 'set-art/stairs', 'set-art/car', 'grip/apple-box', 'grip/c-stand', 'grip/combo-stand', 'grip/ladder', 'grip/rostrum', 'grip/sandbag'];
      for (let i = 0; i < 71; i += 1) place(pieces[i % pieces.length] ?? 'set-art/chair', cell(), i % 5 === 0 ? { rotation: (i * 37) % 360 } : {});
      // 40 lights pointing every way: every fifth all round, every third its gear item's watts, every fourth watts typed.
      let light = '';
      for (let i = 0; i < 40; i += 1) {
        const extra: Props = { rotation: (i * 41) % 360 };
        if (i % 5 === 0) extra.beam_deg = 360;
        if (i % 3 === 0) extra.gear_id = gearItems[i % gearItems.length] ?? '';
        if (i % 4 === 0) extra.watts = 650;
        if (i % 6 === 0) extra.height_m = 2.2;
        const id = place(lights.LIGHT_ICONS[i % lights.LIGHT_ICONS.length] ?? 'lighting/fresnel', cell(), extra);
        if (i === 1) light = id;
      }
      // 30 flags and diffusion frames.
      const frameIcons = [...lights.FLAG_ICONS, ...lights.DIFFUSION_ICONS];
      for (let i = 0; i < 30; i += 1) place(frameIcons[i % frameIcons.length] ?? 'grip/flag', cell(), { rotation: (i * 23) % 360, ...(i % 4 === 0 ? { height_m: 1.8 } : {}) });
      // 6 cameras, each shooting two frames; the first two move through three later positions each.
      const cameraIcons = ['camera/camera', 'camera/sticks', 'camera/dolly-track', 'camera/gimbal', 'camera/steadicam', 'camera/handheld'];
      const cameras = cameraIcons.map((icon, i) => place(icon, cell(), { rotation: (i * 60 + 15) % 360, shot_ids: frames.slice(i * 2, i * 2 + 2) }));
      // Each move is Next position from the camera's last, as the Selection tile and a drop make it.
      const markSize = sizes.iconSize(plan.CAST_MARK_ICON) ?? { width: 0.4, depth: 0.4 };
      const nextPosition = (from: string, at: { x: number; y: number }): string => {
        const id = crypto.randomUUID();
        const list = blocking.nextPositionChanges(local, view, from, markSize, at, id);
        if (list.length === 0) throw new Error('no next position');
        take(list);
        return id;
      };
      for (const camera of cameras.slice(0, 2)) {
        let last = camera;
        for (let k = 0; k < 3; k += 1) last = nextPosition(last, cell());
      }
      // 8 characters, five positions each, in the scene's blocking: a cast mark placed, then four next positions.
      for (const character of characters) {
        const id = crypto.randomUUID();
        const list = blocking.placeMarkChanges(local, view, cell(), markSize, character, id);
        if (list.length === 0) throw new Error('no cast mark');
        take(list);
        let last: string = id;
        for (let k = 1; k < 5; k += 1) last = nextPosition(last, cell());
      }
      // 12 production and sound items; the room's north, turned; the setup's sun path in the afternoon.
      const crew = ['production/video-village', 'production/generator', 'production/first-aid', 'production/parking', 'production/zone', 'production/note', 'production/distro-cable', 'production/hazard', 'sound/boom', 'sound/lav', 'sound/playback', 'sound/sound-cart'];
      for (const icon of crew) place(icon, cell());
      place(plan.NORTH_ICON, { x: 23, y: 1 }, { rotation: 20 });
      place(plan.SUN_ICON, { x: 12, y: 8 }, { time: '16:30' });
      // SB_PERF_EXTRA (6.18 last pass): that many stroke records under the first frame, as a sketched storyboard has, in
      // this same group, so a plan gesture that reads every record in the project is measured where it would hurt.
      if (extra > 0) {
        const holder = frames[0] ?? '';
        let key = order.keyBetween(plan.lastKeyUnder(local, holder, 'stroke'), null);
        const strokes: Change[] = [];
        for (let i = 0; i < extra; i += 1) {
          strokes.push({ kind: 'create', record: { id: crypto.randomUUID(), type: 'stroke', parentId: holder, sortKey: key, props: { tool: 'pen', points: [0.1, 0.1 + (i % 80) / 100, 0.9, 0.1 + (i % 80) / 100], width: 0.004 } } });
          key = order.keyBetween(key, null);
        }
        take(strokes);
      }
      out.plan = { sceneId, setupId, editWall: walls[28]?.id ?? '', light, dragIds, camera: cameras[0] ?? '', frame: frames[0] ?? '', wallIds: walls.map((w) => w.id) };
      return { changes };
    });
    if (!written || !out.plan) throw new Error('the plan was not written');
    return out.plan;
  }, { src: SRC, extra });
  await expect.poll(async () => (await planEntries(page)).length, { timeout: 60_000 }).toBe(299);

  // The underlay, a generated picture dropped on the plan as from Finder or Explorer.
  const box = await planCanvasOf(page).boundingBox();
  if (!box) throw new Error('no plan canvas');
  const transfer = await mixedPictures(page, 7, 1);
  await planTileOf(page).locator('[data-plan-drops]').dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await expect.poll(async () => (await planEntries(page)).filter((e) => e.kind === 'underlay' && typeof e.sha === 'string').length, { timeout: 60_000 }).toBe(1);
  await transfer.dispose();
  return { ...built, key: `setup:${built.setupId}` };
}

/** A wheel event every animation frame on the plan's canvas for `ms`, shaped by `wheel(frame, frames, arg)`. */
async function planWheel(page: Page, ms: number, wheel: (frame: number, total: number, arg: number) => { dx: number; dy: number; ctrl: boolean }, arg = 0) {
  const shape = await pageFunction<typeof wheel>(page, wheel.toString());
  await page.evaluate(
    async ({ ms, shape, arg }) => {
      const element = document.querySelector('[data-plan-tile] [data-canvas]');
      if (!element) throw new Error('no plan canvas');
      const rect = element.getBoundingClientRect();
      const total = Math.round(ms / (1000 / 60));
      for (let frame = 0; frame < total; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const { dx, dy, ctrl } = shape(frame, total, arg);
        element.dispatchEvent(
          new WheelEvent('wheel', { deltaX: dx, deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }),
        );
        (window as unknown as { __lastWheel: number }).__lastWheel = performance.now();
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    { ms, shape, arg },
  ).finally(() => shape.dispose());
}

/**
 * Arms the page to time one edit: from the next Enter's keydown until the plan's data first satisfies `want` (a
 * function of the data's text, as source), and then the next frame drawn. Read with `editLag`.
 */
async function armEdit(page: Page, want: string, arg: string | number) {
  const check = await pageFunction<(data: string, arg: string | number) => boolean>(page, want);
  await page.evaluate(
    ({ check, arg }) => {
      const w = window as unknown as {
        __edit?: { keyAt: number | null; lag: number | null; want: ((data: string, arg: string | number) => boolean) | null; arg: string | number };
        __editWired?: boolean;
      };
      w.__edit = { keyAt: null, lag: null, want: check, arg };
      if (w.__editWired) return;
      w.__editWired = true;
      window.addEventListener(
        'keydown',
        (event) => {
          if (w.__edit?.want && w.__edit.keyAt === null && event.key === 'Enter') w.__edit.keyAt = event.timeStamp;
        },
        true,
      );
      new MutationObserver(() => {
        const edit = w.__edit;
        if (!edit?.want || edit.keyAt === null) return;
        const data = document.querySelector('[data-plan-data]')?.getAttribute('data-plan-data') ?? '';
        if (!edit.want(data, edit.arg)) return;
        const at = edit.keyAt;
        edit.want = null;
        requestAnimationFrame(() => {
          edit.lag = performance.now() - at;
        });
      }).observe(document.body, { attributes: true, attributeFilter: ['data-plan-data'], subtree: true });
    },
    { check, arg },
  ).finally(() => check.dispose());
}

async function editLag(page: Page): Promise<number> {
  const read = () => page.evaluate(() => (window as unknown as { __edit?: { lag: number | null } }).__edit?.lag ?? null);
  await expect.poll(read, { intervals: [5], timeout: 30_000 }).not.toBeNull();
  return (await read()) ?? Number.NaN;
}

/** Selects items on the plan's view, as a click or a marquee would. */
async function selectOnPlan(page: Page, key: string, ids: readonly string[]) {
  await page.evaluate(
    async ({ key, ids, src }) => {
      const path = `${src}features/birdseye/plan/planStore.ts`;
      const store = (await import(/* @vite-ignore */ path)) as typeof import('../src/features/birdseye/plan/planStore');
      store.planStore.getState().select(key, [...ids]);
    },
    { key, ids, src: SRC },
  );
  await expect.poll(async () => (JSON.parse((await planCanvasOf(page).getAttribute('data-selection')) ?? '[]') as string[]).length).toBe(ids.length);
}

const describeTimes = (values: number[]) => `median ${median(values).toFixed(1)} ms, p95 ${p95(values).toFixed(1)} ms, slowest ${Math.max(...values).toFixed(1)} ms`;

test('a 300-item set plan pans, zooms, drags and edits smoothly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  const built = await furnishedPlan(page, '/?files=memory&keep=page');
  const entries = await planEntries(page);
  // What the plan's data lists, and that its cones, beams, paths and the sun are drawn.
  expect(entries).toHaveLength(300);
  const count = (kind: string) => entries.filter((e) => e.kind === kind).length;
  expect({
    wall: count('wall'),
    openings: count('door') + count('window'),
    icon: count('icon'),
    light: count('light'),
    frames: count('flag') + count('diffusion'),
    camera: count('camera'),
    mark: count('mark'),
    measure: count('measure'),
    north: count('north'),
    sun: count('sun'),
    underlay: count('underlay'),
  }).toEqual({ wall: 40, openings: 12, icon: 103, light: 40, frames: 30, camera: 6, mark: 46, measure: 20, north: 1, sun: 1, underlay: 1 });
  expect(entries.filter((e) => e.kind === 'camera' && typeof e.cone === 'number')).toHaveLength(6);
  expect(entries.filter((e) => e.kind === 'camera' && Array.isArray(e.path))).toHaveLength(2);
  expect(entries.filter((e) => e.kind === 'light' && typeof e.beam === 'number')).toHaveLength(40);
  expect(entries.filter((e) => e.kind === 'mark' && Array.isArray(e.path))).toHaveLength(8);
  expect(entries.find((e) => e.kind === 'sun')?.drawn).toBe(true);

  const canvas = planCanvasOf(page);
  const tile = planTileOf(page);
  const results: Record<string, string> = {};
  results['cones and beams as drawn (polygon corners)'] = sightCorners(entries);
  const gestures = new Map<string, Gaps>();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const view = async () => ({
    zoom: Number(await canvas.getAttribute('data-zoom')),
    cx: Number(await canvas.getAttribute('data-cx')),
    cy: Number(await canvas.getAttribute('data-cy')),
  });
  const screenOf = async (x: number, y: number) => {
    const v = await view();
    return { x: box.x + box.width / 2 + (x - v.cx) * v.zoom, y: box.y + box.height / 2 + (y - v.cy) * v.zoom };
  };
  const nextFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const sway = (frame: number) => ({ dx: Math.cos(frame / 20) * 40, dy: Math.sin(frame / 27) * 30, ctrl: false });

  // A 3-second pan with the whole plan in view, then the same at 400% over the corridor.
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => (await view()).zoom).toBeLessThan(1);
  const fit = (await view()).zoom;
  gestures.set('pan, whole plan in view (3 s)', await frameTimes(page, () => planWheel(page, 3000, sway), 'plan-pan-fit'));
  await page.evaluate(
    async ({ key, src }) => {
      const store = (await import(/* @vite-ignore */ `${src}features/birdseye/plan/planStore.ts`)) as typeof import('../src/features/birdseye/plan/planStore');
      store.planStore.getState().setViewport(key, { cx: 1200, cy: 800, zoom: 4 });
    },
    { key: built.key, src: SRC },
  );
  await expect.poll(async () => (await view()).zoom).toBe(4);
  gestures.set('pan, at 400% (3 s)', await frameTimes(page, () => planWheel(page, 3000, sway), 'plan-pan-400'));

  // Fit to 400% with Ctrl + wheel in 1.5 s, held a moment, then back out in 1.5 s.
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => Math.abs((await view()).zoom - fit) < 1e-6).toBe(true);
  const turn = Math.log(4 / fit) / 0.004;
  // Each leg's settle timed on its own (6.11 review, M1): the frame where every item in view is drawn for the new zoom.
  // And how long after the last wheel step every item is drawn for the new zoom (6.11: a slice a frame after the settle).
  const planCanvas = '[data-plan-tile] [data-canvas]';
  await armCaughtUp(page, planCanvas);
  const { zoom: zoomIn, settle: settleIn } = await zoomTimes(page, () => planWheel(page, 1500, (_f, total, arg) => ({ dx: 0, dy: -arg / total, ctrl: true }), turn), 'plan-zoom-in');
  const caughtUpIn = await caughtUp(page, planCanvas);
  const atFour = (await view()).zoom;
  // How many count as in view there (a label's or a beam's reach is worked out for the plan's least zoom), and how many hidden.
  results['items at 400% (shown, mounted hidden)'] = `${String(await canvas.getAttribute('data-shown'))}, ${String(await canvas.getAttribute('data-hidden'))}`;
  await page.waitForTimeout(300);
  await armCaughtUp(page, planCanvas);
  const { zoom: zoomOut, settle: settleOut } = await zoomTimes(page, () => planWheel(page, 1500, (_f, total, arg) => ({ dx: 0, dy: arg / total, ctrl: true }), turn), 'plan-zoom-out');
  const caughtUpOut = await caughtUp(page, planCanvas);
  results['every item at the new zoom (caught up after N ms from the last wheel step), at 400%; at fit'] = `${ms(caughtUpIn)}; ${ms(caughtUpOut)}`;
  gestures.set('zoom, fit to 400% and back (3 s)', { gaps: [...zoomIn.gaps, ...zoomOut.gaps] });
  gestures.set('settle at 400% (300 ms after the last wheel step)', settleIn);
  gestures.set('settle at fit (300 ms after the last wheel step)', settleOut);
  results['zoom'] = `in to ${String(Math.round(atFour * 100))}%, out to ${String(Math.round((await view()).zoom * 100))}% (fit was ${String(Math.round(fit * 100))}%)`;
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => Math.abs((await view()).zoom - fit) < 1e-6).toBe(true);

  // A drag of the 20 pieces in the bottom right room, one pointer move a frame, 90 frames.
  await selectOnPlan(page, built.key, built.dragIds);
  const canvasItems = async () => JSON.parse((await canvas.getAttribute('data-items')) ?? '[]') as { id: string; x: number; y: number; width: number; height: number }[];
  const before = await canvasItems();
  const lead = before.find((i) => i.id === built.dragIds[9]);
  if (!lead) throw new Error('no lead piece');
  const grab = await screenOf(lead.x + lead.width / 2, lead.y + lead.height / 2);
  const startX = built.dragIds.map((id) => before.find((i) => i.id === id)?.x ?? 0);
  gestures.set(
    'drag 20 selected items (90 moves)',
    await frameTimes(
      page,
      async () => {
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        for (let step = 1; step <= 90; step += 1) {
          await page.mouse.move(grab.x - (step * 120) / 90, grab.y + (step * 40) / 90);
          await nextFrame();
        }
        await page.mouse.up();
        await nextFrame();
        await nextFrame();
      },
      'plan-drag',
    ),
  );
  await expect
    .poll(async () => {
      const now = await canvasItems();
      return built.dragIds.map((id) => now.find((i) => i.id === id)?.x ?? 0).every((x, n) => x < (startX[n] ?? 0));
    })
    .toBe(true);

  // A marquee over the left half of the plan, from outside its top left corner.
  await canvas.focus();
  await page.keyboard.press('Escape');
  const topLeft = await screenOf(-60, -60);
  const bottomRight = await screenOf(1230, 1660);
  gestures.set(
    'marquee over the left half (90 moves)',
    await frameTimes(
      page,
      async () => {
        await page.mouse.move(topLeft.x, topLeft.y);
        await page.mouse.down();
        for (let step = 1; step <= 90; step += 1) {
          const along = (from: number, to: number) => from + ((to - from) * step) / 90;
          await page.mouse.move(along(topLeft.x, bottomRight.x), along(topLeft.y, bottomRight.y));
          await nextFrame();
        }
        await page.mouse.up();
        await nextFrame();
        await nextFrame();
      },
      'plan-marquee',
    ),
  );
  const picked = (JSON.parse((await canvas.getAttribute('data-selection')) ?? '[]') as string[]).length;
  results['marquee picked'] = `${String(picked)} items`;
  expect(picked).toBeGreaterThan(120);

  // A light turned with the turn key held for 2 s: a key repeat every 33 ms, as a keyboard repeats it.
  await selectOnPlan(page, built.key, [built.light]);
  const rotationOf = async (id: string) => (await planEntries(page)).find((e) => e.id === id)?.rotation ?? Number.NaN;
  const startTurn = await rotationOf(built.light);
  await canvas.focus();
  const presses = 60;
  gestures.set(
    'turn a light, key held 2 s',
    await frameTimes(
      page,
      () =>
        page.evaluate(async (presses) => {
          const element = document.activeElement ?? document.body;
          const key = { key: ']', code: 'BracketRight', bubbles: true, cancelable: true };
          for (let i = 0; i < presses; i += 1) {
            element.dispatchEvent(new KeyboardEvent('keydown', { ...key, repeat: i > 0 }));
            await new Promise((resolve) => setTimeout(resolve, 33));
          }
          element.dispatchEvent(new KeyboardEvent('keyup', key));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, presses),
      'plan-turn',
    ),
  );
  const turnedBy = (((await rotationOf(built.light)) - startTurn) % 360 + 360) % 360;
  results['turns landed when the key was let go'] = `${String(Math.round(turnedBy / 5))} of ${String(presses)}`;
  const wanted = (startTurn + presses * 5) % 360;
  const landed = Date.now();
  await expect.poll(() => rotationOf(built.light), { timeout: 30_000 }).toBeCloseTo(wanted, 4);
  results['every turn landed, after the key was let go'] = ms(Date.now() - landed);

  // 6.18 last pass: walls dragged, so every move cuts the cones and beams they meet live, through the drop's own
  // function (src/features/birdseye/plan/liveSights.ts). At 100%, where a wall 10 cm thick is 10 px, centred on the place
  // pressed: a place on a wall where no other item lies (the plan is crowded, and an item over the wall would be picked
  // instead), clear of a door or window 3 m along. First the 40 walls picked together, 90 moves; then one corridor wall
  // alone, its door with it, dragged down across the beams, 90 moves.
  const others = (await planEntries(page)).filter((i) => i.kind !== 'wall' && i.kind !== 'underlay' && i.kind !== 'door' && i.kind !== 'window');
  // Whether a point (canvas units) is clear of every other item's turned box, by 10 cm.
  const clear = (x: number, y: number) =>
    others.every((o) => {
      const w = (o.width ?? 0) * 100;
      const h = (o.height ?? 0) * 100;
      const turn = ((o.rotation ?? 0) * Math.PI) / 180;
      const dx = x - ((o.x ?? 0) * 100 + w / 2);
      const dy = y - ((o.y ?? 0) * 100 + h / 2);
      const u = dx * Math.cos(turn) + dy * Math.sin(turn);
      const v = -dx * Math.sin(turn) + dy * Math.cos(turn);
      return Math.abs(u) > w / 2 + 10 || Math.abs(v) > h / 2 + 10;
    });
  /** A clear place on one of these walls (canvas units), along its middle line. */
  const gripOn = async (pool: readonly string[]) => {
    const boxes = await canvasItems();
    for (const id of pool) {
      const b = boxes.find((i) => i.id === id);
      if (!b) continue;
      const turn = (((b as { rotation?: number }).rotation ?? 0) * Math.PI) / 180;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      for (let u = 30; u <= b.width - 30; u += 10) {
        if (u > 230 && u < 370) continue;
        const along = u - b.width / 2;
        const at = { x: cx + along * Math.cos(turn), y: cy + along * Math.sin(turn) };
        if (clear(at.x, at.y)) return { id, ...at };
      }
    }
    throw new Error('no clear place on a wall');
  };
  const centreAt = async (at: { x: number; y: number }) => {
    await page.evaluate(
      async ({ key, src, at }) => {
        const store = (await import(/* @vite-ignore */ `${src}features/birdseye/plan/planStore.ts`)) as typeof import('../src/features/birdseye/plan/planStore');
        store.planStore.getState().setViewport(key, { cx: at.x, cy: at.y, zoom: 1 });
      },
      { key: built.key, src: SRC, at },
    );
    await expect.poll(async () => (await view()).cx).toBe(at.x);
  };
  const boxAt = async (id: string) => (await canvasItems()).find((i) => i.id === id);
  const wallDrag = async (name: string, ids: readonly string[], pool: readonly string[], dx: number, dy: number, label: string) => {
    const grip = await gripOn(pool);
    await centreAt(grip);
    await selectOnPlan(page, built.key, ids);
    const was = await boxAt(grip.id);
    const from = await screenOf(grip.x, grip.y);
    gestures.set(
      name,
      await frameTimes(
        page,
        async () => {
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          for (let step = 1; step <= 90; step += 1) {
            await page.mouse.move(from.x + (step * dx) / 90, from.y + (step * dy) / 90);
            await nextFrame();
          }
          await page.mouse.up();
          await nextFrame();
          await nextFrame();
        },
        label,
      ),
    );
    // The drag was a real one: the wall pressed moved.
    await expect.poll(async () => Math.hypot(((await boxAt(grip.id))?.x ?? 0) - (was?.x ?? 0), ((await boxAt(grip.id))?.y ?? 0) - (was?.y ?? 0))).toBeGreaterThan(20);
  };
  await wallDrag('drag the 40 walls (90 moves)', built.wallIds, built.wallIds, -60, 40, 'plan-drag-walls');
  const corridor = built.wallIds.slice(8, 16);
  const doorWall = (await gripOn(corridor)).id;
  await wallDrag('drag a wall with a door across the beams (90 moves)', [doorWall], [doorWall], 0, 120, 'plan-drag-door-wall');
  results['extra records in the project (SB_PERF_EXTRA)'] = String(PLAN_EXTRA);
  await tile.getByRole('button', { name: 'Fit all' }).click();
  await expect.poll(async () => Math.abs((await view()).zoom - fit) < 1e-6).toBe(true);

  // A wall's length typed in the Selection tile, 10 times: from Enter to the next frame that shows it.
  await selectOnPlan(page, built.key, [built.editWall]);
  const length = page.getByRole('region', { name: 'Selection', exact: true }).getByRole('textbox', { name: 'Length', exact: true });
  await expect(length).toHaveValue('2.00 m');
  const wallEdits: number[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const metres = 2 + i / 100;
    await armEdit(page, '(data, arg) => data.includes(arg)', `"width":${String(metres)},`);
    await length.fill(`${metres.toFixed(2)} m`);
    await length.press('Enter');
    wallEdits.push(await editLag(page));
    await expect(length).toHaveValue(`${metres.toFixed(2)} m`);
  }

  // 10 icons placed from the Library with Enter, each in the middle of the view.
  const library = page.getByRole('region', { name: 'Library', exact: true });
  await expect(library.locator('[data-library-tile]')).toHaveAttribute('data-library-state', 'ready');
  const placing = ['set-art/chair', 'set-art/table', 'grip/apple-box', 'grip/c-stand', 'sound/boom', 'production/parking', 'set-art/plant-tree', 'grip/sandbag', 'set-art/column', 'sound/lav'];
  const placed: number[] = [];
  for (const icon of placing) {
    const now = (await planEntries(page)).length;
    await armEdit(page, '(data, arg) => data.split(\'"level":\').length - 1 > arg', now);
    await library.locator(`[data-library-icon="${icon}"]`).focus();
    await page.keyboard.press('Enter');
    placed.push(await editLag(page));
  }
  await expect.poll(async () => (await planEntries(page)).length).toBe(310);

  // With the plan open, 1A's lens typed in the Inspector 20 times: each redraws its camera's cone.
  await toSection(page, 'Storyboard');
  await cards(page).nth(0).click();
  await toSection(page, 'Setup');
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('group', { name: 'Open tile' }).getByRole('button', { name: 'Frame inspector', exact: true }).click();
  const lens = page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('textbox', { name: 'Lens (mm)', exact: true });
  await expect(lens).toHaveValue('18');
  await expect(canvas).toBeVisible();
  const coneOf = async () => (await planEntries(page)).find((e) => e.id === built.camera)?.cone ?? null;
  const firstCone = await coneOf();
  const lensEdits: number[] = [];
  for (let mm = 21; mm <= 40; mm += 1) {
    await armEdit(page, '(data, arg) => data.includes(arg)', `· ${String(mm)} mm`);
    await lens.fill(String(mm));
    await lens.press('Enter');
    lensEdits.push(await editLag(page));
    await expect.poll(async () => (await planEntries(page)).find((e) => e.id === built.camera)?.labels?.[0]).toContain(`· ${String(mm)} mm`);
  }
  const lastCone = await coneOf();
  expect(lastCone).not.toBeNull();
  expect(lastCone).not.toBe(firstCone);

  // The 6.10 PDF of this setup's plan (decision: report it, fix it only past 10 s), timed from Save to the download.
  await page.locator('[data-plan-tile] [data-plan-heading]').getByRole('button', { name: 'Export…' }).click();
  await page.locator('[data-plan-export="plan-setup-pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  const saving = Date.now();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Save…' }).click();
  await download;
  results['setup plan as PDF (6.10), Save to download'] = ms(Date.now() - saving);

  // Opening the Setup section on that setup after a reload: the plan built again in a page whose projects outlive it.
  // Without SB_PERF_EXTRA's strokes: this project is kept in the page's storage, which 5,000 more records overfill.
  const again = await furnishedPlan(page, '/?files=memory', 0);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Big Plan/ }).click();
  await expect(cards(page)).toHaveCount(PLAN_FRAMES);
  const opening = Date.now();
  await toSection(page, 'Setup');
  await page.locator(`[data-setup-select="${again.setupId}"]`).click();
  await expect.poll(async () => (await planEntries(page)).length, { intervals: [5], timeout: 30_000 }).toBe(300);
  await nextFrame();
  const openedIn = Date.now() - opening;
  await expect.poll(async () => Object.keys(JSON.parse((await tile.locator('[data-plan-data]').getAttribute('data-picture-levels')) ?? '{}') as object).length, { timeout: 30_000 }).toBe(1);
  const pictureIn = Date.now() - opening;
  results['open the Setup section on Setup 1 after a reload (300 items drawn; the underlay too)'] = `${ms(openedIn)}; ${ms(pictureIn)}`;
  await page.waitForTimeout(400);
  const heap = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  results['memory after opening it (JS heap in use)'] = `${(heap / 1024 / 1024).toFixed(0)} MB`;

  console.log(`\nA 300-item set plan, ${test.info().project.name}:`);
  for (const [name, gaps] of gestures) console.log(`  ${name}: ${summary(gaps)}`);
  console.log(`  wall length typed, Enter to drawn (10): ${describeTimes(wallEdits)}`);
  console.log(`  icon placed with Enter, to drawn (10): ${describeTimes(placed)}`);
  console.log(`  frame lens typed in the Inspector, Enter to the cone drawn (20): ${describeTimes(lensEdits)}`);
  for (const [name, value] of Object.entries(results)) console.log(`  ${name}: ${value}`);

  expect(errors).toEqual([]);
  // Budgets, as the board's: what a person would call slow, not what this machine does; 16.7 ms a frame is the target.
  for (const name of ['pan, whole plan in view (3 s)', 'pan, at 400% (3 s)', 'zoom, fit to 400% and back (3 s)']) {
    expect(p95(gestures.get(name)?.gaps ?? []), name).toBeLessThan(34);
  }
  for (const name of ['drag the 40 walls (90 moves)', 'drag a wall with a door across the beams (90 moves)']) {
    expect(p95(gestures.get(name)?.gaps ?? []), name).toBeLessThan(50);
  }
  for (const name of ['drag 20 selected items (90 moves)', 'marquee over the left half (90 moves)', 'turn a light, key held 2 s']) {
    expect(p95(gestures.get(name)?.gaps ?? []), name).toBeLessThan(50);
  }
  for (const [name, lags] of [['wall length', wallEdits], ['icon placed', placed], ['lens', lensEdits]] as const) {
    expect(Math.max(...lags), name).toBeLessThan(100);
  }
  // A zoom's settle is an edit's worth of work (6.11 review, M1): its slowest frame under 100 ms, as an edit's.
  for (const name of ['settle at 400% (300 ms after the last wheel step)', 'settle at fit (300 ms after the last wheel step)']) {
    const gaps = gestures.get(name)?.gaps ?? [];
    expect(gaps.length, name).toBeGreaterThan(0);
    expect(Math.max(...gaps), name).toBeLessThan(100);
  }
  // And every item is at the new zoom within a second of the last wheel step (6.11: the catch-up, a slice a frame).
  expect(caughtUpIn, 'caught up at 400%').toBeLessThan(1000);
  expect(caughtUpOut, 'caught up at fit').toBeLessThan(1000);
  // Open counts the underlay's picture drawn, as the board's counts its pictures (6.11 review, L8).
  expect(pictureIn).toBeLessThan(3000);
});

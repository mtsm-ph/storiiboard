import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
    originals = await page.evaluate(
      async ({ ms, source, arg }) => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- a test probe, given its own code by the spec.
        const make = new Function(`return (${source})`) as () => (frame: number, total: number, arg: number) => ReturnType<Wheel>;
        const shape = make();
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
          if (frame === Math.floor(total / 2)) mid = full();
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // Read at once, within a frame or two of the last step: before the zoom has settled.
        return { mid, end: full() };
      },
      { ms, source: wheel.toString(), arg },
    );
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
  const zoomIn = await frameTimes(page, wheelIn, 'zoom-in');
  const atFour = Number(await canvas.getAttribute('data-zoom'));
  await page.waitForTimeout(300);
  const zoomOut = await frameTimes(page, wheelOut, 'zoom-out');
  gestures.set('zoom, fit to 400% and back (3 s)', { gaps: [...zoomIn.gaps, ...zoomOut.gaps] });
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

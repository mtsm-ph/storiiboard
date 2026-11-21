import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfText } from '../../core/script/pdfLayout';
import {
  CANARY,
  PAGE_STEPS,
  WORKER_POLICY,
  fileName,
  isJavaScript,
  runLaunchCheck,
  type CheckDocument,
  type CheckWindow,
  type LaunchCheckDeps,
  type ScriptAnswer,
  type Violation,
  type WorkerStart,
} from './launchCheck';

// The page's part of the launch check (6.27l), driven with fakes: the real thing runs in a debug build and in both
// real webviews at every checkpoint (scripts/launchCheck.sh). Each failure is reported as that step's, with its reason,
// and the check stops there.

const root = join(import.meta.dirname, '../../..');
const BASE = 'http://tauri.localhost/';
const PDF_WORKER = '/assets/pdf.worker.min-Dr1KORA9.mjs';
const PDF_NAME = 'pdf.worker.min-Dr1KORA9.mjs';
const ACCENT_WORKER = 'http://tauri.localhost/assets/worker-pwfgZlae.js';
const LINE = 'INT. LAUNCH CHECK - DAY';
const CANARY_VIOLATION: Violation = { directive: 'script-src-elem', blocked: 'inline', disposition: 'enforce' };

const text = (value: string): PdfText => ({ page: 1, x: 20, y: 45, width: 100, text: value });

const scriptAnswer = (headers: Record<string, string>, status = 200, type = 'basic'): ScriptAnswer => ({
  status,
  type,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});
const goodScript = () => scriptAnswer({ 'content-type': 'text/javascript', 'content-security-policy': WORKER_POLICY });

interface Fakes {
  deps: LaunchCheckDeps;
  reports: [string, boolean, string][];
  violations: Violation[];
  window: CheckWindow;
  originalWorker: WorkerStart;
  removed: () => number;
  fetched: string[];
}

/** The page as fakes: by default every step passes. `change` swaps any part. */
function fakes(change: (f: Fakes) => Partial<LaunchCheckDeps> = () => ({})): Fakes {
  const reports: [string, boolean, string][] = [];
  const violations: Violation[] = [];
  class FakeWorker {
    terminate(): void {}
  }
  const originalWorker = FakeWorker as unknown as WorkerStart;
  const page: CheckWindow = { Worker: originalWorker };
  let removed = 0;
  const fetched: string[] = [];
  const f: Fakes = {
    reports,
    violations,
    window: page,
    originalWorker,
    removed: () => removed,
    fetched,
    deps: {
      report: (step, ok, detail) => {
        reports.push([step, ok, detail]);
        return Promise.resolve();
      },
      drawScreen: () => Promise.resolve(),
      readPdfText: () => {
        new page.Worker(PDF_WORKER, { type: 'module' });
        return Promise.resolve([text('INT. LAUNCH '), text('CHECK - DAY')]);
      },
      accentsFromWorker: () => {
        new page.Worker(new URL(ACCENT_WORKER), { type: 'module' });
        return Promise.resolve(['#d02020']);
      },
      // The page reads the built-in picture fine: asked only after the accents step failed.
      accentsOnPage: () => Promise.resolve({ width: 16, height: 16, accents: 3 }),
      getFile: (url) => {
        fetched.push(url);
        return Promise.resolve(goodScript());
      },
      document: {
        createElement: () => ({
          textContent: null,
          remove: () => {
            removed += 1;
          },
        }),
        // The webview refuses the inline script and reports it.
        body: {
          appendChild: () => {
            violations.push(CANARY_VIOLATION);
            return undefined;
          },
        },
        // theme-boot.js set the theme, and the app's stylesheet loaded.
        documentElement: { hasAttribute: (name) => name === 'data-theme' },
        styleSheets: { length: 1 },
      },
      window: page,
      baseUrl: BASE,
      violations,
      pdf: new ArrayBuffer(8),
      pdfLine: LINE,
      picture: new Blob(),
      // Vitest's fake clock (beforeEach below): run() moves it on.
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  };
  Object.assign(f.deps, change(f));
  return f;
}

/** The fake document with the canary's append doing `appended` instead of the default report. */
function appending(g: Fakes, appended: () => void): { document: CheckDocument } {
  return {
    document: {
      ...g.deps.document,
      body: {
        appendChild: () => {
          appended();
          return undefined;
        },
      },
    },
  };
}

/** Runs the check on the fake clock until nothing is left to wait for. */
async function run(f: Fakes): Promise<void> {
  const done = runLaunchCheck(f.deps);
  await vi.runAllTimersAsync();
  await done;
}

/** A promise that never settles: a worker that never answers. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const allOk = () => PAGE_STEPS.map((step) => [step, true, '']);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The reports up to and including a failure of `step` with `why`. */
function failedAt(step: string, why: string | RegExp): (reports: [string, boolean, string][]) => void {
  return (reports) => {
    const index = PAGE_STEPS.indexOf(step as (typeof PAGE_STEPS)[number]);
    expect(reports.slice(0, index)).toEqual(PAGE_STEPS.slice(0, index).map((name) => [name, true, '']));
    expect(reports).toHaveLength(index + 1);
    const [name, ok, detail] = reports[index] ?? [];
    expect([name, ok]).toEqual([step, false]);
    if (typeof why === 'string') expect(detail).toBe(why);
    else expect(detail).toMatch(why);
  };
}

describe('the launch check’s page steps (6.27l)', () => {
  it('reports the six steps in order, each once, and puts window.Worker back', async () => {
    const f = fakes();
    await run(f);
    expect(f.reports).toEqual(allOk());
    expect(f.window.Worker).toBe(f.originalWorker);
    // The two scripts the app's own code started, by their full address, each asked for once.
    expect(f.fetched).toEqual([`http://tauri.localhost${PDF_WORKER}`, ACCENT_WORKER]);
    expect(f.removed()).toBe(1);
  });

  describe('page', () => {
    it('fails when the screen never draws', async () => {
      const f = fakes(() => ({ drawScreen: () => Promise.reject(new Error('React could not draw')) }));
      await run(f);
      failedAt('page', 'React could not draw')(f.reports);
    });

    it('fails when theme-boot.js set no theme', async () => {
      const f = fakes((g) => ({ document: { ...g.deps.document, documentElement: { hasAttribute: () => false } } }));
      await run(f);
      failedAt('page', 'theme-boot.js did not run')(f.reports);
    });

    it('fails when no stylesheet is loaded', async () => {
      const f = fakes((g) => ({ document: { ...g.deps.document, styleSheets: { length: 0 } } }));
      await run(f);
      failedAt('page', 'no stylesheet is loaded')(f.reports);
    });
  });

  describe('policy-watch', () => {
    it('fails when the inline script ran', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.window[CANARY] = true;
        }),
      );
      await run(f);
      failedAt('policy-watch', "an inline script ran: the page's policy is not enforced")(f.reports);
      expect(f.removed()).toBe(1);
    });

    it('fails when the refused script was not reported in 2 s', async () => {
      const f = fakes((g) => appending(g, () => undefined));
      await run(f);
      failedAt('policy-watch', 'a refused inline script was not reported: seen nothing was reported')(f.reports);
      expect(f.removed()).toBe(1);
    });

    it('takes a report that comes a moment later, and WebKit’s script-src', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          setTimeout(() => {
            g.violations.push({ directive: 'script-src', blocked: 'inline', disposition: 'enforce' });
          }, 500);
        }),
      );
      await run(f);
      expect(f.reports).toEqual(allOk());
    });

    it('takes an empty blocked address, as WKWebView may give it', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.violations.push({ directive: 'script-src', blocked: '', disposition: 'enforce' });
        }),
      );
      await run(f);
      expect(f.reports).toEqual(allOk());
    });

    it('takes a refusal reported twice as the deliberate one', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.violations.push(CANARY_VIOLATION);
          setTimeout(() => {
            g.violations.push({ directive: 'script-src', blocked: '', disposition: 'enforce' });
          }, 50);
        }),
      );
      await run(f);
      expect(f.violations).toHaveLength(2);
      expect(f.reports).toEqual(allOk());
    });

    it('doesn’t count a report-only entry, and says what it saw', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.violations.push({ directive: 'script-src-elem', blocked: 'inline', disposition: 'report' });
        }),
      );
      await run(f);
      const why = 'a refused inline script was not reported: seen script-src-elem inline report';
      failedAt('policy-watch', why)(f.reports);
    });

    it('doesn’t count a refused inline style or a refused script file as the canary', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.violations.push({ directive: 'style-src-elem', blocked: 'inline', disposition: 'enforce' });
          const file = 'https://example.org/x.js';
          g.violations.push({ directive: 'script-src-elem', blocked: file, disposition: 'enforce' });
        }),
      );
      await run(f);
      failedAt(
        'policy-watch',
        'a refused inline script was not reported: seen style-src-elem inline enforce; ' +
          'script-src-elem https://example.org/x.js enforce',
      )(f.reports);
    });
  });

  describe('pdf-text', () => {
    it('fails with the reader’s own error, and puts window.Worker back', async () => {
      const f = fakes(() => ({ readPdfText: () => Promise.reject(new Error('the PDF worker could not start')) }));
      await run(f);
      failedAt('pdf-text', 'the PDF worker could not start')(f.reports);
      expect(f.window.Worker).toBe(f.originalWorker);
    });

    it('fails when the worker gives no answer in 25 s, and puts window.Worker back', async () => {
      const f = fakes(() => ({ readPdfText: () => never() }));
      const started = Date.now();
      await run(f);
      failedAt('pdf-text', 'no answer from the PDF worker in 25 s')(f.reports);
      expect(Date.now() - started).toBeGreaterThanOrEqual(25_000);
      expect(f.window.Worker).toBe(f.originalWorker);
    });

    it('takes an answer that comes after 20 s, within its 25', async () => {
      const f = fakes((g) => ({
        readPdfText: () => {
          new g.window.Worker(PDF_WORKER);
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve([text(LINE)]);
            }, 20_000);
          });
        },
      }));
      await run(f);
      expect(f.reports).toEqual(allOk());
    });

    it('fails when the text lacks the line', async () => {
      const f = fakes(() => ({ readPdfText: () => Promise.resolve([text('EXT. SOMEWHERE ELSE - NIGHT')]) }));
      await run(f);
      failedAt('pdf-text', 'the PDF\'s text lacks its line: read "EXT. SOMEWHERE ELSE - NIGHT"')(f.reports);
      expect(f.window.Worker).toBe(f.originalWorker);
    });
  });

  describe('accents', () => {
    const unread = 'That image’s colours can’t be read.';
    const invalid = 'The object is in an invalid state.';
    const pageOk = 'on the page: read ok, 16 × 16, 3 accents';
    /** An error as samplePixels gives it: the engine's own, with its stage beside it (6.27q). */
    const atStage = (message: string, stage: string): Error => Object.assign(new Error(message), { stage });

    for (const [what, answer, why] of [
      ['no answer (null)', () => Promise.resolve(null), `the accent worker failed or took over 15 s; ${pageOk}`],
      ['nothing in 20 s', () => never<string[] | null>(), `no answer from the accent worker in 20 s; ${pageOk}`],
      [
        'an empty list',
        () => Promise.resolve([]),
        `the accent worker found no accent in the built-in picture; ${pageOk}`,
      ],
      ['an error', () => Promise.reject(new Error(unread)), `${unread} (worker: no stage); ${pageOk}`],
    ] as const) {
      it(`fails when the worker gives ${what}, and puts window.Worker back`, async () => {
        const f = fakes(() => ({ accentsFromWorker: answer }));
        await run(f);
        failedAt('accents', why)(f.reports);
        expect(f.window.Worker).toBe(f.originalWorker);
      });
    }

    it('asks nothing of the page when the worker passes', async () => {
      const onPage = vi.fn(() => Promise.resolve({ width: 16, height: 16, accents: 3 }));
      const f = fakes(() => ({ accentsOnPage: onPage }));
      await run(f);
      expect(f.reports).toEqual(allOk());
      expect(onPage).not.toHaveBeenCalled();
    });

    it('names the worker’s stage, and the page reading the same picture fine', async () => {
      const f = fakes(() => ({ accentsFromWorker: () => Promise.reject(atStage(invalid, 'decode')) }));
      await run(f);
      failedAt('accents', `${invalid} (worker: decode); ${pageOk}`)(f.reports);
    });

    for (const stage of ['decode', 'canvas', 'draw', 'read']) {
      it(`names the page’s first failing stage, ${stage}, with its words`, async () => {
        const f = fakes(() => ({
          accentsFromWorker: () => Promise.reject(atStage(invalid, stage)),
          accentsOnPage: () => Promise.reject(atStage('The operation is insecure.', stage)),
        }));
        await run(f);
        failedAt('accents', `${invalid} (worker: ${stage}); on the page: ${stage} failed: The operation is insecure.`)(
          f.reports,
        );
      });
    }

    it('keeps today’s words for a null from the worker, and adds the page’s part', async () => {
      const f = fakes(() => ({
        accentsFromWorker: () => Promise.resolve(null),
        accentsOnPage: () => Promise.reject(atStage(invalid, 'read')),
      }));
      await run(f);
      const why = `the accent worker failed or took over 15 s; on the page: read failed: ${invalid}`;
      failedAt('accents', why)(f.reports);
    });

    it('says when the page’s own failure has no stage, and when the page gives no answer in 10 s', async () => {
      const noStage = fakes(() => ({
        accentsFromWorker: () => Promise.resolve(null),
        accentsOnPage: () => Promise.reject(new TypeError('Load failed')),
      }));
      await run(noStage);
      const nullWords = 'the accent worker failed or took over 15 s';
      failedAt('accents', `${nullWords}; on the page: failed: Load failed`)(noStage.reports);

      const silent = fakes(() => ({ accentsFromWorker: () => Promise.resolve(null), accentsOnPage: () => never() }));
      await run(silent);
      failedAt('accents', `${nullWords}; on the page: no answer in 10 s`)(silent.reports);
    });

    it('gives the page the same picture it gave the worker', async () => {
      const pictures: Blob[] = [];
      const f = fakes(() => ({
        accentsFromWorker: (picture) => {
          pictures.push(picture);
          return Promise.reject(atStage(invalid, 'draw'));
        },
        accentsOnPage: (picture) => {
          pictures.push(picture);
          return Promise.resolve({ width: 16, height: 16, accents: 3 });
        },
      }));
      await run(f);
      failedAt('accents', `${invalid} (worker: draw); ${pageOk}`)(f.reports);
      expect(pictures).toHaveLength(2);
      expect(pictures[0]).toBe(f.deps.picture);
      expect(pictures[1]).toBe(f.deps.picture);
      expect(f.window.Worker).toBe(f.originalWorker);
    });
  });

  describe('worker-policy', () => {
    it('fails with one worker started', async () => {
      const f = fakes(() => ({ readPdfText: () => Promise.resolve([text(LINE)]) }));
      await run(f);
      failedAt('worker-policy', '1 worker scripts were started, not 2: worker-pwfgZlae.js')(f.reports);
    });

    it('fails with three workers started', async () => {
      const f = fakes((g) => ({
        readPdfText: () => {
          new g.window.Worker(PDF_WORKER);
          new g.window.Worker('/assets/extra-1234.js');
          return Promise.resolve([text(LINE)]);
        },
      }));
      await run(f);
      failedAt('worker-policy', `3 worker scripts were started, not 2: ${PDF_NAME}, extra-1234.js, worker-pwfgZlae.js`)(
        f.reports,
      );
    });

    const js = 'text/javascript';
    for (const [what, answer, why] of [
      [
        'no policy',
        scriptAnswer({ 'content-type': js }),
        `${PDF_NAME}: no content-security-policy (answer type basic)`,
      ],
      [
        'another policy',
        scriptAnswer({ 'content-type': js, 'content-security-policy': "default-src 'self'" }),
        `${PDF_NAME}: content-security-policy "default-src 'self'", not the workers' policy (answer type basic)`,
      ],
      [
        'a type that isn’t JavaScript',
        scriptAnswer({ 'content-type': 'text/html', 'content-security-policy': WORKER_POLICY }),
        `${PDF_NAME}: content-type text/html, not JavaScript (answer type basic)`,
      ],
      [
        'no type',
        scriptAnswer({ 'content-security-policy': WORKER_POLICY }),
        `${PDF_NAME}: content-type none, not JavaScript (answer type basic)`,
      ],
      [
        'a 404',
        scriptAnswer({ 'content-type': js, 'content-security-policy': WORKER_POLICY }, 404),
        `${PDF_NAME}: status 404 (answer type basic)`,
      ],
      [
        'a header hidden from the page (a cors answer)',
        scriptAnswer({ 'content-type': js }, 200, 'cors'),
        `${PDF_NAME}: no content-security-policy (answer type cors)`,
      ],
    ] as const) {
      it(`fails on a script with ${what}, naming the file and the answer's type`, async () => {
        const f = fakes(() => ({ getFile: () => Promise.resolve(answer) }));
        await run(f);
        failedAt('worker-policy', why)(f.reports);
      });
    }

    it('names the second script when only it is wrong', async () => {
      const f = fakes(() => ({
        getFile: (url) => Promise.resolve(url === ACCENT_WORKER ? scriptAnswer({ 'content-type': js }) : goodScript()),
      }));
      await run(f);
      failedAt('worker-policy', 'worker-pwfgZlae.js: no content-security-policy (answer type basic)')(f.reports);
    });

    it('fails when a script can’t be fetched at all', async () => {
      const f = fakes(() => ({ getFile: () => Promise.reject(new TypeError('Load failed')) }));
      await run(f);
      failedAt('worker-policy', 'Load failed')(f.reports);
    });
  });

  describe('no-violation', () => {
    it('fails on a second violation, from before the check or during it', async () => {
      const f = fakes((g) => ({
        readPdfText: () => {
          new g.window.Worker(PDF_WORKER);
          g.violations.push({ directive: 'connect-src', blocked: 'https://example.org', disposition: 'enforce' });
          return Promise.resolve([text(LINE)]);
        },
      }));
      await run(f);
      failedAt('no-violation', 'another violation: connect-src refused https://example.org (enforce)')(f.reports);
    });

    it('fails on another shape that came beside the deliberate refusal', async () => {
      const f = fakes((g) =>
        appending(g, () => {
          g.violations.push(CANARY_VIOLATION);
          setTimeout(() => {
            g.violations.push({ directive: 'style-src-elem', blocked: 'inline', disposition: 'enforce' });
          }, 50);
        }),
      );
      await run(f);
      failedAt('no-violation', 'another violation: style-src-elem refused inline (enforce)')(f.reports);
    });

    it('fails on a violation that comes late, within its 300 ms', async () => {
      const f = fakes((g) => ({
        accentsFromWorker: () => {
          new g.window.Worker(new URL(ACCENT_WORKER));
          // After the last worker step, while no-violation waits.
          setTimeout(() => {
            g.violations.push({ directive: 'img-src', blocked: 'data', disposition: 'report' });
          }, 100);
          return Promise.resolve(['#d02020']);
        },
      }));
      await run(f);
      failedAt('no-violation', 'another violation: img-src refused data (report)')(f.reports);
    });

    it('fails on a violation already there when the page started', async () => {
      const f = fakes();
      f.violations.push({ directive: 'script-src-elem', blocked: 'inline', disposition: 'enforce' });
      await run(f);
      // The one already there is never taken for the deliberate one: only entries after the canary's append are.
      failedAt('no-violation', 'another violation: script-src-elem refused inline (enforce)')(f.reports);
    });
  });

  it('stops when a report fails', async () => {
    const f = fakes((g) => ({
      report: (step, ok, detail) => {
        g.reports.push([step, ok, detail]);
        return step === 'pdf-text' ? Promise.reject(new Error('refused')) : Promise.resolve();
      },
    }));
    const done = runLaunchCheck(f.deps);
    const settled = expect(done).rejects.toThrow('refused');
    await vi.runAllTimersAsync();
    await settled;
    expect(f.reports.map(([step]) => step)).toEqual(['page', 'policy-watch', 'pdf-text']);
    expect(f.window.Worker).toBe(f.originalWorker);
  });
});

describe('what the check reads', () => {
  it('the workers’ policy is src-tauri/worker-csp.txt’s, read as worker_csp.rs reads it', () => {
    const file = readFileSync(join(root, 'src-tauri/worker-csp.txt'), 'utf8');
    const policy = file
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .join(' ');
    expect(WORKER_POLICY).toBe(policy);
  });

  it('the page’s six steps are Rust’s list after window and loaded (src-tauri/src/launch_check.rs)', () => {
    const rust = readFileSync(join(root, 'src-tauri/src/launch_check.rs'), 'utf8');
    const list = /pub\(crate\) const STEPS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)?.[1];
    expect(list, 'STEPS in launch_check.rs').toBeDefined();
    const names = [...(list ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    expect(names).toEqual(['window', 'loaded', ...PAGE_STEPS]);
  });

  it('knows JavaScript by the same types as worker_csp.rs', () => {
    const yes = [
      'text/javascript',
      'application/javascript; charset=utf-8',
      ' TEXT/JavaScript ',
      'application/x-ecmascript',
    ];
    for (const type of yes) expect(isJavaScript(type), type).toBe(true);
    const no = ['text/html', 'application/json', 'text/javascriptx', 'text/plain; x=text/javascript', '', null];
    for (const type of no) expect(isJavaScript(type), String(type)).toBe(false);
  });

  it('names a file by its name alone', () => {
    const accent = 'http://tauri.localhost/assets/worker-pwfgZlae.js?worker_file&type=module';
    expect(fileName(accent)).toBe('worker-pwfgZlae.js');
    expect(fileName('tauri://localhost/assets/pdf.worker.min-Dr1KORA9.mjs#x')).toBe('pdf.worker.min-Dr1KORA9.mjs');
  });
});

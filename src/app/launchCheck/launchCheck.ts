import type { PdfText } from '../../core/script/pdfLayout';
import { stageOf } from '../../ui/theme/generator/sample';

// The page's part of the launch check (6.27l, Kevin Nov 20; docs/briefs/launch-check.md). Rust switches the mode on
// from the environment alone and adds a script that watches for policy violations from the document's first moment
// (src-tauri/src/launch_check.rs); main.tsx then starts this instead of the app. Six steps, one after another, each
// reported to Rust; the first failure is reported and the check stops. Everything it touches is passed in, so Vitest
// drives it with fakes (launchCheck.test.ts) and start.tsx hands it the real page.
//
// Its reasons are lines for a CI log, never words for people: no screen shows them, so nothing here is translated.

/** The page's steps, in order: Rust reports `window` and `loaded` itself. */
export const PAGE_STEPS = ['page', 'policy-watch', 'pdf-text', 'accents', 'worker-policy', 'no-violation'] as const;
export type PageStep = (typeof PAGE_STEPS)[number];

/** The workers' policy, as src-tauri/worker-csp.txt has it (a test reads the file and fails when the two differ). */
export const WORKER_POLICY = "default-src 'none'; script-src 'self'; worker-src 'self'; base-uri 'none'";

/** The flag the deliberate inline script would set, were the page's policy not enforced. */
export const CANARY = '__storiiboardLaunchCheckCanary';

/** How long a refused inline script may take to be reported, and how long late violations are waited for. */
const CANARY_WAIT_MS = 2000;
const LATE_WAIT_MS = 300;
const POLL_MS = 25;
/** After the first report of the deliberate refusal, how long more of the same shape are taken as its own. */
const SAME_REFUSAL_MS = 100;
/**
 * The page's own limits for its two worker steps: readPdfText waits up to 60 s by itself, longer than the check can
 * give this one step within its 90 s (kept in Rust).
 */
const PDF_LIMIT_MS = 25_000;
const ACCENTS_LIMIT_MS = 20_000;
/** The page's own reading of the picture, after an `accents` failure: short, so the whole stays within Rust's 90 s. */
const ON_PAGE_LIMIT_MS = 10_000;
/** The worker asked once more after a pass by the page: 25 + 20 + 10 + 10 s, still within Rust's 90. */
const AGAIN_LIMIT_MS = 10_000;

/**
 * How the note of an `accents` step passed by the page begins (6.27r): scripts/launchCheck.sh looks for it to refuse
 * such a pass unless it's allowed (a test checks the script holds the same words).
 */
export const BY_THE_PAGE = 'by the page';

/** What the page itself got from the built-in picture: its sampled size and how many accents it found. */
export interface PageReading {
  width: number;
  height: number;
  accents: number;
}

/** One violation, as the watch script keeps it. */
export interface Violation {
  directive: string;
  blocked: string;
  disposition: string;
}

/** What the watch script defines on window, in the mode only. */
export interface LaunchCheckWatch {
  readonly violations: readonly Violation[];
}

/** The answer to a request for a worker's script: what the check reads of a Response. */
export interface ScriptAnswer {
  status: number;
  /** `basic` for the page's own origin, `cors` otherwise: a header hidden from the page reads as one never sent. */
  type: string;
  headers: { get(name: string): string | null };
}

/** What a worker is started with, as `new Worker(...)` takes it. */
export type WorkerStart = new (url: string | URL, options?: WorkerOptions) => Worker;

/** The page's window, as the check uses it: where workers are started from and where the canary would land. */
export interface CheckWindow {
  Worker: WorkerStart;
  [CANARY]?: unknown;
}

/** The document, as the check uses it: what loaded with the page, and the deliberate inline script. */
export interface CheckDocument {
  createElement(tag: 'script'): { textContent: string | null; remove(): void };
  body: { appendChild(node: unknown): unknown } | null;
  /** `<html>`, where public/theme-boot.js sets data-theme: in the mode nothing else does. */
  documentElement: { hasAttribute(name: string): boolean };
  styleSheets: { length: number };
}

export interface LaunchCheckDeps {
  /** Reports a step to Rust (launch_check_step). */
  report: (step: PageStep, ok: boolean, detail: string) => Promise<void>;
  /** Draws the check's screen; resolves once React has committed it. */
  drawScreen: () => Promise<void>;
  readPdfText: (bytes: ArrayBuffer, name: string) => Promise<PdfText[]>;
  /** The accent reader's worker, asked alone (extract.ts's askWorkerAlone). */
  accentsFromWorker: (image: Blob) => Promise<string[] | null>;
  /**
   * The same four stages run on the page itself (sample.ts's samplePixels, then accentCandidates), only after the
   * worker's answer failed, so its line tells a webview that can't do a call in a worker from one that can't do it
   * at all, or can't decode this picture (6.27q); after a worker error at canvas, draw or read, its accents pass the
   * step by the page (6.27r). A failure carries its stage as samplePixels gives it.
   */
  accentsOnPage: (image: Blob) => Promise<PageReading>;
  /** Asks for one of the page's own files (fetch). */
  getFile: (url: string) => Promise<ScriptAnswer>;
  document: CheckDocument;
  window: CheckWindow;
  /** The page's address, for resolving a worker's. */
  baseUrl: string;
  violations: readonly Violation[];
  pdf: ArrayBuffer;
  pdfLine: string;
  picture: Blob;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** A step's failure, with its reason. */
class StepFailed extends Error {}

function fail(why: string): never {
  throw new StepFailed(why);
}

/** An error's message, whatever was thrown. */
const reason = (error: unknown): string => (error instanceof Error ? error.message || error.name : String(error));

/** A file's name alone, from its address: no folder, no query. */
export function fileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

/** Whether a Content-Type is JavaScript: the same set of essences as worker_csp.rs's JAVASCRIPT_TYPES. */
export function isJavaScript(contentType: string | null): boolean {
  const essence = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return /^(text|application)\/(x-)?(javascript|ecmascript)$/.test(essence);
}

/** The violation the deliberate inline script makes: an inline script refused by script-src (or script-src-elem). */
// Its blocked address is `inline` in Chromium (WebView2); WKWebView's shape for it has never been seen here, so an
// empty one counts too, rather than the match hanging on that one word.
const isCanaryViolation = (violation: Violation): boolean =>
  violation.directive.startsWith('script-src') &&
  violation.disposition === 'enforce' &&
  (violation.blocked === 'inline' || violation.blocked === '');

/** Every entry seen, for a failure's detail, so one run tells which shape a webview gives. */
const seen = (violations: readonly Violation[]): string =>
  violations.length === 0
    ? 'nothing was reported'
    : violations.map((v) => `${v.directive} ${v.blocked || '(empty)'} ${v.disposition}`).join('; ');

/** `work`, or a failure with `why` once `ms` have passed without its answer. */
function within<T>(deps: LaunchCheckDeps, ms: number, work: Promise<T>, why: string): Promise<T> {
  return Promise.race([work, deps.sleep(ms).then(() => fail(why))]);
}

/** Runs the page's steps in order; resolves when the check has passed or one step has been reported failed. */
export async function runLaunchCheck(deps: LaunchCheckDeps): Promise<void> {
  // The step's own work: ok when it returns, with its note when it returns one (only accents does, 6.27r); failed
  // with its reason when it throws.
  const step = async (name: PageStep, work: () => Promise<unknown>): Promise<boolean> => {
    let failure: string | null = null;
    let note = '';
    try {
      const done = await work();
      if (typeof done === 'string') note = done;
    } catch (error) {
      failure = reason(error);
    }
    await deps.report(name, failure === null, failure ?? note);
    return failure === null;
  };

  if (!(await step('page', () => page(deps)))) return;

  let deliberate: readonly Violation[] = [];
  const watched = await step('policy-watch', async () => {
    deliberate = await policyWatch(deps);
  });
  if (!watched) return;

  // Every worker the app's own code starts during the next two steps, by address; window.Worker is put back after.
  const started: string[] = [];
  const Original = deps.window.Worker;
  deps.window.Worker = class extends Original {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      started.push(new URL(String(url), deps.baseUrl).href);
    }
  };
  try {
    if (!(await step('pdf-text', () => pdfText(deps)))) return;
    if (!(await step('accents', () => accents(deps)))) return;
  } finally {
    deps.window.Worker = Original;
  }

  if (!(await step('worker-policy', () => workerPolicy(deps, started)))) return;
  await step('no-violation', () => noViolation(deps, deliberate));
}

/** The check's screen committed, after index.html's theme-boot.js and the app's stylesheet loaded and ran. */
async function page(deps: LaunchCheckDeps): Promise<void> {
  await deps.drawScreen();
  if (!deps.document.documentElement.hasAttribute('data-theme')) fail('theme-boot.js did not run');
  if (deps.document.styleSheets.length === 0) fail('no stylesheet is loaded');
}

/**
 * Breaks the page's policy once on purpose: an inline script, which must not run and must be reported. Its entries:
 * every one of the refusal's shape that came since the script was added, up to a moment after the first (an engine
 * may report one refusal twice).
 */
async function policyWatch(deps: LaunchCheckDeps): Promise<Violation[]> {
  const before = deps.violations.length;
  const script = deps.document.createElement('script');
  script.textContent = `window.${CANARY} = true;`;
  const body = deps.document.body ?? fail('the page has no body');
  body.appendChild(script);
  try {
    const deadline = deps.now() + CANARY_WAIT_MS;
    let found: Violation | undefined;
    for (;;) {
      found = deps.violations.slice(before).find(isCanaryViolation);
      if (found || deps.window[CANARY] === true || deps.now() >= deadline) break;
      await deps.sleep(POLL_MS);
    }
    if (deps.window[CANARY] === true) fail("an inline script ran: the page's policy is not enforced");
    if (!found) fail(`a refused inline script was not reported: seen ${seen(deps.violations)}`);
    await deps.sleep(SAME_REFUSAL_MS);
    if (deps.window[CANARY] === true) fail("an inline script ran: the page's policy is not enforced");
    return deps.violations.slice(before).filter(isCanaryViolation);
  } finally {
    script.remove();
  }
}

/** The built-in PDF's text, read through the PDF worker (readPdf.ts gives pdf.js a worker of its own making). */
async function pdfText(deps: LaunchCheckDeps): Promise<void> {
  const reading = deps.readPdfText(deps.pdf.slice(0), 'launch-check.pdf');
  const items = await within(deps, PDF_LIMIT_MS, reading, 'no answer from the PDF worker in 25 s');
  const text = items.map((item) => item.text).join('');
  if (!text.includes(deps.pdfLine)) fail(`the PDF's text lacks its line: read "${text.slice(0, 80)}"`);
}

/** A worker's rejection as the check's lines name it: its words, then its stage or that it had none. */
const workerWords = (error: unknown): string => `${reason(error)} (worker: ${stageOf(error) ?? 'no stage'})`;

/**
 * The built-in picture's accents, from the accent reader's worker alone. A failure's line says where in the worker it
 * failed, then what the page itself gets from the same picture (6.27q):
 * `<the worker's words> (worker: <stage>); on the page: <what happened>`.
 *
 * One exception passes (6.27r, Kevin Nov 20): the worker reported an error at `canvas`, `draw` or `read`, where a
 * worker's canvas can fail as the page's doesn't (no GPU backing, or no OffscreenCanvas), and the page found accents
 * in the same picture, which is what the app itself then shows. The step passes with a note beginning `by the page`,
 * which says what the worker answered then and when asked once more; scripts/launchCheck.sh refuses it unless allowed.
 */
async function accents(deps: LaunchCheckDeps): Promise<string | undefined> {
  let why: string | null = null;
  let pageMayStand = false;
  try {
    const asking = deps.accentsFromWorker(deps.picture);
    const found = await within(deps, ACCENTS_LIMIT_MS, asking, 'no answer from the accent worker in 20 s');
    // One null for no worker, a dead worker and its own 15 s limit alike (extractAccents falls back on all three).
    if (found === null) why = 'the accent worker failed or took over 15 s';
    else if (found.length === 0) why = 'the accent worker found no accent in the built-in picture';
  } catch (error) {
    // The check's own time limit has no worker stage; the worker's rejection has one, or says it had none.
    if (error instanceof StepFailed) why = error.message;
    else {
      why = workerWords(error);
      const stage = stageOf(error);
      // A picture the worker couldn't decode, or an error from nowhere known, is never the page's to stand in for.
      pageMayStand = stage !== undefined && stage !== 'decode';
    }
  }
  // Only after a failure: a passing check does exactly what it did before.
  if (why === null) return undefined;
  const page = await onPage(deps);
  if (!pageMayStand || page.accents < 1) fail(`${why}; on the page: ${page.words}`);
  return `${BY_THE_PAGE}: ${page.words}; the worker: ${why}; the worker asked again: ${await askAgain(deps)}`;
}

/**
 * What the page itself gets from the built-in picture: the first stage that fails with its words, or what it read,
 * with how many accents (none when it failed).
 */
async function onPage(deps: LaunchCheckDeps): Promise<{ words: string; accents: number }> {
  try {
    const reading = deps.accentsOnPage(deps.picture);
    const read = await within(deps, ON_PAGE_LIMIT_MS, reading, 'no answer in 10 s');
    const words = `read ok, ${String(read.width)} × ${String(read.height)}, ${String(read.accents)} accents`;
    return { words, accents: read.accents };
  } catch (error) {
    if (error instanceof StepFailed) return { words: error.message, accents: 0 };
    const stage = stageOf(error);
    return { words: stage ? `${stage} failed: ${reason(error)}` : `failed: ${reason(error)}`, accents: 0 };
  }
}

/**
 * The worker asked once more, with the same picture, after the page passed the step: whether its failure stays, for
 * the note alone. It never changes the verdict.
 */
async function askAgain(deps: LaunchCheckDeps): Promise<string> {
  try {
    const asking = deps.accentsFromWorker(deps.picture);
    const found = await within(deps, AGAIN_LIMIT_MS, asking, 'no answer in 10 s');
    if (found === null) return 'no answer (null)';
    if (found.length === 0) return 'no accent found';
    return `ok, ${String(found.length)} accents`;
  } catch (error) {
    return error instanceof StepFailed ? error.message : workerWords(error);
  }
}

/** Exactly two worker scripts started, each JavaScript and carrying exactly the workers' policy. */
async function workerPolicy(deps: LaunchCheckDeps, started: readonly string[]): Promise<void> {
  const addresses = [...new Set(started)];
  if (addresses.length !== 2) {
    const names = addresses.map(fileName).join(', ') || 'none';
    fail(`${String(addresses.length)} worker scripts were started, not 2: ${names}`);
  }
  for (const address of addresses) {
    const name = fileName(address);
    const answer = await deps.getFile(address);
    // Each failure names the answer's type too, so a header hidden from the page tells from one never sent.
    const wrong = (what: string): never => fail(`${name}: ${what} (answer type ${answer.type})`);
    if (answer.status !== 200) wrong(`status ${String(answer.status)}`);
    const type = answer.headers.get('content-type');
    if (!isJavaScript(type)) wrong(`content-type ${type ?? 'none'}, not JavaScript`);
    const policy = answer.headers.get('content-security-policy');
    if (policy === null) wrong('no content-security-policy');
    else if (policy !== WORKER_POLICY) wrong(`content-security-policy "${policy}", not the workers' policy`);
  }
}

/** After a moment for late events, nothing but the deliberate refusal's entries came from the document's start. */
async function noViolation(deps: LaunchCheckDeps, deliberate: readonly Violation[]): Promise<void> {
  await deps.sleep(LATE_WAIT_MS);
  if (deliberate.length === 0 || !deliberate.every((entry) => deps.violations.includes(entry))) {
    fail('the deliberate violation is missing');
  }
  const other = deps.violations.find((violation) => !deliberate.includes(violation));
  if (other) {
    fail(`another violation: ${other.directive} refused ${other.blocked || 'something'} (${other.disposition})`);
  }
}

/**
 * Bytes from base64, decoded here: a data: URL's fetch is refused by the policy's connect-src, and the page has no
 * Buffer.
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

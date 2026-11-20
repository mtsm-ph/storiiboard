// The end-to-end tests' page runs under the installed app's content security policy (6.13; docs/DESKTOP_GAPS.md,
// "The cheapest cover", item 1). Without one, anything the CSP refuses was found only in an installer: that is how A1
// (a company logo decoded with fetch('data:…'), refused by connect-src) shipped. The test server (vite.config.ts)
// sends the policy read from src-tauri/tauri.conf.json as the app starts, never a copy, plus only the additions below:
// each one something only the test build does, with its reason. A new addition is a line here, and
// scripts/e2eCsp.test.ts names it, so a loosening is never quiet. Never add one to get a test through that the
// installed app would fail: that is a desktop bug to fix (brief 6.13).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CspAddition {
  directive: string;
  source: string;
  why: string;
}

export const E2E_CSP_ADDITIONS: readonly CspAddition[] = [
  {
    directive: 'script-src',
    source: "'wasm-unsafe-eval'",
    why:
      'the tests keep projects in the page with sql.js, which is WebAssembly (src/app/fileAccess.ts, ?files=memory); ' +
      'the desktop app keeps them in SQLite through Rust and never loads it',
  },
];

// React's refresh preamble needs nothing here: it is an inline script @vitejs/plugin-react adds only with hot reload
// on, and the test server has it off (vite.config.ts), so its page carries no inline script at all.

/** The installed app's CSP as tauri.conf.json has it (`app.security.csp`). */
export function tauriCsp(root: string): string {
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
    app?: { security?: { csp?: unknown } };
  };
  const csp = config.app?.security?.csp;
  if (typeof csp !== 'string' || csp.trim() === '') throw new Error('src-tauri/tauri.conf.json has no app.security.csp');
  return csp;
}

/** A policy's directives, in order, each with its sources. */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/**
 * The test server's policy: the app's, with each addition's source put on its directive. A directive the app's
 * policy lacks starts from what default-src gives it, so adding one never widens anything else.
 */
export function e2eCsp(base: string, additions: readonly CspAddition[] = E2E_CSP_ADDITIONS): string {
  // A browser keeps the first copy of a repeated directive and parseCsp the last: the additions would go on a copy the
  // browser ignores, or the policy served would lose the copy it reads. So a base policy that repeats one is refused.
  const names = base
    .split(';')
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    .filter((name) => name !== '');
  const repeated = names.find((name, i) => names.indexOf(name) !== i);
  if (repeated !== undefined) throw new Error(`The app's content security policy repeats ${repeated}: keep one copy of it`);
  const directives = parseCsp(base);
  for (const { directive, source } of additions) {
    const sources = directives.get(directive) ?? [...(directives.get('default-src') ?? [])];
    if (!sources.includes(source)) sources.push(source);
    directives.set(directive, sources);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/**
 * The policy of every worker the app starts (Kevin, Nov 19), from src-tauri/worker-csp.txt, the file Rust reads too
 * (src-tauri/src/worker_csp.rs): every line that isn't a comment (#) or empty, joined.
 */
export function workerCsp(root: string): string {
  const policy = readFileSync(join(root, 'src-tauri/worker-csp.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .join(' ');
  if (policy === '') throw new Error('src-tauri/worker-csp.txt holds no policy');
  return policy;
}

/** Where the test server's pages and workers report a violation (vite.config.ts). */
export const CSP_REPORT_PATH = '/@storiiboard/csp-violation';

// What the test build adds to the worker policy, each with its reason, as E2E_CSP_ADDITIONS is for the page's.
// scripts/e2eCsp.test.ts names each one, so a loosening is never quiet. Only reporting belongs here: a worker that
// needs more to run is a desktop decision (src-tauri/worker-csp.txt), never a test-only addition.
export const E2E_WORKER_CSP_ADDITIONS: readonly CspAddition[] = [
  {
    directive: 'report-uri',
    source: CSP_REPORT_PATH,
    why:
      'a violation inside a worker fires in the worker, never on the page, so the page’s watcher (vite.config.ts) ' +
      'never sees it; the browser reports it here instead, and the run fails on it as on a page’s (e2e/cspTeardown.ts)',
  },
];

/** The test server's worker policy: the app's worker policy with each addition put on its directive. */
export function e2eWorkerCsp(base: string, additions: readonly CspAddition[] = E2E_WORKER_CSP_ADDITIONS): string {
  const directives = parseCsp(base);
  for (const { directive, source } of additions) {
    // A reporting directive isn't a fetch directive: it never starts from default-src.
    const sources = directives.get(directive) ?? [];
    if (!sources.includes(source)) sources.push(source);
    directives.set(directive, sources);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/** A response's Content-Type is JavaScript: the dev server's workers are `.ts` files with a query, so it's by type. */
export function isJavaScript(contentType: string): boolean {
  return /^\s*(text|application)\/(x-)?(javascript|ecmascript)\s*(;|$)/i.test(contentType);
}

/**
 * A header given to Node's `res.writeHead(status, [message], headers)`, by name in any case: the headers as an object,
 * or as the raw array Node also takes, names and values in one list (`['Content-Type', 'text/javascript', …]`), read in
 * pairs. Undefined when it isn't given there (it may still be set on the response: vite.config.ts asks that first).
 */
export function writeHeadHeader(args: readonly unknown[], name: string): unknown {
  const wanted = name.toLowerCase();
  for (const arg of args) {
    if (Array.isArray(arg)) {
      for (let i = 0; i + 1 < arg.length; i += 2) {
        const key: unknown = arg[i];
        if (typeof key === 'string' && key.toLowerCase() === wanted) return arg[i + 1];
      }
    } else if (typeof arg === 'object' && arg !== null) {
      const found = Object.entries(arg).find(([key]) => key.toLowerCase() === wanted);
      if (found) return found[1];
    }
  }
  return undefined;
}

/** What the test server's page prints for each violation, so e2e/cspWatch.ts can fail the test. */
export const CSP_VIOLATION_PREFIX = '[csp-violation]';

// Every violation, from every test, is also kept in a file under test-results (vite.config.ts writes it, emptied as the
// test server starts), and the run's global teardown (e2e/cspTeardown.ts) fails the run on any but the meant ones. Two
// policies report there: the page's (src-tauri/tauri.conf.json, through the page's own watcher) and the workers'
// (src-tauri/worker-csp.txt, through its report-uri, E2E_WORKER_CSP_ADDITIONS). The meant ones are the data: fetch
// e2e/shell.spec.ts makes from CSP_EXPECTED_PAGE, and the probe worker's eval, Function and fetch
// (e2e/workerCsp.spec.ts, CSP_EXPECTED_WORKER). So a spec that never calls skipOnboarding (failOnCspViolation) is
// watched too, and so is every worker.

/** The file the test server keeps the violations in, one JSON line each: `{ "at": <ms since 1970>, "line": "…" }`. */
export const CSP_VIOLATIONS_FILE = 'test-results/csp/violations.jsonl';

/** The address e2e/shell.spec.ts opens for its one meant violation; the page's report names the address it came from. */
export const CSP_EXPECTED_PAGE = '/?csp-expected=data-fetch';

/** The probe worker e2e/workerCsp.spec.ts starts: its eval, Function and fetch are refused on purpose. */
export const CSP_EXPECTED_WORKER = '/e2e/fixtures/workerProbe.ts';

/**
 * The meant violations: connect-src refusing the data: fetch, from the page at CSP_EXPECTED_PAGE; and the probe
 * worker's eval and Function (script-src) and fetch (connect-src), reported from CSP_EXPECTED_WORKER. Nothing else.
 */
export function isExpectedViolation(line: string): boolean {
  if (line.startsWith(`${CSP_VIOLATION_PREFIX} connect-src refused data`) && line.endsWith(` on ${CSP_EXPECTED_PAGE}`)) return true;
  // The fetch is the probe's own, to its origin's /?worker-probe; the origin's port is the test server's. A report
  // names the worker's address as its document (Chromium does); one that names the page instead must still come from
  // the probe's own file, so either way it is known by the probe's address alone.
  const meant = /^\[csp-violation\] (script-src refused eval|connect-src refused https?:\/\/[^/\s]+\/\?worker-probe) /;
  const fromProbe = new RegExp(` from https?://[^/\\s]+${CSP_EXPECTED_WORKER.replace(/\./g, '\\.')}:\\d+ on `);
  return meant.test(line) && (line.endsWith(` on ${CSP_EXPECTED_WORKER}`) || fromProbe.test(line));
}

/** At most this much of a report is kept as its line, whatever the browser sends. */
const REPORT_LINE_MAX = 1000;

/** A report's address as the page's line names it: its path and query, or the text as sent when it isn't one. */
function where(address: string): string {
  try {
    const url = new URL(address);
    return url.pathname + url.search;
  } catch {
    return address;
  }
}

/** One violation, in the line the test server's page sends (CSP_WATCH_SCRIPT in vite.config.ts). */
function violationLine(directive: string, blocked: string, source: string, line: unknown, document: string): string {
  const from = source ? ` from ${source}:${typeof line === 'number' ? String(line) : '0'}` : '';
  return `${CSP_VIOLATION_PREFIX} ${directive} refused ${blocked.slice(0, 120) || '(none)'}${from} on ${where(document)}`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * What the test server keeps of one report sent to CSP_REPORT_PATH, as one line in the page's form: the page's own
 * line as it is; a browser's JSON report (`report-uri`'s `{ "csp-report": … }`, or the Reporting API's list of
 * `csp-violation` reports) turned into it. Anything else is kept as sent, so it fails the run rather than vanishing.
 */
export function cspReportLines(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [body.slice(0, REPORT_LINE_MAX)];
  }
  const lines: string[] = [];
  const reports = Array.isArray(parsed) ? parsed : [parsed];
  for (const report of reports) {
    const legacy = (report as { 'csp-report'?: unknown } | null)?.['csp-report'];
    const modern = (report as { type?: unknown; body?: unknown } | null)?.type === 'csp-violation' ? (report as { body?: unknown }).body : undefined;
    if (legacy && typeof legacy === 'object') {
      const r = legacy as Record<string, unknown>;
      const directive = text(r['effective-directive']) || text(r['violated-directive']).split(' ')[0] || '(unknown)';
      lines.push(violationLine(directive, text(r['blocked-uri']), text(r['source-file']), r['line-number'], text(r['document-uri'])));
    } else if (modern && typeof modern === 'object') {
      const r = modern as Record<string, unknown>;
      lines.push(violationLine(text(r.effectiveDirective) || '(unknown)', text(r.blockedURL), text(r.sourceFile), r.lineNumber, text(r.documentURL)));
    } else {
      lines.push(JSON.stringify(report).slice(0, REPORT_LINE_MAX));
    }
  }
  return lines.map((line) => line.slice(0, REPORT_LINE_MAX));
}

/**
 * The violations in the file's text from `since` (ms since 1970) on, of the page's policy (src-tauri/tauri.conf.json)
 * and the workers' (src-tauri/worker-csp.txt) alike, the meant ones (isExpectedViolation: shell.spec.ts's page and the
 * probe worker) left out.
 */
export function unexpectedViolations(text: string, since: number): string[] {
  return text
    .split('\n')
    .filter((row) => row.trim() !== '')
    .map((row) => {
      try {
        const entry = JSON.parse(row) as { at?: unknown; line?: unknown };
        return typeof entry.at === 'number' && typeof entry.line === 'string' ? { at: entry.at, line: entry.line } : { at: Infinity, line: row };
      } catch {
        // A line this can't read is kept, so nothing is lost silently.
        return { at: Infinity, line: row };
      }
    })
    .filter(({ at, line }) => at >= since && !isExpectedViolation(line))
    .map(({ line }) => line);
}

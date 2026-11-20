import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_EXPECTED_PAGE, CSP_VIOLATION_PREFIX, E2E_CSP_ADDITIONS, e2eCsp, isExpectedViolation, parseCsp, tauriCsp, unexpectedViolations } from './e2eCsp';
import { CSP_EXPECTED_WORKER, CSP_REPORT_PATH, E2E_WORKER_CSP_ADDITIONS, cspReportLines, e2eWorkerCsp, isJavaScript, workerCsp, writeHeadHeader } from './e2eCsp';

// The end-to-end tests' page runs under the installed app's CSP plus a short list of test-only additions (6.13). A
// later loosening, here or in the list, fails this test with a diff to justify.

const root = join(import.meta.dirname, '..');
const app = parseCsp(tauriCsp(root));
const served = parseCsp(e2eCsp(tauriCsp(root)));

describe('the test server’s content security policy (6.13)', () => {
  it('keeps every source of every directive in tauri.conf.json', () => {
    const missing = [...app].flatMap(([directive, sources]) =>
      sources.filter((source) => !served.get(directive)?.includes(source)).map((source) => `${directive} ${source}`),
    );
    expect(missing).toEqual([]);
  });

  it('adds only the listed sources, each with its reason', () => {
    const extra = [...served].flatMap(([directive, sources]) =>
      sources
        .filter((source) => !(app.get(directive) ?? app.get('default-src') ?? []).includes(source))
        .map((source) => `${directive} ${source}`),
    );
    expect(extra).toEqual(E2E_CSP_ADDITIONS.map(({ directive, source }) => `${directive} ${source}`));
    // A directive the app doesn't have starts from exactly what default-src gives it, never wider.
    for (const directive of [...served.keys()].filter((name) => !app.has(name))) {
      const listed = E2E_CSP_ADDITIONS.filter((addition) => addition.directive === directive).map(({ source }) => source);
      expect(served.get(directive)).toEqual([...(app.get('default-src') ?? []), ...listed]);
    }
    expect(served.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    for (const { why } of E2E_CSP_ADDITIONS) expect(why.length).toBeGreaterThan(20);
  });

  it('lets no script run inline or through eval, and allows no host wildcard', () => {
    const scripts = served.get('script-src') ?? served.get('default-src') ?? [];
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect([...served.values()].flat().filter((source) => source.includes('*'))).toEqual([]);
  });

  it('is exactly the app’s policy with the additions, in the app’s order', () => {
    expect(e2eCsp("default-src 'self'; connect-src 'self' ipc:")).toBe(
      "default-src 'self'; connect-src 'self' ipc:; script-src 'self' 'wasm-unsafe-eval'",
    );
    // A source already there isn't added twice.
    expect(e2eCsp("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'")).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'",
    );
  });

  it('refuses a base policy that repeats a directive, naming it: a browser reads the first copy, the parser the last', () => {
    expect(() => e2eCsp("default-src 'self'; connect-src 'self'; Connect-Src *")).toThrow(/repeats connect-src/);
    expect(() => e2eCsp("default-src 'self'; script-src 'self'; script-src 'unsafe-eval'")).toThrow(/repeats script-src/);
    expect(() => e2eCsp("default-src 'self'; connect-src 'self';")).not.toThrow();
  });
});

describe('the run’s CSP violations file (6.13 review)', () => {
  const meant = `${CSP_VIOLATION_PREFIX} connect-src refused data from __playwright_evaluation_script__:3 on ${CSP_EXPECTED_PAGE}`;
  const other = `${CSP_VIOLATION_PREFIX} connect-src refused data on /?files=memory`;
  const row = (at: number, line: string) => JSON.stringify({ at, line });

  it('knows the meant one only by its directive, its refused address and its page', () => {
    expect(isExpectedViolation(meant)).toBe(true);
    expect(isExpectedViolation(other)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} img-src refused https://example.com on ${CSP_EXPECTED_PAGE}`)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} connect-src refused data on ${CSP_EXPECTED_PAGE}&more`)).toBe(false);
  });

  it('lists every other violation from the run’s start on, and keeps a line it cannot read', () => {
    const text = [row(100, other), row(200, meant), row(300, other), 'not json', ''].join('\n');
    expect(unexpectedViolations(text, 0)).toEqual([other, other, 'not json']);
    expect(unexpectedViolations(text, 250)).toEqual([other, 'not json']);
    expect(unexpectedViolations('', 0)).toEqual([]);
  });
});

// Every worker the app starts runs under src-tauri/worker-csp.txt's policy (Kevin, Nov 19), which Rust sends on the
// app's .js and .mjs assets and the test server on every JavaScript response, with only the listed additions.
describe('the workers’ content security policy (Nov 19)', () => {
  const worker = parseCsp(workerCsp(root));
  const fetchDirectives = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'media-src', 'object-src', 'worker-src', 'frame-src', 'child-src', 'manifest-src'];
  /** What a fetch directive allows: its own sources, else default-src's; 'none' allows nothing. */
  const allows = (policy: Map<string, string[]>, directive: string) =>
    (policy.get(directive) ?? (directive === 'worker-src' ? policy.get('script-src') : undefined) ?? policy.get('default-src') ?? ['*']).filter((source) => source !== "'none'");

  it('is the strict policy the brief names, read from the file Rust reads', () => {
    expect(workerCsp(root)).toBe("default-src 'none'; script-src 'self'; worker-src 'self'; base-uri 'none'");
  });

  it('allows nothing the page’s policy doesn’t: no network, no eval, workers and their modules only from the app', () => {
    for (const directive of fetchDirectives) {
      const wider = allows(worker, directive).filter((source) => !allows(app, directive).includes(source));
      expect(wider, directive).toEqual([]);
    }
    expect(allows(worker, 'connect-src')).toEqual([]);
    // 'self', as the page's: WebKit checks a module worker's own imports against worker-src.
    expect(allows(worker, 'worker-src')).toEqual(["'self'"]);
    expect(allows(worker, 'script-src')).toEqual(["'self'"]);
    expect(worker.get('base-uri')).toEqual(["'none'"]);
    expect([...worker.values()].flat().filter((source) => source.includes('*') || /unsafe/.test(source))).toEqual([]);
  });

  it('adds only reporting in the test build, each addition with its reason', () => {
    expect(E2E_WORKER_CSP_ADDITIONS.map(({ directive, source }) => `${directive} ${source}`)).toEqual([`report-uri ${CSP_REPORT_PATH}`]);
    for (const { why } of E2E_WORKER_CSP_ADDITIONS) expect(why.length).toBeGreaterThan(20);
    expect(e2eWorkerCsp(workerCsp(root))).toBe(`${workerCsp(root)}; report-uri /@storiiboard/csp-violation`);
    // A reporting directive never picks up default-src's sources.
    expect(e2eWorkerCsp("default-src 'none'")).toBe("default-src 'none'; report-uri /@storiiboard/csp-violation");
  });

  it('knows JavaScript by its Content-Type, with or without a charset', () => {
    for (const type of ['text/javascript', 'application/javascript; charset=utf-8', 'TEXT/JAVASCRIPT', 'application/x-javascript', 'text/ecmascript']) {
      expect(isJavaScript(type), type).toBe(true);
    }
    for (const type of ['text/html', 'text/css', 'application/json', 'image/png', 'text/javascriptx', 'application/wasm', '']) {
      expect(isJavaScript(type), type).toBe(false);
    }
  });

  it('reads a header given to writeHead as an object or as Node’s raw array, in pairs, in any case', () => {
    expect(writeHeadHeader([200, { 'Content-Type': 'text/javascript' }], 'content-type')).toBe('text/javascript');
    expect(writeHeadHeader([200, 'OK', { 'content-type': 'text/css' }], 'Content-Type')).toBe('text/css');
    expect(writeHeadHeader([200, ['Content-Type', 'text/javascript', 'Content-Length', '12']], 'content-type')).toBe('text/javascript');
    expect(writeHeadHeader([200, 'OK', ['X-A', 'b', 'CONTENT-SECURITY-POLICY', "default-src 'self'"]], 'content-security-policy')).toBe(
      "default-src 'self'",
    );
    // Read in pairs: a value that reads as the name is never taken for it.
    expect(writeHeadHeader([200, ['X-Note', 'content-type', 'X-Other', 'text/plain']], 'content-type')).toBeUndefined();
    expect(writeHeadHeader([200, ['Content-Type']], 'content-type')).toBeUndefined();
    expect(writeHeadHeader([200], 'content-type')).toBeUndefined();
    expect(writeHeadHeader([200, 'OK'], 'content-type')).toBeUndefined();
  });
});

describe('a browser’s JSON report, kept as the page’s line (Nov 19)', () => {
  const origin = 'http://localhost:1421';

  it('keeps the page’s own line as it is', () => {
    const line = `${CSP_VIOLATION_PREFIX} connect-src refused data on /?files=memory`;
    expect(cspReportLines(line)).toEqual([line]);
  });

  it('reads report-uri’s csp-report and the Reporting API’s list alike', () => {
    const legacy = JSON.stringify({
      'csp-report': {
        'document-uri': `${origin}${CSP_EXPECTED_WORKER}`,
        'effective-directive': 'script-src',
        'violated-directive': 'script-src',
        'blocked-uri': 'eval',
        'source-file': `${origin}${CSP_EXPECTED_WORKER}`,
        'line-number': 16,
      },
    });
    expect(cspReportLines(legacy)).toEqual([`${CSP_VIOLATION_PREFIX} script-src refused eval from ${origin}${CSP_EXPECTED_WORKER}:16 on ${CSP_EXPECTED_WORKER}`]);
    const modern = JSON.stringify([
      { type: 'csp-violation', body: { documentURL: `${origin}/src/features/script/x.ts?worker_file`, effectiveDirective: 'connect-src', blockedURL: `${origin}/a` } },
    ]);
    expect(cspReportLines(modern)).toEqual([`${CSP_VIOLATION_PREFIX} connect-src refused ${origin}/a on /src/features/script/x.ts?worker_file`]);
    // Only violated-directive: its first word.
    expect(cspReportLines(JSON.stringify({ 'csp-report': { 'violated-directive': "img-src 'none'", 'document-uri': `${origin}/` } }))).toEqual([
      `${CSP_VIOLATION_PREFIX} img-src refused (none) on /`,
    ]);
  });

  it('keeps anything else as sent, cut to 1000 characters, so it fails the run rather than vanishing', () => {
    expect(cspReportLines('{"other":1}')).toEqual(['{"other":1}']);
    expect(cspReportLines(`{"csp-report":${'x'.repeat(2000)}`)[0]).toHaveLength(1000);
  });

  it('knows the probe worker’s refusals as meant, by its address alone', () => {
    const eval_ = `${CSP_VIOLATION_PREFIX} script-src refused eval from ${origin}${CSP_EXPECTED_WORKER}:16 on ${CSP_EXPECTED_WORKER}`;
    const fetch_ = `${CSP_VIOLATION_PREFIX} connect-src refused ${origin}/?worker-probe from ${origin}${CSP_EXPECTED_WORKER}:20 on ${CSP_EXPECTED_WORKER}`;
    expect(isExpectedViolation(eval_)).toBe(true);
    expect(isExpectedViolation(fetch_)).toBe(true);
    // Named as the page by its document, still from the probe's own file.
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} script-src refused eval from ${origin}${CSP_EXPECTED_WORKER}:18 on /`)).toBe(true);
    // Anything else from the probe, or the same refusal from any other worker or page, is not.
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} img-src refused ${origin}/a.png on ${CSP_EXPECTED_WORKER}`)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} connect-src refused ${origin}/other on ${CSP_EXPECTED_WORKER}`)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} script-src refused eval on /src/ui/theme/generator/worker.ts?worker_file&type=module`)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} script-src refused eval from ${origin}/src/features/script/readPdf.ts:3 on /`)).toBe(false);
    expect(isExpectedViolation(`${CSP_VIOLATION_PREFIX} script-src refused eval on ${CSP_EXPECTED_WORKER}?more`)).toBe(false);
    expect(unexpectedViolations([JSON.stringify({ at: 1, line: eval_ }), JSON.stringify({ at: 1, line: fetch_ })].join('\n'), 0)).toEqual([]);
  });
});

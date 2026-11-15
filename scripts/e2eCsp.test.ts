import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_EXPECTED_PAGE, CSP_VIOLATION_PREFIX, E2E_CSP_ADDITIONS, e2eCsp, isExpectedViolation, parseCsp, tauriCsp, unexpectedViolations } from './e2eCsp';

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

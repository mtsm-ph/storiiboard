import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { E2E_CSP_ADDITIONS, e2eCsp, parseCsp, tauriCsp } from './e2eCsp';

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
});

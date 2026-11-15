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
  const directives = parseCsp(base);
  for (const { directive, source } of additions) {
    const sources = directives.get(directive) ?? [...(directives.get('default-src') ?? [])];
    if (!sources.includes(source)) sources.push(source);
    directives.set(directive, sources);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/** What the test server's page prints for each violation, so e2e/cspWatch.ts can fail the test. */
export const CSP_VIOLATION_PREFIX = '[csp-violation]';

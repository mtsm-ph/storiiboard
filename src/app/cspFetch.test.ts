import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The installed app's content security policy (src-tauri/tauri.conf.json) lets the page fetch only its own files and
// the Rust bridge (connect-src 'self' ipc: http://ipc.localhost). The dev server sends no CSP, so a fetch of a data:
// URL or another host works in every test and fails only in the installed app (docs/DESKTOP_GAPS.md, A1; 5.12). Every
// fetch( in src is listed here with why the installed app allows it; anything else goes through Rust or decodes itself.

const root = join(import.meta.dirname, '../..');

/** File (from the repo's root) → how many fetch( calls it has, and why each is same-origin or dev-only. */
const ALLOWED: Readonly<Record<string, { count: number; reason: string }>> = {
  'src/features/export/deckFonts.ts': {
    count: 1,
    reason: 'bundled font files imported with ?url (same-origin; fonts are far above Vite’s inline limit, never data:)',
  },
  'src/features/export/pdfStoryboardFormat.ts': {
    count: 1,
    reason: 'fontBytes: bundled font files imported with ?url (same-origin), for the storyboard and call sheet PDFs',
  },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('fetch( in the app’s code (5.12)', () => {
  it('is only where the installed app’s CSP allows it', () => {
    const found: Record<string, number> = {};
    for (const path of sourceFiles(join(root, 'src'))) {
      const count = (readFileSync(path, 'utf8').match(/\bfetch\s*\(/g) ?? []).length;
      if (count > 0) found[relative(root, path).replace(/\\/g, '/')] = count;
    }
    const unexpected = Object.entries(found)
      .filter(([file, count]) => ALLOWED[file]?.count !== count)
      .map(([file, count]) => `${file} (${String(count)}, allowed ${String(ALLOWED[file]?.count ?? 0)})`);
    expect(
      unexpected,
      'A fetch( the installed app may refuse: its CSP connect-src allows only \'self\' and ipc: (src-tauri/tauri.conf.json), ' +
        'and the dev server sends no CSP, so tests pass while the app fails (docs/DESKTOP_GAPS.md, A1). Decode data: URLs ' +
        'yourself, reach other hosts through Rust (src-tauri/src/net.rs), or add a same-origin or dev-only call to ALLOWED ' +
        'with its reason.',
    ).toEqual([]);
    // A file taken off the list once its fetch is gone, so the list stays what is in the code.
    expect(Object.keys(ALLOWED).filter((file) => !(file in found))).toEqual([]);
  });
});

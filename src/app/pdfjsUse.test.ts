import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { e2eCsp, parseCsp, tauriCsp } from '../../scripts/e2eCsp';

// What keeps the Advisories job's pdfjs-dist ignore true (osv-scanner.toml, GHSA-hq66-cqwq-w95j, Kevin Nov 18): the
// flaw needs PDF scripting switched on and no script policy. So only readPdf.ts loads pdf.js in the app, nothing loads
// its viewer (pdfjs-dist/web) or builds an annotation layer or turns scripting on, and neither the installed app's
// policy nor the end-to-end tests' one lets a script run inline or through eval. If one of these fails, the reason in
// osv-scanner.toml no longer holds: the ignore goes, or Kevin gives a new one.

const root = join(import.meta.dirname, '..', '..');
const READER = 'src/features/script/readPdf.ts';
const THIS_FILE = 'src/app/pdfjsUse.test.ts';

/** Every source file under these folders, with forward slashes from the repo's root. */
function sources(...folders: string[]): string[] {
  const out: string[] = [];
  const walk = (folder: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, folder), { withFileTypes: true });
    } catch {
      // A folder that isn't there yet (mcp, before its phase).
      return;
    }
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(entry.name)) out.push(path);
    }
  };
  folders.forEach(walk);
  return out;
}

const isTest = (path: string): boolean => /\.test\.(ts|tsx)$/.test(path) || path.startsWith('e2e/');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
// import … from 'pdfjs-dist…', import('pdfjs-dist…'), export … from, require(…): any way code names the package, a
// comment before the string included (import(/* @vite-ignore */ 'pdfjs-dist…')).
const LEAD = String.raw`(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"\x60]`;
const PDFJS_IMPORT = new RegExp(`${LEAD}pdfjs-dist(?:[/'"\\x60?])`);
// The viewer (pdfjs-dist/web) and the scripting sandbox (pdf.sandbox.mjs, in build/ and legacy/build/).
const VIEWER_IMPORT = new RegExp(`${LEAD}pdfjs-dist\\/(?:web\\b|(?:[\\w.-]+\\/)*pdf\\.sandbox)`);

/** The sources a policy gives scripts and workers that let one run inline or through eval, as `directive source`. */
function looseScriptSources(policy: string): string[] {
  const directives = parseCsp(policy);
  const scripts = directives.get('script-src') ?? directives.get('default-src');
  const checked: [string, string[] | undefined][] = [
    ['script-src', scripts],
    // Each narrows script-src for elements or for attributes when it's there, and can loosen it.
    ['script-src-elem', directives.get('script-src-elem')],
    ['script-src-attr', directives.get('script-src-attr')],
    // A worker's fallback, as CSP 3 has it: worker-src, then child-src, then script-src, then default-src.
    ['worker-src', directives.get('worker-src') ?? directives.get('child-src') ?? scripts],
  ];
  return checked.flatMap(([directive, sourcesOf]) =>
    (sourcesOf ?? []).filter((source) => ["'unsafe-inline'", "'unsafe-eval'"].includes(source.toLowerCase())).map((source) => `${directive} ${source}`),
  );
}

describe('pdf.js stays a text reader (the pdfjs-dist ignore, Nov 18)', () => {
  // What the app ships. Unit tests and e2e specs are left out of this rule alone: they import pdf.js to read the PDFs
  // the app exports back (call sheets, decks, plans), run only in Node or the test runner, and never ship. The viewer,
  // the sandbox, the annotation layer and scripting are checked in them too, below.
  const shipped = sources('src', 'web', 'mcp').filter((path) => !isTest(path));
  const everything = [...sources('src', 'web', 'mcp', 'e2e', 'scripts'), ...readdirSync(root).filter((name) => /\.(ts|js|mjs)$/.test(name))].filter(
    (path) => path !== THIS_FILE,
  );

  it('is loaded by readPdf.ts alone', () => {
    expect(shipped).toContain(READER);
    expect(PDFJS_IMPORT.test(read(READER))).toBe(true);
    expect(shipped.filter((path) => path !== READER && PDFJS_IMPORT.test(read(path)))).toEqual([]);
  });

  it('opens a PDF with no WebAssembly, which the workers’ policy refuses (Nov 19)', () => {
    // pdf.js 5.7's useWasm is on by default; its WebAssembly.Module would be refused in the worker and fail a run.
    const options = /getDocument\(\{([\s\S]*?)\}\);/.exec(read(READER))?.[1] ?? '';
    expect(options).toMatch(/^\s*useWasm: false,\s*$/m);
  });

  it('never loads the viewer, the scripting sandbox, an annotation layer or scripting, anywhere', () => {
    // The viewer and the sandbox by their import (osv-scanner.toml's reason names the folder in words); the other two
    // by name at all.
    const named = everything.flatMap((path) => {
      const code = read(path);
      return [VIEWER_IMPORT, /AnnotationLayer/, /enableScripting/].filter((pattern) => pattern.test(code)).map((pattern) => `${path}: ${pattern.source}`);
    });
    expect(named).toEqual([]);
  });

  it('runs under policies that let no script run inline or through eval', () => {
    const app = tauriCsp(root);
    for (const [which, policy] of [
      ['src-tauri/tauri.conf.json', app],
      ['scripts/e2eCsp.ts', e2eCsp(app)],
    ] as const) {
      const directives = parseCsp(policy);
      expect(directives.get('script-src') ?? directives.get('default-src'), `${which} has no script-src or default-src`).toBeDefined();
      expect(looseScriptSources(policy), which).toEqual([]);
    }
  });

  it('finds a loose script source in every directive that governs scripts', () => {
    expect(looseScriptSources("default-src 'self'; style-src 'self' 'unsafe-inline'")).toEqual([]);
    expect(looseScriptSources("default-src 'self' 'unsafe-eval'")).toEqual(["script-src 'unsafe-eval'", "worker-src 'unsafe-eval'"]);
    expect(looseScriptSources("default-src 'self'; script-src-elem 'self' 'unsafe-inline'")).toEqual(["script-src-elem 'unsafe-inline'"]);
    expect(looseScriptSources("default-src 'self'; script-src-attr 'unsafe-eval'")).toEqual(["script-src-attr 'unsafe-eval'"]);
    expect(looseScriptSources("default-src 'self'; worker-src 'self' 'unsafe-eval'")).toEqual(["worker-src 'unsafe-eval'"]);
  });

  it('finds an import of pdf.js however it is written', () => {
    for (const code of [
      "import { getDocument } from 'pdfjs-dist';",
      "import('pdfjs-dist/legacy/build/pdf.mjs')",
      "import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';",
      'export * from "pdfjs-dist/build/pdf.mjs";',
      "require('pdfjs-dist')",
      "import 'pdfjs-dist/web/pdf_viewer.css';",
      "import(/* @vite-ignore */ 'pdfjs-dist/legacy/build/pdf.mjs')",
      "import(\n  // a reason\n  'pdfjs-dist')",
    ])
      expect(PDFJS_IMPORT.test(code), code).toBe(true);
    expect(PDFJS_IMPORT.test('// pdfjs-dist 5.7.284 is the last release built for Safari 16.4')).toBe(false);
    for (const code of [
      "import { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';",
      "import('pdfjs-dist/legacy/build/pdf.sandbox.mjs')",
      "import(/* @vite-ignore */ 'pdfjs-dist/build/pdf.sandbox.min.mjs')",
      "import sandbox from 'pdfjs-dist/legacy/build/pdf.sandbox.mjs?url';",
    ])
      expect(VIEWER_IMPORT.test(code), code).toBe(true);
    expect(VIEWER_IMPORT.test('// loads nothing from pdfjs-dist/web')).toBe(false);
    expect(VIEWER_IMPORT.test("import('pdfjs-dist/legacy/build/pdf.mjs')")).toBe(false);
  });
});

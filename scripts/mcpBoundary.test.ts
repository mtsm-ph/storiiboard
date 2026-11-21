import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app's side of the MCP server's boundary (7.5, Phase 7 decisions 1 and 2), in the app's own test run: the MCP SDK
// and zod are the server's alone, never the app's, and the app never imports the server. Read as text, so this runs
// without mcp/node_modules (round 2). The server's side (no network code in mcp/) is mcp/test/boundary.test.ts.

const root = join(import.meta.dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(path);
  }
  return out;
}

/** Every module a file names: import and export from, dynamic import, require. */
function imported(text: string): string[] {
  const names = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
  return names.filter((name) => name !== '');
}

describe('the MCP server’s boundary, from the app', () => {
  it('keeps the SDK and zod out of the app: no file under src imports either, nor anything in mcp', () => {
    const files = sourceFiles(join(root, 'src'));
    expect(files.length).toBeGreaterThan(100);
    const offending = files.flatMap((path) =>
      imported(readFileSync(path, 'utf8'))
        .filter((name) => /^@modelcontextprotocol\//.test(name) || name === 'zod' || name.startsWith('zod/') || /(^|\/)mcp(\/|$)/.test(name))
        .map((name) => `${relative(root, path)}: ${name}`),
    );
    expect(offending).toEqual([]);
  });

  it('adds neither to the app’s own package.json, and the app’s checks leave mcp/ to its own', () => {
    const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const names = [...Object.keys(app.dependencies ?? {}), ...Object.keys(app.devDependencies ?? {})];
    expect(names.filter((name) => name.startsWith('@modelcontextprotocol/') || name === 'zod')).toEqual([]);
    // The app's TypeScript project and its test run don't reach into mcp/ (its lint ignores it: eslint.config.js).
    const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as { include: string[] };
    expect(tsconfig.include.filter((path) => path.startsWith('mcp'))).toEqual([]);
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).not.toMatch(/include:[^\n]*mcp\//);
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toContain("'mcp/**'");
  });
});

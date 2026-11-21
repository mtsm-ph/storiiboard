import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The trust boundary in the source (7.5, Phase 7 decisions 1 and 2): the MCP SDK and zod are the server's alone, never
// the app's; the app never imports the server; and the server has no network code at all.

const root = join(import.meta.dirname, '..', '..');

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

describe('the MCP server’s boundary', () => {
  it('keeps the SDK and zod out of the app: no file under src imports either, nor anything in mcp', () => {
    const offending = sourceFiles(join(root, 'src')).flatMap((path) =>
      imported(readFileSync(path, 'utf8'))
        .filter((name) => /^@modelcontextprotocol\//.test(name) || name === 'zod' || name.startsWith('zod/') || /(^|\/)mcp(\/|$)/.test(name))
        .map((name) => `${relative(root, path)}: ${name}`),
    );
    expect(offending).toEqual([]);
  });

  it('adds neither to the app’s own package.json', () => {
    const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const names = [...Object.keys(app.dependencies ?? {}), ...Object.keys(app.devDependencies ?? {})];
    expect(names.filter((name) => name.startsWith('@modelcontextprotocol/') || name === 'zod')).toEqual([]);
    const server = JSON.parse(readFileSync(join(root, 'mcp', 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    // Pinned exactly, as every dependency is.
    expect(server.dependencies).toEqual({ '@modelcontextprotocol/sdk': '1.32.2', zod: '4.6.7' });
  });

  it('has no network code in the server: no request, socket or HTTP module, and only the SDK’s stdio parts', () => {
    const files = [...sourceFiles(join(root, 'mcp', 'src')), ...sourceFiles(join(root, 'mcp', 'probe'))];
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      const where = relative(root, path);
      for (const name of imported(text)) {
        expect(name, where).not.toMatch(/^(node:)?(http|https|http2|net|tls|dgram|dns)$/);
        if (name.startsWith('@modelcontextprotocol/')) expect(['@modelcontextprotocol/sdk/server/mcp.js', '@modelcontextprotocol/sdk/server/stdio.js'], where).toContain(name);
      }
      expect(text, where).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    }
  });
});

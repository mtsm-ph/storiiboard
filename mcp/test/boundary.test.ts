import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The server's side of the trust boundary (7.5, Phase 7 decisions 1 and 2): its two packages pinned exactly, and no
// network code at all. The app's side (nothing under src imports the SDK, zod or mcp/) runs in the app's own test run,
// scripts/mcpBoundary.test.ts, so it holds without mcp/node_modules (round 2).

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

/** The SDK's parts the server may use: its stdio server, and the call request's schema (round 2's own argument words). */
const SDK_PARTS = ['@modelcontextprotocol/sdk/server/mcp.js', '@modelcontextprotocol/sdk/server/stdio.js', '@modelcontextprotocol/sdk/types.js'];

describe('the MCP server’s boundary', () => {
  it('pins its two packages exactly, and needs Node 22.16 or later', () => {
    const server = JSON.parse(readFileSync(join(root, 'mcp', 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    // Pinned exactly, as every dependency is.
    expect(server.dependencies).toEqual({ '@modelcontextprotocol/sdk': '1.32.2', zod: '4.6.7' });
    // node:sqlite's setReturnArrays and columns came in 22.16.
    expect(server.engines).toEqual({ node: '>=22.16' });
  });

  it('has no network code in the server: no request, socket or HTTP module, and only the SDK’s stdio parts', () => {
    const files = [...sourceFiles(join(root, 'mcp', 'src')), ...sourceFiles(join(root, 'mcp', 'probe'))];
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      const where = relative(root, path);
      for (const name of imported(text)) {
        expect(name, where).not.toMatch(/^(node:)?(http|https|http2|net|tls|dgram|dns)$/);
        if (name.startsWith('@modelcontextprotocol/')) expect(SDK_PARTS, where).toContain(name);
      }
      expect(text, where).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    }
  });
});

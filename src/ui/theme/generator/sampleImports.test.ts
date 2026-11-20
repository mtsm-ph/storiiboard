import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The accent reader's worker bundles sample.ts, so whatever sample.ts imports lands in the worker (6.27r): canvas.ts
// imports the translations and the picture cleaner, so sample.ts makes its canvas through the import-free
// makeCanvas.ts. Read as text, as the build would see it, so a new import fails here before it grows the worker.

const root = join(import.meta.dirname, '../../../..');
const source = (path: string): string => readFileSync(join(root, path), 'utf8');

/** Every module a source names in an import, an export … from, or a dynamic import(). */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*import\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /^\s*export\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1] ?? '');
  return found;
}

describe('the accent worker’s bundle stays small (6.27r)', () => {
  it('makeCanvas.ts has no import at all, so the accent worker sharing sample.ts takes in no translations', () => {
    const text = source('src/core/media/makeCanvas.ts');
    expect(specifiers(text)).toEqual([]);
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });

  it('sample.ts imports makeCanvas.ts alone, never canvas.ts, so the accent worker takes in no translations', () => {
    const text = source('src/ui/theme/generator/sample.ts');
    expect(specifiers(text)).toEqual(['../../../core/media/makeCanvas']);
    expect(text).toMatch(/^import\s*\{\s*makeCanvas\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/core\/media\/makeCanvas';$/m);
    expect(specifiers(text).some((name) => /(^|\/)canvas(\.ts)?$/.test(name))).toBe(false);
  });
});

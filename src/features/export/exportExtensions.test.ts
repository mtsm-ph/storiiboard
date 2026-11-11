import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECK_FORMATS, FORMATS, SWATCH_FORMATS } from './registry';

// The desktop app saves only the extensions src-tauri/src/export.rs lists (EXTENSIONS); a format whose file isn't on the list
// is refused there with "That isn't a name an export can have", which the browser build never shows. Read from the source text.

const source = readFileSync(new URL('../../../src-tauri/src/export.rs', import.meta.url), 'utf8');
const listed = new Set((/const EXTENSIONS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '').split(',').map((e) => e.trim().replace(/"/g, '')).filter(Boolean));

describe('the extensions the desktop app can save', () => {
  it('include the one of every file format in the registry', () => {
    expect(listed.size).toBeGreaterThan(0);
    for (const format of [...FORMATS, ...DECK_FORMATS, ...SWATCH_FORMATS].filter((f) => f.output === 'file')) {
      const extension = format.name('Bey County', null).split('.').pop()?.toLowerCase() ?? '';
      expect(listed.has(extension), `${format.id}: .${extension}`).toBe(true);
    }
  });

  it('include the call sheet’s and an attachment’s PDF', () => {
    expect(listed.has('pdf')).toBe(true);
  });
});

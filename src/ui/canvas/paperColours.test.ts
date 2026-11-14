import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEPT_LIGHTING, GOLDEN_HOUR } from './paperColours';

// The plan's fixed lighting colour (6.5 review) is the design kit's lighting department token, never a copy that drifts:
// read from design/tokens in the test, both the CSS and the JSON the kit ships.

const tokens = join(import.meta.dirname, '../../../design/tokens');

describe('DEPT_LIGHTING', () => {
  it('is the lighting department’s colour in design/tokens', () => {
    const css = readFileSync(join(tokens, 'tokens.css'), 'utf8');
    const fromCss = /--sb-dept-lighting:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(css)?.[1];
    expect(fromCss?.toUpperCase()).toBe(DEPT_LIGHTING.toUpperCase());
    const json = readFileSync(join(tokens, 'tokens.json'), 'utf8');
    expect(json.toUpperCase()).toContain(`"LIGHTING": "${DEPT_LIGHTING.toUpperCase()}"`);
  });
});

describe('GOLDEN_HOUR', () => {
  it('is golden hour’s Burning Flame in design/tokens (6.6)', () => {
    const css = readFileSync(join(tokens, 'tokens.css'), 'utf8');
    const fromCss = /--sb-highlight:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(css)?.[1];
    expect(fromCss?.toUpperCase()).toBe(GOLDEN_HOUR.toUpperCase());
    const json = readFileSync(join(tokens, 'tokens.json'), 'utf8');
    expect(json.toUpperCase()).toContain(`"HIGHLIGHT": "${GOLDEN_HOUR.toUpperCase()}"`);
  });
});

import { describe, expect, it } from 'vitest';
import { EMERGENCY_COUNTRIES, emergencyNumbers } from './emergencyNumbers';

// The emergency numbers (4.5): exactly the main session's list, and nothing guessed for a country not on it.

describe('emergency numbers', () => {
  it('lists each country the brief names', () => {
    const expected: Record<string, string[]> = {
      '911': ['US', 'CA', 'MX', 'PR', 'GU', 'VI'],
      '112': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'CH', 'IS', 'IN'],
      '000': ['AU'],
      '111': ['NZ'],
      '119': ['JP'],
      '192': ['BR'],
      '123': ['CO'],
      '131': ['CL'],
      '106': ['PE'],
      '107': ['AR'],
    };
    for (const [number, countries] of Object.entries(expected)) for (const code of countries) expect(emergencyNumbers(code), code).toEqual([number]);
    // 27 EU countries minus Ireland (its own entry), plus NO, CH, IS, IN: 30 on 112.
    expect(expected['112']).toHaveLength(30);
  });

  it('gives the UK and Ireland two numbers, the main one first', () => {
    expect(emergencyNumbers('GB')).toEqual(['999', '112']);
    expect(emergencyNumbers('IE')).toEqual(['112', '999']);
  });

  it('knows nothing of a country not listed, and never guesses 112', () => {
    expect(emergencyNumbers('ZA')).toEqual([]);
    expect(emergencyNumbers('')).toEqual([]);
    expect(emergencyNumbers(null)).toEqual([]);
    expect(EMERGENCY_COUNTRIES).not.toContain('ZA');
  });

  it('reads a code in any case', () => {
    expect(emergencyNumbers('pe')).toEqual(['106']);
  });
});

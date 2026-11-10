import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { EMERGENCY_COUNTRIES, emergencyNumbers, emergencyText, type EmergencyNumber } from './emergencyNumbers';

// The emergency numbers (4.5, 4.13): exactly the main session's list, each with its kind, and nothing guessed for a
// country not on it.

const e = (number: string): EmergencyNumber => ({ kind: 'emergency', number });
const a = (number: string): EmergencyNumber => ({ kind: 'ambulance', number });
afterEach(() => {
  setLocale('en');
});

describe('emergency numbers', () => {
  it('lists each country the brief names, with its kind', () => {
    const general: Record<string, string[]> = {
      '911': ['US', 'CA', 'MX', 'PR', 'GU', 'VI', 'EC', 'CR', 'HN', 'PA', 'DO', 'VE'],
      '112': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'CH', 'IS', 'IN'],
      '000': ['AU'],
      '111': ['NZ'],
      '123': ['CO'],
    };
    for (const [number, countries] of Object.entries(general)) for (const code of countries) expect(emergencyNumbers(code), code).toEqual([e(number)]);
    const ambulance: Record<string, string[]> = {
      '119': ['JP'],
      '192': ['BR'],
      '131': ['CL'],
      '106': ['PE'],
      '107': ['AR'],
      '122': ['GT'],
      '102': ['NI'],
      '104': ['CU'],
      '116': ['HT'],
    };
    for (const [number, countries] of Object.entries(ambulance)) for (const code of countries) expect(emergencyNumbers(code), code).toEqual([a(number)]);
    // 27 EU countries minus Ireland (its own entry), plus NO, CH, IS, IN: 30 on 112.
    expect(general['112']).toHaveLength(30);
  });

  it('gives a country its emergency line and its ambulance line', () => {
    expect(emergencyNumbers('SV')).toEqual([e('911'), a('132')]);
    expect(emergencyNumbers('UY')).toEqual([e('911'), a('105')]);
    expect(emergencyNumbers('PY')).toEqual([e('911'), a('141')]);
  });

  it('gives the UK and Ireland two numbers, the main one first', () => {
    expect(emergencyNumbers('GB')).toEqual([e('999'), e('112')]);
    expect(emergencyNumbers('IE')).toEqual([e('112'), e('999')]);
  });

  it('knows nothing of a country not listed, Bolivia included, and never guesses 112', () => {
    for (const code of ['ZA', 'BO', '']) expect(emergencyNumbers(code), code).toEqual([]);
    expect(emergencyNumbers(null)).toEqual([]);
    expect(EMERGENCY_COUNTRIES).not.toContain('ZA');
    expect(EMERGENCY_COUNTRIES).not.toContain('BO');
  });

  it('reads a code in any case', () => {
    expect(emergencyNumbers('pe')).toEqual([a('106')]);
  });

  it('prints one, two and "or" numbers in English', () => {
    expect(emergencyText(emergencyNumbers('US'))).toBe('Emergency 911');
    expect(emergencyText(emergencyNumbers('PE'))).toBe('Ambulance 106');
    expect(emergencyText(emergencyNumbers('PY'))).toBe('Emergency 911 · Ambulance 141');
    expect(emergencyText(emergencyNumbers('GB'))).toBe('Emergency 999 or 112');
    expect(emergencyText(emergencyNumbers('IE'))).toBe('Emergency 112 or 999');
  });

  it('prints them in Spanish', () => {
    setLocale('es');
    expect(emergencyText(emergencyNumbers('US'))).toBe('Emergencias 911');
    expect(emergencyText(emergencyNumbers('PE'))).toBe('Ambulancia 106');
    expect(emergencyText(emergencyNumbers('SV'))).toBe('Emergencias 911 · Ambulancia 132');
    expect(emergencyText(emergencyNumbers('GB'))).toBe('Emergencias 999 o 112');
  });
});

import { describe, expect, it } from 'vitest';
import { countryList, countryName, ISO_COUNTRIES } from './countries';
import { emergencyNumbers } from './emergencyNumbers';
import { valueText } from '../../features/history/summary';

// The country menu and the words History uses for a location's country and hospital (4.5).

describe('countries', () => {
  it('are the 249 assigned ISO 3166-1 codes and XK for Kosovo, none twice, and no code that is not a country', () => {
    expect(ISO_COUNTRIES).toHaveLength(250);
    expect(new Set(ISO_COUNTRIES).size).toBe(250);
    expect(countryName('XK', 'en')).not.toBe('XK');
    expect(emergencyNumbers('XK')).toEqual([]);
    for (const code of ['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'IC', 'EA', 'AC', 'CP', 'DG', 'TA', 'UK', 'DD', 'FX']) expect(ISO_COUNTRIES, code).not.toContain(code);
    // Every country the emergency table lists is in the menu.
    for (const code of ['US', 'GB', 'IE', 'PE', 'AU', 'NZ', 'JP', 'IN', 'PR', 'GU', 'VI']) expect(ISO_COUNTRIES).toContain(code);
    expect(emergencyNumbers('PR')).toEqual(['911']);
  });

  it('are named in the app’s language and sorted by name', () => {
    expect(countryName('PE', 'en')).toBe('Peru');
    expect(countryName('PE', 'es')).toBe('Perú');
    const names = countryList('en').map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('History’s words for a location’s hospital', () => {
  it('says where it came from, whether it has an emergency room, and the country by name', () => {
    expect(valueText('hospital_source', 'osm')).toBe('OpenStreetMap search');
    expect(valueText('hospital_emergency', true)).toBe('24-hour emergency room');
    expect(valueText('hospital_emergency', false)).toBe('unknown');
    expect(valueText('country_code', 'PE')).toBe('Peru');
  });
});

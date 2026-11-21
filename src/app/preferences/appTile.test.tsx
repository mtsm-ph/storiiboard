import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../../core/i18n';
import { AppTile } from './AppTile';

// Settings → App (4.4): the Weather units field, with its three choices, in both languages.

const start = getLocale();
afterEach(() => {
  setLocale(start);
});

const render = () => renderToString(<AppTile />).replaceAll('<!-- -->', '');

describe('Settings → App', () => {
  it('has Weather units: by this computer’s region, metric or US', () => {
    setLocale('en');
    const html = render();
    expect(html).toContain('Weather units');
    expect(html).toContain('By this computer’s region');
    expect(html).toContain('Metric (°C, km/h, mm)');
    expect(html).toContain('US (°F, mph, in)');
  });

  it('has Plan units (6.2a): by this computer’s region, metres or feet and inches', () => {
    setLocale('en');
    const html = render();
    expect(html).toContain('Plan units');
    expect(html).toContain('Meters');
    expect(html).toContain('Feet and inches');
    setLocale('es');
    expect(render()).toContain('Unidades de la planta');
  });

  it('has the Measurement system (Kevin, Nov 18) over the two units, read from them', () => {
    setLocale('en');
    const html = render();
    expect(html).toContain('Measurement system');
    expect(html).toContain('Metric (m, °C, km/h, km)');
    expect(html).toContain('US (ft, °F, mph, mi)');
    // Both By region here, so it reads By region, and Mixed is no choice.
    expect(html).toContain('data-measurement="region"');
    expect(html).not.toContain('>Mixed<');
    expect(html.indexOf('Measurement system')).toBeLessThan(html.indexOf('Plan units'));
    expect(html.indexOf('Plan units')).toBeLessThan(html.indexOf('Weather units'));
    expect(html).toContain('Weather units also give the nearest hospital’s distances.');
    setLocale('es');
    expect(render()).toContain('Sistema de medidas');
  });

  it('has it in Spanish too', () => {
    setLocale('es');
    const html = render();
    expect(html).toContain('Unidades del clima');
    expect(html).toContain('Métricas (°C, km/h, mm)');
    expect(html).toContain('EE. UU. (°F, mph, in)');
  });
});

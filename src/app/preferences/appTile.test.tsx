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

  it('has it in Spanish too', () => {
    setLocale('es');
    const html = render();
    expect(html).toContain('Unidades del clima');
    expect(html).toContain('Métricas (°C, km/h, mm)');
    expect(html).toContain('EE. UU. (°F, mph, in)');
  });
});

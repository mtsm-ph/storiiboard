import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t } from '../../core/i18n';
import { en } from '../../core/i18n/locales/en';
import { es } from '../../core/i18n/locales/es';
import { BROWSER_SERVICES, offReason, offReasonFrom, type ServiceStatus } from '../servicesStatus';
import { OnlineServicesView } from './OnlineServicesTab';

// Settings → Online services (4.0): each service with each state the switch can give it.

const nominatim = (over: Partial<ServiceStatus>): ServiceStatus => ({
  id: 'nominatim',
  server: 'https://nominatim.openstreetmap.org',
  state: 'on',
  reason: null,
  ...over,
});
const render = (service: ServiceStatus) => renderToString(<OnlineServicesView services={[service]} />).replaceAll('<!-- -->', '');

const start = getLocale();
afterEach(() => {
  setLocale(start);
});

describe('Online services', () => {
  it('lists the service with what it is for, when, its server and its state', () => {
    const html = render(nominatim({}));
    expect(html).toContain(t('services.nominatim.name'));
    expect(html).toContain('Only when you press Search address or Find nearest hospital.');
    expect(html).toContain('https://nominatim.openstreetmap.org');
    expect(html).toContain('>On<');
    expect(html).toContain(t('services.listNote'));
  });

  it('says Not checked yet before the switch has been read, which is all a browser build knows', () => {
    expect(render(nominatim({ state: 'unchecked' }))).toContain('Not checked yet');
    expect(BROWSER_SERVICES.map((s) => [s.id, s.state])).toEqual([
      ['nominatim', 'unchecked'],
      ['met-norway', 'unchecked'],
      ['osm-tiles', 'unchecked'],
    ]);
  });

  it('says why a service is off, in words of the app and not the file', () => {
    const operator = render(nominatim({ state: 'off', reason: 'operator-request' }));
    expect(operator).toContain('>Off<');
    expect(operator).toContain('Turned off at the request of the service’s operator');
    expect(render(nominatim({ state: 'off', reason: 'maintenance' }))).toContain('Turned off for now while the service is changed');
    expect(render(nominatim({ state: 'off', reason: 'who-knows' }))).toContain('Turned off for now');
    expect(offReason('maintenance')).toBe(en['services.off.maintenance']);
  });

  it('reads in Spanish too, every state', () => {
    setLocale('es');
    expect(render(nominatim({ state: 'unchecked' }))).toContain('Aún no revisado');
    expect(render(nominatim({}))).toContain('Activado');
    expect(render(nominatim({ state: 'off', reason: 'operator-request' }))).toContain('a pedido del operador');
    expect(render(nominatim({ state: 'off', reason: 'maintenance' }))).toContain('>Desactivado<');
    expect(es['services.state.off']).toBe('Desactivado');
  });

  it('still lists a service it has no words for, with its id and server', () => {
    const html = render({ id: 'tiles', server: 'https://tiles.example', state: 'unchecked', reason: null });
    expect(html).toContain('An online service');
    expect(html).toContain('tiles');
    expect(html).toContain('https://tiles.example');
  });

  it('tells the off error from Rust apart from any other', () => {
    expect(offReasonFrom('service-off:maintenance')).toBe('maintenance');
    expect(offReasonFrom('The service is busy. Try again in a minute.')).toBeNull();
  });

  it('lists MET Norway, the weather, with what it is for and when, in English and Spanish', () => {
    const html = renderToString(<OnlineServicesView services={BROWSER_SERVICES} />).replaceAll('<!-- -->', '');
    expect(html).toContain('Weather (MET Norway)');
    expect(html).toContain('The forecast for each location on a call sheet.');
    expect(html).toContain('Only when a call sheet is opened or refreshed, and never again for a place before the forecast says it’s out of date.');
    expect(html).toContain('https://api.met.no/weatherapi/locationforecast/2.0');
    expect(html.match(/data-service="/g)).toHaveLength(3);
    setLocale('es');
    const spanish = renderToString(<OnlineServicesView services={BROWSER_SERVICES} />).replaceAll('<!-- -->', '');
    expect(spanish).toContain('Clima (MET Norway)');
    expect(spanish).toContain('El pronóstico de cada locación en una hoja de llamado.');
    expect(es['services.metNorway.when']).toContain('nunca otra vez');
  });

  it('lists the map tiles, with what they are for and when, and the tile server, in English and Spanish', () => {
    const html = renderToString(<OnlineServicesView services={BROWSER_SERVICES} />).replaceAll('<!-- -->', '');
    expect(html).toContain('Map tiles (OpenStreetMap)');
    expect(html).toContain('The map on a location.');
    expect(html).toContain('Only the tiles of the map being viewed, kept on this computer for a week or as long as OpenStreetMap says.');
    expect(html).toContain('https://tile.openstreetmap.org');
    setLocale('es');
    const spanish = renderToString(<OnlineServicesView services={BROWSER_SERVICES} />).replaceAll('<!-- -->', '');
    expect(spanish).toContain('Mosaicos del mapa (OpenStreetMap)');
    expect(es['services.osmTiles.purpose']).toBe('El mapa de una locación.');
  });
});

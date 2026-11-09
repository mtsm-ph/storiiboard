import { describe, expect, it } from 'vitest';
import { coordinatesLabel, nominatimPlaces, placeFrom, placesFrom, searchKey } from './places';
import { recordedPlaces } from './recordedSearch';
import cusco from './recorded/nominatim-plaza-de-armas-cusco.json';

// The address search's places (3.4), as the Rust side sends them and the cache keeps them, checked again when read.

describe('places', () => {
  it('are a name and a point on the Earth; anything else is left out', () => {
    expect(placeFrom({ name: 'Lima', latitude: -12.05, longitude: -77.04 })).toEqual({ name: 'Lima', latitude: -12.05, longitude: -77.04 });
    expect(placeFrom({ name: 'Off the map', latitude: 91, longitude: 0 })).toBeNull();
    expect(placeFrom({ name: '', latitude: 1, longitude: 1 })).toBeNull();
    expect(placeFrom({ name: 'Text', latitude: '1', longitude: '1' })).toBeNull();
    expect(placesFrom([{ name: 'Lima', latitude: 1, longitude: 2 }, null, { name: 'NaN', latitude: Number.NaN, longitude: 0 }])).toEqual([{ name: 'Lima', latitude: 1, longitude: 2 }]);
    expect(placesFrom({ places: [] })).toBeNull();
  });

  it('are cached by the words, in one case and spacing, and the language', () => {
    expect(searchKey('  Plaza  de Armas ', 'en')).toBe('en|plaza de armas');
    expect(searchKey('plaza de armas', 'es')).not.toBe(searchKey('plaza de armas', 'en'));
  });

  it('read from a recorded Nominatim answer as the Rust side reads it', async () => {
    const found = nominatimPlaces(cusco);
    expect(found).toHaveLength(5);
    expect(found[0]).toEqual({
      name: 'Plaza de Armas, Hauqaypata, San Cristóbal, Mollococha, Cuzco, Distrito de Cusco, Province of Cusco, Cusco, 08001, Peru',
      latitude: -13.5167674,
      longitude: -71.9787787,
    });
    expect(coordinatesLabel(found[0] ?? { latitude: 0, longitude: 0 })).toBe('-13.51677, -71.97878');
    // The stand-in development builds search through.
    expect(await recordedPlaces('Plaza de Armas, Cusco')).toEqual(found);
    expect(await recordedPlaces('Nowhere')).toEqual([]);
    // As geocode.rs: an empty or missing coordinate is no place, never 0.
    expect(nominatimPlaces([{ display_name: 'Empty', lat: '', lon: '1' }, { display_name: 'Null', lat: null, lon: null }, { display_name: 'Ok', lat: '1', lon: 2 }])).toEqual([{ name: 'Ok', latitude: 1, longitude: 2 }]);
    await expect(recordedPlaces('offline')).rejects.toThrow('couldn\'t reach the service');
  });
});

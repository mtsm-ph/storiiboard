import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { namedByCoordinates, type Place } from '../../core/net/places';
import { AddressSearch } from './AddressSearch';

// A pasted pin's coordinates show once in the Locations tile (6.25 round 2): its name IS its coordinates' text, so the
// name isn't said before them. A searched place keeps its name.

const query = () => '';
const shown = (place: Place) => renderToString(<AddressSearch locationId="l1" place={place} query={query} />).replace(/<!-- -->/g, '');
const count = (html: string, text: string) => html.split(text).length - 1;

describe('a place named by its own coordinates', () => {
  it('is one a pasted pin made, at five places or the four of before; never a searched place or coordinates of elsewhere', () => {
    expect(namedByCoordinates({ name: '40.86771, -73.92123', latitude: 40.867712, longitude: -73.921234 })).toBe(true);
    // Named before 6.25, to four places.
    expect(namedByCoordinates({ name: '40.8677, -73.9212', latitude: 40.867712, longitude: -73.921234 })).toBe(true);
    expect(namedByCoordinates({ name: '40.8677, -73.9212', latitude: 40.86774, longitude: -73.92124 })).toBe(true);
    expect(namedByCoordinates({ name: 'Plaza de Armas, Cusco, Peru', latitude: -13.51677, longitude: -71.97878 })).toBe(false);
    // A pin dragged since keeps its name, which is no longer where it is: both are shown.
    expect(namedByCoordinates({ name: '40.8677, -73.9212', latitude: 40.8687, longitude: -73.9212 })).toBe(false);
    expect(namedByCoordinates({ name: '40.8677, -73.9212', latitude: 40.8677, longitude: -73.9222 })).toBe(false);
  });

  it('shows the coordinates once for a pasted pin, old names included, and a searched place’s name with them', () => {
    const pasted = shown({ name: '40.71280, -74.00600', latitude: 40.7128, longitude: -74.006 });
    expect(count(pasted, '40.71280, -74.00600')).toBe(1);
    const old = shown({ name: '40.8677, -73.9212', latitude: 40.867712, longitude: -73.921234 });
    expect(count(old, '40.86771, -73.92123')).toBe(1);
    expect(old).not.toContain('40.8677, -73.9212');
    const searched = shown({ name: 'Plaza de Armas, Cusco, Peru', latitude: -13.516772, longitude: -71.978781 });
    expect(searched).toContain('Plaza de Armas, Cusco, Peru');
    expect(count(searched, '-13.51677, -71.97878')).toBe(1);
    const dragged = shown({ name: '40.8677, -73.9212', latitude: 40.8687, longitude: -73.9212 });
    expect(dragged).toContain('40.8677, -73.9212');
    expect(dragged).toContain('40.86870, -73.92120');
  });
});

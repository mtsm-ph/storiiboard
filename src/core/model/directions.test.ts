import { describe, expect, it } from 'vitest';
import { directionsLink } from './directions';

// The directions link of a location (4.6): a link per map app, from the place when there is one, else the address.

const place = { name: 'Plaza de Armas, Cusco', latitude: -13.5167674, longitude: -71.9787787 };
const diner = { name: 'Diner', address: '12 Route 9,  Bey County' };

describe('directions links', () => {
  it('with a place: its coordinates at six decimals, in each app', () => {
    expect(directionsLink('google', diner, place)).toBe('https://www.google.com/maps/dir/?api=1&destination=-13.516767,-71.978779');
    expect(directionsLink('apple', diner, place)).toBe('https://maps.apple.com/?daddr=-13.516767,-71.978779');
    expect(directionsLink('osm', diner, place)).toBe('https://www.openstreetmap.org/directions?to=-13.516767,-71.978779');
  });

  it('without a place: the address, spaces run together, encoded', () => {
    expect(directionsLink('google', diner, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=12%20Route%209%2C%20Bey%20County');
    expect(directionsLink('apple', diner, null)).toBe('https://maps.apple.com/?daddr=12%20Route%209%2C%20Bey%20County');
    // OpenStreetMap has no address-only directions link; it opens the search the Locations tile already uses.
    expect(directionsLink('osm', diner, null)).toBe('https://www.openstreetmap.org/search?query=12%20Route%209%2C%20Bey%20County');
  });

  it('encodes accents and the characters a URL reserves', () => {
    const cusco = { name: 'Casa', address: 'Calle Ñusta & Plaza #3, Cusco' };
    expect(directionsLink('google', cusco, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=Calle%20%C3%91usta%20%26%20Plaza%20%233%2C%20Cusco');
    expect(directionsLink('apple', cusco, null)).toContain('daddr=Calle%20%C3%91usta%20%26%20Plaza%20%233%2C%20Cusco');
  });

  it('with no address, the name; with neither, no link', () => {
    expect(directionsLink('google', { name: 'Diner', address: '  ' }, null)).toBe('https://www.google.com/maps/dir/?api=1&destination=Diner');
    expect(directionsLink('google', { name: '', address: '' }, null)).toBeNull();
    expect(directionsLink('apple', { name: ' ', address: ' ' }, null)).toBeNull();
    expect(directionsLink('osm', { name: '', address: '' }, null)).toBeNull();
  });

  it('a place wins over the address, and the link never carries the address with it', () => {
    expect(directionsLink('google', diner, place)).not.toContain('Route');
  });
});

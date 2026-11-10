import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { distanceText, haversineKm, hospitalFrom, hospitalKey, hospitalsFrom, hospitalsJson, nominatimHospitals, rankHospitals, type FoundHospital } from './hospitals';
import cusco from './recorded/nominatim-hospitals-cusco.json';

// The nearest-hospital search's hospitals (4.5), read as the Rust side reads them (src-tauri/src/hospital.rs), ranked
// and cached; the recorded answer is hand-written in Nominatim's jsonv2 shape.

afterEach(() => {
  setLocale('en');
});

const plaza = { latitude: -13.5167674, longitude: -71.9787787 };
const found = (name: string, latitude: number, longitude: number, emergency: boolean): FoundHospital => ({ name, address: '', latitude, longitude, emergency, phone: null, countryCode: null });

describe('hospitals', () => {
  it('read from the recorded answer: emergency yes or unknown, phone, country code, a short address', () => {
    const list = nominatimHospitals(cusco);
    // The entry off the Earth is left out.
    expect(list).toHaveLength(6);
    expect(list[0]).toEqual({
      name: 'Hospital Regional del Cusco',
      address: 'Avenida de la Cultura, Cusco, 08002',
      latitude: -13.5236,
      longitude: -71.9632,
      emergency: true,
      phone: '+51 84 233 331',
      countryCode: 'PE',
    });
    expect(list[1]).toMatchObject({ emergency: false, phone: null, address: 'Avenida de la Cultura, San Sebastián, Cusco' });
    expect(list[4]?.address).toBe('Avenida Collasuyo 845, Cusco');
    // The vet and the bus stop with "hospital" in the name are not hospitals.
    expect(list.map((h) => h.name).join('|')).not.toMatch(/VCA|parada/);
    // "emergency=no" is unknown too, and contact:phone counts as a phone.
    expect(list[2]).toMatchObject({ emergency: false, phone: '+51 84 111 222' });
  });

  it('an unnamed one is worded Hospital, and a bus stop or vet is dropped', () => {
    const [one, ...rest] = nominatimHospitals([
      { category: 'amenity', type: 'hospital', lat: '1', lon: '2', display_name: 'Calle Real, Cusco, Peru', address: { road: 'Calle Real' } },
      { category: 'highway', type: 'bus_stop', name: 'Hospital', lat: '1', lon: '2' },
      { category: 'amenity', type: 'veterinary', name: 'Animal Hospital', lat: '1', lon: '2' },
      { name: 'No category', lat: '1', lon: '2' },
    ]);
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ name: 'Hospital', address: 'Calle Real' });
  });

  it('write the address in the country order, from a municipality or suburb when there is no town, never a postcode alone', () => {
    const at = (address: Record<string, string>) =>
      nominatimHospitals([{ category: 'amenity', type: 'hospital', name: 'H', lat: '1', lon: '2', display_name: 'H, Fallback Street, Somewhere, Land', address }])[0]?.address;
    expect(at({ house_number: '845', road: 'Main Street', city: 'Austin', postcode: '78701', country_code: 'us' })).toBe('845 Main Street, Austin, 78701');
    expect(at({ house_number: '12', road: 'Calle Real', town: 'Ica', country_code: 'pe' })).toBe('Calle Real 12, Ica');
    expect(at({ house_number: '12', road: 'Rue de Rivoli', city: 'Paris', country_code: 'fr' })).toBe('12 Rue de Rivoli, Paris');
    expect(at({ road: 'Calle Real', suburb: 'Wanchaq', country_code: 'pe' })).toBe('Calle Real, Wanchaq');
    expect(at({ postcode: '08002', country_code: 'pe' })).toBe('Fallback Street, Somewhere, Land');
  });

  it('are a name and a point on the Earth; anything else is left out', () => {
    expect(hospitalFrom({ name: 'X', latitude: 1, longitude: 2, countryCode: 'pe' })).toMatchObject({ name: 'X', countryCode: 'PE', emergency: false });
    expect(hospitalFrom({ name: 'X', latitude: 91, longitude: 0 })).toBeNull();
    expect(hospitalFrom({ name: ' ', latitude: 1, longitude: 0 })?.name).toBe('Hospital');
    expect(hospitalFrom({ latitude: 1, longitude: 0 })).toBeNull();
    expect(hospitalFrom({ name: 'X', latitude: 1, longitude: 0, countryCode: 'Peru' })?.countryCode).toBeNull();
    expect(hospitalsFrom({ error: 'x' })).toBeNull();
    expect(hospitalsFrom([null, { name: 'X', latitude: 1, longitude: 0 }])).toHaveLength(1);
  });

  it('are ranked emergency department first, then nearest, five at most', () => {
    const ranked = rankHospitals(nominatimHospitals(cusco), plaza);
    expect(ranked).toHaveLength(5);
    // Emergency yes by distance (EsSalud, Regional, Paredes), then the others by distance (Pardo, Lorena); Saylla is sixth.
    expect(ranked.map((h) => h.name)).toEqual([
      'Hospital EsSalud Adolfo Guevara Velasco',
      'Hospital Regional del Cusco',
      'Clínica Paredes',
      'Clínica Pardo',
      'Hospital Antonio Lorena',
    ]);
    expect(ranked.map((h) => h.emergency)).toEqual([true, true, true, false, false]);
    expect(ranked[3]?.distanceKm).toBeLessThan(ranked[4]?.distanceKm ?? 0);
    // A nearer one without a known emergency department never beats a farther one with.
    expect(ranked[3]?.distanceKm).toBeLessThan(ranked[0]?.distanceKm ?? 0);
  });

  it('measures the straight line in km', () => {
    // One degree of latitude is about 111.2 km.
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm(plaza, plaza)).toBe(0);
    expect(rankHospitals([found('A', 1, 0, false)], { latitude: 0, longitude: 0 })[0]?.distanceKm).toBeCloseTo(111.19, 1);
  });

  it('writes the distance with one decimal, in km or miles', () => {
    expect(distanceText(1.234, 'metric')).toBe('1.2 km');
    expect(distanceText(1.609344, 'us')).toBe('1.0 mi');
    expect(distanceText(10, 'us')).toBe('6.2 mi');
    setLocale('es');
    expect(distanceText(1.25, 'metric')).toBe('1,3 km');
  });

  it('are cached by the place to 3 decimals and the language', () => {
    expect(hospitalKey({ latitude: -13.5167674, longitude: -71.9787787 }, 'en')).toBe('en|-13.517,-71.979');
    expect(hospitalKey({ latitude: -13.5171, longitude: -71.9791 }, 'en')).toBe('en|-13.517,-71.979');
    expect(hospitalKey(plaza, 'es')).not.toBe(hospitalKey(plaza, 'en'));
  });

  it('keep what was cached when read back', () => {
    const ranked = rankHospitals(nominatimHospitals(cusco), plaza);
    const back = hospitalsFrom(JSON.parse(JSON.stringify(hospitalsJson(ranked))));
    expect(back).toHaveLength(5);
    expect(rankHospitals(back ?? [], plaza).map((h) => h.name)).toEqual(ranked.map((h) => h.name));
  });
});

import { describe, expect, it } from 'vitest';
import { safetyOf } from './callsheet';
import { locationFields } from './location';

// The safety box's data (4.5): the number for the location's country and the hospital kept on it, for each case.

const place = { name: 'Plaza de Armas', latitude: -13.5167674, longitude: -71.9787787 };
const of = (props: Record<string, string | number | boolean>, withPlace = true) => safetyOf(props, locationFields(props).country_code, withPlace ? place : null);

describe('a location’s safety box', () => {
  it('with nothing set: no number to give, no hospital', () => {
    expect(of({ name: 'Diner' })).toEqual({ countryCode: '', numbers: [], hospital: null });
  });

  it('gives the number for the country, two for the UK', () => {
    expect(of({ country_code: 'PE' }).numbers).toEqual(['106']);
    expect(of({ country_code: 'GB' }).numbers).toEqual(['999', '112']);
    // A country not in the table: check locally, never 112.
    expect(of({ country_code: 'ZA' })).toMatchObject({ countryCode: 'ZA', numbers: [] });
    // Something that is not a code reads as not set.
    expect(of({ country_code: 'peru' }).countryCode).toBe('');
  });

  it('a searched hospital with an emergency department has its distance and the OpenStreetMap credit', () => {
    const { hospital } = of({
      country_code: 'PE',
      hospital_name: 'Hospital Regional del Cusco',
      hospital_address: 'Avenida de la Cultura',
      hospital_phone: '+51 84 233 331',
      hospital_latitude: -13.5236,
      hospital_longitude: -71.9632,
      hospital_emergency: true,
      hospital_source: 'osm',
    });
    expect(hospital).toMatchObject({ name: 'Hospital Regional del Cusco', phone: '+51 84 233 331', emergency: true, fromSearch: true });
    expect(hospital?.distanceKm).toBeGreaterThan(1.5);
    expect(hospital?.distanceKm).toBeLessThan(2.2);
  });

  it('a searched hospital whose emergency department is unknown says to check', () => {
    const { hospital } = of({ hospital_name: 'Clínica', hospital_latitude: -13.52, hospital_longitude: -71.97, hospital_source: 'osm' });
    expect(hospital).toMatchObject({ emergency: false, fromSearch: true });
  });

  it('a hospital typed by hand has no distance and no credit', () => {
    const { hospital } = of({ hospital_name: 'Posta del pueblo', hospital_phone: '123' });
    expect(hospital).toMatchObject({ name: 'Posta del pueblo', distanceKm: null, emergency: false, fromSearch: false, address: '' });
  });

  it('a hospital with coordinates at a location with no place has no distance', () => {
    expect(of({ hospital_name: 'H', hospital_latitude: 1, hospital_longitude: 2 }, false).hospital?.distanceKm).toBeNull();
  });

  it('a hospital with an address or phone but no name prints what is there; with none of the three it is none', () => {
    expect(of({ hospital_name: '  ', hospital_phone: '123' }).hospital).toMatchObject({ name: '', phone: '123' });
    expect(of({ hospital_address: 'Calle Real' }).hospital).toMatchObject({ name: '', address: 'Calle Real' });
    expect(of({ hospital_name: ' ', hospital_address: ' ', hospital_phone: '' }).hospital).toBeNull();
  });
});

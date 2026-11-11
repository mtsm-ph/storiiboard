import { describe, expect, it } from 'vitest';
import { keptHospital } from '../../core/model/location';
import type { Hospital } from '../../core/net/hospitals';
import type { SbdRecord } from '../../core/model/record';
import { clearHospital, countryChange, hospitalFieldChange, pickHospital } from './locationEdits';

// The location's hospital edits (4.5): one change list each, so one ⌘Z.

const location = (props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id: 'l1',
  type: 'location',
  parentId: 'p',
  sortKey: 'a',
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
});
const records = (props: SbdRecord['props'] = { name: 'Plaza' }, trashedAt: string | null = null) => ({ l1: location(props, trashedAt) });

const hospital: Hospital = {
  name: 'Hospital Regional del Cusco',
  address: 'Avenida de la Cultura, Wanchaq, Cusco',
  latitude: -13.5236,
  longitude: -71.9632,
  distanceKm: 1.8,
  emergency: true,
  phone: '+51 84 233 331',
  countryCode: 'PE',
};

describe('picking a hospital', () => {
  it('sets everything in one change, with the country when the location has none', () => {
    expect(pickHospital(records(), 'l1', hospital)).toEqual([
      {
        kind: 'update',
        id: 'l1',
        set: {
          hospital_name: 'Hospital Regional del Cusco',
          hospital_address: 'Avenida de la Cultura, Wanchaq, Cusco',
          hospital_latitude: -13.5236,
          hospital_longitude: -71.9632,
          hospital_source: 'osm',
          hospital_emergency: true,
          hospital_phone: '+51 84 233 331',
          country_code: 'PE',
        },
        unset: [],
      },
    ]);
  });

  it('keeps a country already set, and takes off what the new one lacks', () => {
    const now = records({ name: 'Plaza', country_code: 'US', hospital_emergency: true, hospital_phone: '1' });
    const [change] = pickHospital(now, 'l1', { ...hospital, emergency: false, phone: null });
    if (change?.kind !== 'update') throw new Error('update');
    expect(change.set).not.toHaveProperty('country_code');
    expect(change.set).not.toHaveProperty('hospital_emergency');
    expect(change.unset).toEqual(['hospital_emergency', 'hospital_phone']);
  });

  it('does nothing for a location that is gone or in the Trash', () => {
    expect(pickHospital(records({}, '2026-11-10T12:00:00.000Z'), 'l1', hospital)).toEqual([]);
    expect(pickHospital(records(), 'nope', hospital)).toEqual([]);
  });

  it('reads back as the hospital kept on the location', () => {
    const [change] = pickHospital(records(), 'l1', hospital);
    if (change?.kind !== 'update') throw new Error('update');
    expect(keptHospital(change.set ?? {})).toEqual({
      name: 'Hospital Regional del Cusco',
      address: 'Avenida de la Cultura, Wanchaq, Cusco',
      phone: '+51 84 233 331',
      place: { latitude: -13.5236, longitude: -71.9632 },
      emergency: true,
      fromSearch: true,
    });
  });
});

describe('clearing a hospital', () => {
  it('takes all seven props off in one change, and nothing else', () => {
    const now = records({
      name: 'Plaza',
      country_code: 'PE',
      hospital_name: 'X',
      hospital_address: 'Y',
      hospital_phone: '1',
      hospital_latitude: 1,
      hospital_longitude: 2,
      hospital_emergency: true,
      hospital_source: 'osm',
    });
    const [change] = clearHospital(now, 'l1');
    if (change?.kind !== 'update') throw new Error('update');
    expect(change.unset).toEqual(['hospital_name', 'hospital_address', 'hospital_phone', 'hospital_latitude', 'hospital_longitude', 'hospital_emergency', 'hospital_source']);
    expect(clearHospital(records(), 'l1')).toEqual([]);
  });
});

describe('hospital fields by hand', () => {
  it('is one change for each field, none when unchanged', () => {
    expect(hospitalFieldChange(records(), 'l1', 'hospital_phone', '112')).toEqual([{ kind: 'update', id: 'l1', set: { hospital_phone: '112' } }]);
    expect(hospitalFieldChange(records({ hospital_phone: '112' }), 'l1', 'hospital_phone', '112')).toEqual([]);
  });

  it('a new name takes off the emergency flag and where it is; the source, address and phone stay', () => {
    const now = records({ hospital_name: 'Old', hospital_address: 'Calle 1', hospital_phone: '1', hospital_latitude: 1, hospital_longitude: 2, hospital_emergency: true, hospital_source: 'osm' });
    expect(hospitalFieldChange(now, 'l1', 'hospital_name', 'New')).toEqual([
      { kind: 'update', id: 'l1', set: { hospital_name: 'New' }, unset: ['hospital_emergency', 'hospital_latitude', 'hospital_longitude'] },
    ]);
    // A new address takes off where it is (no distance) and keeps the emergency flag; a phone takes off nothing.
    expect(hospitalFieldChange(now, 'l1', 'hospital_address', 'Street')).toEqual([
      { kind: 'update', id: 'l1', set: { hospital_address: 'Street' }, unset: ['hospital_latitude', 'hospital_longitude'] },
    ]);
    expect(hospitalFieldChange(now, 'l1', 'hospital_phone', '2')).toEqual([{ kind: 'update', id: 'l1', set: { hospital_phone: '2' } }]);
    // Spaces added or trimmed are the same hospital: the search's facts stay.
    expect(hospitalFieldChange(now, 'l1', 'hospital_name', ' Old  ')).toEqual([{ kind: 'update', id: 'l1', set: { hospital_name: ' Old  ' } }]);
  });
});

describe('the country', () => {
  it('is set in upper case, unset with null, and refused when not two letters', () => {
    expect(countryChange(records(), 'l1', 'pe')).toEqual([{ kind: 'update', id: 'l1', set: { country_code: 'PE' } }]);
    expect(countryChange(records({ country_code: 'PE' }), 'l1', 'PE')).toEqual([]);
    expect(countryChange(records({ country_code: 'PE' }), 'l1', null)).toEqual([{ kind: 'update', id: 'l1', unset: ['country_code'] }]);
    expect(countryChange(records(), 'l1', null)).toEqual([]);
    expect(countryChange(records(), 'l1', 'Peru')).toEqual([]);
  });
});

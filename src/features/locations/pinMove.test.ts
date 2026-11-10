import { describe, expect, it } from 'vitest';
import { MAP_PLACE_PROPS, mapPlace, pinPlacedByHand, unpinnedBy } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { locationChange, movePin, placeLocation, unplaceLocation } from './locationEdits';

// The pin dragged on the map (4.9): one change, `map_moved` set, the name kept, and a new pick clears it.

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
const placed = { name: 'Plaza', address: 'Plaza de Armas', latitude: -13.51677, longitude: -71.97875, map_name: 'Plaza de Armas, Cusco, Peru' };
const records = (props: SbdRecord['props'] = placed, trashedAt: string | null = null) => ({ l1: location(props, trashedAt) });

describe('moving the pin', () => {
  it('is one update that sets the place and marks it placed by hand, keeping the map name', () => {
    const changes = movePin(records(), 'l1', -13.5168, -71.9789);
    expect(changes).toEqual([{ kind: 'update', id: 'l1', set: { latitude: -13.5168, longitude: -71.9789, map_moved: true } }]);
    // Nothing in it touches the name or the address.
    expect(JSON.stringify(changes)).not.toContain('map_name');
  });

  it('keeps six decimals', () => {
    const changes = movePin(records(), 'l1', -13.516_812_345_678, -71.978_912_345_678);
    expect(changes).toEqual([{ kind: 'update', id: 'l1', set: { latitude: -13.516_812, longitude: -71.978_912, map_moved: true } }]);
  });

  it('is nothing when the pin is where it was, there is no place yet, or the location is gone', () => {
    expect(movePin(records(), 'l1', placed.latitude, placed.longitude)).toEqual([]);
    expect(movePin(records({ name: 'Plaza' }), 'l1', 1, 2)).toEqual([]);
    expect(movePin(records(placed, '2026-11-10T12:00:00.000Z'), 'l1', 1, 2)).toEqual([]);
    expect(movePin(records(), 'nope', 1, 2)).toEqual([]);
  });

  it('refuses a point that is not on the Earth', () => {
    expect(movePin(records(), 'l1', 91, 0)).toEqual([]);
    expect(movePin(records(), 'l1', 0, -181)).toEqual([]);
    expect(movePin(records(), 'l1', Number.NaN, 0)).toEqual([]);
  });

  it('keeps the place reading as a place, now placed by hand', () => {
    const moved = { ...placed, latitude: -13.5168, longitude: -71.9789, map_moved: true };
    expect(mapPlace(moved)?.name).toBe('Plaza de Armas, Cusco, Peru');
    expect(pinPlacedByHand(moved)).toBe(true);
    expect(pinPlacedByHand(placed)).toBe(false);
    // Without a place there is nothing to be placed by hand.
    expect(pinPlacedByHand({ name: 'x', map_moved: true })).toBe(false);
  });
});

describe('a place from the search after a move', () => {
  const moved = { ...placed, latitude: -13.5168, longitude: -71.9789, map_moved: true };

  it('clears the mark', () => {
    const next = { name: 'Qorikancha, Cusco, Peru', latitude: -13.5205, longitude: -71.9753 };
    const changes = placeLocation(records(moved), 'l1', next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'update', unset: ['map_moved'], set: { latitude: next.latitude, map_name: next.name } });
  });

  it('leaves no unset when nothing was moved', () => {
    const changes = placeLocation(records(), 'l1', { name: 'Qorikancha', latitude: -13.5205, longitude: -71.9753 });
    expect(changes[0]).not.toHaveProperty('unset');
  });

  it('is taken off with the place by a new address, and by Clear', () => {
    expect(MAP_PLACE_PROPS).toContain('map_moved');
    expect(unpinnedBy(moved, 'Another street')).toEqual(['latitude', 'longitude', 'map_name', 'map_moved']);
    expect(unpinnedBy(moved, 'Plaza  de   Armas')).toEqual([]);
    const change = locationChange(records(moved), 'l1', 'address', 'Another street');
    expect(change[0]).toMatchObject({ unset: ['latitude', 'longitude', 'map_name', 'map_moved'] });
    expect(unplaceLocation(records(moved), 'l1')[0]).toMatchObject({ unset: ['latitude', 'longitude', 'map_name', 'map_moved'] });
  });
});

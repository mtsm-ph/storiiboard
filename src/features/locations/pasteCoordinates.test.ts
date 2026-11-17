import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';

// A location's place by pasted coordinates (6.5.5): one edit with the place as read, `map_moved` set as a moved pin's,
// the address as typed; and no request of any kind: no address search, no Rust command, no fetch.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);
const search = vi.hoisted(() => ({ searchOnline: vi.fn() }));
vi.mock('../../app/addressSearch', () => search);

const { putPastedCoordinates } = await import('./pasteCoordinates');
const { pasteCoordinatesChanges } = await import('./locationEdits');
const { projectStore } = await import('../../app/projectStore');

const location = (props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id: 'l1',
  type: 'location',
  parentId: 'p',
  sortKey: 'a',
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
});
const typed = { name: 'Fort Tryon', address: 'Margaret Corbin Dr, New York', status: 'tbd' };
const placed = { ...typed, latitude: -13.51677, longitude: -71.97875, map_name: 'Plaza de Armas, Cusco, Peru' };

let groups: Change[][];
const fetchSpy = vi.fn();

beforeEach(() => {
  groups = [];
  tauri.invoke.mockReset();
  search.searchOnline.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  const records = { l1: location(typed) };
  projectStore.setState({
    records,
    applyWith: (build: (now: typeof records) => { changes: Change[] }) => {
      const { changes } = build(records);
      if (changes.length > 0) groups.push(changes);
      return Promise.resolve(changes.length > 0);
    },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pasting coordinates on a location', () => {
  it('is one op setting the place as read, placed by hand, the address kept, and requests nothing', async () => {
    const outcome = await putPastedCoordinates('l1', '40.867712, -73.921234');
    expect(outcome).toEqual({ ok: true, place: { latitude: 40.867712, longitude: -73.921234 }, written: true });
    expect(groups).toEqual([[{ kind: 'update', id: 'l1', set: { latitude: 40.867712, longitude: -73.921234, map_moved: true, map_name: '40.86771, -73.92123' } }]]);
    // Nothing touches the address.
    expect(JSON.stringify(groups)).not.toContain('address');
    expect(search.searchOnline).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads Google Maps’ degrees, minutes and seconds too', async () => {
    const outcome = await putPastedCoordinates('l1', `40°52'03.7"N 73°55'16.3"W`);
    expect(outcome.ok).toBe(true);
    expect(groups).toHaveLength(1);
  });

  it('refuses what isn’t coordinates, saying why, writing and requesting nothing', async () => {
    expect(await putPastedCoordinates('l1', '40,8677, -73,9212')).toEqual({ ok: false, reason: 'decimalComma' });
    expect(await putPastedCoordinates('l1', 'Fort Tryon Park')).toEqual({ ok: false, reason: 'unreadable' });
    expect(await putPastedCoordinates('l1', '91, 0')).toEqual({ ok: false, reason: 'latitude' });
    expect(groups).toEqual([]);
    expect(search.searchOnline).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names a searched place’s pin by its new coordinates, leaves its hospital, and is nothing where the pin already is', () => {
    const records = { l1: location({ ...placed, hospital_name: 'Hospital Regional', hospital_latitude: -13.52, hospital_longitude: -71.97 }) };
    const changes = pasteCoordinatesChanges(records, 'l1', 40.8677, -73.9212);
    expect(changes).toEqual([{ kind: 'update', id: 'l1', set: { latitude: 40.8677, longitude: -73.9212, map_moved: true, map_name: '40.86770, -73.92120' } }]);
    // A dragged pin (movePin) touches no hospital prop, and nor does this.
    expect(JSON.stringify(changes)).not.toContain('hospital');
    expect(pasteCoordinatesChanges(records, 'l1', placed.latitude, placed.longitude)).toEqual([]);
    expect(pasteCoordinatesChanges({ l1: location(typed, '2026-11-16T12:00:00.000Z') }, 'l1', 1, 2)).toEqual([]);
    expect(pasteCoordinatesChanges(records, 'l1', 91, 0)).toEqual([]);
  });
});

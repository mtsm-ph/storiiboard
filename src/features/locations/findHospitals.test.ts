import { beforeEach, describe, expect, it, vi } from 'vitest';

// The hospital search's cache (4.5): a search made before for the place is read from the project; Find again asks the
// network (the recorded answer in this build) and replaces it. Nothing here goes online.

const lookups = vi.hoisted(() => ({ loadLookup: vi.fn(), lookupStatement: vi.fn((...args: unknown[]) => ({ sql: 'x', params: args })) }));
vi.mock('../../core/storage/lookups', () => lookups);

const { findHospitals } = await import('./findHospitals');
const { projectStore } = await import('../../app/projectStore');

const writeAside = vi.fn(() => Promise.resolve(true));
const place = { latitude: -13.5167674, longitude: -71.9787787 };

beforeEach(() => {
  lookups.loadLookup.mockReset();
  lookups.lookupStatement.mockClear();
  writeAside.mockClear();
  projectStore.setState({ project: { file: 'plan.sbd' } as never, writeAside });
});

describe('the hospital search', () => {
  it('asks the network the first time, ranked, and caches five under the place and language', async () => {
    lookups.loadLookup.mockResolvedValue(null);
    const first = await findHospitals(place, false);
    expect(first.saved).toBe(false);
    expect(first.hospitals).toHaveLength(5);
    expect(first.hospitals[0]?.emergency).toBe(true);
    expect(lookups.loadLookup).toHaveBeenCalledWith('plan.sbd', 'hospital_search', 'en|-13.517,-71.979');
    expect(lookups.lookupStatement).toHaveBeenCalledTimes(1);
    expect(lookups.lookupStatement.mock.calls[0]?.[0]).toBe('hospital_search');
    expect(writeAside).toHaveBeenCalledTimes(1);
  });

  it('reads a fresh answer from the cache, with when it was fetched, and writes nothing', async () => {
    lookups.loadLookup.mockResolvedValue({
      fetchedAt: '2026-11-10T09:00:00.000Z',
      result: [{ name: 'Clínica Cache', address: 'Calle 1', latitude: -13.52, longitude: -71.97, emergency: false, phone: null, countryCode: 'PE' }],
    });
    const cached = await findHospitals(place, false);
    expect(cached).toMatchObject({ saved: true, fetchedAt: '2026-11-10T09:00:00.000Z' });
    expect(cached.hospitals.map((h) => h.name)).toEqual(['Clínica Cache']);
    expect(writeAside).not.toHaveBeenCalled();
  });

  it('Find again skips the cache and replaces it', async () => {
    lookups.loadLookup.mockResolvedValue({ fetchedAt: '2026-11-10T09:00:00.000Z', result: [] });
    const again = await findHospitals(place, true);
    expect(lookups.loadLookup).not.toHaveBeenCalled();
    expect(again.saved).toBe(false);
    expect(again.hospitals).toHaveLength(5);
    expect(writeAside).toHaveBeenCalledTimes(1);
  });

  it('goes to the network when the cache holds something unreadable', async () => {
    lookups.loadLookup.mockResolvedValue({ fetchedAt: '2026-11-10T09:00:00.000Z', result: { odd: true } });
    expect((await findHospitals(place, false)).saved).toBe(false);
  });
});

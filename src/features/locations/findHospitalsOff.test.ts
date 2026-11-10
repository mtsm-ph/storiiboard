import { beforeEach, describe, expect, it, vi } from 'vitest';

// The hospital search when the service switch has turned Nominatim off (4.0): Rust answers with the reason code
// (src-tauri/src/services.rs, "service-off:<code>"), and the page shows the translated words and caches nothing.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);

const { findHospitals } = await import('./findHospitals');
const { projectStore } = await import('../../app/projectStore');

const writeAside = vi.fn(() => Promise.resolve(true));
const place = { latitude: -13.5167674, longitude: -71.9787787 };

beforeEach(() => {
  tauri.invoke.mockReset();
  writeAside.mockClear();
  projectStore.setState({ project: { file: 'plan.sbd' } as never, writeAside });
});

describe('a hospital search with the service turned off', () => {
  it('shows the reason in the app’s words and caches nothing', async () => {
    tauri.invoke.mockRejectedValue('service-off:maintenance');
    await expect(findHospitals(place, true)).rejects.toThrow(/^Turned off/);
    expect(tauri.invoke).toHaveBeenCalledWith('nearest_hospitals', { latitude: place.latitude, longitude: place.longitude, language: 'en' });
    expect(writeAside).not.toHaveBeenCalled();
  });

  it('ranks what Rust sends and caches it', async () => {
    tauri.invoke.mockResolvedValue([
      { name: 'Far', address: '', latitude: -13.6, longitude: -72, emergency: false, phone: null, countryCode: null },
      { name: 'Near', address: '', latitude: -13.52, longitude: -71.98, emergency: false, phone: null, countryCode: 'PE' },
    ]);
    const found = await findHospitals(place, true);
    expect(found.hospitals.map((h) => h.name)).toEqual(['Near', 'Far']);
    expect(writeAside).toHaveBeenCalledTimes(1);
  });
});

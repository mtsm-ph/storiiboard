import { beforeEach, describe, expect, it, vi } from 'vitest';

// The address search when the service switch has turned the service off (4.0): Rust answers with the reason code
// (src-tauri/src/services.rs, "service-off:<code>"), and the page shows the translated words, caches nothing.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);

const { findPlaces } = await import('./findPlaces');
const { projectStore } = await import('../../app/projectStore');

const writeAside = vi.fn(() => Promise.resolve(true));

beforeEach(() => {
  tauri.invoke.mockReset();
  writeAside.mockClear();
  // A project is open, so a successful search would be cached; an off service must not be.
  projectStore.setState({ project: { file: 'plan.sbd' } as never, writeAside });
});

describe('an address search with the service turned off', () => {
  it('shows the operator-request reason in the app’s words and caches nothing', async () => {
    tauri.invoke.mockRejectedValue('service-off:operator-request');
    await expect(findPlaces('Plaza de Armas', true)).rejects.toThrow('Turned off at the request of the service’s operator');
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(writeAside).not.toHaveBeenCalled();
  });

  it('says "Turned off for now" for a reason code the app does not know', async () => {
    tauri.invoke.mockRejectedValue('service-off:solar-flare');
    await expect(findPlaces('Plaza de Armas', true)).rejects.toThrow(/^Turned off for now$/);
    expect(writeAside).not.toHaveBeenCalled();
  });

  it('leaves any other error as it came', async () => {
    tauri.invoke.mockRejectedValue('The service is busy. Try again in a minute.');
    await expect(findPlaces('Plaza de Armas', true)).rejects.toBe('The service is busy. Try again in a minute.');
  });
});

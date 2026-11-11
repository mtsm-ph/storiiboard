import { invoke } from '@tauri-apps/api/core';
import { getLocale, t } from '../core/i18n';
import { hospitalsFrom, type FoundHospital } from '../core/net/hospitals';
import type { Place } from '../core/net/places';
import { isTauriApp } from './fileAccess';
import { offReason, offReasonFrom } from './servicesStatus';

// The nearest-hospital search on the network (4.5): on the desktop through Rust (src-tauri/src/hospital.rs: the host
// list, the app's User-Agent, the address search's one request a second), never from the page itself. A development
// build in a browser answers from a recorded answer instead (src/core/net/recordedHospitals.ts), so the end-to-end
// tests never go online; a release in a browser has no search.

/** The hospitals around `place` (up to twenty, unranked), their names in the app's language where the map has them. */
export async function searchHospitalsOnline(place: Pick<Place, 'latitude' | 'longitude'>): Promise<FoundHospital[]> {
  if (isTauriApp) {
    // A service the switch has turned off (4.0) answers with its reason code, and nothing was sent.
    const answer = await invoke<unknown>('nearest_hospitals', { latitude: place.latitude, longitude: place.longitude, language: getLocale() }).catch((error: unknown) => {
      const code = offReasonFrom(typeof error === 'string' ? error : error instanceof Error ? error.message : '');
      throw code === null ? error : new Error(offReason(code));
    });
    const found = hospitalsFrom(answer);
    if (!found) throw new Error(t('error.oddAnswer'));
    return found;
  }
  if (import.meta.env.DEV) {
    const { recordedHospitals } = await import('../core/net/recordedHospitals');
    return recordedHospitals();
  }
  throw new Error(t('error.hospitalDesktopOnly'));
}

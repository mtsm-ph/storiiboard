import { invoke } from '@tauri-apps/api/core';
import { getLocale, t } from '../core/i18n';
import { placesFrom, type Place } from '../core/net/places';
import { isTauriApp } from './fileAccess';
import { offReason, offReasonFrom } from './servicesStatus';

// The address search on the network (3.4): on the desktop through Rust (src-tauri/src/geocode.rs: the host list, the
// app's User-Agent, one request a second), never from the page itself. A development build in a browser answers from
// a recorded answer instead (src/core/net/recordedSearch.ts), so the end-to-end tests never go online; a release in a
// browser has no search.

/** The places found for `query`, their names in the app's language where the map has them. */
export async function searchOnline(query: string): Promise<Place[]> {
  if (isTauriApp) {
    // A service the switch has turned off (4.0) answers with its reason code, and nothing was sent.
    const answer = await invoke<unknown>('address_search', { query, language: getLocale() }).catch((error: unknown) => {
      const code = offReasonFrom(typeof error === 'string' ? error : error instanceof Error ? error.message : '');
      throw code === null ? error : new Error(offReason(code));
    });
    const places = placesFrom(answer);
    if (!places) throw new Error(t('error.oddAnswer'));
    return places;
  }
  if (import.meta.env.DEV) {
    const { recordedPlaces } = await import('../core/net/recordedSearch');
    return recordedPlaces(query);
  }
  throw new Error(t('error.searchDesktopOnly'));
}

import { searchOnline } from '../../app/addressSearch';
import { projectStore } from '../../app/projectStore';
import { getLocale } from '../../core/i18n';
import { placesFrom, placesJson, searchKey, type Place } from '../../core/net/places';
import { loadLookup, lookupStatement } from '../../core/storage/lookups';

// The Locations tile's address search (3.4): only when the person presses Search (never as they type). A search made
// before in this project is read from its cache (`lookups`), with when it was fetched; Search again asks the network
// and replaces it. What's found is offered, never applied: picking a place is the edit (locationEdits.ts).

export interface Found {
  places: Place[];
  /** ISO time the answer came from the network. */
  fetchedAt: string;
  /** Read from the project's cache, not just fetched. */
  saved: boolean;
}

export async function findPlaces(query: string, again: boolean): Promise<Found> {
  const language = getLocale();
  const key = searchKey(query, language);
  const file = projectStore.getState().project?.file;
  if (!again && file) {
    // A cache that can't be read is no cache: the search goes to the network.
    const cached = await loadLookup(file, 'address_search', key).catch(() => null);
    const places = cached ? placesFrom(cached.result) : null;
    if (cached && places) return { places, fetchedAt: cached.fetchedAt, saved: true };
  }
  const places = await searchOnline(query);
  const fetchedAt = new Date().toISOString();
  // Kept for the project it was asked in: one opened while the search was out isn't written to (writeAside checks only
  // from here on), and the answer is still shown, just not cached. Not waited for: the answer shows at once, behind
  // no queued edit, and a write that fails costs only the cache.
  if (file && projectStore.getState().project?.file === file) void projectStore.getState().writeAside([lookupStatement('address_search', key, query.trim().replace(/\s+/g, ' '), placesJson(places), fetchedAt)]);
  return { places, fetchedAt, saved: false };
}

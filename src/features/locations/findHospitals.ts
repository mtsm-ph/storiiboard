import { searchHospitalsOnline } from '../../app/hospitalSearch';
import { projectStore } from '../../app/projectStore';
import { getLocale } from '../../core/i18n';
import { hospitalKey, hospitalsFrom, hospitalsJson, rankHospitals, type Hospital } from '../../core/net/hospitals';
import type { Place } from '../../core/net/places';
import { loadLookup, lookupStatement } from '../../core/storage/lookups';

// The Locations tile's nearest-hospital search (4.5): only when the person presses Find nearest hospital. One made
// before for this place (to 3 decimals) is read from the project's cache with when it was fetched; Find again asks the
// network and replaces it. What's found is offered, never applied: picking one is the edit (locationEdits.ts).

export interface FoundNearby {
  hospitals: Hospital[];
  /** ISO time the answer came from the network. */
  fetchedAt: string;
  /** Read from the project's cache, not just fetched. */
  saved: boolean;
}

export async function findHospitals(place: Pick<Place, 'latitude' | 'longitude'>, again: boolean): Promise<FoundNearby> {
  const key = hospitalKey(place, getLocale());
  const file = projectStore.getState().project?.file;
  if (!again && file) {
    // A cache that can't be read is no cache: the search goes to the network.
    const cached = await loadLookup(file, 'hospital_search', key).catch(() => null);
    const found = cached ? hospitalsFrom(cached.result) : null;
    if (cached && found) return { hospitals: rankHospitals(found, place), fetchedAt: cached.fetchedAt, saved: true };
  }
  const hospitals = rankHospitals(await searchHospitalsOnline(place), place);
  const fetchedAt = new Date().toISOString();
  // Kept for the project it was asked in, and not waited for, as the address search's answer is.
  if (file && projectStore.getState().project?.file === file) void projectStore.getState().writeAside([lookupStatement('hospital_search', key, key, hospitalsJson(hospitals), fetchedAt)]);
  return { hospitals, fetchedAt, saved: false };
}

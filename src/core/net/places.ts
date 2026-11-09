import type { JsonValue } from '../model/record';

// The address search's answers (3.4): places as the desktop's Rust side finds them on Nominatim (src-tauri/src/
// geocode.rs), cached in the project as these same objects. Read back, every one is checked again: a cache written by
// another version, or a file someone edited, never puts a place off the Earth on a location.

export interface Place {
  /** Its name as the map service writes it ("Plaza de Armas, Cusco, Peru"). */
  name: string;
  latitude: number;
  longitude: number;
}

const isCoordinate = (value: unknown, range: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= range;

/** A place, or null for anything that isn't one. */
export function placeFrom(value: unknown): Place | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, latitude, longitude } = value as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '' || !isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return null;
  return { name, latitude, longitude };
}

/** The places in an answer, leaving out what isn't one; null when it isn't a list at all. */
export function placesFrom(value: unknown): Place[] | null {
  return Array.isArray(value) ? value.flatMap((entry) => placeFrom(entry) ?? []) : null;
}

export const placesJson = (places: readonly Place[]): JsonValue => places.map(({ name, latitude, longitude }) => ({ name, latitude, longitude }));

/**
 * What a search is cached under: the words run together and in one case, and the language the names came in, since
 * Nominatim names places in the language asked for.
 */
export function searchKey(query: string, language: string): string {
  return `${language}|${query.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** "-13.51677, -71.97878": five places, about a metre, as a coordinate is written on a call sheet. */
export const coordinatesLabel = (place: Pick<Place, 'latitude' | 'longitude'>): string => `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;

/** A coordinate as geocode.rs reads one: a number, or text that is one; anything else (empty, null) is none. */
function coordinate(value: unknown): number {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : Number.NaN;
}

/**
 * Nominatim's own answer read as places, as geocode.rs reads it: for the recorded answers that stand in for the
 * network in development builds and tests.
 */
export function nominatimPlaces(answer: unknown): Place[] {
  if (!Array.isArray(answer)) return [];
  return answer
    .flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { display_name: name, lat, lon } = entry as Record<string, unknown>;
      const place = placeFrom({ name: typeof name === 'string' ? name.trim() : name, latitude: coordinate(lat), longitude: coordinate(lon) });
      return place ? [place] : [];
    })
    .slice(0, 5);
}

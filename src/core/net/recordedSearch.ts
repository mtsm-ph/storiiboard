import { nominatimPlaces, type Place } from './places';
import cusco from './recorded/nominatim-plaza-de-armas-cusco.json';

// Development builds only (loaded behind import.meta.env.DEV, so a release never carries it): the address search in a
// browser, where there's no Rust side to ask, answers from a recorded Nominatim answer (fetched once, Nov 9, 2026).
// The end-to-end tests search through it, so no test ever asks the real service. "Plaza de Armas" finds five places;
// "offline" fails as an unreachable service does; anything else finds nothing.

// Word for word the Rust side's (net.rs), so it reads as the same error.key in every language.
export const NO_CONNECTION = "Storiiboard couldn't reach the service. Check the connection and try again.";

export function recordedPlaces(query: string): Promise<Place[]> {
  const words = query.trim().toLowerCase();
  if (words === 'offline') return Promise.reject(new Error(NO_CONNECTION));
  return Promise.resolve(words.includes('plaza de armas') ? nominatimPlaces(cusco) : []);
}

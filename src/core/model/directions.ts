import type { Place } from '../net/places';
import type { DirectionsApp } from '../storage/settings';
import { mapLink, type LocationFields } from './location';

// The directions link of a location (4.6, docs/PHASE4_DECISIONS.md decision 4): the link the call sheet prints under
// its address and puts in the QR code, and what "Copy map link" copies. It opens the app Settings → App names (Google
// Maps by default). Built from the place picked on the map when there is one, else from the address. It's a link only:
// the app never contacts Google or Apple, the person who scans or taps it does.

export type { DirectionsApp };
export const DIRECTIONS_APPS: readonly DirectionsApp[] = ['google', 'apple', 'osm'];

/** What the address search gives, cut to six decimals (about 10 cm), as the sheet prints its coordinates too. */
export const coordinates = (place: Pick<Place, 'latitude' | 'longitude'>): string => `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;

/** The link to drive to a location in `app`, or null when it has neither a place nor an address (nor a name). */
export function directionsLink(app: DirectionsApp, fields: Pick<LocationFields, 'address' | 'name'>, place: Place | null): string | null {
  if (place) {
    const to = coordinates(place);
    if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${to}`;
    if (app === 'apple') return `https://maps.apple.com/?daddr=${to}`;
    return `https://www.openstreetmap.org/directions?to=${to}`;
  }
  // The address, else the name, as the map link does; spaces run together are one.
  const query = (fields.address.trim() || fields.name.trim()).replace(/\s+/g, ' ');
  if (query === '') return null;
  if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
  if (app === 'apple') return `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`;
  return mapLink(fields, null);
}

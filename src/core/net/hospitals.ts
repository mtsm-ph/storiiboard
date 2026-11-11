import type { JsonValue } from '../model/record';
import type { WeatherUnits } from './weather';
import { t, getLocale } from '../i18n';
import type { Place } from './places';

// The nearest-hospital search's answers (4.5): hospitals as the desktop's Rust side reads them from Nominatim
// (src-tauri/src/hospital.rs), ranked here (emergency department first, then the straight line from the place) and
// cached in the project. Read back, every one is checked again, like the address search's places.

export interface Hospital {
  name: string;
  /** The first parts of Nominatim's `display_name`, after the name. */
  address: string;
  latitude: number;
  longitude: number;
  /** Straight-line distance from the place searched around, in km. */
  distanceKm: number;
  /** OpenStreetMap says it has an emergency department. False is unknown, never "none". */
  emergency: boolean;
  phone: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string | null;
}

/** A hospital before it is ranked: no distance yet. */
export type FoundHospital = Omit<Hospital, 'distanceKm'>;

/** The most a search lists. */
export const MAX_HOSPITALS = 5;

const isCoordinate = (value: unknown, range: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= range;
const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** A hospital, or null for anything that isn't one. */
export function hospitalFrom(value: unknown): FoundHospital | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  // An unnamed hospital (OpenStreetMap has them) is worded "Hospital", in the app's language.
  const name = nonEmpty(v.name) ?? (typeof v.name === 'string' ? t('hospital.unnamed') : null);
  if (name === null || !isCoordinate(v.latitude, 90) || !isCoordinate(v.longitude, 180)) return null;
  const code = typeof v.countryCode === 'string' && /^[A-Za-z]{2}$/.test(v.countryCode) ? v.countryCode.toUpperCase() : null;
  return {
    name,
    address: typeof v.address === 'string' ? v.address : '',
    latitude: v.latitude,
    longitude: v.longitude,
    emergency: v.emergency === true,
    phone: nonEmpty(v.phone),
    countryCode: code,
  };
}

/** The hospitals in an answer, leaving out what isn't one; null when it isn't a list at all. */
export function hospitalsFrom(value: unknown): FoundHospital[] | null {
  return Array.isArray(value) ? value.flatMap((entry) => hospitalFrom(entry) ?? []) : null;
}

/** Great-circle distance between two points, in km. */
export function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** At most five: those with an emergency department first, then the nearest, each with its distance from `from`. */
export function rankHospitals(found: readonly FoundHospital[], from: Pick<Place, 'latitude' | 'longitude'>): Hospital[] {
  return found
    .map((h): Hospital => ({ ...h, distanceKm: haversineKm(from, h) }))
    .sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.distanceKm - b.distanceKm)
    .slice(0, MAX_HOSPITALS);
}

export const hospitalsJson = (hospitals: readonly Hospital[]): JsonValue =>
  hospitals.map((h) => ({ name: h.name, address: h.address, latitude: h.latitude, longitude: h.longitude, distanceKm: h.distanceKm, emergency: h.emergency, phone: h.phone, countryCode: h.countryCode }));

/** What a search is cached under: the place rounded to 3 decimals (about 100 m) and the language the names came in. */
export function hospitalKey(place: Pick<Place, 'latitude' | 'longitude'>, language: string): string {
  return `${language}|${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

/** A coordinate as hospital.rs reads one: a number, or text that is one. */
function coordinate(value: unknown): number {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : Number.NaN;
}

/** Countries that write the house number before the road ("845 Main Street"); elsewhere it follows ("Calle Real 845"). */
const NUMBER_FIRST = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'PH', 'IN', 'FR', 'LU', 'SG', 'MY', 'HK', 'ZA']);

/** The street and town from an entry's address details, as hospital.rs writes them; '' when it has no street or town. */
function detailedAddress(details: unknown): string {
  if (typeof details !== 'object' || details === null) return '';
  const d = details as Record<string, unknown>;
  const road = nonEmpty(d.road);
  const number = nonEmpty(d.house_number);
  const first = NUMBER_FIRST.has((nonEmpty(d.country_code) ?? '').toUpperCase());
  const street = road === null ? null : number === null ? road : first ? `${number} ${road}` : `${road} ${number}`;
  const town = ['city', 'town', 'village', 'municipality', 'suburb', 'hamlet'].reduce<string | null>((found, key) => found ?? nonEmpty(d[key]), null);
  // A postcode alone is no address: the caller falls back to display_name.
  if (street === null && town === null) return '';
  return [street, town, nonEmpty(d.postcode)].filter((p): p is string => p !== null).join(', ');
}

/**
 * Nominatim's own answer read as hospitals, as hospital.rs reads it: for the recorded answer that stands in for the
 * network in development builds and tests. Only amenity=hospital counts (jsonv2 `category` and `type`): the search also
 * finds a bus stop or a vet with "hospital" in its name.
 */
export function nominatimHospitals(answer: unknown): FoundHospital[] {
  if (!Array.isArray(answer)) return [];
  return answer.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (e.category !== 'amenity' || e.type !== 'hospital') return [];
    const display = typeof e.display_name === 'string' ? e.display_name.trim() : '';
    const parts = display.split(', ');
    const name = nonEmpty(e.name) ?? '';
    const address = detailedAddress(e.address) || parts.slice(parts[0] === name ? 1 : 0, (parts[0] === name ? 1 : 0) + 3).join(', ');
    const tags = (typeof e.extratags === 'object' && e.extratags !== null ? e.extratags : {}) as Record<string, unknown>;
    const country = (typeof e.address === 'object' && e.address !== null ? (e.address as Record<string, unknown>).country_code : null) ?? null;
    const found = hospitalFrom({
      name,
      address,
      latitude: coordinate(e.lat),
      longitude: coordinate(e.lon),
      emergency: nonEmpty(tags.emergency) === 'yes',
      phone: nonEmpty(tags.phone) ?? nonEmpty(tags['contact:phone']),
      countryCode: country,
    });
    return found ? [found] : [];
  });
}

/** "1.2 km" or "0.7 mi", one decimal, in the app's language. */
export function distanceText(km: number, units: WeatherUnits): string {
  const value = units === 'us' ? km / 1.609344 : km;
  const shown = value.toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  return t(units === 'us' ? 'hospital.miles' : 'hospital.kilometres', { value: shown });
}

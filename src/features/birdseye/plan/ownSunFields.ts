import { formatCoordinates, parseCoordinates, type Coordinates, type CoordinatesRefusal } from '../../../core/model/coordinates';
import { isDayDate } from '../../../core/model/shootDay';

// What leaving a sun path's own place or own date field does (6.5.5 review), pure so it can be tested without a page.
// The place: values are compared, not text. The field shows a pasted place in its short form, so Enter then leaving it
// (two commits of what is now that short text) writes once and keeps every decimal pasted. The date: an incomplete date
// (the date field reads '' with `badInput`) changes nothing and never clears a stored one; only an emptied field clears.

export type PlaceCommit = { kind: 'none' } | { kind: 'clear' } | { kind: 'set'; place: Coordinates } | { kind: 'refused'; reason: CoordinatesRefusal };

const same = (a: Coordinates | null, b: Coordinates | null): boolean => a !== null && b !== null && a.latitude === b.latitude && a.longitude === b.longitude;

/**
 * The own place's commit. `stored`: the place in the file, or null. `shown`: the last place this field showed or wrote
 * (its full value), which its short text stands for, or null.
 */
export function ownPlaceCommit(typed: string, stored: Coordinates | null, shown: Coordinates | null): PlaceCommit {
  const text = typed.trim();
  if (text === '') return stored === null ? { kind: 'none' } : { kind: 'clear' };
  // The short form of what the field already holds stands for that place, every decimal of it.
  const known = [shown, stored].find((p): p is Coordinates => p !== null && formatCoordinates(p) === text) ?? null;
  const read = known ? { ok: true as const, ...known } : parseCoordinates(text);
  if (!read.ok) return { kind: 'refused', reason: read.reason };
  const place = { latitude: read.latitude, longitude: read.longitude };
  return same(place, stored) || same(place, shown) ? { kind: 'none' } : { kind: 'set', place };
}

export type DateCommit = { kind: 'none' } | { kind: 'clear' } | { kind: 'set'; date: string } | { kind: 'refused' };

/** The own date's commit: `badInput` is the field's own word that what's in it isn't a whole date yet. */
export function ownDateCommit(value: string, badInput: boolean, stored: string | null): DateCommit {
  const text = value.trim();
  if (badInput) return { kind: 'none' };
  if (text === '') return stored === null ? { kind: 'none' } : { kind: 'clear' };
  if (!isDayDate(text)) return { kind: 'refused' };
  return text === stored ? { kind: 'none' } : { kind: 'set', date: text };
}

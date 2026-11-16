// A place's coordinates as a person types or pastes them (6.5.5, Kevin Nov 16): a sun path's own place and a location's
// place on the map, with no address search and nothing requested. Pure. Read: decimal degrees as Google Maps copies
// them ("40.8677, -73.9212", with or without the space, or a space for the comma), with the hemisphere's letter before
// or after ("40.8677° N, 73.9212° W", "N 40.8677 W 73.9212"), and degrees, minutes and seconds as Google Maps shows them
// (40°52'03.7"N 73°55'16.3"W). Latitude first unless the letters say otherwise. A decimal comma is refused, never
// guessed: "40,8677" could as well be two numbers. Written back as "40.8677, -73.9212", four places (about 10 m); the
// file keeps every place read.

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Why a text isn't a place, in the words the UI says (coordinates.refused.*). */
export type CoordinatesRefusal = 'empty' | 'unreadable' | 'decimalComma' | 'latitude' | 'longitude';

export type ParsedCoordinates = ({ ok: true } & Coordinates) | { ok: false; reason: CoordinatesRefusal };

/** One coordinate's number: degrees (signed when it has no letter), then optional minutes and seconds. */
const NUMBER = String.raw`([-+]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"\s*)?)?`;
/**
 * Two of them with their letters after (or none), a comma (spaces either side or none) or spaces between; or with their
 * letters before. Two patterns, not one with a letter on either side: one pattern could read "N 40 W 73" as 40 with N
 * before it and W after it.
 */
// O is west in Spanish (oeste), as the Spanish help says.
const LETTERS_AFTER = new RegExp(String.raw`^${NUMBER}([NSEWO])?\s*(?:,\s*|\s+)${NUMBER}([NSEWO])?$`, 'i');
const LETTERS_BEFORE = new RegExp(String.raw`^([NSEWO])\s*${NUMBER}\s*,?\s*([NSEWO])\s*${NUMBER}$`, 'i');

/** The two coordinates' parts as read, letter before, degrees, minutes, seconds, letter after; null for neither pattern. */
function pairOf(typed: string): [Parts, Parts] | null {
  const after = LETTERS_AFTER.exec(typed);
  if (after) return [[undefined, after[1] ?? '', after[2], after[3], after[4]], [undefined, after[5] ?? '', after[6], after[7], after[8]]];
  const before = LETTERS_BEFORE.exec(typed);
  if (before) return [[before[1], before[2] ?? '', before[3], before[4], undefined], [before[5], before[6] ?? '', before[7], before[8], undefined]];
  return null;
}

type Parts = [string | undefined, string, string | undefined, string | undefined, string | undefined];

interface Read {
  value: number;
  /** The hemisphere's letter, upper case, or '' for none. */
  letter: string;
}

/**
 * The marks other programs and keyboards use, as the ones read here: the true minus sign, the prime and double prime,
 * curly quotes (a word processor's), and the ordinal º and the ring above ˚ (U+02DA) some keyboards give for °.
 */
function plain(text: string): string {
  return text
    .trim()
    .replace(/[−‒–]/g, '-')
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]|''/g, '"')
    .replace(/[º˚]/g, '°');
}

/** One coordinate's parts read as degrees; null for one that can't be (letters that disagree, minutes of 60 or more). */
function readOne(before: string | undefined, degrees: string, minutes: string | undefined, seconds: string | undefined, after: string | undefined): Read | null {
  const west = (l: string | undefined) => (l === undefined ? undefined : l.toUpperCase() === 'O' ? 'W' : l.toUpperCase());
  if (before && after && west(before) !== west(after)) return null;
  const letter = west(before) ?? west(after) ?? '';
  const signed = /^[-+]/.test(degrees);
  // A sign and a letter both say which side: refused rather than guessed which wins.
  if (signed && letter !== '') return null;
  const whole = Number(degrees);
  if (minutes !== undefined) {
    // Degrees, minutes and seconds: whole degrees, minutes and seconds under 60.
    const m = Number(minutes);
    const s = seconds === undefined ? 0 : Number(seconds);
    if (!/^[-+]?\d+$/.test(degrees) || m >= 60 || s >= 60) return null;
    const size = Math.abs(whole) + m / 60 + s / 3600;
    return { value: degrees.startsWith('-') ? -size : size, letter };
  }
  return { value: whole, letter };
}

const southOrWest = (read: Read): number => (read.letter === 'S' || read.letter === 'W' ? -read.value : read.value);
const isLatitudeLetter = (letter: string) => letter === 'N' || letter === 'S';
const isLongitudeLetter = (letter: string) => letter === 'E' || letter === 'W';

/** A place from what was typed or pasted, or why it isn't one. */
export function parseCoordinates(text: string): ParsedCoordinates {
  const typed = plain(text);
  if (typed === '') return { ok: false, reason: 'empty' };
  const pair = pairOf(typed);
  const first = pair ? readOne(...pair[0]) : null;
  const second = pair ? readOne(...pair[1]) : null;
  if (!first || !second) return { ok: false, reason: /\d,\d/.test(typed) ? 'decimalComma' : 'unreadable' };
  // Which is which: latitude first, unless the letters say the first is the longitude.
  let latitude = first;
  let longitude = second;
  if (isLongitudeLetter(first.letter) || isLatitudeLetter(second.letter)) {
    latitude = second;
    longitude = first;
  }
  if (isLongitudeLetter(latitude.letter) || isLatitudeLetter(longitude.letter)) return { ok: false, reason: 'unreadable' };
  const lat = southOrWest(latitude);
  const lon = southOrWest(longitude);
  // "40,8677" reads as two numbers, one off the Earth: most likely a decimal comma, said so.
  const decimalComma = /\d,\d/.test(typed);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return { ok: false, reason: decimalComma ? 'decimalComma' : 'latitude' };
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return { ok: false, reason: decimalComma ? 'decimalComma' : 'longitude' };
  // −0 reads as 0, so a place on the equator or the meridian writes back without a sign.
  return { ok: true, latitude: lat === 0 ? 0 : lat, longitude: lon === 0 ? 0 : lon };
}

/** Four places, never "-0.0000". */
const four = (value: number): string => {
  const text = value.toFixed(4);
  return /^-0\.0+$/.test(text) ? text.slice(1) : text;
};

/** "40.8677, -73.9212": how a place is shown and offered back to copy (the file keeps every place). */
export const formatCoordinates = (place: Coordinates): string => `${four(place.latitude)}, ${four(place.longitude)}`;

import { describe, expect, it } from 'vitest';
import { formatCoordinates, parseCoordinates } from './coordinates';

// Coordinates typed or pasted (6.5.5): every form Google Maps and people write, the bounds, the refusals with their
// reason, and the round trip through the form shown.

const place = (text: string) => {
  const read = parseCoordinates(text);
  if (!read.ok) throw new Error(`refused ${text}: ${read.reason}`);
  return { latitude: read.latitude, longitude: read.longitude };
};
const close = (text: string, latitude: number, longitude: number) => {
  const read = place(text);
  expect(read.latitude, text).toBeCloseTo(latitude, 4);
  expect(read.longitude, text).toBeCloseTo(longitude, 4);
};
const refusal = (text: string) => {
  const read = parseCoordinates(text);
  return read.ok ? null : read.reason;
};

describe('coordinates as text (6.5.5)', () => {
  it('reads decimal degrees as Google Maps copies them, with or without the space, or a space for the comma', () => {
    expect(place('40.8677, -73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('40.8677,-73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('40.8677 -73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('  40.8677 ,  -73.9212  ')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('-13.51677,-71.97878')).toEqual({ latitude: -13.51677, longitude: -71.97878 });
    expect(place('40.8677,73.9212')).toEqual({ latitude: 40.8677, longitude: 73.9212 });
    expect(place('+40.8677, +73.9212')).toEqual({ latitude: 40.8677, longitude: 73.9212 });
    // Every decimal pasted is kept.
    expect(place('40.867712345, -73.921234567')).toEqual({ latitude: 40.867712345, longitude: -73.921234567 });
    // The true minus sign some sites write.
    expect(place('40.8677, −73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
  });

  it('reads the hemisphere’s letter after or before, and puts latitude and longitude where the letters say', () => {
    expect(place('40.8677° N, 73.9212° W')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('40.8677°N 73.9212°W')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('N 40.8677 W 73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('N40.8677, W73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('33.8688 S, 151.2093 E')).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(place('s 33.8688 e 151.2093')).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    // Longitude first, said by its letter.
    expect(place('73.9212 W, 40.8677 N')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
  });

  it('reads O as west, as the Spanish help says, and the ring-above sign ˚ for degrees', () => {
    expect(place('40.8677 N, 73.9212 O')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('N 40.8677 O 73.9212')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('40.8677 n, 73.9212 o')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    expect(place('73.9212 O, 40.8677 N')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    close(`40°52'03.7"N 73°55'16.3"O`, 40.86769, -73.92119);
    expect(place('40.8677˚ N, 73.9212˚ W')).toEqual({ latitude: 40.8677, longitude: -73.9212 });
    close(`40˚52'03.7"N 73˚55'16.3"W`, 40.86769, -73.92119);
    // O is a longitude's letter: with W or E it makes two longitudes.
    expect(refusal('40 O, 73 W')).toBe('unreadable');
    expect(refusal('40 O, 73 E')).toBe('unreadable');
  });

  it('reads degrees, minutes and seconds as Google Maps shows them', () => {
    close(`40°52'03.7"N 73°55'16.3"W`, 40 + 52 / 60 + 3.7 / 3600, -(73 + 55 / 60 + 16.3 / 3600));
    // With the typographic prime and double prime, and a space between the parts.
    close('40° 52′ 03.7″ N, 73° 55′ 16.3″ W', 40.86769, -73.92119);
    // Degrees and minutes only.
    close(`40°52'N 73°55'W`, 40 + 52 / 60, -(73 + 55 / 60));
    close(`N 40°52'03.7" W 73°55'16.3"`, 40.86769, -73.92119);
    close(`33°52'07.7"S 151°12'33.5"E`, -(33 + 52 / 60 + 7.7 / 3600), 151 + 12 / 60 + 33.5 / 3600);
  });

  it('keeps latitude within −90 to 90 and longitude within −180 to 180, the ends included', () => {
    expect(place('90, 180')).toEqual({ latitude: 90, longitude: 180 });
    expect(place('-90, -180')).toEqual({ latitude: -90, longitude: -180 });
    expect(place('0, 0')).toEqual({ latitude: 0, longitude: 0 });
    expect(refusal('90.0001, 0')).toBe('latitude');
    expect(refusal('-91, 0')).toBe('latitude');
    expect(refusal('95° N, 10° E')).toBe('latitude');
    expect(refusal('0, 180.5')).toBe('longitude');
    expect(refusal('0, -181')).toBe('longitude');
  });

  it('refuses what it can’t read, saying why: empty, a decimal comma, letters or parts that disagree', () => {
    expect(refusal('')).toBe('empty');
    expect(refusal('   ')).toBe('empty');
    expect(refusal('40,8677, -73,9212')).toBe('decimalComma');
    expect(refusal('40,8677 -73,9212')).toBe('decimalComma');
    expect(refusal('40,8677')).toBe('decimalComma');
    expect(refusal('Fort Tryon Park')).toBe('unreadable');
    expect(refusal('40.8677')).toBe('unreadable');
    expect(refusal('40.8677, -73.9212, 12')).toBe('unreadable');
    // Two latitudes, two longitudes, a letter that disagrees with itself or with a sign.
    expect(refusal('40 N, 73 S')).toBe('unreadable');
    expect(refusal('40 E, 73 W')).toBe('unreadable');
    expect(refusal('N 40 S, 73 W')).toBe('unreadable');
    expect(refusal('-40 N, 73 W')).toBe('unreadable');
    // Minutes or seconds of 60 or more, and minutes on decimal degrees.
    expect(refusal(`40°60'N 73°55'W`)).toBe('unreadable');
    expect(refusal(`40°52'60"N 73°55'W`)).toBe('unreadable');
    expect(refusal(`40.5°52'N 73°55'W`)).toBe('unreadable');
  });

  it('writes a place back as “40.8677, -73.9212”, four places, never “-0.0000”', () => {
    expect(formatCoordinates({ latitude: 40.867712, longitude: -73.921234 })).toBe('40.8677, -73.9212');
    expect(formatCoordinates({ latitude: -0.00001, longitude: 0.00004 })).toBe('0.0000, 0.0000');
    expect(formatCoordinates({ latitude: 90, longitude: -180 })).toBe('90.0000, -180.0000');
  });

  it('round-trips: what it writes reads back as the same place, to the places shown', () => {
    for (const p of [
      { latitude: 40.8677, longitude: -73.9212 },
      { latitude: -33.86882, longitude: 151.20929 },
      { latitude: 0, longitude: 0 },
      { latitude: 89.99994, longitude: -179.99996 },
      { latitude: -13.516772, longitude: -71.978781 },
    ]) {
      const back = place(formatCoordinates(p));
      expect(Math.abs(back.latitude - p.latitude)).toBeLessThanOrEqual(0.00005);
      expect(Math.abs(back.longitude - p.longitude)).toBeLessThanOrEqual(0.00005);
      expect(formatCoordinates(back)).toBe(formatCoordinates(p));
    }
  });
});

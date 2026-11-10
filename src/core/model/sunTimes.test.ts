import { getPosition } from 'suncalc';
import { describe, expect, it } from 'vitest';
import { isTimeZone, noonIn, sunTimes, type SunDay, type SunRange } from './sunTimes';

// Known values: sunrise and sunset for these places and days, checked by hand against the solar position formulas
// (the equation of time, the declination, and the hour angle at -0.833 degrees), to the minute; SunCalc is within a
// minute or two of them, so the tests allow two. Golden and blue hours are checked against the angles themselves: the
// sun's height from SunCalc's getPosition at each boundary is +6, -4 or -6 degrees (to a tenth of a degree).

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const near = (actual: string, expected: string) => {
  expect(Math.abs(minutes(actual) - minutes(expected)), `${actual} against ${expected}`).toBeLessThanOrEqual(2);
};
const day = (value: SunDay | null): SunDay => {
  if (!value) throw new Error('no sun');
  return value;
};
const range = (value: SunRange | null): SunRange => {
  if (!value) throw new Error('no stretch');
  return value;
};

/** The sun's height at a clock time on `date` (+1 day for a next-day time), on a day without a clock change. */
function heightAt(date: string, zone: string, lat: number, lon: number, minute: number): number {
  const noon = noonIn(date, zone);
  if (!noon) throw new Error('no noon');
  return getPosition(new Date(noon.getTime() - 12 * 3600000 + minute * 60000), lat, lon).altitude;
}
// getPosition gives the apparent height (refraction added, SunCalc's Meeus 16.4 formula, flat below the horizon) while
// getTimes' angles are the sun's true height, so the refraction at the angle is taken off before comparing. The times
// are rounded to the minute, so the sun must pass the angle within a minute either side of the time shown.
const refraction = (angle: number) => {
  const h = (Math.max(angle, 0) * Math.PI) / 180;
  return (0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)) * 180) / Math.PI;
};
function isAt(angle: number, date: string, zone: string, lat: number, lon: number, time: string, next = false) {
  const minute = minutes(time) + (next ? 1440 : 0);
  const before = heightAt(date, zone, lat, lon, minute - 1) - refraction(angle);
  const after = heightAt(date, zone, lat, lon, minute + 1) - refraction(angle);
  expect(Math.min(before, after), `${time} for ${String(angle)}`).toBeLessThanOrEqual(angle + 0.01);
  expect(Math.max(before, after), `${time} for ${String(angle)}`).toBeGreaterThanOrEqual(angle - 0.01);
}

describe('sunTimes', () => {
  it('works out New York in summer and winter time, in the zone’s own clock', () => {
    const summer = day(sunTimes('2026-06-21', 40.7128, -74.006, 'America/New_York'));
    near(summer.sunrise, '05:25');
    near(summer.sunset, '20:31');
    const winter = day(sunTimes('2026-12-21', 40.7128, -74.006, 'America/New_York'));
    near(winter.sunrise, '07:16');
    near(winter.sunset, '16:32');
  });

  it('works out Madrid on a November day, and on a day the clocks change', () => {
    const sun = day(sunTimes('2026-11-16', 40.4168, -3.7038, 'Europe/Madrid'));
    near(sun.sunrise, '08:02');
    near(sun.sunset, '17:57');
    // 29 March 2026: clocks go forward at 02:00, so sunrise and sunset are in summer time (UTC+2).
    const change = day(sunTimes('2026-03-29', 40.4168, -3.7038, 'Europe/Madrid'));
    near(change.sunrise, '08:04');
    near(change.sunset, '20:36');
  });

  it('reads the right day east of the date line (noon in the zone, not noon UTC)', () => {
    // Auckland is UTC+12 in June: asked for noon UTC on the 21st it would be answering for the 22nd's morning.
    const sun = day(sunTimes('2026-06-21', -36.85, 174.76, 'Pacific/Auckland'));
    near(sun.sunrise, '07:34');
    near(sun.sunset, '17:12');
    // Noon on the 21st there is midnight UTC at the start of the 21st.
    expect(noonIn('2026-06-21', 'Pacific/Auckland')?.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(noonIn('2026-06-21', 'America/Los_Angeles')?.toISOString()).toBe('2026-06-21T19:00:00.000Z');
  });

  it('finds noon on the days the clocks change', () => {
    expect(noonIn('2026-03-29', 'Europe/Madrid')?.toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(noonIn('2026-10-25', 'Europe/Madrid')?.toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });

  it('puts golden and blue hour at the angles: +6, -4 and -6 degrees', () => {
    const cases = [
      ['2026-06-21', 40.7128, -74.006, 'America/New_York'],
      ['2026-12-21', 40.7128, -74.006, 'America/New_York'],
      ['2026-11-16', 40.4168, -3.7038, 'Europe/Madrid'],
      ['2026-06-21', -36.85, 174.76, 'Pacific/Auckland'],
    ] as const;
    for (const [date, lat, lon, zone] of cases) {
      const sun = day(sunTimes(date, lat, lon, zone));
      const gm = range(sun.golden.morning);
      const ge = range(sun.golden.evening);
      const bm = range(sun.blue.morning);
      const be = range(sun.blue.evening);
      isAt(-4, date, zone, lat, lon, gm.start);
      isAt(6, date, zone, lat, lon, gm.end);
      isAt(6, date, zone, lat, lon, ge.start);
      isAt(-4, date, zone, lat, lon, ge.end);
      isAt(-6, date, zone, lat, lon, bm.start);
      isAt(-4, date, zone, lat, lon, bm.end);
      isAt(-4, date, zone, lat, lon, be.start);
      isAt(-6, date, zone, lat, lon, be.end);
      // In clock order around the day.
      const order = [bm.start, bm.end, gm.end, ge.start, ge.end, be.end].map(minutes);
      expect(order, `${date} ${zone}`).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('says the sun is up all day in Tromsø in midsummer, with golden hour through the night', () => {
    const sun = day(sunTimes('2026-06-21', 69.65, 18.96, 'Europe/Oslo'));
    expect(sun.state).toBe('up');
    expect(sun.sunrise).toBe('');
    expect(sun.sunset).toBe('');
    // The sun's lowest point is about +3 degrees: it never gets below golden hour's -4, so the day begins and ends
    // inside the band: golden from midnight to the morning's +6, and from the evening's +6 to the next morning's.
    expect(sun.golden.morning).toMatchObject({ start: '00:00', endNext: false });
    expect(sun.golden.evening).toMatchObject({ startNext: false, endNext: true });
    expect(sun.golden.evening?.end).toBe(sun.golden.morning?.end);
    expect(sun.blue).toEqual({ allDay: false, morning: null, evening: null, whole: null });
  });

  it('says the sun is down all day in Tromsø at midwinter, with golden hour around midday as one stretch', () => {
    const sun = day(sunTimes('2026-12-21', 69.65, 18.96, 'Europe/Oslo'));
    expect(sun.state).toBe('down');
    expect(sun.sunrise).toBe('');
    // The sun peaks near -3 degrees: it never reaches +6, so golden hour is from -4 rising to -4 setting.
    const whole = range(sun.golden.whole);
    expect(sun.golden.morning).toBeNull();
    expect(sun.golden.evening).toBeNull();
    isAt(-4, '2026-12-21', 'Europe/Oslo', 69.65, 18.96, whole.start);
    isAt(-4, '2026-12-21', 'Europe/Oslo', 69.65, 18.96, whole.end);
    // Blue hour on either side of it.
    expect(range(sun.blue.morning).end).toBe(whole.start);
    expect(range(sun.blue.evening).start).toBe(whole.end);
  });

  it('keeps the stretches at Reykjavík, where the sun gets near the band’s edges', () => {
    const [lat, lon, zone] = [64.147, -21.94, 'Atlantic/Reykjavik'] as const;
    const summer = day(sunTimes('2026-06-21', lat, lon, zone));
    // Sunset just after midnight is on the next day.
    expect(summer.state).toBe('normal');
    expect(summer.sunsetNext).toBe(true);
    expect(summer.sunset).toBe('00:04');
    // The lowest sun is about -2.4 degrees, so it never gets to -4: golden hour runs through the night.
    expect(summer.golden.morning).toMatchObject({ start: '00:00' });
    expect(summer.golden.evening).toMatchObject({ endNext: true });
    expect(summer.blue).toEqual({ allDay: false, morning: null, evening: null, whole: null });
    const winter = day(sunTimes('2026-12-21', lat, lon, zone));
    // The highest sun is about +2.4 degrees: never +6, so golden hour is one stretch from -4 rising to -4 setting.
    const whole = range(winter.golden.whole);
    expect(winter.golden.morning).toBeNull();
    isAt(-4, '2026-12-21', zone, lat, lon, whole.start);
    isAt(-4, '2026-12-21', zone, lat, lon, whole.end);
    expect(winter.blue.morning).not.toBeNull();
  });

  it('keeps a blue hour that runs through a midsummer night near 61 N (Lillehammer)', () => {
    const [lat, lon, zone] = [61.11, 10.47, 'Europe/Oslo'] as const;
    const sun = day(sunTimes('2026-06-21', lat, lon, zone));
    expect(sun.state).toBe('normal');
    // The lowest sun is between -6 and -4: blue hour is the night itself, ending at the morning's -4 and starting again
    // at the evening's -4 (after midnight, so the next day), running to the next morning's.
    // The evening before's crossing fell at 00:02 on this clock, so the stretch starts then, not at midnight.
    expect(sun.blue.morning).toMatchObject({ start: '00:02', startPrev: false });
    const evening = range(sun.blue.evening);
    expect(evening).toMatchObject({ startNext: true, endNext: true });
    isAt(-4, '2026-06-21', zone, lat, lon, range(sun.blue.morning).end);
    isAt(-4, '2026-06-21', zone, lat, lon, evening.start, true);
    expect(sun.golden.evening).toMatchObject({ endNext: true });
  });

  it('starts a night’s blue hour when it began, even after midnight on the clock (Anchorage)', () => {
    const [lat, lon, zone] = [61.22, -149.9, 'America/Anchorage'] as const;
    const sun = day(sunTimes('2026-06-21', lat, lon, zone));
    // The lowest sun is about -5.3 degrees: blue hour began at the evening's -4 crossing, 00:46 on this clock, and
    // ends at the morning's, 03:16: it does not start at midnight.
    const morning = range(sun.blue.morning);
    near(morning.start, '00:46');
    near(morning.end, '03:16');
    expect(morning.startPrev).toBe(false);
    // The evening before ends golden hour at that same crossing (shown as the next day's).
    const before = day(sunTimes('2026-06-20', lat, lon, zone));
    expect(range(before.golden.evening)).toMatchObject({ endNext: true });
    near(range(before.golden.evening).end, morning.start);
  });

  it('marks a time on the day before, and picks the branch from the day’s own crossings', () => {
    // London's sun in Kiritimati's clock (UTC+14), whose noon is the night before in London: sunrise at 04:00 UTC
    // is 18:00 on the day before.
    const sun = day(sunTimes('2026-06-21', 51.5, 0, 'Pacific/Kiritimati'));
    expect(sun.sunrisePrev).toBe(true);
  });

  it('gives nothing for a date, a zone or a place it can’t read', () => {
    expect(sunTimes('soon', 40, -74, 'America/New_York')).toBeNull();
    // February 31st isn't a day (a Date would roll it on to March 3rd).
    expect(sunTimes('2026-02-31', 40, -74, 'America/New_York')).toBeNull();
    expect(sunTimes('2026-06-21', 40, -74, 'Mars/Olympus')).toBeNull();
    expect(sunTimes('2026-06-21', 91, -74, 'America/New_York')).toBeNull();
    expect(sunTimes('2026-06-21', Number.NaN, -74, 'America/New_York')).toBeNull();
  });

  it('knows which zone names are real', () => {
    expect(isTimeZone('America/New_York')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(5)).toBe(false);
  });
});

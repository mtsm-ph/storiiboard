import { describe, expect, it } from 'vitest';
import { planVector, sunAt, sunPath, sunPosition, trueAltitude } from './sunPath';
import { zoneClock } from './sunTimes';

// The sun over a plan (6.6) against published values, never a live service: the US Naval Observatory's Astronomical
// Applications Department (aa.usno.navy.mil, "Sun or Moon Altitude/Azimuth Table" and "Sun and Moon Data for One
// Day"), fetched Nov 14, 2026. USNO's altitudes are geometric (no refraction), so they are compared with the true
// height (`altitude`), within 0.3°; azimuths within 0.5°; rise and set within 2 minutes.

const NYC = { latitude: 40.7128, longitude: -74.006, zone: 'America/New_York' };
const LA = { latitude: 34.0522, longitude: -118.2437, zone: 'America/Los_Angeles' };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093, zone: 'Australia/Sydney' };

const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const withinMinutes = (got: string | undefined, want: string, by = 2) => {
  expect(got, `${String(got)} vs ${want}`).toMatch(/^\d\d:\d\d$/);
  expect(Math.abs(minutes(got ?? '') - minutes(want))).toBeLessThanOrEqual(by);
};

describe('sunAt, New York City, 21 June 2026 (UTC−4): USNO', () => {
  const cases = [
    { time: '09:00', altitude: 37.79, azimuth: 90.19 },
    { time: '13:00', altitude: 72.72, azimuth: 181.63 },
    { time: '17:00', altitude: 36.99, azimuth: 270.5 },
  ];
  for (const c of cases) {
    it(`at ${c.time}: altitude ${String(c.altitude)}°, azimuth ${String(c.azimuth)}°`, () => {
      const sun = sunAt('2026-06-21', c.time, NYC.latitude, NYC.longitude, NYC.zone);
      expect(sun).not.toBeNull();
      expect(Math.abs((sun?.altitude ?? 0) - c.altitude)).toBeLessThanOrEqual(0.3);
      expect(Math.abs((sun?.bearing ?? 0) - c.azimuth)).toBeLessThanOrEqual(0.5);
      expect(sun?.up).toBe(true);
      // The apparent height is a little higher: refraction lifts the sun.
      expect(sun?.apparent ?? 0).toBeGreaterThan(sun?.altitude ?? 0);
      // Built in the place's zone: 13:00 there is 17:00 UTC that day.
      expect(zoneClock(sun?.instant ?? new Date(NaN), NYC.zone)).toMatchObject({ date: '2026-06-21', hour: Number(c.time.slice(0, 2)), minute: 0 });
    });
  }

  it('crosses the south at its upper transit, 12:58 (to 2 minutes)', () => {
    const before = sunAt('2026-06-21', '12:56', NYC.latitude, NYC.longitude, NYC.zone);
    const after = sunAt('2026-06-21', '13:00', NYC.latitude, NYC.longitude, NYC.zone);
    expect(before?.bearing ?? 999).toBeLessThan(180);
    expect(after?.bearing ?? 0).toBeGreaterThan(180);
  });

  it('a time that can’t be read, or a place off the globe, is none', () => {
    expect(sunAt('2026-06-21', '25:00', NYC.latitude, NYC.longitude, NYC.zone)).toBeNull();
    expect(sunAt('2026-06-21', '13:00', 95, 0, NYC.zone)).toBeNull();
    expect(sunAt('2026-06-21', '13:00', NYC.latitude, NYC.longitude, 'Not/AZone')).toBeNull();
  });

  it('says the sun is down after sunset', () => {
    expect(sunAt('2026-06-21', '21:10', NYC.latitude, NYC.longitude, NYC.zone)?.up).toBe(false);
  });
});

describe('sunPath: rise and set as USNO publishes them', () => {
  it('New York, 21 June 2026: sunrise 05:25, sunset 20:31', () => {
    const path = sunPath('2026-06-21', NYC.latitude, NYC.longitude, NYC.zone);
    withinMinutes(path?.day.sunrise, '05:25');
    withinMinutes(path?.day.sunset, '20:31');
    withinMinutes(path?.rise?.time, '05:25');
    withinMinutes(path?.set?.time, '20:31');
    // The arc runs from the north east round the south to the north west.
    expect(path?.rise?.bearing ?? 0).toBeGreaterThan(50);
    expect(path?.rise?.bearing ?? 999).toBeLessThan(70);
    expect(path?.set?.bearing ?? 0).toBeGreaterThan(290);
    expect(path?.arc.length ?? 0).toBeGreaterThan(100);
  });

  it('New York, 21 December 2026 (UTC−5): sunrise 07:17, sunset 16:32', () => {
    const path = sunPath('2026-12-21', NYC.latitude, NYC.longitude, NYC.zone);
    withinMinutes(path?.day.sunrise, '07:17');
    withinMinutes(path?.day.sunset, '16:32');
  });

  it('Los Angeles, 20 March 2026 (UTC−7): sunrise 06:56, sunset 19:05', () => {
    const path = sunPath('2026-03-20', LA.latitude, LA.longitude, LA.zone);
    withinMinutes(path?.day.sunrise, '06:56');
    withinMinutes(path?.day.sunset, '19:05');
  });

  it('Sydney, 21 June 2026 (UTC+10): sunrise 07:00, sunset 16:54, and at noon the sun is in the north', () => {
    const path = sunPath('2026-06-21', SYDNEY.latitude, SYDNEY.longitude, SYDNEY.zone);
    withinMinutes(path?.day.sunrise, '07:00');
    withinMinutes(path?.day.sunset, '16:54');
    const noon = sunAt('2026-06-21', '12:00', SYDNEY.latitude, SYDNEY.longitude, SYDNEY.zone);
    const bearing = noon?.bearing ?? 180;
    expect(Math.min(bearing, 360 - bearing)).toBeLessThanOrEqual(5);
  });
});

describe('sunPath: the hours and golden hour', () => {
  it('marks every whole hour of the zone’s clock while the sun is up, at the place’s whole hours', () => {
    const path = sunPath('2026-06-21', NYC.latitude, NYC.longitude, NYC.zone);
    expect(path?.hours.map((h) => h.hour)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    for (const h of path?.hours ?? []) expect(h.time).toBe(`${String(h.hour).padStart(2, '0')}:00`);
  });

  it('stays on local whole hours on the day the clocks change (New York, 8 March 2026: 02:00 becomes 03:00)', () => {
    const path = sunPath('2026-03-08', NYC.latitude, NYC.longitude, NYC.zone);
    // Sunrise near 07:2x (EDT, just after the change), sunset near 19:00: the first mark is 08:00, then each hour on.
    const hours = path?.hours ?? [];
    expect(hours[0]?.hour).toBe(8);
    expect(hours.map((h) => h.hour)).toEqual(hours.map((_, i) => 8 + i));
    expect(hours.length).toBeGreaterThanOrEqual(11);
    for (const h of hours) expect(zoneClock(h.instant, NYC.zone)).toMatchObject({ date: '2026-03-08', hour: h.hour, minute: 0 });
    // An hour apart each, in real time too: the clock change is before sunrise.
    for (let i = 1; i < hours.length; i += 1) expect((hours[i]?.instant.getTime() ?? 0) - (hours[i - 1]?.instant.getTime() ?? 0)).toBe(3_600_000);
  });

  it('on the day the clocks go back (Sydney, 5 April 2026, 03:00 becomes 02:00), every mark is still a local whole hour', () => {
    const path = sunPath('2026-04-05', SYDNEY.latitude, SYDNEY.longitude, SYDNEY.zone);
    for (const h of path?.hours ?? []) expect(zoneClock(h.instant, SYDNEY.zone)).toMatchObject({ date: '2026-04-05', hour: h.hour, minute: 0 });
    expect(new Set(path?.hours.map((h) => h.hour)).size).toBe(path?.hours.length);
  });

  it('colours the arc golden from 6° above to 4° below the horizon, as call sheets do', () => {
    const path = sunPath('2026-06-21', NYC.latitude, NYC.longitude, NYC.zone);
    const arc = path?.arc ?? [];
    expect(arc[0]?.golden).toBe(true);
    expect(arc.at(-1)?.golden).toBe(true);
    for (const p of arc) expect(p.golden).toBe(p.altitude <= 6 && p.altitude >= -4);
    expect(arc.some((p) => !p.golden)).toBe(true);
  });

  it('a day the sun never rises has no arc and no hours', () => {
    const path = sunPath('2026-12-21', 78.22, 15.65, 'Arctic/Longyearbyen');
    expect(path?.day.state).toBe('down');
    expect(path?.arc).toEqual([]);
    expect(path?.hours).toEqual([]);
  });
});

describe('trueAltitude', () => {
  it('takes SunCalc’s refraction back off', () => {
    // Low in the morning (05:45 in New York), where refraction is a quarter of a degree.
    const at = new Date('2026-06-21T09:45:00Z');
    const p = sunPosition(at, NYC.latitude, NYC.longitude);
    expect(p.apparent - p.altitude).toBeGreaterThan(0.1);
    expect(trueAltitude(-10)).toBeLessThan(-10);
  });
});

describe('planVector', () => {
  it('turns a compass bearing onto the plan by the room’s north', () => {
    // North up the plan (0): a bearing of 0 points up (y down on the canvas), 90 (east) to the right.
    expect(planVector(0, 0)).toEqual({ x: 0, y: -1 });
    expect(planVector(90, 0)).toEqual({ x: 1, y: 0 });
    // North turned 90° (pointing right): the bearing 180 (south) is 90 + 180 = 270° clockwise from up the plan, so
    // x = sin 270° = −1, y = −cos 270° = 0: it points left.
    expect(planVector(180, 90)).toEqual({ x: -1, y: 0 });
    // And east (90) with north to the right is 180° from up: down the plan.
    expect(planVector(90, 90)).toEqual({ x: 0, y: 1 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Props, SbdRecord } from '../model/record';
import type { Forecast, ForecastEntry } from '../net/weather';
import { allChecks, allChecksMade, callSheetChecks, CHECK_KINDS, type CheckKind, type HeldForecasts } from '.';

// Every check over the whole project (7.4): each of the eight kinds found on a project built to trip it, nothing on a
// clean one, a day's findings the same as its call sheet strip's, what was skipped and why, the order and the ids, the
// forecasts read only as given (never fetched), and the result kept while nothing the checks read changes.

type Records = Record<string, SbdRecord>;

const at = '2030-11-01T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const withProps = (records: Records, id: string, props: Props): Records => {
  const old = records[id] as SbdRecord;
  return { ...records, [id]: { ...old, props: { ...old.props, ...props } } };
};
const without = (records: Records, id: string, prop: string): Records => {
  const old = records[id] as SbdRecord;
  return { ...records, [id]: { ...old, props: Object.fromEntries(Object.entries(old.props).filter(([key]) => key !== prop)) } };
};

const pier = { name: 'Harbor Pier', address: '1 Pier Road', contact_name: 'Robin Vale', parking: 'Lot A', map_name: 'Pier', latitude: 40.7128, longitude: -74.006, time_zone: 'America/New_York' };

/**
 * "Harbor Lights", clear: Day 1 on Nov 16, 2030 from 10:00 to 14:00 at the pier, everyone it needs on it, one interior
 * day scene with frame 1A needing only the FX3 the day's list has, and a camera on Setup 1's plan with no lens typed.
 */
const clean = (): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('pier', 'location', 'p', pier),
    record('d1', 'shoot_day', 'p', { date: '2030-11-16', call_time: '10:00', wrap_time: '14:00', people_ids: ['dir', 'robin', 'sam', 'hana', 'wen', 'lee'], gear_ids: ['fx3'] }),
    record('fx3', 'gear_item', 'p', { name: 'FX3 package' }),
    record('slider', 'gear_item', 'p', { name: 'Slider' }),
    record('s1', 'scene', 'p', { number: '1', int_ext: 'INT', day_night: 'DAY', location_id: 'pier' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('cam', 'plan_item', 'own', { kind: 'camera', icon: 'camera/camera', x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0, shot_ids: ['a'] }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd1', gear_ids: ['fx3'], setup_id: 'u1', lens_mm: 35 }),
    record('dir', 'person', 'p', { name: 'Dana Reyes', departments: ['direction'] }),
    record('robin', 'person', 'p', { name: 'Robin Vale', departments: ['camera'] }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', departments: ['sound'] }),
    record('hana', 'person', 'p', { name: 'Hana Ito', departments: ['hmu'] }),
    record('wen', 'person', 'p', { name: 'Wen Li', departments: ['wardrobe'] }),
    record('lee', 'person', 'p', { name: 'Lee Park', role: 'cast', departments: ['cast'] }),
  );

const hour = (h: number): string => `2030-11-16T${String(h).padStart(2, '0')}:00:00Z`;
const entry = (time: string, rain: number): ForecastEntry => ({ time, temperature: 8, wind: 3, rain1h: rain, rain6h: null, symbol1h: null, symbol6h: null });
/** Hourly over Nov 16 from 05:00Z: `rain` mm at 16:00Z (11:00 at the pier). */
const forecast = (rain: number): Forecast => ({ expires: '2030-11-16T00:00:00Z', lastModified: null, entries: Array.from({ length: 19 }, (_, i) => entry(hour(5 + i), 5 + i === 16 ? rain : 0)) });
const held = (f: Forecast): HeldForecasts => new Map([['pier', f]]);

/** The clean project with one mistake of each kind on Day 1. */
const tripped = (): Records => {
  let records = clean();
  // Robin is away that day; the frame needs the slider too; the scene is an exterior at dusk (rain is held for it);
  // a second scene is at a yard with no address or parking; Wen, wardrobe, isn't on the day; Lee's HMU is ready ten
  // minutes after the call; and the camera was planned at 50 mm while 1A is at 35.
  records = { ...records, away: record('away', 'availability', 'robin', { from: '2030-11-16', to: '2030-11-16', state: 'unavailable', note: '' }) };
  records = withProps(records, 'a', { gear_ids: ['fx3', 'slider'] });
  records = withProps(records, 's1', { int_ext: 'EXT', day_night: 'DUSK' });
  records = {
    ...records,
    yard: record('yard', 'location', 'p', { name: 'Boat Yard', contact_name: 'Sam Ortiz' }),
    s2: record('s2', 'scene', 'p', { number: '2', int_ext: 'INT', day_night: 'DAY', location_id: 'yard' }),
    b: record('b', 'shot', 's2', { number: '2A', status: 'need', shoot_day_id: 'd1' }),
  };
  records = withProps(records, 'd1', { people_ids: ['dir', 'robin', 'sam', 'hana', 'lee'] });
  records = { ...records, cs: record('cs', 'callsheet', 'd1', { person_times: { lee: { hmu_ready: '10:10' } } }) };
  records = withProps(records, 'cam', { lens_mm: 50 });
  return records;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every check over the project (7.4)', () => {
  it('finds nothing, and skips nothing, on a clean project', () => {
    expect(allChecks(clean(), 'p', { forecasts: held(forecast(0)) })).toEqual({ findings: [], skipped: [], oldForecasts: [] });
  });

  it('finds each of the eight kinds (CLAUDE.md’s seven checks, golden hour and rain apart) on a project built to trip each', () => {
    const { findings, skipped } = allChecks(tripped(), 'p', { forecasts: held(forecast(2)) });
    expect(findings.map((f) => f.kind)).toEqual([...CHECK_KINDS]);
    expect(CHECK_KINDS).toHaveLength(8);
    expect(skipped).toEqual([]);
    expect(new Set(findings.map((f) => `${f.severity}:${String(f.dayId)}`))).toEqual(new Set(['warning:d1']));
    const byKind = (kind: CheckKind) => findings.find((f) => f.kind === kind);
    expect(byKind('unavailable-on-day')).toMatchObject({ id: 'unavailable-on-day:d1:robin', target: { kind: 'sheet', dayId: 'd1' } });
    expect(byKind('gear-not-on-day')).toMatchObject({ id: 'gear-not-on-day:d1:a', finding: { gearIds: ['slider'] }, target: { kind: 'shot', shotId: 'a', sceneId: 's1' } });
    expect(byKind('golden-hour-midday')).toMatchObject({ id: 'golden-hour-midday:d1:s1', target: { kind: 'sheet', dayId: 'd1' } });
    expect(byKind('exterior-rain')).toMatchObject({ id: 'exterior-rain:d1:s1:pier', finding: { mm: 2 } });
    expect(byKind('location-missing')).toMatchObject({ id: 'location-missing:d1:yard', finding: { missing: ['address', 'parking'] }, target: { kind: 'location', locationId: 'yard' } });
    expect(byKind('department-missing')).toMatchObject({ id: 'department-missing:d1:wardrobe', finding: { reason: 'cast' } });
    expect(byKind('hmu-too-short')).toMatchObject({ id: 'hmu-too-short:d1:lee:short', finding: { gap: 10 } });
    expect(byKind('plan-lens-differs')).toMatchObject({
      id: 'plan-lens-differs:cam:a',
      finding: { frameMm: 35, cameraMm: 50 },
      target: { kind: 'plan', sceneId: 's1', setupId: 'u1', itemIds: ['cam'] },
    });
  });

  it('gives each day exactly its call sheet strip’s findings', () => {
    const records = tripped();
    const forecasts = held(forecast(2));
    const strip = callSheetChecks(records, 'p', 'd1', forecasts).findings;
    const sheetKinds = new Set<string>(strip.map((f) => f.kind));
    const mine = allChecks(records, 'p', { forecasts }).findings.filter((f) => f.dayId === 'd1' && sheetKinds.has(f.kind));
    const order = (kind: string) => CHECK_KINDS.indexOf(kind as CheckKind);
    expect(mine.map((f) => f.finding)).toEqual([...strip].sort((a, b) => order(a.kind) - order(b.kind)));
    // The same objects: nothing is worked out twice.
    expect(mine.every((f) => strip.includes(f.finding as (typeof strip)[number]))).toBe(true);
  });

  it('says what it skipped and why: no date, no zone, no forecast held, a forecast that doesn’t reach the day', () => {
    const outdoors = withProps(clean(), 's1', { int_ext: 'EXT', day_night: 'DUSK' });
    // No forecast held for the exterior.
    expect(allChecks(outdoors, 'p').skipped).toEqual([{ id: 'exterior-rain:no-forecast:d1:pier', kinds: ['exterior-rain'], reason: 'no-forecast', dayId: 'd1', locationId: 'pier' }]);
    // One held, but it ends before the day.
    const early: Forecast = { expires: '2030-11-01T00:00:00Z', lastModified: null, entries: [entry('2030-11-01T10:00:00Z', 0), entry('2030-11-01T11:00:00Z', 0)] };
    expect(allChecks(outdoors, 'p', { forecasts: held(early) }).skipped).toEqual([
      { id: 'exterior-rain:forecast-not-covering:d1:pier', kinds: ['exterior-rain'], reason: 'forecast-not-covering', dayId: 'd1', locationId: 'pier' },
    ]);
    // No zone: the place has none typed and none was looked up, so neither light nor rain can be read.
    const noZone = without(outdoors, 'pier', 'time_zone');
    expect(allChecks(noZone, 'p').skipped.map((s) => `${s.kinds.join()}:${s.reason}`)).toEqual(['golden-hour-midday:no-zone', 'exterior-rain:no-zone']);
    // Looked up, the zone is known again.
    expect(allChecks(noZone, 'p', { forecasts: held(forecast(0)), zones: new Map([['pier', 'America/New_York']]) }).skipped).toEqual([]);
    // A day with no date.
    const undated = { ...clean(), d2: record('d2', 'shoot_day', 'p', { call_time: '07:00' }) };
    expect(allChecks(undated, 'p').skipped).toEqual([{ id: 'no-date:d2', kinds: ['unavailable-on-day', 'golden-hour-midday', 'exterior-rain'], reason: 'no-date', dayId: 'd2', locationId: null }]);
  });

  it('sorts by day (by date, undated days after, no day last), then by check, with ids that stay the same from run to run', () => {
    const build = (): Records => {
      let records = tripped();
      // Day 0 on Nov 10 with a frame needing the slider; an undated day with one too; and a frame in no day the camera
      // shoots at another lens.
      records = {
        ...records,
        d0: record('d0', 'shoot_day', 'p', { date: '2030-11-10', call_time: '10:00', wrap_time: '14:00', people_ids: ['dir', 'robin'], gear_ids: [] }),
        dx: record('dx', 'shoot_day', 'p', { call_time: '10:00', people_ids: ['dir', 'robin'], gear_ids: [] }),
        c: record('c', 'shot', 's1', { number: '1B', status: 'need', shoot_day_id: 'd0', gear_ids: ['slider'] }),
        e: record('e', 'shot', 's1', { number: '1C', status: 'need', shoot_day_id: 'dx', gear_ids: ['fx3'] }),
        f: record('f', 'shot', 's1', { number: '1D', status: 'need', setup_id: 'u1', lens_mm: 85 }),
      };
      return withProps(records, 'cam', { shot_ids: ['a', 'f'] });
    };
    const forecasts = held(forecast(2));
    const first = allChecks(build(), 'p', { forecasts });
    const days = first.findings.map((f) => f.dayId);
    expect([...new Set(days)]).toEqual(['d0', 'd1', 'dx', null]);
    // 1B is in the dusk exterior too: its hours miss the light, and the forecast held (Nov 16's) doesn't reach Nov 10.
    expect(first.findings.filter((f) => f.dayId === 'd0').map((f) => f.kind)).toEqual(['gear-not-on-day', 'golden-hour-midday']);
    expect(first.skipped.map((s) => s.id)).toEqual(['exterior-rain:forecast-not-covering:d0:pier', 'no-date:dx']);
    expect(first.findings.filter((f) => f.dayId === 'dx').map((f) => f.kind)).toEqual(['gear-not-on-day']);
    expect(first.findings.filter((f) => f.dayId === null).map((f) => f.id)).toEqual(['plan-lens-differs:cam:f']);
    expect(first.findings.filter((f) => f.dayId === 'd1').map((f) => f.kind)).toEqual([...CHECK_KINDS]);
    // Built again from nothing, so every check runs anew: the same ids in the same order.
    const made = allChecksMade();
    const second = allChecks(build(), 'p', { forecasts });
    expect(allChecksMade() - made).toBe(1);
    expect(second.findings.map((f) => f.id)).toEqual(first.findings.map((f) => f.id));
    expect(new Set(first.findings.map((f) => f.id)).size).toBe(first.findings.length);
    expect(second.skipped.map((s) => s.id)).toEqual(first.skipped.map((s) => s.id));
  });

  it('reads only the forecasts it is given, and never asks the network', () => {
    const fetching = vi.spyOn(globalThis, 'fetch');
    const records = tripped();
    expect(allChecks(records, 'p').findings.some((f) => f.kind === 'exterior-rain')).toBe(false);
    expect(allChecks(records, 'p').skipped.map((s) => s.reason)).toEqual(['no-forecast']);
    expect(allChecks(records, 'p', { forecasts: held(forecast(2)) }).findings.some((f) => f.kind === 'exterior-rain')).toBe(true);
    expect(fetching).not.toHaveBeenCalled();
  });

  it('is kept while nothing the checks read changes, and run again when something does', () => {
    const records = tripped();
    const forecasts = held(forecast(2));
    const first = allChecks(records, 'p', { forecasts });
    let made = allChecksMade();
    // A stroke on a frame's sketch, a note, a board: a new records object, but nothing the checks read.
    const sketched = { ...records, k: record('k', 'stroke', 'a', { points: [0, 0, 1, 1] }), n: record('n', 'note', 's1', { text: 'Bring the long lens' }) };
    expect(allChecks(sketched, 'p', { forecasts })).toBe(first);
    // The same forecasts in another map (each tile builds its own) are the same.
    expect(allChecks(sketched, 'p', { forecasts: new Map(forecasts) })).toBe(first);
    expect(allChecksMade() - made).toBe(0);
    // A light that isn't gear turned on the plan: not read either.
    const lit = { ...sketched, lamp: record('lamp', 'plan_item', 'own', { kind: 'light', icon: 'lighting/fresnel', x: 1, y: 1, width: 0.4, height: 0.4, rotation: 0 }) };
    expect(allChecks(lit, 'p', { forecasts })).toBe(first);
    const turned = withProps(lit, 'lamp', { rotation: 5 });
    expect(allChecks(turned, 'p', { forecasts })).toBe(first);
    expect(allChecksMade() - made).toBe(0);
    // The slider put on the day's list: worked out again, and that finding is gone.
    made = allChecksMade();
    const fixed = withProps(turned, 'd1', { gear_ids: ['fx3', 'slider'] });
    const next = allChecks(fixed, 'p', { forecasts });
    expect(allChecksMade() - made).toBe(1);
    expect(next.findings.map((f) => f.kind)).not.toContain('gear-not-on-day');
    // A forecast that changes is read again.
    expect(allChecks(fixed, 'p', { forecasts: held(forecast(0)) }).findings.map((f) => f.kind)).not.toContain('exterior-rain');
  });
});

describe('every check over the project, round 2 (7.4)', () => {
  const outdoors = (): Records => withProps(clean(), 's1', { int_ext: 'EXT', day_night: 'DUSK' });

  it('reads an old forecast that covers the day, and says so with when it was fetched; one still fresh says nothing', () => {
    const fetchedAt = new Map([['pier', '2030-11-15T14:14:00Z']]);
    // Expired at midnight on Nov 16 (UTC); read at 08:00 that morning.
    const now = Date.parse('2030-11-16T08:00:00Z');
    const result = allChecks(outdoors(), 'p', { forecasts: held(forecast(2)), fetchedAt, now });
    expect(result.findings.map((f) => f.kind)).toContain('exterior-rain');
    expect(result.oldForecasts).toEqual([{ id: 'forecast-old:d1:pier', dayId: 'd1', locationId: 'pier', fetchedAt: '2030-11-15T14:14:00Z' }]);
    expect(result.skipped).toEqual([]);
    // Before its expiry, or with no `now`, nothing is said.
    expect(allChecks(outdoors(), 'p', { forecasts: held(forecast(2)), fetchedAt, now: Date.parse('2030-11-15T20:00:00Z') }).oldForecasts).toEqual([]);
    expect(allChecks(outdoors(), 'p', { forecasts: held(forecast(2)), fetchedAt }).oldForecasts).toEqual([]);
    // Read again later, the same: one result while what it says is the same.
    const again = allChecks(outdoors(), 'p', { forecasts: held(forecast(2)), fetchedAt, now: now + 60_000 });
    expect(again.oldForecasts).toEqual(result.oldForecasts);
  });

  it('a forecast that covers the date but not the working hours is a skip of its own', () => {
    // Hourly from 05:00Z to 16:00Z on Nov 16: the call at 10:00 in New York is 15:00Z, the wrap at 14:00 is 19:00Z.
    const short: Forecast = { expires: '2030-11-16T00:00:00Z', lastModified: null, entries: Array.from({ length: 11 }, (_, i) => entry(hour(5 + i), 0)) };
    expect(allChecks(outdoors(), 'p', { forecasts: held(short) }).skipped).toEqual([
      { id: 'exterior-rain:forecast-not-hours:d1:pier', kinds: ['exterior-rain'], reason: 'forecast-not-hours', dayId: 'd1', locationId: 'pier' },
    ]);
    // Rain found in the part it covers is a finding, and nothing is skipped.
    const wet: Forecast = { ...short, entries: short.entries.map((e, i) => (i === 10 ? { ...e, rain1h: 3 } : e)) };
    const found = allChecks(outdoors(), 'p', { forecasts: held(wet) });
    expect(found.findings.map((f) => f.kind)).toContain('exterior-rain');
    expect(found.skipped).toEqual([]);
  });

  it('a location with no place is “no place”, for the light and the rain, never “no forecast”', () => {
    const placeless = without(without(without(outdoors(), 'pier', 'latitude'), 'pier', 'longitude'), 'pier', 'map_name');
    expect(allChecks(placeless, 'p').skipped).toEqual([{ id: 'no-place:d1:pier', kinds: ['golden-hour-midday', 'exterior-rain'], reason: 'no-place', dayId: 'd1', locationId: 'pier' }]);
    // An interior at midday needs neither: nothing to say.
    expect(allChecks(without(without(without(clean(), 'pier', 'latitude'), 'pier', 'longitude'), 'pier', 'map_name'), 'p').skipped).toEqual([]);
  });

  it('runs no check when a camera or a gear light is moved or turned on a plan, and runs them when its gear or lens changes', () => {
    let records = tripped();
    records = { ...records, lamp: record('lamp', 'plan_item', 'own', { kind: 'light', icon: 'lighting/fresnel', x: 1, y: 1, width: 0.4, height: 0.4, rotation: 0, gear_id: 'slider' }) };
    const forecasts = held(forecast(2));
    const first = allChecks(records, 'p', { forecasts });
    let made = allChecksMade();
    const moved = withProps(withProps(records, 'lamp', { x: 3, y: 4, rotation: 45 }), 'cam', { x: 2, rotation: 90 });
    expect(allChecks(moved, 'p', { forecasts })).toBe(first);
    expect(allChecksMade() - made).toBe(0);
    // Its gear, or the camera's typed lens: read.
    made = allChecksMade();
    allChecks(withProps(moved, 'lamp', { gear_id: 'fx3' }), 'p', { forecasts });
    expect(allChecksMade() - made).toBe(1);
    made = allChecksMade();
    const relensed = allChecks(withProps(moved, 'cam', { lens_mm: 35 }), 'p', { forecasts });
    expect(allChecksMade() - made).toBe(1);
    expect(relensed.findings.map((f) => f.kind)).not.toContain('plan-lens-differs');
  });
});

describe('every check over the project, round 3 (7.4)', () => {
  const outdoors = (): Records => withProps(clean(), 's1', { int_ext: 'EXT', day_night: 'DUSK' });

  it('says an old forecast is old when it found rain in the hours it covers, though it misses the rest of them', () => {
    // Hourly from 05:00Z to 15:00Z on Nov 16, 3 mm at 15:00Z (the call at the pier): rain found, the wrap not covered.
    const short: Forecast = { expires: '2030-11-16T00:00:00Z', lastModified: null, entries: Array.from({ length: 11 }, (_, i) => entry(hour(5 + i), i === 10 ? 3 : 0)) };
    const fetchedAt = new Map([['pier', '2030-11-15T14:14:00Z']]);
    const result = allChecks(outdoors(), 'p', { forecasts: held(short), fetchedAt, now: Date.parse('2030-11-16T08:00:00Z') });
    expect(result.findings.map((f) => f.kind)).toContain('exterior-rain');
    expect(result.skipped).toEqual([]);
    expect(result.oldForecasts).toEqual([{ id: 'forecast-old:d1:pier', dayId: 'd1', locationId: 'pier', fetchedAt: '2030-11-15T14:14:00Z' }]);
    // Still fresh: nothing said.
    expect(allChecks(outdoors(), 'p', { forecasts: held(short), fetchedAt, now: Date.parse('2030-11-15T20:00:00Z') }).oldForecasts).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { callSheet } from '../model/callsheet';
import { checkContext } from './context';
import { workingHours } from './hours';
import { hmuMinutes } from '../model/shootDay';
import type { Props, SbdRecord } from '../model/record';
import type { Forecast, ForecastEntry } from '../net/weather';
import { callSheetChecks, departmentMissing, exteriorRain, goldenHourMidday, hmuTooShort, locationMissing, type HeldForecasts } from '.';

// The call sheet's checks (4.8): each found and not found, the Trash ignored, and the edges (missing times, overnight
// times, no place, no forecast, nobody chosen), then callSheetChecks for one day.

type Records = Record<string, SbdRecord>;

const at = '2030-11-01T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
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
  const rest = Object.fromEntries(Object.entries(old.props).filter(([key]) => key !== prop));
  return { ...records, [id]: { ...old, props: rest } };
};
const trash = (records: Records, id: string): Records => ({ ...records, [id]: { ...(records[id] as SbdRecord), trashedAt: at } });
const ctxOf = (records: Records) => {
  const sheet = callSheet(records, 'p', 'd');
  if (!sheet) throw new Error('no sheet');
  return checkContext(records, 'p', sheet);
};

const full = { name: 'Diner', address: '12 Route 9', contact_name: 'Rae', parking: 'Lot B', map_name: 'Diner', latitude: 40.7128, longitude: -74.006, time_zone: 'America/New_York' };

/** A complete, clear day: every department present, a location with everything, an interior day scene. */
const clear = (): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', { date: '2030-11-16', call_time: '07:00', wrap_time: '17:00', people_ids: ['dir', 'dp', 'snd', 'hmu', 'wr', 'ana'] }),
    record('diner', 'location', 'p', full),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('s1', 'scene', 'p', { number: '1', int_ext: 'INT', day_night: 'DAY', location_id: 'diner', character_ids: ['mary'] }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'] }),
    record('dir', 'person', 'p', { name: 'Dee Rector', departments: ['direction'] }),
    record('dp', 'person', 'p', { name: 'Kevin Matos', departments: ['camera'] }),
    record('snd', 'person', 'p', { name: 'Sound Sam', departments: ['sound'] }),
    record('hmu', 'person', 'p', { name: 'Hair Hana', departments: ['hmu'] }),
    record('wr', 'person', 'p', { name: 'Wardrobe Wen', departments: ['wardrobe'] }),
  );

describe('location missing details', () => {
  it('finds nothing for a complete location', () => {
    expect(locationMissing(ctxOf(clear()))).toEqual([]);
  });

  it('lists what each location on the day lacks, once per location; a name or a phone is a contact', () => {
    let records = withProps(clear(), 'diner', { address: '  ', parking: '' });
    expect(locationMissing(ctxOf(records))).toEqual([{ kind: 'location-missing', dayId: 'd', locationId: 'diner', missing: ['address', 'parking'] }]);
    records = withProps(records, 'diner', { contact_name: '', contact_phone: '555 0100' });
    expect(locationMissing(ctxOf(records))[0]?.missing).toEqual(['address', 'parking']);
    records = withProps(records, 'diner', { contact_phone: '' });
    expect(locationMissing(ctxOf(records))[0]?.missing).toEqual(['address', 'contact', 'parking']);
  });

  it('ignores a location in the Trash, and one the day’s frames don’t use', () => {
    const bare = withProps(clear(), 'diner', { address: '' });
    expect(locationMissing(ctxOf(trash(bare, 'diner')))).toEqual([]);
    const other = { ...bare, yard: record('yard', 'location', 'p', { name: 'Yard' }) };
    expect(locationMissing(ctxOf(other)).map((f) => f.locationId)).toEqual(['diner']);
  });
});

describe('department missing', () => {
  const found = (records: Records) => departmentMissing(ctxOf(records)).map((f) => `${f.department}:${f.reason}`);

  it('finds nothing when every department the day needs is on it', () => {
    expect(found(clear())).toEqual([]);
  });

  it('wants Direction and Camera on a day with frames to shoot, and neither on a day with none', () => {
    const records = withProps(clear(), 'd', { people_ids: ['snd', 'hmu', 'wr', 'ana'] });
    expect(found(records)).toEqual(['direction:frames', 'camera:frames']);
    expect(found(withProps(records, 'a', { status: 'have' }))).toEqual([]);
  });

  it('wants Sound for a scene with a speaking character, or a frame with dialogue, and not for a silent one', () => {
    const noSound = withProps(clear(), 'd', { people_ids: ['dir', 'dp', 'hmu', 'wr', 'ana'] });
    expect(found(noSound)).toEqual(['sound:dialogue']);
    const silent = withProps(noSound, 's1', { character_ids: [] });
    expect(found(silent)).toEqual([]);
    expect(found(withProps(silent, 'a', { dialogue: 'We’re closed.' }))).toEqual(['sound:dialogue']);
    expect(found(withProps(silent, 'a', { dialogue: '   ' }))).toEqual([]);
  });

  it('wants HMU and Wardrobe when an actor is on the day', () => {
    const records = withProps(clear(), 'd', { people_ids: ['dir', 'dp', 'snd', 'ana'] });
    expect(found(records)).toEqual(['hmu:cast', 'wardrobe:cast']);
    // The actor isn't on the day: nobody to dress.
    expect(found(withProps(records, 'd', { people_ids: ['dir', 'dp', 'snd'] }))).toEqual([]);
  });

  it('ignores people in the Trash', () => {
    expect(found(trash(clear(), 'snd'))).toEqual(['sound:dialogue']);
  });

  it('counts the departments a role stands for, not only the ones ticked', () => {
    // A director with no department ticked covers Direction (personPart, as department status counts them).
    const records = withProps(clear(), 'dir', { role: 'director', departments: [] });
    expect(found(records)).toEqual([]);
  });

  it('needs nothing on a day with nothing left to shoot, and ignores dialogue on frames already shot', () => {
    const shot = withProps(withProps(clear(), 'd', { people_ids: ['dir', 'dp', 'ana'] }), 'a', { status: 'have', dialogue: 'We’re closed.' });
    expect(found(shot)).toEqual([]);
    // Another frame still to shoot in a silent scene: the shot frame’s dialogue doesn’t ask for Sound.
    const more = {
      ...withProps(shot, 's1', { character_ids: [] }),
      s2: record('s2', 'scene', 'p', { number: '2', int_ext: 'INT', day_night: 'DAY', location_id: 'diner' }),
      b: record('b', 'shot', 's2', { number: '2A', status: 'need', shoot_day_id: 'd' }),
    };
    const crew = { people_ids: ['dir', 'dp'] };
    expect(found(withProps(more, 'd', crew))).toEqual([]);
    expect(found(withProps(withProps(more, 'b', { dialogue: 'Hello.' }), 'd', crew))).toEqual(['sound:dialogue']);
  });

  it('with nobody chosen yet, checks against everyone in Cast and crew', () => {
    const open = without(clear(), 'd', 'people_ids');
    expect(found(open)).toEqual([]);
    expect(found(trash(open, 'dp'))).toEqual(['camera:frames']);
  });
});

describe('HMU too short', () => {
  const found = (records: Records) => hmuTooShort(ctxOf(records));
  const withSheet = (records: Records): Records => ({ ...records, cs: record('cs', 'callsheet', 'd', {}) });
  const times = (person: Props) => (records: Records) => withProps(withSheet(records), 'cs', { person_times: { ana: person } });

  it('reads the project’s minimum: 45 unless set, 0 to 600', () => {
    expect(hmuMinutes(undefined)).toBe(45);
    expect(hmuMinutes({ hmu_minutes: 30 })).toBe(30);
    expect(hmuMinutes({ hmu_minutes: 0 })).toBe(0);
    expect(hmuMinutes({ hmu_minutes: 601 })).toBe(45);
    expect(hmuMinutes({ hmu_minutes: 20.5 })).toBe(45);
  });

  it('finds an HMU ready time under the minimum after the call, worked out as 4.2 does (the day’s call when none of their own)', () => {
    expect(found(times({ hmu_ready: '07:20' })(clear()))).toMatchObject([
      { kind: 'hmu-too-short', personId: 'ana', problem: 'short', call: '07:00', hmuReady: '07:20', gap: 20, minimum: 45 },
    ]);
    expect(found(times({ call: '06:00', hmu_ready: '07:00' })(clear()))).toEqual([]);
    expect(found(times({ hmu_ready: '07:45' })(clear()))).toEqual([]);
  });

  it('uses a set minimum, including 0', () => {
    const records = times({ hmu_ready: '07:20' })(clear());
    expect(found(withProps(records, 'p', { hmu_minutes: 20 }))).toEqual([]);
    expect(found(withProps(records, 'p', { hmu_minutes: 60 }))[0]?.minimum).toBe(60);
    expect(found(withProps(times({ hmu_ready: '06:50' })(clear()), 'p', { hmu_minutes: 0 }))).toHaveLength(1);
    expect(found(withProps(times({ hmu_ready: '07:00' })(clear()), 'p', { hmu_minutes: 0 }))).toEqual([]);
  });

  it('finds HMU ready after they are on set', () => {
    const records = times({ call: '06:00', hmu_ready: '07:00', on_set: '06:45' })(clear());
    expect(found(records).map((f) => f.problem)).toEqual(['after-on-set']);
  });

  it('says nothing for a missing call or ready time', () => {
    expect(found(withSheet(clear()))).toEqual([]);
    expect(found(times({ call: '06:00' })(clear()))).toEqual([]);
    const noCall = withProps(clear(), 'd', { call_time: '' });
    expect(found(times({ hmu_ready: '07:00' })(noCall))).toEqual([]);
  });

  it('reads a time more than 12 hours earlier than the call as the next day', () => {
    // A 22:00 call and a 00:10 ready are 2 h 10 min apart; a 22:00 call and a 21:30 ready are before the call.
    const night = (person: Props) => times(person)(withProps(clear(), 'd', { call_time: '22:00' }));
    expect(found(night({ hmu_ready: '00:10' }))).toEqual([]);
    expect(found(night({ hmu_ready: '23:00', on_set: '00:30' }))).toEqual([]);
    expect(found(night({ hmu_ready: '23:00', on_set: '22:30' })).map((f) => f.problem)).toEqual(['after-on-set']);
    expect(found(night({ hmu_ready: '21:30' }))[0]).toMatchObject({ problem: 'short', gap: -30 });
  });

  it('ignores cast in the Trash', () => {
    expect(found(trash(times({ hmu_ready: '07:20' })(clear()), 'ana'))).toEqual([]);
  });
});

describe('golden-hour scene at midday', () => {
  const found = (records: Records) => goldenHourMidday(ctxOf(records));
  const dusk = (extra: Props = {}) => withProps(withProps(clear(), 's1', { day_night: 'DUSK', int_ext: 'EXT' }), 'd', { call_time: '09:00', wrap_time: '13:00', ...extra });

  it('finds a dusk scene on a day whose hours miss the light, naming the scene and the golden hour', () => {
    const [finding] = found(dusk());
    expect(finding).toMatchObject({ kind: 'golden-hour-midday', sceneId: 's1', locationId: 'diner', dayNight: 'DUSK' });
    expect(finding?.golden).toHaveLength(2);
    // November 16 at 40.7 degrees north: the evening golden hour is in the afternoon.
    expect(finding?.golden[1]?.start).toMatch(/^1[5-6]:\d\d$/);
  });

  it('finds nothing once the hours reach the golden or blue hour, or for a scene that isn’t at the edge of the day', () => {
    expect(found(dusk({ wrap_time: '17:30' }))).toEqual([]);
    expect(found(dusk({ call_time: '06:00', wrap_time: '07:00' }))).toEqual([]);
    expect(found(withProps(dusk(), 's1', { day_night: 'DAY' }))).toEqual([]);
    expect(found(withProps(dusk(), 's1', { day_night: 'NIGHT' }))).toEqual([]);
    expect(found(withProps(dusk(), 's1', { day_night: 'MAGIC HOUR' })).map((f) => f.dayNight)).toEqual(['MAGIC HOUR']);
    expect(found(withProps(dusk(), 's1', { day_night: 'DAWN' })).map((f) => f.dayNight)).toEqual(['DAWN']);
  });

  it('without a wrap, takes the call plus the day’s estimate (one setup at 30 minutes)', () => {
    expect(found(dusk({ wrap_time: '' }))).toHaveLength(1);
    expect(found(dusk({ call_time: '15:40', wrap_time: '' }))).toEqual([]);
    expect(found(withProps(dusk({ call_time: '12:00', wrap_time: '' }), 'p', { setup_minutes: 240 }))).toEqual([]);
  });

  it('says nothing without a crew call, a date or a place', () => {
    expect(found(dusk({ call_time: '' }))).toEqual([]);
    expect(found(dusk({ date: '' }))).toEqual([]);
    expect(found(without(without(dusk(), 'diner', 'latitude'), 'diner', 'longitude'))).toEqual([]);
  });

  it('ignores a scene in the Trash', () => {
    expect(found(trash(dusk(), 's1'))).toEqual([]);
  });

  it('counts a wrap after midnight, and meets the next morning’s light when the hours run into it', () => {
    expect(found(dusk({ call_time: '14:00', wrap_time: '02:00' }))).toEqual([]);
    const dawn = (extra: Props) => withProps(dusk(extra), 's1', { day_night: 'DAWN' });
    // 18:00 to 08:00 reaches the next morning’s golden hour; 18:00 to 02:00 does not.
    expect(found(dawn({ call_time: '18:00', wrap_time: '08:00' }))).toEqual([]);
    expect(found(dawn({ call_time: '18:00', wrap_time: '02:00' }))).toHaveLength(1);
  });

  it('takes a wrap equal to the call as no wrap, using the estimate', () => {
    expect(found(dusk({ call_time: '09:00', wrap_time: '09:00' }))).toHaveLength(1);
    expect(found(dusk({ call_time: '15:40', wrap_time: '15:40' }))).toEqual([]);
  });

  it('reads the hours as instants in the sheet’s zone, so a location in another zone is compared at the same moments', () => {
    const two = {
      ...dusk(),
      zulu: record('zulu', 'location', 'p', { name: 'Zulu', address: 'x', contact_name: 'y', parking: 'z', map_name: 'Zulu', latitude: 34.05, longitude: -118.24, time_zone: 'America/Los_Angeles' }),
      s2: record('s2', 'scene', 'p', { number: '2', int_ext: 'EXT', day_night: 'DUSK', location_id: 'zulu' }),
      b: record('b', 'shot', 's2', { number: '2A', status: 'need', shoot_day_id: 'd' }),
    };
    const only = (extra: Props) => found(withProps(withProps(two, 'd', extra), 's1', { day_night: 'DAY' }));
    // Los Angeles’s evening golden hour is about 15:50 to 16:50 there, 18:50 to 19:50 in New York: 18:00 to 20:00 meets it.
    expect(only({ call_time: '18:00', wrap_time: '20:00' })).toEqual([]);
    // 15:00 to 17:00 in New York is 12:00 to 14:00 in Los Angeles: it misses, though 15:00 to 17:00 read there would not.
    expect(only({ call_time: '15:00', wrap_time: '17:00' }).map((f) => f.locationId)).toEqual(['zulu']);
  });
});

describe('exterior with rain', () => {
  const hour = (h: number): string => `2030-11-16T${String(h).padStart(2, '0')}:00:00Z`;
  const entry = (h: number, rain: number | null, symbol: string | null = null): ForecastEntry => ({
    time: hour(h),
    temperature: 8,
    wind: 3,
    rain1h: rain,
    rain6h: null,
    symbol1h: symbol,
    symbol6h: null,
  });
  /** Hourly from 05:00Z to 23:00Z (00:00 to 18:00 in New York on the 16th): `rain` by UTC hour. */
  const forecast = (rain: Record<number, number>, symbols: Record<number, string> = {}): Forecast => ({
    expires: '2030-11-16T00:00:00Z',
    lastModified: null,
    entries: Array.from({ length: 19 }, (_, i) => entry(5 + i, rain[5 + i] ?? 0, symbols[5 + i] ?? null)),
  });
  const held = (f: Forecast | null): HeldForecasts => new Map(f ? [['diner', f]] : []);
  const outdoors = (extra: Props = {}) => withProps(withProps(clear(), 's1', { int_ext: 'EXT' }), 'd', extra);
  const found = (records: Records, f: Forecast | null) => exteriorRain(ctxOf(records), held(f));

  it('finds an exterior scene when a millimetre or more falls in the day’s hours', () => {
    // 07:00 to 17:00 in New York is 12:00Z to 22:00Z.
    expect(found(outdoors(), forecast({ 14: 0.6, 15: 0.6 }))).toEqual([
      { kind: 'exterior-rain', dayId: 'd', sceneId: 's1', locationId: 'diner', cause: 'precipitation', mm: 1.2, conditions: null },
    ]);
    expect(found(withProps(outdoors(), 's1', { int_ext: 'INT/EXT' }), forecast({ 14: 1 }))).toHaveLength(1);
  });

  it('finds nothing for a dry spell, rain outside the hours, a millimetre not reached, or an interior', () => {
    expect(found(outdoors(), forecast({}))).toEqual([]);
    expect(found(outdoors(), forecast({ 8: 5, 23: 5 }))).toEqual([]);
    expect(found(outdoors(), forecast({ 14: 0.9 }))).toEqual([]);
    expect(found(withProps(outdoors(), 's1', { int_ext: 'INT' }), forecast({ 14: 5 }))).toEqual([]);
  });

  it('counts the whole day without a wrap, or without a call', () => {
    expect(found(outdoors({ wrap_time: '' }), forecast({ 8: 2 }))).toHaveLength(1);
    expect(found(outdoors({ call_time: '' }), forecast({ 8: 2 }))).toHaveLength(1);
  });

  it('takes a wrap equal to the call as no wrap: the whole day', () => {
    expect(found(outdoors({ call_time: '07:00', wrap_time: '07:00' }), forecast({ 8: 2 }))).toHaveLength(1);
  });

  it('finds rain, thunder, sleet or snow at the call even when little has fallen', () => {
    expect(found(outdoors(), forecast({}, { 12: 'rain' }))).toMatchObject([{ cause: 'conditions', conditions: 'weather.rain' }]);
    expect(found(outdoors(), forecast({}, { 12: 'snow' }))).toHaveLength(1);
    // Light rain at the call alone isn't wet enough.
    expect(found(outdoors(), forecast({}, { 12: 'lightrain' }))).toEqual([]);
    expect(found(outdoors(), forecast({}, { 12: 'heavyrainandthunder' }))[0]?.conditions).toBe('weather.thunder');
    expect(found(outdoors(), forecast({}, { 12: 'cloudy' }))).toEqual([]);
    // Rain later in the day is not the condition at the call.
    expect(found(outdoors(), forecast({}, { 15: 'rain' }))).toEqual([]);
  });

  it('says nothing without a held forecast, a date, or when the forecast misses the hours', () => {
    expect(found(outdoors(), null)).toEqual([]);
    expect(found(outdoors({ date: '' }), forecast({ 14: 5 }))).toEqual([]);
    const early: Forecast = { expires: '2030-11-16T00:00:00Z', lastModified: null, entries: [entry(1, 3), entry(2, 3)] };
    expect(found(outdoors(), early)).toEqual([]);
  });

  it('ignores a scene or location in the Trash', () => {
    expect(found(trash(outdoors(), 's1'), forecast({ 14: 5 }))).toEqual([]);
    expect(found(trash(outdoors(), 'diner'), forecast({ 14: 5 }))).toEqual([]);
  });

  it('reads a wrap after midnight as the next day', () => {
    expect(found(outdoors({ call_time: '15:00', wrap_time: '02:00' }), forecast({ 22: 3 }))).toHaveLength(1);
  });
});

describe('the working hours across a clock change', () => {
  const minutesBetween = (extra: Props) => {
    const hours = workingHours(ctxOf(withProps(clear(), 'd', extra)), false);
    if (!hours) throw new Error('no hours');
    return (hours.end - hours.start) / 60_000;
  };

  it('counts the real time from the call to the wrap when the clocks go back (New York, 2030-11-03)', () => {
    // 00:30 EDT to 03:00 EST: the 01:00 hour happens twice.
    expect(minutesBetween({ date: '2030-11-03', call_time: '00:30', wrap_time: '03:00' })).toBe(210);
  });

  it('counts the real time when the clocks go forward (New York, 2030-03-10)', () => {
    // 00:30 EST to 04:00 EDT: the 02:00 hour does not happen.
    expect(minutesBetween({ date: '2030-03-10', call_time: '00:30', wrap_time: '04:00' })).toBe(150);
  });

  it('is the plain difference on an ordinary night, a wrap past midnight included', () => {
    expect(minutesBetween({ date: '2030-11-16', call_time: '18:00', wrap_time: '02:00' })).toBe(480);
  });
});

describe('callSheetChecks for one day', () => {
  it('finds nothing on a clear day, and runs every check in order on a bad one', () => {
    expect(callSheetChecks(clear(), 'p', 'd').findings).toEqual([]);
    let records = withProps(clear(), 'diner', { parking: '' });
    records = withProps(records, 'd', { people_ids: ['dir', 'dp', 'hmu', 'wr', 'ana'], call_time: '09:00', wrap_time: '13:00' });
    records = withProps(records, 's1', { day_night: 'DUSK', int_ext: 'EXT' });
    records = { ...records, cs: record('cs', 'callsheet', 'd', { person_times: { ana: { hmu_ready: '09:10' } } }) };
    const entries: ForecastEntry[] = Array.from({ length: 6 }, (_, i) => ({
      time: `2030-11-16T${String(14 + i).padStart(2, '0')}:00:00Z`,
      temperature: 5,
      wind: 2,
      rain1h: 1,
      rain6h: null,
      symbol1h: null,
      symbol6h: null,
    }));
    const forecasts: HeldForecasts = new Map([['diner', { expires: '2030-11-16T00:00:00Z', lastModified: null, entries }]]);
    const kinds = callSheetChecks(records, 'p', 'd', forecasts).findings.map((f) => f.kind);
    expect(kinds).toEqual(['location-missing', 'department-missing', 'hmu-too-short', 'golden-hour-midday', 'exterior-rain']);
  });

  it('is empty for a day that isn’t there or is in the Trash', () => {
    expect(callSheetChecks(clear(), 'p', 'nope')).toEqual({ findings: [], skipped: [] });
    expect(callSheetChecks(trash(clear(), 'd'), 'p', 'd').findings).toEqual([]);
  });

  it('is cached per records, day, zones and forecasts: the same arguments give the same result', () => {
    const records = withProps(clear(), 'diner', { address: '' });
    const first = callSheetChecks(records, 'p', 'd');
    expect(callSheetChecks(records, 'p', 'd')).toBe(first);
    // Zones are compared by what they hold, as the app makes the map again on every draw.
    const zones = new Map([['diner', 'America/New_York']]);
    const withZones = callSheetChecks(records, 'p', 'd', undefined, zones);
    expect(callSheetChecks(records, 'p', 'd', undefined, new Map(zones))).toBe(withZones);
    expect(callSheetChecks(records, 'p', 'd', new Map())).not.toBe(first);
    expect(callSheetChecks({ ...records }, 'p', 'd')).not.toBe(first);
    expect(callSheetChecks({ ...records }, 'p', 'd')).toEqual(first);
  });

  it('says which checks it could not run: no zone for a place, no held forecast', () => {
    const outdoorsDusk = (records: Records) => withProps(records, 's1', { int_ext: 'EXT', day_night: 'DUSK' });
    // Records alone: the place has no zone of its own and none was looked up, so neither light nor rain can be read.
    const noZone = outdoorsDusk(without(clear(), 'diner', 'time_zone'));
    expect(callSheetChecks(noZone, 'p', 'd').skipped).toEqual([
      { kind: 'golden-hour-midday', reason: 'no-zone', locationId: 'diner' },
      { kind: 'exterior-rain', reason: 'no-zone', locationId: 'diner' },
    ]);
    // With the zone looked up but no forecast held, only the rain is skipped.
    expect(callSheetChecks(noZone, 'p', 'd', undefined, new Map([['diner', 'America/New_York']])).skipped).toEqual([
      { kind: 'exterior-rain', reason: 'no-forecast', locationId: 'diner' },
    ]);
    // Nothing is skipped when both are given, or when the scenes don't need them.
    const held: HeldForecasts = new Map([['diner', { expires: '2030-11-16T00:00:00Z', lastModified: null, entries: [] }]]);
    expect(callSheetChecks(noZone, 'p', 'd', held, new Map([['diner', 'America/New_York']])).skipped).toEqual([]);
    expect(callSheetChecks(clear(), 'p', 'd').skipped).toEqual([]);
    // A place that isn’t on the map has no forecast to hold.
    const noPlace = outdoorsDusk(without(without(clear(), 'diner', 'latitude'), 'diner', 'longitude'));
    expect(callSheetChecks(noPlace, 'p', 'd').skipped).toEqual([{ kind: 'exterior-rain', reason: 'no-forecast', locationId: 'diner' }]);
  });

  it('treats forecasts as the same when each entry is the same object, however many maps hold them', () => {
    const records = withProps(clear(), 'diner', { address: '' });
    const forecast: Forecast = { expires: '2030-11-16T00:00:00Z', lastModified: null, entries: [] };
    const first = callSheetChecks(records, 'p', 'd', new Map([['diner', forecast]]));
    expect(callSheetChecks(records, 'p', 'd', new Map([['diner', forecast]]))).toBe(first);
    expect(callSheetChecks(records, 'p', 'd', new Map([['diner', { ...forecast }]]))).not.toBe(first);
  });

  it('checks neither light nor rain while the sheet’s zone is on its way, and says so', () => {
    const records = withProps(without(clear(), 'diner', 'time_zone'), 's1', { int_ext: 'EXT', day_night: 'DUSK' });
    const entries: ForecastEntry[] = Array.from({ length: 24 }, (_, i) => ({
      time: `2030-11-16T${String(i).padStart(2, '0')}:00:00Z`,
      temperature: 5,
      wind: 2,
      rain1h: 2,
      rain6h: null,
      symbol1h: null,
      symbol6h: null,
    }));
    const forecasts: HeldForecasts = new Map([['diner', { expires: '2030-11-16T00:00:00Z', lastModified: null, entries }]]);
    const waiting = callSheetChecks(records, 'p', 'd', forecasts);
    expect(waiting.findings.map((f) => f.kind)).not.toContain('exterior-rain');
    expect(waiting.findings.map((f) => f.kind)).not.toContain('golden-hour-midday');
    expect(waiting.skipped).toEqual([
      { kind: 'golden-hour-midday', reason: 'no-zone', locationId: 'diner' },
      { kind: 'exterior-rain', reason: 'no-zone', locationId: 'diner' },
    ]);
    // The zone arrives: the rain is found, and nothing is skipped.
    const arrived = callSheetChecks(records, 'p', 'd', forecasts, new Map([['diner', 'America/New_York']]));
    expect(arrived.findings.map((f) => f.kind)).toContain('exterior-rain');
    expect(arrived.skipped).toEqual([]);
  });
});

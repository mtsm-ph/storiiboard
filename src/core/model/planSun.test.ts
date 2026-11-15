import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { Change } from '../ops/ops';
import { northFields, sunFields } from './plan';
import { planLegend } from './planLegend';
import { copySetupChanges, separateCopyChanges, setupOnlyChanges } from './planRooms';
import { clockOf, parseSunTime, roomNorth, roomNorthItem, steppedTime, sunBase, sunReading, sunReadingsMade, sunTimeChanges, sunZonePoint } from './planSun';
import type { Props, SbdRecord } from './record';

// The room's north and a setup's sun path (6.6): north is the room's first live `north` item's rotation; a sun path reads
// the setup's frames live, and says what it lacks one thing at a time, in order (no frames, no day, no date, no location,
// no place, no north, no zone); among several days and places the earliest day's frame, then board order. Copies of a
// room and of a setup carry north and the sun path; north never goes into one setup's plan.

type Records = Record<string, SbdRecord>;

const at = '2026-11-14T10:00:00.000Z';
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

function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'update') {
      const was = next[change.id];
      if (!was) continue;
      const gone = new Set(change.unset ?? []);
      next[change.id] = { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([key]) => !gone.has(key))) };
    } else if (change.kind === 'trash') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, trashedAt: at };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const NYC = { latitude: 40.7128, longitude: -74.006, map_name: 'Diner, New York' };
const box = { x: 0, y: 0, width: 0.6, height: 0.6, rotation: 0 };

/**
 * Bey County: scene 1 at the Diner (in New York, its zone set), set in room `room` with north turned 90°; Setup 1 with
 * frame 1A on Day 1, 21 June 2026; its own plan holding a sun path at 13:00.
 */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('diner', 'location', 'p', { name: 'Diner', ...NYC, time_zone: 'America/New_York' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner', location_id: 'diner' }),
    record('north', 'plan_item', 'room', { kind: 'north', icon: 'production/north', ...box, rotation: 90 }),
    record('s1', 'scene', 'p', { number: '1', location_id: 'diner', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('sun', 'plan_item', 'own', { kind: 'sun', icon: 'lighting/sun-path', ...box, width: 0.8, height: 0.8, time: '13:00' }),
    record('d1', 'shoot_day', 'p', { date: '2026-06-21' }, 'a'),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1', shoot_day_id: 'd1' }, 'a'),
  );

const with_ = (records: Records, ...list: SbdRecord[]): Records => ({ ...records, ...recordsOf(...list) });
const patched = (records: Records, id: string, props: Props): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: { ...was.props, ...props } } };
};
const without = (records: Records, id: string, prop: string): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  const props = Object.fromEntries(Object.entries(was.props).filter(([name]) => name !== prop));
  return { ...records, [id]: { ...was, props } };
};
const none = new Map<string, string | null>();

beforeEach(() => {
  setLocale('en');
});

describe('north and sun fields (6.6)', () => {
  it('reads a north and a sun path, a missing or odd time as noon', () => {
    expect(northFields({ kind: 'north', ...box, rotation: 35 })).toMatchObject({ kind: 'north', icon: 'production/north', rotation: 35 });
    expect(sunFields({ kind: 'sun', ...box, time: '14:30' })).toMatchObject({ kind: 'sun', icon: 'lighting/sun-path', time: '14:30' });
    expect(sunFields({ kind: 'sun', ...box })?.time).toBe('12:00');
    expect(sunFields({ kind: 'sun', ...box, time: '25:00' })?.time).toBe('12:00');
    expect(northFields({ kind: 'north', x: 0, y: 0 })).toBeNull();
  });
});

describe('the room’s north (6.6)', () => {
  it('is its north item’s rotation; a room with none has none', () => {
    expect(roomNorth(base(), 'room')).toBe(90);
    expect(roomNorth(without(base(), 'north', 'kind'), 'room')).toBeNull();
    expect(roomNorth(base(), null)).toBeNull();
  });

  it('is the first live north in plan order, one in the Trash read as none', () => {
    const two = with_(base(), record('north2', 'plan_item', 'room', { kind: 'north', ...box, rotation: 10 }, 'zz'));
    expect(roomNorthItem(two, 'room')?.record.id).toBe('north');
    const trashed = with_(two, record('north', 'plan_item', 'room', { kind: 'north', ...box, rotation: 90 }, 'north', at));
    expect(roomNorth(trashed, 'room')).toBe(10);
  });
});

describe('what a sun path reads, live (6.6)', () => {
  it('draws from the setup’s frame, its day, its location, its zone and the room’s north', () => {
    const reading = sunReading(base(), 'sun', none);
    expect(reading && 'source' in reading).toBe(true);
    if (!reading || !('source' in reading)) return;
    expect(reading.source.frame.id).toBe('a');
    expect(reading.source.day.record.id).toBe('d1');
    expect(reading.source.location.id).toBe('diner');
    expect(reading.source.place).toEqual({ latitude: 40.7128, longitude: -74.006 });
    expect(reading.source.north).toBe(90);
    expect(reading.zone).toEqual({ zone: 'America/New_York', source: 'location' });
    expect(reading.source.otherDays).toEqual([]);
  });

  it('says each thing missing, one at a time, in order', () => {
    const missing = (records: Records, zones = none) => {
      const r = sunReading(records, 'sun', zones);
      return r && 'missing' in r ? r.missing : 'drawn';
    };
    // No frames in the setup.
    expect(missing(with_(base(), record('a', 'shot', 's1', { number: '1A' })))).toBe('noFrames');
    // The frame in no shoot day; its day in the Trash reads as none.
    expect(missing(without(base(), 'a', 'shoot_day_id'))).toBe('noDay');
    expect(missing(with_(base(), record('d1', 'shoot_day', 'p', { date: '2026-06-21' }, 'a', at)))).toBe('noDay');
    // The day has no date.
    const undated = without(base(), 'd1', 'date');
    expect(missing(undated)).toBe('noDate');
    expect(sunReading(undated, 'sun', none)).toMatchObject({ missing: 'noDate', dayId: 'd1' });
    // No location on the frame or its scene.
    expect(missing(without(base(), 's1', 'location_id'))).toBe('noLocation');
    // The location has no place on the map.
    const unplaced = without(without(without(base(), 'diner', 'latitude'), 'diner', 'longitude'), 'diner', 'map_name');
    expect(missing(unplaced)).toBe('noPlace');
    expect(sunReading(unplaced, 'sun', none)).toMatchObject({ missing: 'noPlace', locationId: 'diner' });
    // No north in the room.
    expect(missing(with_(base(), record('north', 'plan_item', 'room', { kind: 'north', ...box }, 'north', at)))).toBe('noNorth');
    // No time zone: none on the location and none looked up (the lookup is unavailable, or still on its way).
    const zoneless = without(base(), 'diner', 'time_zone');
    expect(missing(zoneless)).toBe('noZone');
    expect(missing(zoneless, new Map([['diner', null]]))).toBe('noZone');
    expect(sunZonePoint(zoneless, 'sun')).toEqual({ id: 'diner', latitude: 40.7128, longitude: -74.006 });
    // Looked up from the place: drawn, its zone from the map.
    const found = sunReading(zoneless, 'sun', new Map([['diner', 'America/New_York']]));
    expect(found && 'zone' in found ? found.zone : null).toEqual({ zone: 'America/New_York', source: 'map' });
    // A zone of its own needs no lookup.
    expect(sunZonePoint(base(), 'sun')).toBeNull();
  });

  it('a frame’s own location stands before its scene’s', () => {
    const elsewhere = with_(patched(base(), 'a', { location_id: 'lot' }), record('lot', 'location', 'p', { name: 'Lot' }));
    expect(sunReading(elsewhere, 'sun', none)).toMatchObject({ missing: 'noPlace', locationId: 'lot' });
  });

  it('draws the frame with the earliest day, then board order, and says what else the setup shoots', () => {
    const records = with_(
      base(),
      // Day 2 is 1B's; 1C is at another place on Day 1, after 1A in board order.
      record('d2', 'shoot_day', 'p', { date: '2026-06-24' }, 'b'),
      record('lot', 'location', 'p', { name: 'Parking lot', latitude: 40.7, longitude: -74, map_name: 'Lot', time_zone: 'America/New_York' }),
      record('b', 'shot', 's1', { number: '1B', setup_id: 'u1', shoot_day_id: 'd2' }, 'b'),
      record('c', 'shot', 's1', { number: '1C', setup_id: 'u1', shoot_day_id: 'd1', location_id: 'lot' }, 'c'),
    );
    const reading = sunReading(records, 'sun', none);
    if (!reading || !('source' in reading)) throw new Error('not drawn');
    expect(reading.source.frame.id).toBe('a');
    expect(reading.source.otherDays.map((d) => d.number)).toEqual([2]);
    expect(reading.source.otherPlaces.map((l) => l.id)).toEqual(['lot']);
    // 1A moved to the later day: 1C, on the earliest day, is drawn, at its own place.
    const moved = patched(records, 'a', { shoot_day_id: 'd2' });
    const now = sunReading(moved, 'sun', none);
    if (!now || !('source' in now)) throw new Error('not drawn');
    expect(now.source.frame.id).toBe('c');
    expect(now.source.location.id).toBe('lot');
    // A day without a place doesn't win: 1C's place taken off, 1A on Day 2 is drawn.
    const placeless = without(without(moved, 'lot', 'latitude'), 'lot', 'longitude');
    const later = sunReading(placeless, 'sun', none);
    expect(later && 'source' in later ? later.source.frame.id : null).toBe('a');
  });

  it('is worked out once per records object', () => {
    const records = base();
    const before = sunReadingsMade();
    sunBase(records, 'sun');
    sunBase(records, 'sun');
    sunReading(records, 'sun', none);
    expect(sunReadingsMade() - before).toBe(1);
    sunBase({ ...records }, 'sun');
    expect(sunReadingsMade() - before).toBe(2);
  });

  it('a sun path outside a setup’s plan reads as having no frames', () => {
    const inRoom = with_(base(), record('sun', 'plan_item', 'room', { kind: 'sun', ...box, time: '13:00' }));
    expect(sunReading(inRoom, 'sun', none)).toMatchObject({ missing: 'noFrames' });
    expect(sunReading(base(), 'nothing', none)).toBeNull();
  });
});

describe('a sun path’s time (6.6)', () => {
  it('reads typed times', () => {
    expect(parseSunTime('14:30')).toBe('14:30');
    expect(parseSunTime('1430')).toBe('14:30');
    expect(parseSunTime('9:05')).toBe('09:05');
    expect(parseSunTime('9')).toBe('09:00');
    expect(parseSunTime('24:00')).toBeNull();
    expect(parseSunTime('noon')).toBeNull();
    expect(clockOf(-15)).toBe('23:45');
  });

  it('steps 15 minutes or an hour, onto the step, round midnight', () => {
    expect(steppedTime('13:00', 15)).toBe('13:15');
    expect(steppedTime('13:00', -15)).toBe('12:45');
    expect(steppedTime('14:07', 15)).toBe('14:15');
    expect(steppedTime('14:07', -15)).toBe('14:00');
    expect(steppedTime('13:00', 60)).toBe('14:00');
    expect(steppedTime('23:45', 15)).toBe('00:00');
    expect(steppedTime('00:00', -60)).toBe('23:00');
  });

  it('is one update, nothing when it reads so already or isn’t a time', () => {
    expect(sunTimeChanges(base(), ['sun'], '14:30')).toEqual([{ kind: 'update', id: 'sun', set: { time: '14:30' } }]);
    expect(sunTimeChanges(base(), ['sun'], '13:00')).toEqual([]);
    expect(sunTimeChanges(base(), ['sun'], '1430')).toEqual([]);
    expect(sunTimeChanges(base(), ['north'], '14:30')).toEqual([]);
  });
});

describe('copies and levels (6.6)', () => {
  it('a separate copy of the room copies its north', () => {
    const shared = with_(base(), record('s2', 'scene', 'p', { number: '2', room_id: 'room' }));
    const copy = applied(shared, separateCopyChanges(shared, 'p', 's2', 'room2'));
    expect(roomNorth(copy, 'room2')).toBe(90);
    expect(roomNorth(copy, 'room')).toBe(90);
    expect(roomNorthItem(copy, 'room2')?.record.props.copied_from).toBe('north');
  });

  it('a setup started from another copies its sun path with its time', () => {
    const records = with_(base(), record('u2', 'setup', 's1', { name: '' }, 'u2'));
    const copy = applied(records, copySetupChanges(records, 'u1', 'u2', 'own2'));
    const suns = Object.values(copy).filter((r) => r.parentId === 'own2' && r.props.kind === 'sun');
    expect(suns).toHaveLength(1);
    expect(suns[0]?.props.time).toBe('13:00');
  });

  it('north never goes into one setup’s own plan', () => {
    expect(setupOnlyChanges(base(), 's1', 'u1', ['north'], true)).toEqual([]);
  });
});

describe('the legend’s north (6.6)', () => {
  it('lists the room’s north with the room, and no line for north or the sun path', () => {
    const legend = planLegend(base(), 's1', 'u1', (icon) => icon);
    expect(legend.north).toBe(90);
    expect(legend.groups).toEqual([]);
    expect(planLegend(without(base(), 'north', 'kind'), 's1', 'u1', (icon) => icon).north).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { callSheet, dayCallsheet, dayDateFull, defaultSheetDay, isCastOnly } from './callsheet';
import { personFields } from './person';
import type { Props, SbdRecord } from './record';
import { projectShootDays } from './shootDay';

// The call sheet's sections (4.1), worked out from a small project: two scenes over two locations on Day 2, a frame
// of a third scene on Day 1, characters with and without cast, and people in every kind of department.

const at = '2026-11-10T10:00:00.000Z';
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
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));
const trashed = (r: SbdRecord): SbdRecord => ({ ...r, trashedAt: at });

const base = (...more: SbdRecord[]) =>
  recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d1', 'shoot_day', 'p', { date: '2026-11-15' }),
    record('d2', 'shoot_day', 'p', { date: '2026-11-16', call_time: '07:00' }),
    record('diner', 'location', 'p', { name: 'Diner', status: 'confirmed', address: '1 Main St' }),
    record('dock', 'location', 'p', { name: 'Dock' }),
    record('mill', 'location', 'p', { name: 'Mill' }),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('joe', 'character', 'p', { name: 'JOE' }),
    record('kid', 'character', 'p', { name: 'KID', cast_id: 'kev' }),
    record('s1', 'scene', 'p', { number: '1', name: 'Diner', int_ext: 'INT', location_id: 'diner', character_ids: ['mary', 'joe'], page_eighths: 8 }, 'a'),
    record('s2', 'scene', 'p', { number: '2', name: 'Pier', location_id: 'dock', character_ids: ['mary', 'kid'] }, 'b'),
    record('s3', 'scene', 'p', { number: '3', name: 'Mill', location_id: 'mill' }, 'c'),
    record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd2' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', shoot_day_id: 'd2' }, 'b'),
    record('c', 'shot', 's2', { number: '2A', shoot_day_id: 'd2' }, 'a'),
    record('e', 'shot', 's3', { number: '3A', shoot_day_id: 'd1' }, 'a'),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'] }),
    record('extra', 'person', 'p', { name: 'Zed Extra', role: 'cast' }),
    record('kev', 'person', 'p', { name: 'Kevin Matos', role: 'dp', title: 'DP', departments: ['camera', 'grip-electric'] }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', role: 'producer' }),
    ...more,
  );

describe('a day’s call sheet', () => {
  it('has the day, its number among the live days, and the project’s title', () => {
    const sheet = callSheet(base(), 'p', 'd2');
    expect(sheet?.title).toBe('Bey County');
    expect([sheet?.day.number, sheet?.dayCount, sheet?.day.fields.callTime]).toEqual([2, 2, '07:00']);
    expect(dayDateFull('2026-11-16')).toBe('Monday, November 16, 2026');
    expect(callSheet(base(), 'p', 'nothing')).toBeNull();
  });

  it('counts live days only', () => {
    const records = base(record('d3', 'shoot_day', 'p', { date: '2026-11-20' }), record('gone', 'shoot_day', 'p', { date: '2026-11-17' }, 'gone', at));
    const sheet = callSheet(records, 'p', 'd3');
    expect([sheet?.day.number, sheet?.dayCount]).toEqual([3, 3]);
    expect(callSheet(records, 'p', 'gone')).toBeNull();
  });

  it('lists the locations the day’s frames are at, and the scenes in board order with their characters and actors', () => {
    const sheet = callSheet(base(), 'p', 'd2');
    expect(sheet?.locations.map((l) => l.fields.name)).toEqual(['Diner', 'Dock']);
    expect(sheet?.scenes.map((s) => [s.record.id, s.frames, s.location])).toEqual([
      ['s1', 2, 'Diner'],
      ['s2', 1, 'Dock'],
    ]);
    expect(sheet?.scenes[0]?.characters.map((c) => [c.name, c.cast?.fields.name ?? null])).toEqual([
      ['MARY', 'Ana Ruiz'],
      ['JOE', null],
    ]);
  });

  it('names a scene’s places from its frames on the day, a frame’s own first, as Locations lists them', () => {
    const records = base();
    const sheet = callSheet({ ...records, c: { ...(records.c as SbdRecord), props: { number: '2A', shoot_day_id: 'd2', location_id: 'mill' } } }, 'p', 'd2');
    expect(sheet?.locations.map((l) => l.fields.name)).toEqual(['Diner', 'Mill']);
    expect(sheet?.scenes.map((s) => s.location)).toEqual(['Diner', 'Mill']);
    const two = callSheet({ ...records, b: { ...(records.b as SbdRecord), props: { number: '1B', shoot_day_id: 'd2', location_id: 'mill' } } }, 'p', 'd2');
    expect(two?.scenes[0]?.location).toBe('Diner, Mill');
    // An unnamed place reads as the Locations section names it, never as an empty name.
    const unnamed = callSheet({ ...records, b: { ...(records.b as SbdRecord), props: { number: '1B', shoot_day_id: 'd2', location_id: 'mill' } }, mill: { ...(records.mill as SbdRecord), props: {} } }, 'p', 'd2');
    expect(unnamed?.scenes[0]?.location).toBe('Diner, Unnamed location');
  });

  it('skips unnamed characters', () => {
    const records = base();
    const sheet = callSheet({ ...records, joe: { ...(records.joe as SbdRecord), props: { name: ' ' } } }, 'p', 'd2');
    expect(sheet?.scenes[0]?.characters.map((c) => c.name)).toEqual(['MARY']);
  });

  it('keeps Cast out of Crew, though someone in Camera and Cast is still in Camera', () => {
    const records = base(record('both', 'person', 'p', { name: 'Bo', role: 'dp', departments: ['camera', 'cast'] }));
    const groups = callSheet(records, 'p', 'd2')?.crew.map((g) => g.department);
    expect(groups).toEqual(['camera', 'grip-electric', null]);
    expect(callSheet(records, 'p', 'd2')?.crew[0]?.people.map((p) => p.fields.name)).toEqual(['Bo', 'Kevin Matos']);
  });

  it('lists each actor once with the characters they play that day, by first appearance', () => {
    const sheet = callSheet(base(), 'p', 'd2');
    expect(sheet?.cast.map((c) => [c.person.fields.name, c.characters])).toEqual([
      ['Ana Ruiz', ['MARY']],
      ['Kevin Matos', ['KID']],
    ]);
    // Day 1 has only the mill: no characters, no cast.
    expect(callSheet(base(), 'p', 'd1')?.cast).toEqual([]);
  });

  it('lists the crew by department, in several when they have several, without those who only play a part', () => {
    const sheet = callSheet(base(), 'p', 'd2');
    expect(sheet?.crew.map((g) => [g.department, g.people.map((p) => p.fields.name)])).toEqual([
      ['camera', ['Kevin Matos']],
      ['grip-electric', ['Kevin Matos']],
      [null, ['Sam Ortiz']],
    ]);
    // Ana (cast only) and Zed (no department, the cast role) are not crew, and Zed plays nobody: not on the sheet.
    const everywhere = sheet?.crew.flatMap((g) => g.people.map((p) => p.fields.name));
    expect(everywhere).not.toContain('Ana Ruiz');
    expect(everywhere).not.toContain('Zed Extra');
    expect(sheet?.cast.map((c) => c.person.fields.name)).not.toContain('Zed Extra');
  });

  it('reads who is cast-only', () => {
    expect(isCastOnly({ departments: ['cast'], role: null })).toBe(true);
    expect(isCastOnly({ departments: [], role: 'cast' })).toBe(true);
    expect(isCastOnly({ departments: ['cast', 'camera'], role: 'cast' })).toBe(false);
    expect(isCastOnly({ departments: [], role: 'dp' })).toBe(false);
  });

  it('takes the people on the day when told who they are', () => {
    const records = base();
    const sam = records.sam as SbdRecord;
    const sheet = callSheet(records, 'p', 'd2', [{ record: sam, fields: personFields(sam.props) }]);
    expect(sheet?.crew.flatMap((g) => g.people.map((p) => p.record.id))).toEqual(['sam']);
  });

  it('leaves out trashed frames, scenes, locations, people and characters', () => {
    const records = base();
    const sheet = callSheet(
      {
        ...records,
        c: trashed(records.c as SbdRecord),
        dock: trashed(records.dock as SbdRecord),
        kid: trashed(records.kid as SbdRecord),
        sam: trashed(records.sam as SbdRecord),
        joe: trashed(records.joe as SbdRecord),
      },
      'p',
      'd2',
    );
    // The Pier's only frame is gone, so its scene and its location go with it.
    expect(sheet?.scenes.map((s) => s.record.id)).toEqual(['s1']);
    expect(sheet?.locations.map((l) => l.fields.name)).toEqual(['Diner']);
    expect(sheet?.scenes[0]?.characters.map((c) => c.name)).toEqual(['MARY']);
    expect(sheet?.cast.map((c) => c.person.fields.name)).toEqual(['Ana Ruiz']);
    expect(sheet?.crew.flatMap((g) => g.people.map((p) => p.fields.name))).not.toContain('Sam Ortiz');
    // A scene in the Trash takes its frames off the sheet.
    expect(callSheet({ ...records, s2: trashed(records.s2 as SbdRecord) }, 'p', 'd2')?.scenes.map((s) => s.record.id)).toEqual(['s1']);
    // A location in the Trash reads as none on its scene.
    expect(callSheet({ ...records, diner: trashed(records.diner as SbdRecord) }, 'p', 'd2')?.scenes[0]?.location).toBeNull();
    // An actor in the Trash reads as nobody playing the part.
    expect(callSheet({ ...records, ana: trashed(records.ana as SbdRecord) }, 'p', 'd2')?.scenes[0]?.characters[0]?.cast).toBeNull();
  });

  it('shows a day with no frames: empty sections, the day still there', () => {
    const sheet = callSheet(base(record('d3', 'shoot_day', 'p', { date: '2026-11-20' })), 'p', 'd3');
    expect(sheet?.day.number).toBe(3);
    expect([sheet?.locations, sheet?.scenes, sheet?.cast]).toEqual([[], [], []]);
  });

  it('takes the first live call sheet by sort key, and ignores one in the Trash', () => {
    const records = base(
      record('cs2', 'callsheet', 'd2', { notes: 'second' }, 'b'),
      record('cs1', 'callsheet', 'd2', { notes: 'first', safety_notes: 'hard hats' }, 'a'),
      record('cs0', 'callsheet', 'd2', { notes: 'trashed' }, '0', at),
    );
    expect(dayCallsheet(records, 'd2')?.id).toBe('cs1');
    // The same key (two computers each made the first): the lower id is the call sheet, whatever the order.
    const tie = recordsOf(record('zz', 'callsheet', 'd2', {}, 'm'), record('aa', 'callsheet', 'd2', {}, 'm'));
    expect(dayCallsheet(tie, 'd2')?.id).toBe('aa');
    const sheet = callSheet(records, 'p', 'd2');
    expect([sheet?.notes.general, sheet?.notes.safety]).toEqual(['first', 'hard hats']);
    expect(dayCallsheet(recordsOf(record('only', 'callsheet', 'd2', {}, 'a', at)), 'd2')).toBeNull();
    expect(callSheet(base(), 'p', 'd1')?.notes).toEqual({ record: null, general: '', safety: '' });
  });
});

describe('the day the tile starts on', () => {
  it('is the first dated day on or after today, else the last day', () => {
    const days = projectShootDays(base(record('d3', 'shoot_day', 'p', {})), 'p');
    expect(defaultSheetDay(days, '2026-11-15')?.record.id).toBe('d1');
    expect(defaultSheetDay(days, '2026-11-16')?.record.id).toBe('d2');
    // Past the last dated day: the last day, which is the undated one here.
    expect(defaultSheetDay(days, '2027-01-01')?.record.id).toBe('d3');
    expect(defaultSheetDay([], '2026-11-16')).toBeNull();
  });

  it('works out each location’s sun in its zone, notes a location with no place, and says whose clock the day is in (4.3)', () => {
    const sunny = recordsOf(
      record('p', 'project', null, {}),
      record('d', 'shoot_day', 'p', { date: '2026-06-21', call_time: '06:00' }),
      record('ny', 'location', 'p', { name: 'Roof', latitude: 40.7128, longitude: -74.006, map_name: 'New York' }),
      record('bare', 'location', 'p', { name: 'Barn', address: 'Somewhere' }),
      record('s1', 'scene', 'p', { number: '1', location_id: 'ny' }, 'a'),
      record('s2', 'scene', 'p', { number: '2', location_id: 'bare' }, 'b'),
      record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }, 'a'),
      record('b', 'shot', 's2', { number: '2A', shoot_day_id: 'd' }, 'b'),
    );
    const sheet = callSheet(sunny, 'p', 'd', undefined, new Map([['ny', 'America/New_York']]));
    const roof = sheet?.locations.find((l) => l.record.id === 'ny');
    const barn = sheet?.locations.find((l) => l.record.id === 'bare');
    expect(roof?.zone).toEqual({ zone: 'America/New_York', source: 'map' });
    expect(roof?.sun?.sunrise).toMatch(/^05:2[3-7]$/);
    expect(roof?.sun?.sunset).toMatch(/^20:(29|3[0-3])$/);
    // No place on the map: no sun, nothing guessed from the address.
    expect(barn?.place).toBeNull();
    expect(barn?.sun).toBeNull();
    // The day's clock is the first location's zone.
    expect(sheet?.timesIn).toEqual(sheet?.locations[0]?.zone);
    // A zone chosen on the location wins over the map's, and moves the clock the times are written in.
    const moved = { ...sunny, ny: record('ny', 'location', 'p', { ...sunny.ny?.props, time_zone: 'Europe/Madrid' }) };
    const there = callSheet(moved, 'p', 'd', undefined, new Map([['ny', 'America/New_York']]))?.locations.find((l) => l.record.id === 'ny');
    expect(there?.zone).toEqual({ zone: 'Europe/Madrid', source: 'location' });
    expect(there?.sun?.sunrise).toMatch(/^11:2[3-7]$/);
  });

  it('has no sun without a date and no zone line without a location', () => {
    const none = recordsOf(record('p', 'project', null, {}), record('d', 'shoot_day', 'p', {}), record('ny', 'location', 'p', { name: 'Roof', latitude: 40.7, longitude: -74, map_name: 'NY' }));
    expect(callSheet(none, 'p', 'd')?.timesIn).toBeNull();
    const undated = recordsOf(
      record('p', 'project', null, {}),
      record('d', 'shoot_day', 'p', {}),
      record('ny', 'location', 'p', { name: 'Roof', latitude: 40.7, longitude: -74, map_name: 'NY' }),
      record('s1', 'scene', 'p', { number: '1', location_id: 'ny' }),
      record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
    );
    // Still waiting for the zone: no zone, no sun, no "Times in" line.
    const waiting = callSheet(undated, 'p', 'd');
    expect(waiting?.locations[0]?.zone).toBeNull();
    expect(waiting?.timesIn).toBeNull();
    const sheet = callSheet(undated, 'p', 'd', undefined, new Map([['ny', null]]));
    expect(sheet?.locations[0]?.sun).toBeNull();
    // Nothing known of the place's zone yet: this computer's, said as such.
    expect(sheet?.timesIn?.source).toBe('computer');
  });
});

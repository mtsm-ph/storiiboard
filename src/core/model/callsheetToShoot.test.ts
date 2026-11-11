import { describe, expect, it } from 'vitest';
import { departmentMissing } from '../checks';
import { checkContext } from '../checks/context';
import { callSheet } from './callsheet';
import { dayLocations, dayScenes } from './schedule';
import type { Props, SbdRecord } from './record';

// Only frames still to shoot are on the call sheet (4.11); the Calendar's helpers keep every frame of the day.

const at = '2030-11-01T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Record<string, SbdRecord> => Object.fromEntries(list.map((r) => [r.id, r]));
const withProps = (records: Record<string, SbdRecord>, id: string, props: Props) => ({
  ...records,
  [id]: { ...(records[id] as SbdRecord), props: { ...(records[id] as SbdRecord).props, ...props } },
});

// Scene 1 (diner, MARY played by Ana): 1A need, 1B have. Scene 2 (yard, JO played by Bo): 2A have. Scene 3 (diner): 3A source.
const base = () =>
  recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', { date: '2030-11-16', call_time: '07:00', wrap_time: '17:00', people_ids: ['dir', 'dp', 'ana', 'bo'] }),
    record('diner', 'location', 'p', { name: 'Diner' }),
    record('yard', 'location', 'p', { name: 'Yard' }),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('jo', 'character', 'p', { name: 'JO', cast_id: 'bo' }),
    record('s1', 'scene', 'p', { number: '1', int_ext: 'INT', day_night: 'DAY', location_id: 'diner', character_ids: ['mary'] }),
    record('s2', 'scene', 'p', { number: '2', int_ext: 'EXT', day_night: 'DAY', location_id: 'yard', character_ids: ['jo'] }),
    record('s3', 'scene', 'p', { number: '3', int_ext: 'INT', day_night: 'DAY', location_id: 'diner' }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd' }),
    record('b', 'shot', 's1', { number: '1B', status: 'have', shoot_day_id: 'd' }),
    record('c', 'shot', 's2', { number: '2A', status: 'have', shoot_day_id: 'd' }),
    record('e', 'shot', 's3', { number: '3A', status: 'source', shoot_day_id: 'd' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'] }),
    record('bo', 'person', 'p', { name: 'Bo Diaz', role: 'cast', departments: ['cast'] }),
    record('dir', 'person', 'p', { name: 'Dee Rector', departments: ['direction'] }),
    record('dp', 'person', 'p', { name: 'Kevin Matos', departments: ['camera'] }),
  );

const sheetOf = (records: Record<string, SbdRecord>) => {
  const sheet = callSheet(records, 'p', 'd');
  if (!sheet) throw new Error('no sheet');
  return sheet;
};

describe('the call sheet lists only frames still to shoot (4.11)', () => {
  it('keeps the scenes and the count of Need-to-shoot frames; scenes of Have or Source frames leave', () => {
    const sheet = sheetOf(base());
    expect(sheet.scenes.map((s) => [s.fields.number, s.frames])).toEqual([['1', 1]]);
    expect(sheet.nothingLeft).toBe(false);
  });

  it('keeps the Calendar’s scenes and locations as they were', () => {
    const records = base();
    expect(dayScenes(records, 'p', 'd').map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(dayLocations(records, 'p', 'd').map((l) => l.name)).toEqual(['Diner', 'Yard']);
  });

  it('drops a location only Have or Source frames used', () => {
    const sheet = sheetOf(base());
    expect(sheet.locations.map((l) => l.fields.name)).toEqual(['Diner']);
    expect(sheet.scenes[0]?.location).toBe('Diner');
    const moved = withProps(base(), 'a', { status: 'have' });
    expect(sheetOf(moved).locations).toEqual([]);
    expect(sheetOf(withProps(base(), 'c', { status: 'need' })).locations.map((l) => l.fields.name)).toEqual(['Diner', 'Yard']);
  });

  it('follows with the cast: an actor whose scene left is not on the sheet', () => {
    // Bo is chosen for the day, so stays listed, but with no part: JO's scene left.
    const parts = (r: Record<string, SbdRecord>) => sheetOf(r).cast.map((c) => `${c.person.fields.name}:${c.characters.join('+')}`);
    expect(parts(base())).toEqual(['Ana Ruiz:MARY', 'Bo Diaz:']);
    expect(parts(withProps(base(), 'c', { status: 'need' }))).toEqual(['Ana Ruiz:MARY', 'Bo Diaz:JO']);
    // Nobody chosen: only the actors of scenes still to shoot are listed with parts.
    const unchosen = { ...base(), d: { ...(base().d as SbdRecord), props: { date: '2030-11-16' } } };
    expect(sheetOf(unchosen).scenes[0]?.characters.map((c) => c.name)).toEqual(['MARY']);
  });

  it('gives the checks the same frames, so a dialogue scene whose frames are all Have no longer asks for Sound', () => {
    const records = withProps(base(), 'd', { people_ids: ['dir', 'dp', 'ana'] });
    const asks = (r: Record<string, SbdRecord>) => departmentMissing(checkContext(r, 'p', sheetOf(r))).map((f) => `${f.department}:${f.reason}`);
    expect(asks(records)).toContain('sound:dialogue');
    const shot = withProps(records, 'a', { status: 'have' });
    expect(checkContext(shot, 'p', sheetOf(shot)).frames).toEqual([]);
    expect(asks(shot)).toEqual([]);
  });

  it('says there is nothing left to shoot when every frame of the day is Have or Source, and keeps the people', () => {
    const sheet = sheetOf(withProps(base(), 'a', { status: 'have' }));
    expect(sheet.scenes).toEqual([]);
    expect(sheet.nothingLeft).toBe(true);
    expect(sheet.people).toHaveLength(4);
  });

  it('is not “nothing left” for a day with no frames at all', () => {
    const empty = sheetOf(recordsOf(record('p', 'project', null, {}), record('d', 'shoot_day', 'p', { date: '2030-11-16' })));
    expect(empty.nothingLeft).toBe(false);
  });
});

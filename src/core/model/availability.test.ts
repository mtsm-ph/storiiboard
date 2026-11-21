import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { addStretch, awayOn, isStretch, MAX_STRETCH_DAYS, personStretches, projectStretches, removeStretch, stretchDays, stretchLabel } from './availability';
import type { Props, SbdRecord } from './record';

// Unavailable dates (7.3): the reader's bounds, a stretch that can't be read (kept, never read), a person in the Trash,
// a removed stretch, the label, and the edits Cast and crew makes.

type Records = Record<string, SbdRecord>;

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null, sortKey = id): SbdRecord => ({
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
const away = (id: string, personId: string, from: unknown, to: unknown, extra: Props = {}, trashedAt: string | null = null) =>
  record(id, 'availability', personId, { from: from as string, to: to as string, state: 'unavailable', note: '', ...extra }, trashedAt);

const base = (...more: SbdRecord[]): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('robin', 'person', 'p', { name: 'Robin Vale', role: 'gaffer' }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', departments: ['sound'] }),
    ...more,
  );

afterEach(() => {
  setLocale('en');
});

describe('a stretch’s dates', () => {
  it('takes real dates in order, at most 366 days apart', () => {
    expect(isStretch('2026-11-24', '2026-11-24')).toBe(true);
    expect(isStretch('2026-11-24', '2026-11-28')).toBe(true);
    expect(isStretch('2026-11-28', '2026-11-24')).toBe(false);
    expect(stretchDays('2027-01-01', '2028-01-02')).toBe(366);
    expect(isStretch('2027-01-01', '2028-01-02')).toBe(true);
    expect(isStretch('2027-01-01', '2028-01-03')).toBe(false);
    expect(MAX_STRETCH_DAYS).toBe(366);
    // February 30 isn't a date; nor is a date with a time.
    expect(isStretch('2026-02-27', '2026-02-30')).toBe(false);
    expect(isStretch('2026-11-24T00:00', '2026-11-28')).toBe(false);
    expect(stretchDays('2026-11-24', 'soon')).toBeNull();
  });
});

describe('a person’s stretches', () => {
  it('reads each live stretch under a live person, earliest first, the note as text', () => {
    const records = base(away('b', 'robin', '2026-12-01', '2026-12-02', { note: 'Wedding' }), away('a', 'robin', '2026-11-24', '2026-11-28'));
    expect(personStretches(records, 'robin').map((s) => [s.record.id, s.from, s.to, s.note])).toEqual([
      ['a', '2026-11-24', '2026-11-28', ''],
      ['b', '2026-12-01', '2026-12-02', 'Wedding'],
    ]);
    expect(personStretches(records, 'sam')).toEqual([]);
  });

  it('reads a stretch that can’t be read as nothing, and leaves it as it is', () => {
    const odd = [
      away('x1', 'robin', '2026-11-28', '2026-11-24'),
      away('x2', 'robin', '2026-02-30', '2026-03-01'),
      away('x3', 'robin', 20261124, '2026-11-28'),
      away('x4', 'robin', '2026-11-24', '2028-01-01'),
      away('x5', 'robin', '2026-11-24', '2026-11-28', { state: 'tentative' }),
      record('x6', 'availability', 'robin', { date: '2026-11-24', shoot_day_id: 'd1' }),
    ];
    const records = base(...odd, away('ok', 'robin', '2026-11-24', '2026-11-24', { note: 42 }));
    expect(personStretches(records, 'robin').map((s) => [s.record.id, s.note])).toEqual([['ok', '']]);
    // Nothing offers to remove what can't be read either: it's never shown.
    for (const r of odd) expect(records[r.id]).toBe(r);
  });

  it('skips a removed stretch, and every stretch of a person in the Trash, who keeps them for a restore', () => {
    const records = base(away('a', 'robin', '2026-11-24', '2026-11-28'), away('b', 'robin', '2026-12-01', '2026-12-01', {}, at));
    expect(personStretches(records, 'robin').map((s) => s.record.id)).toEqual(['a']);
    const trashed: Records = { ...records, robin: { ...(records.robin as SbdRecord), trashedAt: at } };
    expect(personStretches(trashed, 'robin')).toEqual([]);
    expect(projectStretches(trashed, 'p')).toEqual([]);
    expect(trashed.a?.trashedAt).toBeNull();
  });

  it('lists the project’s stretches once per records, and who is away on a date, both ends included', () => {
    const records = base(away('a', 'robin', '2026-11-24', '2026-11-28'), away('b', 'sam', '2026-11-28', '2026-11-30'), away('c', 'robin', '2026-11-26', '2026-11-27'));
    expect(projectStretches(records, 'p')).toBe(projectStretches(records, 'p'));
    expect([...awayOn(records, 'p', '2026-11-23').keys()]).toEqual([]);
    expect([...awayOn(records, 'p', '2026-11-24').keys()]).toEqual(['robin']);
    expect(awayOn(records, 'p', '2026-11-26').get('robin')?.map((s) => s.record.id)).toEqual(['a', 'c']);
    expect([...awayOn(records, 'p', '2026-11-28').keys()]).toEqual(['robin', 'sam']);
    expect([...awayOn(records, 'p', '2026-12-01').keys()]).toEqual([]);
    expect(awayOn(records, 'p', '').size).toBe(0);
    // Another project's people aren't this one's.
    expect(projectStretches(records, 'other')).toEqual([]);
  });
});

describe('the label', () => {
  it('reads "Nov 24 – Nov 28", one date alone, and the year on both ends across a new year', () => {
    expect(stretchLabel('2026-11-24', '2026-11-28')).toBe('Nov 24 – Nov 28');
    expect(stretchLabel('2026-11-24', '2026-11-24')).toBe('Nov 24');
    expect(stretchLabel('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027');
    expect(stretchLabel('nope', '2026-11-24')).toBe('');
    setLocale('es');
    expect(stretchLabel('2026-11-24', '2026-11-28')).toMatch(/^24 nov\.? – 28 nov\.?$/);
  });
});

describe('the edits', () => {
  it('adds a stretch under a live person, after their others, with its note trimmed', () => {
    const records = base(away('a', 'robin', '2026-11-24', '2026-11-28'));
    const [change] = addStretch(records, 'robin', '2026-12-01', '2026-12-03', '  Wedding ', 'n');
    expect(change).toMatchObject({ kind: 'create', record: { id: 'n', type: 'availability', parentId: 'robin', props: { from: '2026-12-01', to: '2026-12-03', state: 'unavailable', note: 'Wedding' } } });
    if (change?.kind !== 'create') throw new Error('a create');
    expect(change.record.sortKey > 'a').toBe(true);
  });

  it('adds nothing for dates that don’t make a stretch, or a person not live', () => {
    const records = base();
    expect(addStretch(records, 'robin', '2026-11-28', '2026-11-24', '')).toEqual([]);
    expect(addStretch(records, 'robin', '', '', '')).toEqual([]);
    expect(addStretch(records, 'nobody', '2026-11-24', '2026-11-24', '')).toEqual([]);
    const trashed: Records = { ...records, robin: { ...(records.robin as SbdRecord), trashedAt: at } };
    expect(addStretch(trashed, 'robin', '2026-11-24', '2026-11-24', '')).toEqual([]);
  });

  it('removes a stretch with a trash op, so undo brings it back; nothing for one already off or not a stretch', () => {
    const records = base(away('a', 'robin', '2026-11-24', '2026-11-28'), away('b', 'robin', '2026-12-01', '2026-12-01', {}, at));
    expect(removeStretch(records, 'a')).toEqual([{ kind: 'trash', id: 'a' }]);
    expect(removeStretch(records, 'b')).toEqual([]);
    expect(removeStretch(records, 'robin')).toEqual([]);
    expect(removeStretch(records, 'gone')).toEqual([]);
  });
});

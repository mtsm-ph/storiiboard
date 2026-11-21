import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../model/record';
import { callSheetChecks, runChecks, unavailableOnDay } from '.';

// The seventh check (7.3): someone on a live shoot day whose unavailable dates take in its date. Inside, on both edges
// and outside; a day without its list (everyone); a day with no date; someone not on the day; two stretches over the
// same date, one finding; a person in the Trash. The strip's words are in src/features/callsheets/unavailableStrip.test.tsx.

type Records = Record<string, SbdRecord>;

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const away = (id: string, personId: string, from: string, to: string, trashedAt: string | null = null) =>
  record(id, 'availability', personId, { from, to, state: 'unavailable', note: 'Family wedding' }, trashedAt);
const withProps = (records: Records, id: string, props: Props): Records => {
  const old = records[id] as SbdRecord;
  return { ...records, [id]: { ...old, props: { ...old.props, ...props } } };
};

const project = (date: string, ...more: SbdRecord[]): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('d', 'shoot_day', 'p', { date, call_time: '07:00', people_ids: ['robin', 'sam'] }),
    record('robin', 'person', 'p', { name: 'Robin Vale', role: 'gaffer', departments: ['grip-electric'] }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', departments: ['sound'] }),
    record('lee', 'person', 'p', { name: 'Lee Park', role: 'cast', departments: ['cast'] }),
    away('a', 'robin', '2026-11-24', '2026-11-28'),
    ...more,
  );
const found = (records: Records) => unavailableOnDay(records, 'p').map((f) => `${f.personId}:${f.date}:${f.stretches.map((s) => s.id).join('+')}`);

describe('cast or crew called on a day they marked unavailable', () => {
  it('finds someone on a day inside their stretch, and on its first and last dates', () => {
    expect(found(project('2026-11-26'))).toEqual(['robin:2026-11-26:a']);
    expect(found(project('2026-11-24'))).toEqual(['robin:2026-11-24:a']);
    expect(found(project('2026-11-28'))).toEqual(['robin:2026-11-28:a']);
    expect(unavailableOnDay(project('2026-11-26'), 'p')[0]).toEqual({
      kind: 'unavailable-on-day',
      dayId: 'd',
      date: '2026-11-26',
      personId: 'robin',
      stretches: [{ id: 'a', from: '2026-11-24', to: '2026-11-28' }],
    });
  });

  it('finds nothing outside it', () => {
    expect(found(project('2026-11-23'))).toEqual([]);
    expect(found(project('2026-11-29'))).toEqual([]);
  });

  it('reads a day without its list as everyone, cast included, as 4.2 does', () => {
    const records = project('2026-11-25', away('l', 'lee', '2026-11-25', '2026-11-25'));
    expect(found(records)).toEqual(['robin:2026-11-25:a']);
    const open = { ...records, d: { ...(records.d as SbdRecord), props: { date: '2026-11-25' } } };
    // Everyone, in Cast and crew's order (by name).
    expect(found(open)).toEqual(['lee:2026-11-25:l', 'robin:2026-11-25:a']);
  });

  it('finds nothing for a day with no date, or in the Trash', () => {
    expect(found(project(''))).toEqual([]);
    const records = project('2026-11-26');
    expect(found({ ...records, d: { ...(records.d as SbdRecord), trashedAt: at } })).toEqual([]);
  });

  it('finds nothing for someone away who isn’t on the day', () => {
    expect(found(withProps(project('2026-11-26'), 'd', { people_ids: ['sam'] }))).toEqual([]);
  });

  it('gives one finding for two stretches over the same date, naming both', () => {
    expect(found(project('2026-11-26', away('b', 'robin', '2026-11-26', '2026-12-02')))).toEqual(['robin:2026-11-26:a+b']);
  });

  it('finds nothing for a person in the Trash, a removed stretch, or one that can’t be read', () => {
    const records = project('2026-11-26');
    expect(found({ ...records, robin: { ...(records.robin as SbdRecord), trashedAt: at } })).toEqual([]);
    expect(found({ ...records, a: { ...(records.a as SbdRecord), trashedAt: at } })).toEqual([]);
    expect(found(withProps(records, 'a', { to: '2026-11-20' }))).toEqual([]);
  });

  it('is among the project-wide checks, and runs on the call sheet after the HMU check', () => {
    const records = project('2026-11-26');
    expect(runChecks(records, 'p').map((f) => f.kind)).toEqual(['unavailable-on-day']);
    expect(callSheetChecks(records, 'p', 'd').findings.filter((f) => f.kind === 'unavailable-on-day').map((f) => f.personId)).toEqual(['robin']);
    expect(callSheetChecks(project('2026-11-30'), 'p', 'd').findings.map((f) => f.kind)).not.toContain('unavailable-on-day');
  });
});

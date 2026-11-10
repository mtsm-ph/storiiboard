import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, describeEdit, fieldChanges, lineText } from './summary';

// Who is on a day and when they are called, in History (4.2): by name and day, call times with their before and
// after, and never a phone or an email.

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'm',
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const op = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null): LoggedOp => ({
  id: 'o',
  seq: 1,
  groupId: 'g',
  groupKind: 'edit',
  recordId: (after ?? before)?.id ?? '',
  kind,
  before,
  after,
  author: 'local',
  timestamp: at,
});

const day = (props: Props) => record('d', 'shoot_day', 'p', { date: '2026-11-16', ...props });
const ana = record('ana', 'person', 'p', { name: 'Ana Ruiz', phone: '555 0101', email: 'ana@example.com' });
const bo = record('bo', 'person', 'p', { name: 'Bo Diaz' });
const around = new Map([['d', day({})], ['ana', ana], ['bo', bo]]);
const none = new Set<string>();
const say = (before: SbdRecord | null, after: SbdRecord, kind: LoggedOp['kind'] = 'update') => lineText(describeEdit([op(kind, before, after)], none, around));

afterEach(() => {
  setLocale('en');
});

describe('History for who is on a day', () => {
  it('says who was added or taken off, by name and day', () => {
    expect(say(day({ people_ids: [] }), day({ people_ids: ['ana'] }))).toBe('Added Ana Ruiz to Mon, Nov 16');
    expect(say(day({ people_ids: ['ana', 'bo'] }), day({ people_ids: ['bo'] }))).toBe('Took Ana Ruiz off Mon, Nov 16');
    expect(say(day({ people_ids: ['ana'] }), day({ people_ids: ['ana', 'bo'] }))).toBe('Added Bo Diaz to Mon, Nov 16');
  });

  it('says everyone for a day that had no list, or several added at once, and a plain change for a mix', () => {
    expect(say(day({}), day({ people_ids: ['ana', 'bo'] }))).toBe('Added everyone to Mon, Nov 16');
    expect(say(day({ people_ids: [] }), day({ people_ids: ['ana', 'bo'] }))).toBe('Added everyone to Mon, Nov 16');
    expect(say(day({ people_ids: ['ana'] }), day({ people_ids: ['bo'] }))).toBe('Changed who is on Mon, Nov 16');
  });

  it('says them in Spanish too', () => {
    setLocale('es');
    expect(say(day({ people_ids: [] }), day({ people_ids: ['ana'] }))).toBe('Se agregó a Ana Ruiz a lun, 16 nov');
    expect(say(day({ people_ids: ['ana'] }), day({ people_ids: [] }))).toBe('Se quitó a Ana Ruiz de lun, 16 nov');
    expect(say(day({}), day({ people_ids: ['ana', 'bo'] }))).toBe('Se agregó a todos a lun, 16 nov');
  });

  it('names a person it cannot read in words, never by id', () => {
    const line = lineText(describeEdit([op('update', day({ people_ids: [] }), day({ people_ids: ['ghost'] }))], none, new Map([['d', day({})]])));
    expect(line).toBe('Added a person to Mon, Nov 16');
  });
});

describe('History for a call sheet’s times', () => {
  const sheet = (props: Props) => record('cs', 'callsheet', 'd', props);

  it('names a department’s call and shows its before and after', () => {
    expect(say(sheet({}), sheet({ department_calls: { camera: '06:30' } }))).toBe('Call sheet · Mon, Nov 16: Camera’s call — → 06:30');
    expect(say(sheet({ department_calls: { camera: '06:30' } }), sheet({ department_calls: { camera: '07:00' } }))).toBe('Call sheet · Mon, Nov 16: Camera’s call 06:30 → 07:00');
    expect(say(sheet({ department_calls: { camera: '06:30' } }), sheet({}))).toBe('Call sheet · Mon, Nov 16: Camera’s call 06:30 → —');
  });

  it('names a person’s call, HMU ready and on set, and reads a first one as a change, not a call sheet added', () => {
    expect(say(sheet({ person_times: { ana: { call: '09:00' } } }), sheet({ person_times: { ana: { call: '09:30' } } }))).toBe('Call sheet · Mon, Nov 16: Ana Ruiz’s call 09:00 → 09:30');
    expect(say(sheet({}), sheet({ person_times: { ana: { hmu_ready: '08:00' } } }))).toBe('Call sheet · Mon, Nov 16: Ana Ruiz’s HMU ready — → 08:00');
    expect(say(null, sheet({ person_times: { ana: { on_set: '10:30' } } }), 'create')).toBe('Call sheet · Mon, Nov 16: Ana Ruiz’s time on set — → 10:30');
  });

  it('lists several changes by name, and says them in Spanish', () => {
    const after = sheet({ person_times: { ana: { call: '09:00' }, bo: { call: '07:00' } } });
    expect(say(sheet({}), after)).toBe('Call sheet · Mon, Nov 16: Ana Ruiz’s call, Bo Diaz’s call');
    setLocale('es');
    expect(say(sheet({}), sheet({ department_calls: { camera: '06:30' } }))).toBe('Hoja de llamado · lun, 16 nov: Llamado de Cámara — → 06:30');
    expect(say(sheet({}), sheet({ person_times: { ana: { call: '09:00' } } }))).toBe('Hoja de llamado · lun, 16 nov: Llamado de Ana Ruiz — → 09:00');
    expect(say(sheet({}), sheet({ person_times: { ana: { hmu_ready: '08:00' } } }))).toBe('Hoja de llamado · lun, 16 nov: HMU lista de Ana Ruiz — → 08:00');
    expect(say(sheet({}), sheet({ person_times: { ana: { on_set: '10:30' } } }))).toBe('Hoja de llamado · lun, 16 nov: Hora en set de Ana Ruiz — → 10:30');
  });

  it('still keeps the notes private beside the times, and gives labels without names', () => {
    const before = sheet({ notes: 'Gate code 4471' });
    const after = sheet({ notes: 'Gate code 9999', department_calls: { camera: '06:30' } });
    const changes = fieldChanges(before, after);
    expect(changes.map((change) => changeLabel(change))).toEqual(['general notes', 'Camera’s call']);
    expect(say(before, after)).not.toMatch(/4471|9999/);
    expect(changeLabel({ prop: 'person_times', key: 'ana:call', before: '', after: '09:00', sheet: true })).toBe('a person’s call');
  });

  it('never carries a phone or an email into any line', () => {
    const lines = [
      say(day({ people_ids: [] }), day({ people_ids: ['ana'] })),
      say(day({ people_ids: ['ana'] }), day({ people_ids: [] })),
      say(sheet({}), sheet({ person_times: { ana: { call: '09:00' } } })),
      say(ana, { ...ana, props: { ...ana.props, contact_on_sheet: true } }),
    ];
    for (const line of lines) expect(line).not.toMatch(/555|example\.com/);
    expect(lines[3]).toBe('Ana Ruiz: phone and email on call sheets — → on');
  });
});

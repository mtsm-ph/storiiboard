import { awayOn, type Stretch } from '../../core/model/availability';
import { projectPeople, type PersonFields } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import { dayPeople } from '../../core/model/schedule';
import type { ShootDay } from '../../core/model/shootDay';

// Who the Calendar shows as away on a date (7.3): on a date with a shoot, the people on its days (`people_ids`, or
// everyone while nobody has chosen) whose unavailable dates take it in; on a date with none, anyone at all who is away.
// In Cast and crew's order. Worked out from the records, never stored.

type Records = Readonly<Record<string, SbdRecord>>;

export interface AwayPerson {
  record: SbdRecord;
  fields: PersonFields;
  /** Their stretches that take in the date, earliest first. */
  stretches: Stretch[];
}

/** `shoots`: the live shoot days on the date (none for a date with no shoot). */
export function awayShown(records: Records, projectId: string, date: string, shoots: readonly ShootDay[]): AwayPerson[] {
  const away = awayOn(records, projectId, date);
  if (away.size === 0) return [];
  const called = shoots.length === 0 ? null : new Set(shoots.flatMap((day) => dayPeople(records, projectId, day.record).map((p) => p.record.id)));
  return projectPeople(records, projectId).flatMap(({ record, fields }) => {
    const stretches = away.get(record.id);
    return stretches && (called === null || called.has(record.id)) ? [{ record, fields, stretches }] : [];
  });
}

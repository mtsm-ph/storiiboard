import { awayOn } from '../model/availability';
import type { SbdRecord } from '../model/record';
import { dayPeople } from '../model/schedule';
import { projectShootDays, type ShootDay } from '../model/shootDay';
import { keptFor } from '../model/recordIndex';
import type { CheckContext } from './context';

// Check 7 (7.3, CLAUDE.md's "Cast called on a day they marked unavailable"): someone on a live shoot day whose
// unavailable dates take in the day's date. It runs for everyone on the day, cast and crew (the session's reading,
// Kevin can overrule it: a crew member away is the same mistake). Who is on a day is its `people_ids`, everyone live
// while nobody has chosen (4.2). A day with no date, a person in the Trash and a stretch that can't be read find
// nothing. One finding per person and day, however many of their stretches take it in.

type Records = Readonly<Record<string, SbdRecord>>;

export interface UnavailableOnDay {
  kind: 'unavailable-on-day';
  dayId: string;
  /** The day's date, YYYY-MM-DD. */
  date: string;
  personId: string;
  /** Every stretch of theirs that takes in the date, earliest first: the record and its dates. */
  stretches: { id: string; from: string; to: string }[];
}

function forDay(records: Records, projectId: string, day: ShootDay, people: readonly { record: SbdRecord }[]): UnavailableOnDay[] {
  const { date } = day.fields;
  if (date === '') return [];
  const away = awayOn(records, projectId, date);
  if (away.size === 0) return [];
  return people.flatMap(({ record }): UnavailableOnDay[] => {
    const stretches = away.get(record.id);
    if (!stretches) return [];
    return [{ kind: 'unavailable-on-day', dayId: day.record.id, date, personId: record.id, stretches: stretches.map((s) => ({ id: s.record.id, from: s.from, to: s.to })) }];
  });
}

/** The call sheet's run (4.8's strip): the people on its day who are away that date. */
export function unavailableOnSheet({ records, projectId, sheet }: CheckContext): UnavailableOnDay[] {
  return forDay(records, projectId, sheet.day, sheet.people);
}

/** Every live day's findings, in the days' order: the project-wide list (7.4's Checks tile, 7.5's server). Shared: don't change it. */
export function unavailableOnDay(records: Records, projectId: string): readonly UnavailableOnDay[] {
  return keptFor(records, `checks.unavailable:${projectId}`, () => projectShootDays(records, projectId).flatMap((day) => forDay(records, projectId, day, dayPeople(records, projectId, day.record))));
}

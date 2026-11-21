import { formatDate, t } from '../i18n';
import { keyAfterKeys } from '../ops/order';
import type { Change } from '../ops/ops';
import type { Props, SbdRecord } from './record';
import { childrenByParent, childrenOf, keptFor } from './recordIndex';
import { isDayDate } from './shootDay';

// Unavailable dates (7.3, docs/PHASE7_DECISIONS.md 6): an `availability` record under its `person`, one per stretch
// (a week away is one record), whole dates only. Typed on the desktop in Cast and crew for now; a department's change
// file may bring them later, so the record is the one place they live. `from` and `to` are real calendar dates, `to`
// on or after `from` and at most 366 days on; `state` is `unavailable`, the only value written; `note` is text. A
// record whose dates can't be read, or whose state this version doesn't know, is kept as it is and read as nothing:
// never rewritten. Removing a stretch is a `trash` op (undo brings it back), but availability isn't among the Trash's
// kinds: it is never listed there. A person in the Trash keeps their stretches under them, skipped while they're there.

type Records = Readonly<Record<string, SbdRecord>>;

/** The most days a stretch may run past its first (a year and a leap day). */
export const MAX_STRETCH_DAYS = 366;

export interface Stretch {
  record: SbdRecord;
  personId: string;
  /** YYYY-MM-DD, both real dates, `to` on or after `from`. */
  from: string;
  to: string;
  note: string;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number => Date.parse(`${date}T12:00:00Z`) / DAY_MS;

/** Days from `from` to `to` (0 for one date), or null when either isn't a real date. */
export function stretchDays(from: string, to: string): number | null {
  if (!isDayDate(from) || !isDayDate(to)) return null;
  return Math.round(dayNumber(to) - dayNumber(from));
}

/** Whether a from and a to make a stretch this version writes: real dates, in order, at most 366 days apart. */
export function isStretch(from: string, to: string): boolean {
  const days = stretchDays(from, to);
  return days !== null && days >= 0 && days <= MAX_STRETCH_DAYS;
}

/** A record's stretch as read, or null: not an availability record, its dates unreadable, or a state not known here. */
export function stretchOf(record: SbdRecord): Omit<Stretch, 'personId'> | null {
  if (record.type !== 'availability') return null;
  const { from, to, state, note } = record.props;
  if (state !== 'unavailable' || typeof from !== 'string' || typeof to !== 'string' || !isStretch(from, to)) return null;
  return { record, from, to, note: typeof note === 'string' ? note : '' };
}

const byDates = (a: Stretch, b: Stretch): number =>
  a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;

const livePerson = (records: Records, id: string, projectId?: string): boolean => {
  const person = records[id];
  return person?.type === 'person' && person.trashedAt === null && (projectId === undefined || person.parentId === projectId);
};

/** A live person's live, readable stretches, earliest first. None for a person in the Trash or gone. */
export function personStretches(records: Records, personId: string): Stretch[] {
  if (!livePerson(records, personId)) return [];
  return childrenOf(records, personId, 'availability')
    .flatMap((record) => {
      const read = record.trashedAt === null ? stretchOf(record) : null;
      return read ? [{ ...read, personId }] : [];
    })
    .sort(byDates);
}

/**
 * Every live, readable stretch of the project's live people, earliest first: kept per records object, so the Calendar
 * and the checks read it once per edit. Shared: don't change it.
 */
export function projectStretches(records: Records, projectId: string): readonly Stretch[] {
  return keptFor(records, `availability.project:${projectId}`, () =>
    [...childrenByParent(records, 'availability').keys()].filter((id) => livePerson(records, id, projectId)).flatMap((id) => personStretches(records, id)).sort(byDates),
  );
}

/** Whether a stretch takes in a date (both ends included). */
export const covers = (stretch: Pick<Stretch, 'from' | 'to'>, date: string): boolean => stretch.from <= date && date <= stretch.to;

/** The stretches that take in a date, by person, in the order projectStretches gives. */
export function awayOn(records: Records, projectId: string, date: string): Map<string, Stretch[]> {
  const found = new Map<string, Stretch[]>();
  if (!isDayDate(date)) return found;
  for (const stretch of projectStretches(records, projectId)) {
    if (stretch.from > date) break;
    if (!covers(stretch, date)) continue;
    found.set(stretch.personId, [...(found.get(stretch.personId) ?? []), stretch]);
  }
  return found;
}

const short = (date: string, year: boolean): string =>
  formatDate(new Date(`${date}T12:00:00Z`), { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "Nov 24 – Nov 28", one date alone as "Nov 24"; the year on both ends when the stretch crosses into the next. */
export function stretchLabel(from: string, to: string): string {
  if (!isDayDate(from) || !isDayDate(to)) return '';
  if (from === to) return short(from, false);
  const year = from.slice(0, 4) !== to.slice(0, 4);
  return t('availability.range', { from: short(from, year), to: short(to, year) });
}

/** A new stretch under a live person: nothing when the dates don't make one. The note is kept as typed, trimmed. */
export function addStretch(records: Records, personId: string, from: string, to: string, note: string, id: string = crypto.randomUUID()): Change[] {
  if (!livePerson(records, personId) || !isStretch(from, to)) return [];
  // After every stretch they have, the Trash's too, so one put back never shares a key (keyAfterKeys reads past an odd one).
  const sortKey = keyAfterKeys(childrenOf(records, personId, 'availability').map((r) => r.sortKey));
  const props: Props = { from, to, state: 'unavailable', note: note.trim() };
  return [{ kind: 'create', record: { id, type: 'availability', parentId: personId, sortKey, props } }];
}

/** A stretch taken off: a trash op, so undo brings it back. Nothing when it isn't a live stretch of a live person. */
export function removeStretch(records: Records, id: string): Change[] {
  const record = records[id];
  if (record?.type !== 'availability' || record.trashedAt !== null || record.parentId === null || !livePerson(records, record.parentId)) return [];
  return [{ kind: 'trash', id }];
}

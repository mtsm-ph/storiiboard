import { dayCallsheet } from '../../core/model/callsheet';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import { HMU_MINUTES, isClockTime } from '../../core/model/shootDay';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the call sheet makes: its two notes (4.1), and its department and person times (4.2). The `callsheet` record under a day is made by the
// first note typed, in the same change list, so one ⌘Z takes both back; just viewing a day never makes one.

type Records = Readonly<Record<string, SbdRecord>>;

export type CallsheetNote = 'notes' | 'safety_notes';

type Props = { [key: string]: JsonValue };
const objectOf = (value: JsonValue | undefined): Props | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null);

/** A live day, or null. */
const liveDay = (records: Records, dayId: string): SbdRecord | null => {
  const day = records[dayId];
  return day?.type === 'shoot_day' && day.trashedAt === null ? day : null;
};

/**
 * Sets (or with `undefined` takes off) one prop of a day's call sheet, making the record when it has none: the create
 * and the set are one change list, so one ⌘Z. A day's first call sheet isn't made just to take something off.
 */
function sheetProp(records: Records, dayId: string, prop: string, value: JsonValue | undefined, id: string): Change[] {
  const sheet = dayCallsheet(records, dayId);
  if (!sheet) {
    if (value === undefined) return [];
    // After every call sheet the day has had (in the Trash too), so a restored one never shares a key.
    const last = Object.values(records)
      .filter((r) => r.type === 'callsheet' && r.parentId === dayId)
      .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    return [{ kind: 'create', record: { id, type: 'callsheet', parentId: dayId, sortKey: keyBetween(last, null), props: { [prop]: value } } }];
  }
  return value === undefined ? [{ kind: 'update', id: sheet.id, unset: [prop] }] : [{ kind: 'update', id: sheet.id, set: { [prop]: value } }];
}

/**
 * One of a day's notes; an empty value takes it off. Nothing when it's already so, or the day isn't live. The first
 * note of a day creates its call sheet with the note on it.
 */
export function callsheetNoteChange(records: Records, dayId: string, prop: CallsheetNote, value: string, id: string = crypto.randomUUID()): Change[] {
  if (!liveDay(records, dayId)) return [];
  const sheet = dayCallsheet(records, dayId);
  const current = typeof sheet?.props[prop] === 'string' ? sheet.props[prop] : '';
  if (current === value) return [];
  return sheetProp(records, dayId, prop, value === '' ? undefined : value, id);
}

/** A time the way the Shoot days tile edits one: empty (take it off) or HH:MM. */
const validTime = (value: string): boolean => value === '' || isClockTime(value);

/**
 * A department's call on the sheet (4.2): `department_calls`, `{ "<department id>": "HH:MM" }`. An empty value takes
 * the key off (and the prop when it's the last). What else the prop holds is written back as it was; a prop that isn't
 * an object is never written over. Nothing when it's already so, the time isn't one, or the day isn't live.
 */
export function departmentCallChange(records: Records, dayId: string, department: string, value: string, id: string = crypto.randomUUID()): Change[] {
  if (!liveDay(records, dayId) || !validTime(value)) return [];
  const sheet = dayCallsheet(records, dayId);
  const stored = sheet?.props.department_calls;
  if (stored !== undefined && objectOf(stored) === null) return [];
  const calls = objectOf(stored) ?? {};
  const current = typeof calls[department] === 'string' && isClockTime(calls[department]) ? calls[department] : '';
  if (current === value) return [];
  const next = Object.fromEntries(Object.entries(calls).filter(([key]) => key !== department));
  if (value !== '') next[department] = value;
  return sheetProp(records, dayId, 'department_calls', Object.keys(next).length === 0 ? undefined : next, id);
}

export type PersonTime = 'call' | 'hmu_ready' | 'on_set';

/**
 * A person's call, HMU ready or on-set time on the sheet (4.2): `person_times`, `{ "<person id>": { call, hmu_ready,
 * on_set } }`. An empty value takes the key off, and a person with nothing left is taken off. Keys this version
 * doesn't know are written back as they were; a prop, or a person's entry, that isn't an object is never written over.
 */
export function personTimeChange(records: Records, dayId: string, personId: string, field: PersonTime, value: string, id: string = crypto.randomUUID()): Change[] {
  if (!liveDay(records, dayId) || !validTime(value)) return [];
  const sheet = dayCallsheet(records, dayId);
  const stored = sheet?.props.person_times;
  if (stored !== undefined && objectOf(stored) === null) return [];
  const times = objectOf(stored) ?? {};
  if (times[personId] !== undefined && objectOf(times[personId]) === null) return [];
  const entry = objectOf(times[personId]) ?? {};
  const current = typeof entry[field] === 'string' && isClockTime(entry[field]) ? entry[field] : '';
  if (current === value) return [];
  const nextEntry = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== field));
  if (value !== '') nextEntry[field] = value;
  const next = Object.fromEntries(Object.entries(times).filter(([key]) => key !== personId));
  if (Object.keys(nextEntry).length > 0) next[personId] = nextEntry;
  return sheetProp(records, dayId, 'person_times', Object.keys(next).length === 0 ? undefined : next, id);
}

/** The least minutes HMU needs before a cast call (4.8), on the project: nothing for a value out of range or unchanged. */
export function hmuMinutesChange(records: Records, projectId: string, minutes: number): Change[] {
  const project = records[projectId];
  if (project?.type !== 'project' || !Number.isInteger(minutes) || minutes < HMU_MINUTES.min || minutes > HMU_MINUTES.max) return [];
  return project.props.hmu_minutes === minutes ? [] : [{ kind: 'update', id: projectId, set: { hmu_minutes: minutes } }];
}

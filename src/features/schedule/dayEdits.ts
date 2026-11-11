import { isClockTime, isDayDate, SETUP_MINUTES, shootDayFields } from '../../core/model/shootDay';
import type { SbdRecord } from '../../core/model/record';
import { dayPeopleIds } from '../../core/model/schedule';
import { projectPeople } from '../../core/model/person';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the Days tile makes (3.7). Each is one op group, so one ⌘Z: a new day, one field, frames moved into a
// day, between days or out of them, a day to the Trash, who's on a day (4.2). A day in the Trash keeps its frames' links, so its frames read
// as unscheduled while it's there and go back into it with a restore.

type Records = Readonly<Record<string, SbdRecord>>;

const liveDay = (records: Records, id: string): SbdRecord | null => {
  const day = records[id];
  return day?.type === 'shoot_day' && day.trashedAt === null ? day : null;
};

/** The day after a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * A new day after the project's others (in the Trash too, so a restored one never shares a key), dated the day after
 * the latest live date, or `today` when there's none yet: the next shoot day is usually the next calendar day. From
 * 4.2 on it starts with nobody on it (`people_ids: []`); a day made before has no list and reads as everyone.
 */
export function newDay(records: Records, projectId: string, today: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const siblings = Object.values(records).filter((r) => r.type === 'shoot_day' && r.parentId === projectId);
  const last = siblings.reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  const dates = siblings.filter((r) => r.trashedAt === null).map((r) => shootDayFields(r.props).date).filter((d) => d !== '');
  const latest = dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);
  const date = latest ? nextDate(latest) : isDayDate(today) ? today : '';
  return { kind: 'create', record: { id, type: 'shoot_day', parentId: projectId, sortKey: keyBetween(last, null), props: { date, people_ids: [] } } };
}

export type DayField = 'date' | 'call_time' | 'wrap_time' | 'notes';

/** One field of a day; an empty value takes it off. Nothing when it's already that, it isn't a valid value, or the day's gone. */
export function dayChange(records: Records, id: string, prop: DayField, value: string): Change[] {
  const day = liveDay(records, id);
  if (!day) return [];
  if (value !== '' && ((prop === 'date' && !isDayDate(value)) || ((prop === 'call_time' || prop === 'wrap_time') && !isClockTime(value)))) return [];
  const current = typeof day.props[prop] === 'string' ? day.props[prop] : '';
  if (current === value) return [];
  return value === '' ? [{ kind: 'update', id, unset: [prop] }] : [{ kind: 'update', id, set: { [prop]: value } }];
}

/**
 * Frames into a day, or out of every day with null: one edit for all of them, so moving a scene's frames is one undo
 * step. Only live frames; one already there is left as it is.
 */
export function scheduleFrames(records: Records, shotIds: readonly string[], dayId: string | null): Change[] {
  if (dayId !== null && !liveDay(records, dayId)) return [];
  return shotIds.flatMap((id): Change[] => {
    const shot = records[id];
    if (shot?.type !== 'shot' || shot.trashedAt !== null) return [];
    const current = typeof shot.props.shoot_day_id === 'string' ? shot.props.shoot_day_id : null;
    if (current === dayId) return [];
    return dayId === null ? [{ kind: 'update', id, unset: ['shoot_day_id'] }] : [{ kind: 'update', id, set: { shoot_day_id: dayId } }];
  });
}

/** A day to the Trash; its frames keep their link, so a restore puts them back in it. */
export function trashDay(records: Records, id: string): Change[] {
  return liveDay(records, id) ? [{ kind: 'trash', id }] : [];
}

/** The project's minutes per setup, for every day's estimate; nothing for a value out of range or unchanged. */
export function setupMinutesChange(records: Records, projectId: string, minutes: number): Change[] {
  const project = records[projectId];
  if (!project || !Number.isInteger(minutes) || minutes < SETUP_MINUTES.min || minutes > SETUP_MINUTES.max) return [];
  return project.props.setup_minutes === minutes ? [] : [{ kind: 'update', id: projectId, set: { setup_minutes: minutes } }];
}

/**
 * The list a day's people edits start from: its `people_ids` exactly as stored (repeats and all, so an edit never
 * tidies what it wasn't asked to), or, while nobody has chosen, `[]`. Null when the day isn't live or the prop is
 * something other than a list (a later version's): never written over from here.
 */
function peopleBase(records: Records, dayId: string): string[] | null {
  const day = liveDay(records, dayId);
  if (!day) return null;
  if (day.props.people_ids !== undefined && dayPeopleIds(day.props) === null) return null;
  return dayPeopleIds(day.props) === null ? [] : [...(day.props.people_ids as string[])];
}

const livePerson = (records: Records, id: string) => records[id]?.type === 'person' && records[id].trashedAt === null;

/** A person onto a chosen day (after those there). Nothing when they're on it, aren't live, or nobody has chosen yet. */
export function dayPeopleAdd(records: Records, dayId: string, personId: string): Change[] {
  const base = peopleBase(records, dayId);
  const day = liveDay(records, dayId);
  if (!base || !day || dayPeopleIds(day.props) === null || base.includes(personId) || !livePerson(records, personId)) return [];
  return [{ kind: 'update', id: dayId, set: { people_ids: [...base, personId] } }];
}

/**
 * A person off a chosen day. Their confirmation and times stay as they are, so adding them back brings them back.
 * Nothing when they aren't on it.
 */
export function dayPeopleRemove(records: Records, dayId: string, personId: string): Change[] {
  const base = peopleBase(records, dayId);
  const day = liveDay(records, dayId);
  if (!base || !day || dayPeopleIds(day.props) === null || !base.includes(personId)) return [];
  return [{ kind: 'update', id: dayId, set: { people_ids: base.filter((id) => id !== personId) } }];
}

/**
 * Every live person not yet on the day, in Cast and crew's order, after those already there. On a day nobody has
 * chosen for it writes everyone, so it is "Choose who's on the day" too. Nothing when everyone is on already.
 */
export function dayPeopleAddEveryone(records: Records, projectId: string, dayId: string): Change[] {
  const base = peopleBase(records, dayId);
  if (!base) return [];
  const missing = projectPeople(records, projectId).map((p) => p.record.id).filter((id) => !base.includes(id));
  const day = liveDay(records, dayId);
  if (missing.length === 0 && day && dayPeopleIds(day.props) !== null) return [];
  return [{ kind: 'update', id: dayId, set: { people_ids: [...base, ...missing] } }];
}

/** "Choose who's on the day" for a day that has no list (made before 4.2): everyone live now, as one edit. */
export function dayPeopleChoose(records: Records, projectId: string, dayId: string): Change[] {
  const day = liveDay(records, dayId);
  return day && day.props.people_ids === undefined ? dayPeopleAddEveryone(records, projectId, dayId) : [];
}

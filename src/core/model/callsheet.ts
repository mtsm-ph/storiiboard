import { formatDate, t } from '../i18n';
import { castOf, characterName, contactOnSheet, isCastOnly, peopleByDepartment, personFields, projectPeople as allPeople, sceneCharacters, type PersonFields } from './person';
import { frameLocationId, locationFields, type LocationFields } from './location';
import type { Department } from './department';
import type { JsonValue, SbdRecord } from './record';
import { dayLocations, dayPeople, dayPeopleChosen, dayScenes } from './schedule';
import { dayFrames, isClockTime, isDayDate, projectShootDays, type ShootDay } from './shootDay';
import { sceneFields, type SceneFields } from './storyboard';

// A shoot day's call sheet (4.1), worked out from the project's records whenever it's drawn: nothing on it is copied
// from elsewhere (CLAUDE.md: views read records). The only thing it stores is what a call sheet adds, its own notes,
// on a `callsheet` record under the day. Later milestones add a section each (who's on the day and their calls 4.2,
// sun 4.3, weather 4.4, the hospital 4.5): they pass in more and add to this shape rather than reshape it.

// Where it began (4.1); it lives with the person's other rules now (4.2's contact default needs it).
export { isCastOnly };

type Records = Readonly<Record<string, SbdRecord>>;

export interface SheetPerson {
  record: SbdRecord;
  fields: PersonFields;
}

export interface SheetLocation {
  record: SbdRecord;
  fields: LocationFields;
}

/** A person's phone and email as the sheet prints them (4.2): only where their record allows it. */
export interface SheetContact {
  phone: string;
  email: string;
}

export interface SheetCharacter {
  record: SbdRecord;
  name: string;
  /** Who plays them, or null while nobody does. */
  cast: SheetPerson | null;
  /** False when the actor isn't on the day (4.2): the sheet marks it so a missed actor is seen. */
  onDay: boolean;
}

export interface SheetScene {
  record: SbdRecord;
  fields: SceneFields;
  /** The live locations this scene's frames are shot at on this day (a frame's own first), by name; null for none. */
  location: string | null;
  /** How many of the scene's frames are on this day. */
  frames: number;
  characters: SheetCharacter[];
}

/** The times a person is called (4.2); '' for one not set. */
export interface SheetTimes {
  /** Their own `call`; else the earliest of their departments' calls; else the day's crew call. */
  call: string;
  hmuReady: string;
  onSet: string;
}

export interface SheetCast {
  person: SheetPerson;
  /** The characters they play on this day, in scene order; none for cast on the day with no part in its scenes. */
  characters: string[];
  times: SheetTimes;
  /** Their own call as stored, '' when it is worked out from a department or the day (times.call). */
  ownCall: string;
  /** Phone and email, only when their record says they print. */
  contact: SheetContact | null;
}

export interface SheetCrewPerson extends SheetPerson {
  call: string;
  /** Their own call as stored; '' when `call` is worked out. */
  ownCall: string;
  contact: SheetContact | null;
}

export interface SheetCrewGroup {
  department: Department | null;
  /** The department's call (4.2): its override, else the day's crew call; '' for neither. Null for no department. */
  call: string | null;
  /** The department's stored override; '' when `call` is the day's. */
  ownCall: string;
  people: SheetCrewPerson[];
}

export interface CallSheetNotes {
  /** The day's live `callsheet` record; null until a note is typed. */
  record: SbdRecord | null;
  general: string;
  safety: string;
}

export interface CallSheet {
  day: ShootDay;
  /** How many live days the project has: "Day 3 of 5". */
  dayCount: number;
  /** The project's title as the top bar shows it; '' when it has none (the caller names it by the file). */
  title: string;
  locations: SheetLocation[];
  scenes: SheetScene[];
  cast: SheetCast[];
  crew: SheetCrewGroup[];
  /** Whether someone chose who's on the day; while not, everyone live in Cast and crew is. */
  peopleChosen: boolean;
  /** `people_ids` is there but not a list of text (a later version's): never written over, so not offered to choose. */
  peopleOdd: boolean;
  /** Who is on the day, in the order added (Cast and crew's while not chosen). */
  people: SheetPerson[];
  /** The live people not on the day, in Cast and crew's order: who "Add person" offers. */
  notOnDay: SheetPerson[];
  notes: CallSheetNotes;
}

// Two computers each making a day's first call sheet get the same key, so ties go by id: both agree on the first.
const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * A day's call sheet record: its live `callsheet` child. Two (two computers, a merged file) make the first by sort key
 * the call sheet and the others ignored. One in the Trash is no call sheet.
 */
export function dayCallsheet(records: Records, dayId: string): SbdRecord | null {
  return (
    Object.values(records)
      .filter((r) => r.type === 'callsheet' && r.parentId === dayId && r.trashedAt === null)
      .sort(bySortKey)[0] ?? null
  );
}

/** "Monday, November 16, 2026" in the app's language, or "" for no date. Read at noon UTC, so no time zone moves it a day. */
export function dayDateFull(date: string): string {
  return isDayDate(date)
    ? formatDate(new Date(`${date}T12:00:00Z`), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : '';
}

/**
 * The day the tile starts on: the first dated day on or after `today` (YYYY-MM-DD), else the last day. `days` is in
 * the order projectShootDays gives, so the undated come last and are never "after today".
 */
export function defaultSheetDay(days: readonly ShootDay[], today: string): ShootDay | null {
  const upcoming = days.find((d) => d.fields.date !== '' && d.fields.date >= today);
  return upcoming ?? days.at(-1) ?? null;
}

const objectOf = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
const clock = (value: JsonValue | undefined): string => (typeof value === 'string' && isClockTime(value) ? value : '');

/** The call sheet's department calls (4.2), by department id: only valid times; anything odd reads as unset. */
export function departmentCalls(sheetProps: Readonly<Record<string, JsonValue>> | undefined): ReadonlyMap<string, string> {
  const calls = objectOf(sheetProps?.department_calls);
  return new Map(Object.entries(calls ?? {}).flatMap(([id, time]) => (clock(time) !== '' ? [[id, clock(time)] as const] : [])));
}

/** What the sheet holds for one person (4.2), as set on them: a time not set or odd reads ''. */
export function personTimesOf(sheetProps: Readonly<Record<string, JsonValue>> | undefined, personId: string): SheetTimes {
  const entry = objectOf(objectOf(sheetProps?.person_times)?.[personId]);
  return { call: clock(entry?.call), hmuReady: clock(entry?.hmu_ready), onSet: clock(entry?.on_set) };
}

/**
 * A person's call on the sheet (4.2): their own; else the earliest override among their departments; else the day's
 * crew call; else ''. The sheet shows just the time, not where it came from.
 */
export function personCall(own: string, departments: readonly string[], calls: ReadonlyMap<string, string>, dayCall: string): string {
  if (own !== '') return own;
  const earliest = departments.flatMap((d) => calls.get(d) ?? []).sort()[0];
  return earliest ?? dayCall;
}

/**
 * The sections of one day's call sheet, or null when the day isn't a live day of the project. `people` is who is on
 * the day; left out, it is the people the day's `people_ids` names (4.2), or everyone live in Cast and crew while
 * nobody has chosen.
 */
export function callSheet(records: Records, projectId: string, dayId: string, people?: readonly SheetPerson[]): CallSheet | null {
  const days = projectShootDays(records, projectId);
  const day = days.find((d) => d.record.id === dayId);
  if (!day) return null;

  const chosen = dayPeopleChosen(day.record);
  const onDay = people ?? dayPeople(records, projectId, day.record);
  const onDayIds = new Set(onDay.map((p) => p.record.id));
  const sheet = dayCallsheet(records, dayId);
  const calls = departmentCalls(sheet?.props);
  const dayCall = day.fields.callTime;
  const contactOf = ({ fields }: SheetPerson): SheetContact | null => (contactOnSheet(fields) ? { phone: fields.phone, email: fields.email } : null);

  const frames = dayFrames(records, projectId, dayId);
  const scenes = dayScenes(records, projectId, dayId).map((record): SheetScene => {
    const fields = sceneFields(record.props);
    const here = frames.filter((f) => f.scene.id === record.id);
    const places = [...new Set(here.map(({ shot }) => frameLocationId(records, shot)).filter((id): id is string => id !== null))].map((id) => locationFields(records[id]?.props ?? {}).name || t('trash.unnamedLocation'));
    return {
      record,
      fields,
      location: places.length > 0 ? places.join(', ') : null,
      frames: here.length,
      // An unnamed character has nothing to print.
      characters: sceneCharacters(records, record).filter((c) => characterName(c) !== '').map((character) => {
        const player = castOf(records, character);
        return {
          record: character,
          name: characterName(character),
          cast: player ? { record: player, fields: personFields(player.props) } : null,
          onDay: player ? onDayIds.has(player.id) : true,
        };
      }),
    };
  });

  // Each actor on the day once, by their first character's first appearance; a character in several scenes is listed once.
  const cast: SheetCast[] = [];
  const addCast = (person: SheetPerson, character: string | null) => {
    const entry = cast.find((c) => c.person.record.id === person.record.id);
    const times = personTimesOf(sheet?.props, person.record.id);
    if (!entry) {
      cast.push({
        person,
        characters: character === null ? [] : [character],
        times: { ...times, call: personCall(times.call, person.fields.departments, calls, dayCall) },
        ownCall: times.call,
        contact: contactOf(person),
      });
    } else if (character !== null && !entry.characters.includes(character)) entry.characters.push(character);
  };
  for (const scene of scenes) {
    for (const character of scene.characters) {
      if (character.cast && character.onDay) addCast(character.cast, character.name);
    }
  }
  // Once someone has chosen the day's people, cast they chose are listed even when their parts aren't in its scenes.
  if (chosen) for (const person of onDay) if (isCastOnly(person.fields)) addCast(person, null);

  // The Cast section covers cast, so Crew has no Cast group.
  const crew = peopleByDepartment(onDay.filter((p) => !isCastOnly(p.fields)))
    .filter((g) => g.department !== 'cast')
    .map(({ department, people: members }): SheetCrewGroup => ({
      department,
      call: department === null ? null : (calls.get(department) ?? dayCall),
      ownCall: department === null ? '' : (calls.get(department) ?? ''),
      people: members.map((person) => ({
        ...person,
        call: personCall(personTimesOf(sheet?.props, person.record.id).call, person.fields.departments, calls, dayCall),
        ownCall: personTimesOf(sheet?.props, person.record.id).call,
        contact: contactOf(person),
      })),
    }));
  const project = records[projectId];
  return {
    day,
    dayCount: days.length,
    title: text(project?.props.title) || text(project?.props.name),
    locations: dayLocations(records, projectId, dayId).map(({ record }) => ({ record, fields: locationFields(record.props) })),
    scenes,
    cast,
    crew,
    peopleChosen: chosen,
    peopleOdd: !chosen && day.record.props.people_ids !== undefined,
    people: [...onDay],
    notOnDay: allPeople(records, projectId).filter((p) => !onDayIds.has(p.record.id)),
    notes: { record: sheet, general: text(sheet?.props.notes), safety: text(sheet?.props.safety_notes) },
  };
}

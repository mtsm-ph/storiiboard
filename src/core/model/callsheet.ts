import { formatDate, t } from '../i18n';
import { castOf, characterName, peopleByDepartment, personFields, projectPeople, sceneCharacters, type PersonFields } from './person';
import { frameLocationId, locationFields, type LocationFields } from './location';
import type { Department } from './department';
import type { SbdRecord } from './record';
import { dayLocations, dayScenes } from './schedule';
import { dayFrames, isDayDate, projectShootDays, type ShootDay } from './shootDay';
import { sceneFields, type SceneFields } from './storyboard';

// A shoot day's call sheet (4.1), worked out from the project's records whenever it's drawn: nothing on it is copied
// from elsewhere (CLAUDE.md: views read records). The only thing it stores is what a call sheet adds, its own notes,
// on a `callsheet` record under the day. Later milestones add a section each (who's on the day and their calls 4.2,
// sun 4.3, weather 4.4, the hospital 4.5): they pass in more and add to this shape rather than reshape it.

type Records = Readonly<Record<string, SbdRecord>>;

export interface SheetPerson {
  record: SbdRecord;
  fields: PersonFields;
}

export interface SheetLocation {
  record: SbdRecord;
  fields: LocationFields;
}

export interface SheetCharacter {
  record: SbdRecord;
  name: string;
  /** Who plays them, or null while nobody does. */
  cast: SheetPerson | null;
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

export interface SheetCast {
  person: SheetPerson;
  /** The characters they play on this day, in scene order. */
  characters: string[];
}

export interface SheetCrewGroup {
  department: Department | null;
  people: SheetPerson[];
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

/** Someone who only plays a part: in the Cast department alone, or in none with the cast role. */
export function isCastOnly(fields: Pick<PersonFields, 'departments' | 'role'>): boolean {
  const [only] = fields.departments;
  return fields.departments.length === 0 ? fields.role === 'cast' : fields.departments.length === 1 && only === 'cast';
}

/**
 * The day the tile starts on: the first dated day on or after `today` (YYYY-MM-DD), else the last day. `days` is in
 * the order projectShootDays gives, so the undated come last and are never "after today".
 */
export function defaultSheetDay(days: readonly ShootDay[], today: string): ShootDay | null {
  const upcoming = days.find((d) => d.fields.date !== '' && d.fields.date >= today);
  return upcoming ?? days.at(-1) ?? null;
}

/**
 * The sections of one day's call sheet, or null when the day isn't a live day of the project. `people` is who is on
 * the day: everyone live in Cast and crew until 4.2 says who is called.
 */
export function callSheet(records: Records, projectId: string, dayId: string, people?: readonly SheetPerson[]): CallSheet | null {
  const days = projectShootDays(records, projectId);
  const day = days.find((d) => d.record.id === dayId);
  if (!day) return null;

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
        return { record: character, name: characterName(character), cast: player ? { record: player, fields: personFields(player.props) } : null };
      }),
    };
  });

  // Each actor once, by their first character's first appearance; a character in several scenes is listed once.
  const cast: SheetCast[] = [];
  for (const scene of scenes) {
    for (const character of scene.characters) {
      if (!character.cast) continue;
      const id = character.cast.record.id;
      const entry = cast.find((c) => c.person.record.id === id);
      if (!entry) cast.push({ person: character.cast, characters: [character.name] });
      else if (!entry.characters.includes(character.name)) entry.characters.push(character.name);
    }
  }

  // The Cast section covers cast, so Crew has no Cast group.
  const crew = peopleByDepartment((people ?? projectPeople(records, projectId)).filter((p) => !isCastOnly(p.fields))).filter((g) => g.department !== 'cast');
  const project = records[projectId];
  const sheet = dayCallsheet(records, dayId);
  return {
    day,
    dayCount: days.length,
    title: text(project?.props.title) || text(project?.props.name),
    locations: dayLocations(records, projectId, dayId).map(({ record }) => ({ record, fields: locationFields(record.props) })),
    scenes,
    cast,
    crew,
    notes: { record: sheet, general: text(sheet?.props.notes), safety: text(sheet?.props.safety_notes) },
  };
}

import { frameLocationId, locationFields, type LocationStatus } from './location';
import { projectPeople, personFields, type PersonFields } from './person';
import { isObject } from './departmentStatus';
import type { Props, SbdRecord } from './record';
import { dayFrames } from './shootDay';

// What a shoot day brings together for the Calendar (3.8): its scenes, the locations it's at with whether each is
// booked, and how many of the crew have confirmed. Worked out from the day's frames and the people, never stored
// (CLAUDE.md: rollups are computed).
//
// Crew confirmed (docs/PHASE3_DECISIONS.md 10): set on the desktop for now, per person per day, in the day's `crew`
// prop, `{ "<person id>": "confirmed" }`; anyone not there is pending. Who's called on a day (4.2) is its `people_ids`;
// a day without the prop (made before 4.2) reads as everyone in Cast and crew. Phase 9's web availability arrives as
// suggestions over the same prop.

type Records = Readonly<Record<string, SbdRecord>>;
type Frame = { scene: SbdRecord; shot: SbdRecord };

/** The live scenes a day's frames are in, in board order. */
export function dayScenes(records: Records, projectId: string, dayId: string): SbdRecord[] {
  return scenesOfFrames(dayFrames(records, projectId, dayId));
}

/** The scenes of some frames, each once, in the frames' order (the call sheet passes only its frames still to shoot, 4.11). */
export function scenesOfFrames(frames: readonly Frame[]): SbdRecord[] {
  const seen = new Set<string>();
  return frames.flatMap(({ scene }) => {
    if (seen.has(scene.id)) return [];
    seen.add(scene.id);
    return [scene];
  });
}

/** The live locations a day's frames are shot at (a frame's own, else its scene's), each with its status, by name. */
export function dayLocations(records: Records, projectId: string, dayId: string): { record: SbdRecord; name: string; status: LocationStatus }[] {
  return locationsOfFrames(records, dayFrames(records, projectId, dayId));
}

/** The live locations of some frames, as dayLocations lists them (the call sheet passes only its frames, 4.11). */
export function locationsOfFrames(records: Records, frames: readonly Frame[]): { record: SbdRecord; name: string; status: LocationStatus }[] {
  const ids = new Set(frames.map(({ shot }) => frameLocationId(records, shot)).filter((id): id is string => id !== null));
  return [...ids]
    .flatMap((id) => {
      const record = records[id];
      if (record?.type !== 'location' || record.trashedAt !== null) return [];
      const fields = locationFields(record.props);
      return [{ record, name: fields.name, status: fields.status }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The people who've confirmed a day, by id: those marked `confirmed` in its `crew` prop. */
export function confirmedCrew(dayProps: Props): Set<string> {
  const crew = dayProps.crew;
  if (!isObject(crew)) return new Set();
  return new Set(Object.entries(crew).filter(([, status]) => status === 'confirmed').map(([id]) => id));
}

/**
 * The person ids a day was told it has (`people_ids`, 4.2), each once, in the order added; null when the prop is
 * missing (a day made before 4.2: everyone) or odd (not a list of text: read as missing and never written over).
 */
export function dayPeopleIds(props: Props): string[] | null {
  const ids = props.people_ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
  return [...new Set(ids)];
}

/** Whether someone has chosen who's on the day: its `people_ids` is a list (an empty one is nobody). */
export const dayPeopleChosen = (day: Pick<SbdRecord, 'props'>): boolean => dayPeopleIds(day.props) !== null;

/**
 * The live people on a day, in the order they were added: everyone live in Cast and crew while nobody has chosen. An
 * id of someone in the Trash or gone is skipped here, and stays in the list for a restore to bring back.
 */
export function dayPeople(records: Records, projectId: string, day: Pick<SbdRecord, 'props'>): { record: SbdRecord; fields: PersonFields }[] {
  const ids = dayPeopleIds(day.props);
  if (ids === null) return projectPeople(records, projectId);
  return ids.flatMap((id) => {
    const record = records[id];
    return record?.type === 'person' && record.trashedAt === null && record.parentId === projectId ? [{ record, fields: personFields(record.props) }] : [];
  });
}

/** A day's crew (the people on it, 4.2), and how many of them have confirmed. */
export function dayCrew(records: Records, projectId: string, day: SbdRecord): { people: number; confirmed: number } {
  const confirmed = confirmedCrew(day.props);
  const people = dayPeople(records, projectId, day);
  return { people: people.length, confirmed: people.filter((p) => confirmed.has(p.record.id)).length };
}

/**
 * A person confirmed for a day, or back to pending. Only `confirmed` is stored, so pending takes the entry off; what
 * else the prop keeps (another version's statuses, people since deleted) is written back as it was. Nothing when it's
 * already so, or the day isn't live.
 */
export function crewChange(records: Records, dayId: string, personId: string, confirmed: boolean): { kind: 'update'; id: string; set: Props }[] {
  const day = records[dayId];
  if (day?.type !== 'shoot_day' || day.trashedAt !== null) return [];
  if (confirmedCrew(day.props).has(personId) === confirmed) return [];
  // Something other than a list of people there (a newer version's) is never written over from here.
  if (day.props.crew !== undefined && !isObject(day.props.crew)) return [];
  const crew = isObject(day.props.crew) ? day.props.crew : {};
  const next = Object.fromEntries(Object.entries(crew).filter(([id]) => id !== personId));
  if (confirmed) next[personId] = 'confirmed';
  return [{ kind: 'update', id: dayId, set: { crew: next } }];
}

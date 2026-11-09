import { frameLocationId, locationFields, type LocationStatus } from './location';
import { projectPeople } from './person';
import { isObject } from './departmentStatus';
import type { Props, SbdRecord } from './record';
import { dayFrames } from './shootDay';

// What a shoot day brings together for the Calendar (3.8): its scenes, the locations it's at with whether each is
// booked, and how many of the crew have confirmed. Worked out from the day's frames and the people, never stored
// (CLAUDE.md: rollups are computed).
//
// Crew confirmed (docs/PHASE3_DECISIONS.md 10): set on the desktop for now, per person per day, in the day's `crew`
// prop, `{ "<person id>": "confirmed" }`; anyone not there is pending. Until call sheets (Phase 4) say who's called,
// a day's crew is everyone in Cast and crew. Phase 9's web availability arrives as suggestions over the same prop.

type Records = Readonly<Record<string, SbdRecord>>;

/** The live scenes a day's frames are in, in board order. */
export function dayScenes(records: Records, projectId: string, dayId: string): SbdRecord[] {
  const seen = new Set<string>();
  return dayFrames(records, projectId, dayId).flatMap(({ scene }) => {
    if (seen.has(scene.id)) return [];
    seen.add(scene.id);
    return [scene];
  });
}

/** The live locations a day's frames are shot at (a frame's own, else its scene's), each with its status, by name. */
export function dayLocations(records: Records, projectId: string, dayId: string): { record: SbdRecord; name: string; status: LocationStatus }[] {
  const ids = new Set(dayFrames(records, projectId, dayId).map(({ shot }) => frameLocationId(records, shot)).filter((id): id is string => id !== null));
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

/** A day's crew (everyone live in Cast and crew, until call sheets choose), and how many of them have confirmed. */
export function dayCrew(records: Records, projectId: string, day: SbdRecord): { people: number; confirmed: number } {
  const confirmed = confirmedCrew(day.props);
  const people = projectPeople(records, projectId);
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

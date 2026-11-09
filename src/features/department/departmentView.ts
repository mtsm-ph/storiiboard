import type { Department } from '../../core/model/department';
import { DEPARTMENT_STATES, inState, type DepartmentState } from '../../core/model/departmentStatus';
import { projectPeople, type PersonFields } from '../../core/model/person';
import type { SbdRecord } from '../../core/model/record';
import type { Seen } from '../../core/storage/seen';
import { boardScene, type BoardShot } from '../storyboard/board';

// A department's view of a scene (3.6a): its frames in board order, each with where this department is on it, and
// how many are in each state. Read from the records and Seen, never stored: a view, as CLAUDE.md asks.

type Records = Readonly<Record<string, SbdRecord>>;

export interface DepartmentFrame {
  shot: BoardShot;
  /** This department's states on the frame, in the table's column order; Seen included. */
  states: DepartmentState[];
}

/** The scene's live frames, each with this department's states. Empty for a scene that's gone or in the Trash. */
export function departmentFrames(records: Records, sceneId: string | null, department: Department, seen: Seen): DepartmentFrame[] {
  const scene = sceneId ? records[sceneId] : undefined;
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return [];
  return boardScene(records, scene).shots.map((shot) => ({
    shot,
    states: DEPARTMENT_STATES.filter((state) => inState(shot.fields.departmentStatus, seen[shot.record.id] ?? [], department, state)),
  }));
}

/** How many of the frames are in each state for this department, in column order; states none are in left out. */
export function departmentCounts(frames: readonly DepartmentFrame[]): { state: DepartmentState; count: number }[] {
  return DEPARTMENT_STATES.map((state) => ({ state, count: frames.filter((f) => f.states.includes(state)).length })).filter((row) => row.count > 0);
}

/** The project's people in this department, by name as Cast and crew lists them. Contacts aren't part of the view. */
export function departmentPeople(records: Records, projectId: string, department: Department): { record: SbdRecord; fields: PersonFields }[] {
  return projectPeople(records, projectId).filter((person) => person.fields.departments.includes(department));
}

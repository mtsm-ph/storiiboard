import type { Department } from '../model/department';
import { personPart } from '../model/person';
import { dayTotals } from '../model/shootDay';
import { shotFields } from '../model/storyboard';
import type { CheckContext } from './context';

// Check 2 (4.8): a department the day's scenes need has nobody on the day. "On the day" is the sheet's people (4.2):
// the ones chosen, or everyone while nobody has chosen. A person counts for each department their role stands for and
// each they ticked (personPart, as department status and Seen count them). A day with nothing left to shoot needs none.

export type DepartmentReason = 'dialogue' | 'cast' | 'frames';

export interface DepartmentMissing {
  kind: 'department-missing';
  dayId: string;
  department: Department;
  reason: DepartmentReason;
}

export function departmentMissing(ctx: CheckContext): DepartmentMissing[] {
  const { sheet, frames } = ctx;
  const dayId = sheet.day.record.id;
  if (dayTotals(ctx.records, frames, 1).frames === 0) return [];
  // The context's frames are already the sheet's: only "Need to shoot" ones, so one already shot asks nothing of the day.
  const present = new Set(sheet.people.flatMap((p) => personPart(p.fields).departments));
  const found: DepartmentMissing[] = [];
  const need = (department: Department, reason: DepartmentReason) => {
    if (!present.has(department)) found.push({ kind: 'department-missing', dayId, department, reason });
  };

  // Direction and Camera: any day with frames to shoot has a director and a camera.
  need('direction', 'frames');
  need('camera', 'frames');
  // Sound: dialogue means a scene being shot with a speaking character (3.13's character_ids, from the script) or a
  // frame to shoot with dialogue written on it.
  const sceneIds = new Set(frames.map(({ scene }) => scene.id));
  if (sheet.scenes.some((s) => sceneIds.has(s.record.id) && s.characters.length > 0) || frames.some(({ shot }) => shotFields(shot.props).dialogue.trim() !== '')) {
    need('sound', 'dialogue');
  }
  // HMU and Wardrobe: whenever an actor is on the day, somebody dresses and makes them up.
  if (sheet.cast.length > 0) {
    need('hmu', 'cast');
    need('wardrobe', 'cast');
  }
  return found;
}

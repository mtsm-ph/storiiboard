import type { CallSheet } from '../model/callsheet';
import type { SbdRecord } from '../model/record';
import { dayFrames } from '../model/shootDay';

// What every call sheet check reads (4.8): the records, the project, the day's sheet and the day's frames, worked out
// once so no check walks the board again.

export interface CheckContext {
  records: Readonly<Record<string, SbdRecord>>;
  projectId: string;
  sheet: CallSheet;
  /** The day's live frames in board order, any status. */
  frames: { scene: SbdRecord; shot: SbdRecord }[];
}

export function checkContext(records: Readonly<Record<string, SbdRecord>>, projectId: string, sheet: CallSheet): CheckContext {
  return { records, projectId, sheet, frames: dayFrames(records, projectId, sheet.day.record.id) };
}

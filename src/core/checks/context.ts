import { sheetFrames, type CallSheet } from '../model/callsheet';
import type { SbdRecord } from '../model/record';

// What every call sheet check reads (4.8): the records, the project, the day's sheet and the day's frames, worked out
// once so no check walks the board again.

export interface CheckContext {
  records: Readonly<Record<string, SbdRecord>>;
  projectId: string;
  sheet: CallSheet;
  /** The sheet's frames in board order: the day's still to shoot (4.11), the same set the sheet is built from. */
  frames: { scene: SbdRecord; shot: SbdRecord }[];
}

export function checkContext(records: Readonly<Record<string, SbdRecord>>, projectId: string, sheet: CallSheet): CheckContext {
  return { records, projectId, sheet, frames: sheetFrames(records, projectId, sheet.day.record.id) };
}

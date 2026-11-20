import { t, type LocaleId } from '../../core/i18n';
import type { PlanUnit } from '../../core/model/length';
import type { SbdRecord } from '../../core/model/record';
import type { ProjectFile } from '../../core/storage/driver';
import { undoRedoLines, type UndoRedoLines } from '../../features/history/steps';
import type { Line } from '../../features/history/summary';

// The top bar's Undo and Redo (item 8) name the steps ⌘Z and ⌘⇧Z would take, read from the file after each step. A
// read takes a while (several queries through Rust on the desktop), so each is kept with the state it was read for,
// and shown only while that is still the state: right after an edit, an undo, a redo or a language change the buttons
// say "a step" until the new read lands, never the step before's name (#241's review), which a second Enter would
// otherwise act on without its name being true.

/** What a read of the lines was for: the open file, its records (a new object after every committed step), Empty
 * Trash's and Clean up's count (they change no record, but a line may then read "(picture removed)"), the words and
 * the plan's unit the lines were worded in. */
export interface ReadFor {
  file: ProjectFile;
  records: Readonly<Record<string, SbdRecord>>;
  deletedForGood: number;
  locale: LocaleId;
  unit: PlanUnit;
}

/** One finished read, with what it was for. */
export interface StepLinesRead {
  at: ReadFor;
  lines: UndoRedoLines;
}

export function sameState(a: ReadFor, b: ReadFor): boolean {
  return a.file === b.file && a.records === b.records && a.deletedForGood === b.deletedForGood && a.locale === b.locale && a.unit === b.unit;
}

/**
 * Reads the lines for this state. Never throws: a read that fails, or meets a project closed under it, is null, and
 * the buttons go on saying "a step" quietly. A name is a courtesy; an edit's own failure is said where the edit is.
 */
export async function readStepLines(at: ReadFor, read: (file: ProjectFile, unit: PlanUnit) => Promise<UndoRedoLines> = undoRedoLines): Promise<StepLinesRead | null> {
  try {
    return { at, lines: await read(at.file, at.unit) };
  } catch {
    return null;
  }
}

/**
 * What the buttons name now: the store says at once whether there is a step to take (null: nothing); its line is the
 * read's only while the read was for this very state, else "a step".
 */
export function shownLines(read: StepLinesRead | null, now: ReadFor, can: { canUndo: boolean; canRedo: boolean }): { undo: Line | null; redo: Line | null } {
  const lines = read && sameState(read.at, now) ? read.lines : null;
  const aStep: Line = [t('history.aStep')];
  return { undo: can.canUndo ? (lines?.undo ?? aStep) : null, redo: can.canRedo ? (lines?.redo ?? aStep) : null };
}

import { undoRun, type OpGroup } from '../../core/ops/ops';

// Undoing from History (item 7, Kevin, Nov 18): one sign at a time, all worked out from the log, nothing stored.
// - The newest run of undos (⌘Z pressed five times is one run; an edit between ends it) or the newest restore is
//   outlined in History, its entries marked Undone, with "Bring back what was undone" at the top, until it settles:
//   Ctrl+S, three further steps, a project switch or a reopen (src/app/undoSettle.ts), or once it's brought back.
// - After a restore, the step that was current just before it carries "Before restoring" for good, with "Go back to
//   this point" once the restore's own outline has settled (the button is the way back until then).

/** What the log says, before settling: the newest run, and every restore's mark. */
export interface UndoneFacts {
  run: {
    /** The run's newest undo, or the restore: what a bring_back points at. */
    target: string;
    /** Its place in the log: a run at or before the settled place shows nothing. */
    seq: number;
    /** The restore, when the run is one. */
    restore: string | null;
    /** The steps it undid, by group id. */
    undone: ReadonlySet<string>;
    /** Steps made after it. */
    later: number;
    /** A bring_back already points at it. */
    broughtBack: boolean;
  } | null;
  /** By the step just before each restore: that restore's id. */
  marks: ReadonlyMap<string, string>;
}

export const NO_UNDONE: UndoneFacts = { run: null, marks: new Map() };

/** Three further steps settle a run (Kevin, Nov 18). */
export const SETTLE_AFTER_STEPS = 3;

/** The newest run and the marks, from the whole log, oldest first. */
export function undoneFacts(groups: readonly OpGroup[]): UndoneFacts {
  const marks = new Map<string, string>();
  groups.forEach((group, i) => {
    const before = groups[i - 1];
    if (group.kind === 'restore' && before) marks.set(before.id, group.id);
  });
  let index = -1;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const kind = groups[i]?.kind;
    if (kind === 'undo' || kind === 'restore') {
      index = i;
      break;
    }
  }
  const run = index < 0 ? null : undoRun(groups, index);
  const target = groups[index];
  if (!run || !target) return { run: null, marks };
  const undone = new Set<string>();
  if (target.kind === 'restore') {
    // Every step after the point it went back to (the project as created: every step before it).
    const from = target.restoreTo === null ? -1 : groups.findIndex((g) => g.id === target.restoreTo);
    for (const group of groups.slice(from + 1, index)) undone.add(group.id);
  } else {
    for (const group of run) if (group.targetGroupId !== null) undone.add(group.targetGroupId);
  }
  return {
    run: {
      target: target.id,
      seq: target.seq,
      restore: target.kind === 'restore' ? target.id : null,
      undone,
      later: groups.length - 1 - index,
      broughtBack: groups.some((g) => g.kind === 'bring_back' && g.targetGroupId === target.id),
    },
    marks,
  };
}

/** The run that shows now: none once it's settled (by `settledThrough`, a place in the log), brought back or three steps old. */
export function shownRun(facts: UndoneFacts, settledThrough: number): UndoneFacts['run'] {
  const { run } = facts;
  if (!run || run.broughtBack || run.later >= SETTLE_AFTER_STEPS || run.seq <= settledThrough) return null;
  return run;
}

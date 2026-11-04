import type { SbdRecord } from '../../core/model/record';
import { log, opsOfGroups, recordsBefore, storedPictures, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import type { ProjectFile } from '../../core/storage/driver';
import { describeGroup, type Line } from './summary';

/** Steps shown at a time; older ones load on asking (Show older steps), so a long project opens its History at once. */
export const PAGE = 100;

export interface Steps {
  /** Newest first. */
  steps: { group: OpGroup; line: Line }[];
  /** More steps before the oldest shown. */
  more: boolean;
}

/** The newest `count` steps, each with its line. */
export async function loadSteps(file: ProjectFile, count: number): Promise<Steps> {
  const groups = await log(file);
  const shown = groups.slice(-count);
  // Undo, redo and restore name the step they point at, which may be older than the page, and may itself point at
  // another (an undone restore names its point): followed until every line has what it names.
  const byId = new Map(groups.map((g) => [g.id, g]));
  const wanted = new Set<string>();
  const pending: (string | null)[] = shown.map((g) => g.id);
  while (pending.length > 0) {
    const id = pending.pop() ?? null;
    const group = id === null ? undefined : byId.get(id);
    if (!group || wanted.has(group.id)) continue;
    wanted.add(group.id);
    pending.push(group.targetGroupId, group.restoreTo);
  }
  const [ops, stored] = await Promise.all([opsOfGroups(file, [...wanted]), storedPictures(file)]);
  const byGroup = new Map<string, LoggedOp[]>();
  for (const op of ops) byGroup.set(op.groupId, [...(byGroup.get(op.groupId) ?? []), op]);
  // Only an edit's line names its own records; undo, redo and restore name the step they point at.
  const around = await sketchedFrames(file, new Map([...byGroup].filter(([id]) => byId.get(id)?.kind === 'edit')));
  // Oldest first, so the step an undo, redo or restore names already has its line.
  const titles = new Map<string, Line>();
  for (const group of groups) if (wanted.has(group.id)) titles.set(group.id, describeGroup(group, byGroup.get(group.id) ?? [], titles, stored, around.get(group.id)));
  return { steps: shown.reverse().map((group) => ({ group, line: titles.get(group.id) ?? ['a step'] })), more: groups.length > count };
}

/**
 * The frame each sketch step drew on, as it was then, by group: a sketch writes only its strokes, so without this
 * every one would read "Sketched on a frame". As it was then, not now, so a step's number matches the board's at the
 * time, as every other line's does.
 */
async function sketchedFrames(file: ProjectFile, byGroup: ReadonlyMap<string, readonly LoggedOp[]>): Promise<Map<string, Map<string, SbdRecord>>> {
  const asks: { group: string; id: string; seq: number }[] = [];
  for (const [group, ops] of byGroup) {
    const stroke = ops.find((op) => (op.after ?? op.before)?.type === 'stroke');
    const shotId = stroke ? (stroke.after ?? stroke.before)?.parentId : null;
    if (stroke && shotId && !ops.some((op) => op.recordId === shotId)) asks.push({ group, id: shotId, seq: stroke.seq });
  }
  const found = await recordsBefore(file, asks);
  const around = new Map<string, Map<string, SbdRecord>>();
  asks.forEach((ask, i) => {
    const record = found[i];
    if (record) around.set(ask.group, new Map([[ask.id, record]]));
  });
  return around;
}

import type { SbdRecord } from '../../core/model/record';
import { childrenInLog, log, opsOfGroups, opsOfRecords, recordsBefore, storedPictures, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import type { ProjectFile } from '../../core/storage/driver';
import { listVersions, type NamedVersion } from '../../core/storage/versions';
import { describeGroup, lineText, type Line } from './summary';

/** Steps shown at a time; older ones load on asking (Show older steps), so a long project opens its History at once. */
export const PAGE = 100;

export interface Steps {
  /** Newest first. */
  steps: { group: OpGroup; line: Line }[];
  /** More steps before the oldest shown. */
  more: boolean;
  /** The newest step: what a version named now includes. */
  newest: string | null;
  /** Named versions (1.23), newest first. */
  versions: NamedVersion[];
  /** Each version's step, in words, by version id. */
  versionLines: Map<string, Line>;
}

/** The newest `count` steps, each with its line, and the named versions with theirs. */
export async function loadSteps(file: ProjectFile, count: number): Promise<Steps> {
  const [groups, versions] = await Promise.all([log(file), listVersions(file)]);
  const shown = groups.slice(-count);
  // Undo, redo and restore name the step they point at, which may be older than the page, and may itself point at
  // another (an undone restore names its point): followed until every line has what it names.
  const byId = new Map(groups.map((g) => [g.id, g]));
  const wanted = new Set<string>();
  // A version's step may be older than the page too.
  const pending: (string | null)[] = [...shown.map((g) => g.id), ...versions.map((v) => v.opGroupId)];
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
  const around = await namedRecords(file, new Map([...byGroup].filter(([id]) => byId.get(id)?.kind === 'edit')));
  // Oldest first, so the step an undo, redo or restore names already has its line.
  const titles = new Map<string, Line>();
  for (const group of groups) if (wanted.has(group.id)) titles.set(group.id, describeGroup(group, byGroup.get(group.id) ?? [], titles, stored, around.get(group.id)));
  return {
    steps: shown.reverse().map((group) => ({ group, line: titles.get(group.id) ?? ['a step'] })),
    more: groups.length > count,
    newest: groups.at(-1)?.id ?? null,
    versions,
    versionLines: new Map(versions.map((v) => [v.id, titles.get(v.opGroupId) ?? ['a step']])),
  };
}

/**
 * Records a step names without writing them, as they were then, by group: the frame a sketch drew on (a sketch writes
 * only its strokes, so without this every one would read "Sketched on a frame"), and a scene's location, which the
 * scene keeps by id. As they were then, not now, so a step's number or name matches the board's at the time, as every
 * other line's does.
 */
async function namedRecords(file: ProjectFile, byGroup: ReadonlyMap<string, readonly LoggedOp[]>): Promise<Map<string, Map<string, SbdRecord>>> {
  const asks: { group: string; id: string; seq: number }[] = [];
  for (const [group, ops] of byGroup) {
    const stroke = ops.find((op) => (op.after ?? op.before)?.type === 'stroke');
    const shotId = stroke ? (stroke.after ?? stroke.before)?.parentId : null;
    if (stroke && shotId && !ops.some((op) => op.recordId === shotId)) asks.push({ group, id: shotId, seq: stroke.seq });
    // As the step left it: a location picked by a new name is made in the same step.
    const end = Math.max(...ops.map((op) => op.seq)) + 1;
    const places = new Set(ops.flatMap((op) => [op.before?.props.location_id, op.after?.props.location_id]));
    for (const id of places) if (typeof id === 'string' && id !== '') asks.push({ group, id, seq: end });
  }
  const found = await recordsBefore(file, asks);
  const around = new Map<string, Map<string, SbdRecord>>();
  asks.forEach((ask, i) => {
    const record = found[i];
    if (!record) return;
    const named = around.get(ask.group) ?? new Map<string, SbdRecord>();
    named.set(ask.id, record);
    around.set(ask.group, named);
  });
  return around;
}

/** Every write to a frame and to what the log ever put under it (its strokes and picture), oldest first. */
export async function frameOps(file: ProjectFile, frameId: string): Promise<LoggedOp[]> {
  return opsOfRecords(file, [frameId, ...(await childrenInLog(file, frameId))]);
}

/**
 * Every write to an item, oldest first, for its own history. A frame's sketch and picture are part of it (frameOps);
 * a scene's frames and notes are items of their own, with histories of their own, so a scene's lists only its writes.
 */
export async function itemOps(file: ProjectFile, item: SbdRecord): Promise<LoggedOp[]> {
  return item.type === 'shot' ? frameOps(file, item.id) : opsOfRecords(file, [item.id]);
}

/**
 * What the tile says after Restore to here: what it did, or, when the project is already as it was then, that nothing
 * changed, rather than a button press with no effect. Past an Empty Trash, what it deleted can't come back, so the
 * project isn't quite as it was then: said either way, so no one takes a frame still missing for a failed restore.
 */
export function restoreNotice(steps: Steps['steps'], groupId: string, changed: boolean, undoKey: string): string {
  const index = steps.findIndex((step) => step.group.id === groupId);
  const said = lineText(steps[index]?.line ?? ['that step']);
  const emptied = steps.slice(0, Math.max(index, 0)).some((step) => step.group.kind === 'empty_trash');
  const lost = emptied ? ' What Empty Trash deleted can’t come back.' : '';
  if (changed) return `Restored the project to after “${said}”.${lost} ${undoKey} takes it back.`;
  return `Nothing to restore: the project is already as it was after “${said}”.${lost}`;
}

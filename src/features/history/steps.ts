import type { SbdRecord } from '../../core/model/record';
import { childrenInLog, lastOpSeq, log, opsOfGroups, opsOfRecords, opsSince, recordsBefore, storedPictures, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import type { ProjectFile } from '../../core/storage/driver';
import { listVersions, type NamedVersion } from '../../core/storage/versions';
import { byStep, describeGroup, lineText, peopleDiff, type Line } from './summary';
import { t } from '../../core/i18n';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Steps shown at a time; older ones load on asking (Show older steps), so a long project opens its History at once. */
export const PAGE = 100;

export interface Steps {
  /** Newest first, each with the records its ops wrote (3.10: Notifications filters by scene). */
  steps: { group: OpGroup; line: Line; recordIds: string[] }[];
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
  const byGroup = byStep(ops);
  // Only an edit's line names its own records; undo, redo and restore name the step they point at.
  const around = await namedRecords(file, new Map([...byGroup].filter(([id]) => byId.get(id)?.kind === 'edit')));
  // Oldest first, so the step an undo, redo or restore names already has its line.
  const titles = new Map<string, Line>();
  for (const group of groups) if (wanted.has(group.id)) titles.set(group.id, describeGroup(group, byGroup.get(group.id) ?? [], titles, stored, around.get(group.id)));
  return {
    steps: shown.reverse().map((group) => ({
      group,
      line: titles.get(group.id) ?? ['a step'],
      recordIds: [...new Set((byGroup.get(group.id) ?? []).map((op) => op.recordId))],
    })),
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
export async function namedRecords(file: ProjectFile, byGroup: ReadonlyMap<string, readonly LoggedOp[]>): Promise<Map<string, Map<string, SbdRecord>>> {
  const asks: { group: string; id: string; seq: number }[] = [];
  for (const [group, ops] of byGroup) {
    const stroke = ops.find((op) => (op.after ?? op.before)?.type === 'stroke');
    const shotId = stroke ? (stroke.after ?? stroke.before)?.parentId : null;
    if (stroke && shotId && !ops.some((op) => op.recordId === shotId)) asks.push({ group, id: shotId, seq: stroke.seq });
    // A picture's parent, when the step didn't write it: a location's photos (3.3) read "photos of Diner", not a frame's.
    const picture = ops.find((op) => (op.after ?? op.before)?.type === 'media');
    const parentId = picture ? (picture.after ?? picture.before)?.parentId : null;
    if (picture && parentId && !ops.some((op) => op.recordId === parentId)) asks.push({ group, id: parentId, seq: picture.seq });
    // A call sheet is named by its day (4.1), which the step doesn't write.
    const sheet = ops.find((op) => (op.after ?? op.before)?.type === 'callsheet');
    const dayId = sheet ? (sheet.after ?? sheet.before)?.parentId : null;
    if (sheet && dayId && !ops.some((op) => op.recordId === dayId)) asks.push({ group, id: dayId, seq: sheet.seq });
    // As the step left it: a location picked by a new name is made in the same step.
    // Not Math.max(...seqs), which throws past about 125k arguments: a Restore to here can be a step that big.
    const end = ops.reduce((max, op) => Math.max(max, op.seq), 0) + 1;
    const places = new Set(
      ops.flatMap((op) => [
        op.before?.props.location_id,
        op.after?.props.location_id,
        op.before?.props.cast_id,
        op.after?.props.cast_id,
        op.before?.props.shoot_day_id,
        op.after?.props.shoot_day_id,
      ]),
    );
    // The people added to or taken off a shoot day (4.2), and those a call sheet's times name: by name as they were then.
    // An issued call sheet (4.7) is named by its day, which is the call sheet's parent: asked for below, once the call
    // sheet (here, or as it was) is known.
    const people = ops.flatMap((op) => {
      const diff = peopleDiff(op.before?.props.people_ids, op.after?.props.people_ids);
      const timed = [op.before, op.after].flatMap((r) => (r?.type === 'callsheet' && isObject(r.props.person_times) ? Object.keys(r.props.person_times) : []));
      return [...diff.added, ...diff.removed, ...timed];
    });
    for (const id of new Set([...places, ...people])) if (typeof id === 'string' && id !== '') asks.push({ group, id, seq: end });
  }
  const found = await recordsBefore(file, asks);
  const around = new Map<string, Map<string, SbdRecord>>();
  const keep = (list: readonly { group: string; id: string }[], records: readonly (SbdRecord | null)[]): void => {
    list.forEach((ask, i) => {
      const record = records[i];
      if (!record) return;
      const named = around.get(ask.group) ?? new Map<string, SbdRecord>();
      named.set(ask.id, record);
      around.set(ask.group, named);
    });
  };
  keep(asks, found);
  // An issued call sheet that already existed (4.7): its day, which only the call sheet record knows.
  const days = [...around].flatMap(([group, named]) => {
    const issued = byGroup.get(group)?.find((op) => op.after?.type === 'media' && typeof op.after.props.issue_version === 'number');
    const parent = issued?.after?.parentId;
    const sheet = parent ? named.get(parent) : undefined;
    return issued && sheet?.parentId && !named.has(sheet.parentId) ? [{ group, id: sheet.parentId, seq: issued.seq }] : [];
  });
  keep(days, await recordsBefore(file, days));
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

/** An item's writes as last read (itemOps), and how far into the log that read went. */
export interface ItemLog {
  itemId: string;
  ops: LoggedOp[];
  /** The newest op's seq when the read began: writes after it are the next read's. */
  through: number;
}

/** An item's whole history, read afresh: when it's first shown, or after Empty Trash took data from older writes. */
export async function readItemLog(file: ProjectFile, item: SbdRecord): Promise<ItemLog> {
  // Taken first, so a write landing during the read is read again next time rather than missed (kept once, by id).
  const through = await lastOpSeq(file);
  return { itemId: item.id, ops: await itemOps(file, item), through };
}

/**
 * The same history after more steps: only the writes since `known` are read, to the item, to what it already had
 * under it, or to anything the new steps put under it. Finding a frame's strokes afresh looks through every write in
 * the log, which on a long project is too slow to do after every edit while the History tile shows one frame.
 */
export async function moreItemLog(file: ProjectFile, item: SbdRecord, known: ItemLog): Promise<ItemLog> {
  if (known.itemId !== item.id) return readItemLog(file, item);
  const through = await lastOpSeq(file);
  const ids = [...new Set([item.id, ...known.ops.map((op) => op.recordId)])];
  // Only a frame's history takes in what's under it (itemOps); a scene's frames and notes have their own.
  const since = await opsSince(file, known.through, ids, item.type === 'shot' ? item.id : null);
  const have = new Set(known.ops.map((op) => op.id));
  const added = since.filter((op) => !have.has(op.id));
  if (added.length === 0) return { ...known, through: Math.max(known.through, through) };
  return { itemId: item.id, ops: [...known.ops, ...added].sort((a, b) => a.seq - b.seq), through: Math.max(known.through, through) };
}

/**
 * What the tile says after Restore to here: what it did, or, when the project is already as it was then, that nothing
 * changed, rather than a button press with no effect. Past an Empty Trash, what it deleted can't come back, so the
 * project isn't quite as it was then: said either way, so no one takes a frame still missing for a failed restore.
 */
export function restoreNotice(steps: Steps['steps'], groupId: string, changed: boolean, undoKey: string): string {
  const index = steps.findIndex((step) => step.group.id === groupId);
  const said = lineText(steps[index]?.line ?? [t('history.thatStep')]);
  const emptied = steps.slice(0, Math.max(index, 0)).some((step) => step.group.kind === 'empty_trash');
  const lost = emptied ? t('history.lostForGood') : '';
  if (changed) return t('history.restoredNotice', { step: said, lost, undo: undoKey });
  return t('history.nothingToRestore', { step: said, lost });
}

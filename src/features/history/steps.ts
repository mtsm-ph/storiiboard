import type { PlanUnit } from '../../core/model/length';
import type { SbdRecord } from '../../core/model/record';
import { childrenInLog, dayOpsSince, lastOpSeq, log, logBefore, logOf, NO_DAY_RECORDS, opsOfGroups, opsOfRecords, opsSince, placesBefore, projectAt, purgedSince, recordsBefore, storedPictures, stepBefore, undoTops, type BroughtBack, type DayRecords, type GoneRecord, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import type { ProjectFile } from '../../core/storage/driver';
import { listVersions, type NamedVersion } from '../../core/storage/versions';
import { byStep, describeGroup, keptText, lineText, moveTarget, peopleDiff, scheduledScene, stepPictures, stepScene, type Line } from './summary';
import { t, tn } from '../../core/i18n';
import { undoneFacts, type UndoneFacts } from './undone';

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
  /** The newest undo run or restore, and every restore's mark (item 7), as the log says before settling. */
  undone: UndoneFacts;
}

/** The newest `count` steps, each with its line, and the named versions with theirs; a plan's lengths in `unit`. */
export async function loadSteps(file: ProjectFile, count: number, unit?: PlanUnit): Promise<Steps> {
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
    // A bring_back of a restore names the step that was current just before it.
    const target = group.kind === 'bring_back' ? byId.get(group.targetGroupId ?? '') : undefined;
    if (target?.kind === 'restore') pending.push(stepBefore(groups, target.seq)?.id ?? null);
  }
  const { titles, byGroup } = await describeSteps(file, groups.filter((g) => wanted.has(g.id)), unit);
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
    undone: undoneFacts(groups),
  };
}

/**
 * These groups, and every step one of them names, read by `logOf` until none is missing: an undo's or redo's target,
 * a restore's point, and for a bring_back of a restore the step just before that restore. Only those steps are read,
 * never the whole log.
 */
async function withNamed(file: ProjectFile, ids: readonly string[]): Promise<OpGroup[]> {
  const found = new Map<string, OpGroup>();
  // The restores whose step before has been asked for already.
  const asked = new Set<string>();
  let pending = [...ids];
  while (pending.length > 0) {
    const read = await logOf(file, pending);
    for (const group of read) found.set(group.id, group);
    const restores = [...found.values()]
      .filter((g) => g.kind === 'bring_back')
      .map((g) => found.get(g.targetGroupId ?? ''))
      .filter((g): g is OpGroup => g?.kind === 'restore' && !asked.has(g.id));
    for (const restore of restores) asked.add(restore.id);
    const before = (await logBefore(file, restores.map((g) => g.seq))).filter((g) => !found.has(g.id));
    for (const group of before) found.set(group.id, group);
    pending = [...new Set([...read, ...before].flatMap((g) => [g.targetGroupId, g.restoreTo]))].filter((id): id is string => id !== null && !found.has(id));
  }
  return [...found.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Each step's line, by group id, for these groups (oldest first, with every step one of them names): the one wording
 * History, Notifications and the top bar's Undo and Redo all read.
 */
async function describeSteps(
  file: ProjectFile,
  groups: readonly OpGroup[],
  unit?: PlanUnit,
  { everyOp = true }: { everyOp?: boolean } = {},
): Promise<{ titles: Map<string, Line>; byGroup: Map<string, LoggedOp[]> }> {
  const kinds = new Map(groups.map((g) => [g.id, g.kind]));
  // Only an edit's line reads its own ops (an Empty Trash's counts them from the log's own count); History reads every
  // group's too, for the records each step wrote (Notifications filters by them). An undo, redo or restore is named by
  // the step it points at, and a Restore to here or an Empty Trash can hold about 125k ops (#241).
  const read = everyOp ? [...kinds.keys()] : [...kinds].filter(([, kind]) => kind === 'edit').map(([id]) => id);
  const ops = await opsOfGroups(file, read);
  const byGroup = byStep(ops);
  // Only the pictures the edits' own records name, by describeEdit's own rule: whether each is still stored is all their
  // lines ask (1.21).
  const pictures = [...byGroup].flatMap(([id, written]) => (kinds.get(id) === 'edit' ? stepPictures(written) : []));
  const stored = await storedPictures(file, pictures);
  // Only an edit's line names its own records; undo, redo and restore name the step they point at.
  const { around, unsure, trashed } = await stepRecords(file, new Map([...byGroup].filter(([id]) => kinds.get(id) === 'edit')));
  // Oldest first, so the step an undo, redo or restore names already has its line.
  const titles = new Map<string, Line>();
  const byId = new Map(groups.map((g) => [g.id, g]));
  // What a bring_back brought back: the step its undo undid, or the step that was current just before its restore.
  const brought = (group: OpGroup): string | null => {
    const target = group.kind === 'bring_back' ? byId.get(group.targetGroupId ?? '') : undefined;
    if (target?.kind === 'undo') return target.targetGroupId;
    return target?.kind === 'restore' ? (stepBefore(groups, target.seq)?.id ?? null) : null;
  };
  for (const group of groups) {
    titles.set(
      group.id,
      describeGroup(group, byGroup.get(group.id) ?? [], titles, stored, around.get(group.id), unit, unsure.has(group.id), trashed.get(group.id), brought(group)),
    );
  }
  return { titles, byGroup };
}

/** What the top bar's Undo and Redo name (item 8): the steps ⌘Z and ⌘⇧Z would take now, each as History lines it. */
export interface UndoRedoLines {
  /** Null: nothing to undo. */
  undo: Line | null;
  /** Null: nothing to redo. */
  redo: Line | null;
}

/**
 * The lines of the steps undo and redo would take now. Only those steps are read, with the steps they name (a restore
 * names its point), never the whole log: this runs after every edit while a project is open.
 */
export async function undoRedoLines(file: ProjectFile, unit?: PlanUnit): Promise<UndoRedoLines> {
  const { undoTop, redoTop } = await undoTops(file);
  const found = await withNamed(file, [undoTop, redoTop].filter((id): id is string => id !== null));
  const { titles } = await describeSteps(file, found, unit, { everyOp: false });
  const line = (id: string | null): Line | null => (id === null ? null : (titles.get(id) ?? [t('history.aStep')]));
  return { undo: line(undoTop), redo: line(redoTop) };
}

/**
 * Records a step names without writing them, as they were then, by group: the frame a sketch drew on (a sketch writes
 * only its strokes, so without this every one would read "Sketched on a frame"), and a scene's location, which the
 * scene keeps by id. As they were then, not now, so a step's number or name matches the board's at the time, as every
 * other line's does.
 */
export async function namedRecords(file: ProjectFile, byGroup: ReadonlyMap<string, readonly LoggedOp[]>): Promise<Map<string, Map<string, SbdRecord>>> {
  return (await stepRecords(file, byGroup)).around;
}

/**
 * namedRecords, and the steps whose place's records may not all be known any more (`unsure`): a step that reads a
 * place (a move's, a scheduled scene's) while some record that was in the project then has since been deleted for good.
 * Empty Trash empties a purged record's every write and keeps only their seqs and kinds (1.21), so where it was can't
 * be read: it was there at the step unless all its writes came before the step (it was gone already), or the first
 * one made it after the step began (in another step). The line then says only what it can prove (summary.ts).
 * `trashed`: by step, the records the step wrote while they were in the Trash, since deleted for good.
 */
export async function stepRecords(
  file: ProjectFile,
  byGroup: ReadonlyMap<string, readonly LoggedOp[]>,
): Promise<{ around: Map<string, Map<string, SbdRecord>>; unsure: Set<string>; trashed: Map<string, Set<string>> }> {
  const asks: { group: string; id: string; seq: number }[] = [];
  const kids: { group: string; parentId: string; seq: number }[] = [];
  const reads: { group: string; start: number }[] = [];
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
    // A setup is named with its scene (6.0), which the step doesn't write; so are frames put into a setup or out of one.
    const setup = ops.find((op) => (op.after ?? op.before)?.type === 'setup');
    const setupScene = setup ? (setup.after ?? setup.before)?.parentId : null;
    if (setup && setupScene && !ops.some((op) => op.recordId === setupScene)) asks.push({ group, id: setupScene, seq: setup.seq });
    const joined = ops.find((op) => op.after?.type === 'shot' && op.before !== null && op.before.props.setup_id !== op.after.props.setup_id);
    const joinedScene = joined?.after?.parentId;
    if (joined && joinedScene && !ops.some((op) => op.recordId === joinedScene)) asks.push({ group, id: joinedScene, seq: joined.seq });
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
        // A frame's setup (6.0), by its name as it was then.
        op.before?.props.setup_id,
        op.after?.props.setup_id,
        // A frame's lens (6.1), by its name as it was then.
        op.before?.props.lens_id,
        op.after?.props.lens_id,
        // A live card on a board (5.4) is named by the frame or scene it shows, as it was then.
        op.before?.props.shot_id,
        op.after?.props.shot_id,
        op.before?.props.scene_id,
        op.after?.props.scene_id,
        // A scene's room (6.2b), by its name as it was then; a plan item's plan, so a move says which level it went to.
        op.before?.props.room_id,
        op.after?.props.room_id,
        // A mark's character and camera (6.7), by name as they were then.
        op.before?.props.character_id,
        op.after?.props.character_id,
        op.before?.props.camera_id,
        op.after?.props.camera_id,
        ...(op.before?.type === 'plan_item' || op.after?.type === 'plan_item' ? [op.before?.parentId, op.after?.parentId] : []),
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
    // A suggestion decided in the step (7.0): its target (for a call sheet, its day), so a Reject names it by its own name
    // as the step left it rather than the change file's label. An id of an id's length only: the record is untrusted.
    const decided = ops.find((op) => op.after?.type === 'suggestion');
    const targetId = decided?.after?.props.target_id;
    if (typeof targetId === 'string' && targetId !== '' && targetId.length <= 100 && !ops.some((op) => op.recordId === targetId)) asks.push({ group, id: targetId, seq: end });
    // Where a drag put frames, notes, scenes or pages (Kevin, Nov 18): the place, and what was in it just before the
    // step, so the line names the neighbour as numbered when it was dragged ("Moved 4A to after 3C").
    const start = ops.reduce((min, op) => Math.min(min, op.seq), Number.MAX_SAFE_INTEGER);
    const into = moveTarget(ops);
    if (into !== null) {
      if (!ops.some((op) => op.recordId === into)) asks.push({ group, id: into, seq: end });
      kids.push({ group, parentId: into, seq: start });
      reads.push({ group, start });
    }
    // The scene a step's records share, so "Changed 3 items in SC 12" can name it; a scene's frames scheduled together,
    // with its frames as the step left them, so a whole scene reads as the scene.
    const scene = stepScene(ops);
    if (scene !== null && !ops.some((op) => op.recordId === scene)) asks.push({ group, id: scene, seq: end });
    const scheduled = scheduledScene(ops);
    if (scheduled !== null) {
      kids.push({ group, parentId: scheduled, seq: end });
      reads.push({ group, start });
    }
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
  // A place's records as they were then, each kept only where the step's own asks haven't named it already.
  const { children, gone } = await placesBefore(file, kids);
  kids.forEach((ask, i) => {
    const named = around.get(ask.group) ?? new Map<string, SbdRecord>();
    for (const record of children[i] ?? []) if (!named.has(record.id)) named.set(record.id, record);
    around.set(ask.group, named);
  });
  const unsure = new Set<string>();
  const trashed = new Map<string, Set<string>>();
  // A record in the Trash at the step is never a neighbour (summary.ts keeps live ones only), so its purge since changes
  // nothing. Empty Trash keeps each write's kind and group: its last write before the step tells. A delete (an edit's or
  // a redo's) or an undone restore left it in the Trash; anything else, a Restore to here's revert among them, can't
  // say so, and it counts as there. Only the writes before the latest step asked about are read; each record's are
  // sorted once and searched, not filtered per step.
  const writes = new Map<string, LoggedOp[]>();
  if (reads.length > 0 && gone.length > 0) {
    const latest = reads.reduce((max, read) => Math.max(max, read.start), 0);
    for (const op of await opsOfRecords(file, gone.map((record) => record.id), latest)) {
      const list = writes.get(op.recordId);
      if (list) list.push(op);
      else writes.set(op.recordId, [op]);
    }
    for (const list of writes.values()) list.sort((a, b) => a.seq - b.seq);
  }
  const trashedThen = (id: string, start: number): boolean => {
    const list = writes.get(id) ?? [];
    // The last write before `start`: the first at or after it, less one.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid]?.seq ?? 0) < start) lo = mid + 1;
      else hi = mid;
    }
    const last = list[lo - 1];
    if (!last) return false;
    return (last.kind === 'trash' && (last.groupKind === 'edit' || last.groupKind === 'redo' || last.groupKind === 'bring_back')) || (last.kind === 'restore' && last.groupKind === 'undo');
  };
  for (const { group, start } of reads) {
    const ops = byGroup.get(group) ?? [];
    const own = new Set(ops.map((op) => op.recordId));
    // The step itself brought it back out of the Trash (a restore, an undone delete, a Restore to here's revert, or made
    // afresh), so it was in the project after the step though in the Trash before it. Not every own write: a re-key
    // (6.23) moves the Trash's records too, and that move leaves them in the Trash.
    const brought = new Set(
      ops
        .filter(
          (op) =>
            (op.kind === 'restore' && (op.groupKind === 'edit' || op.groupKind === 'redo' || op.groupKind === 'bring_back')) ||
            (op.kind === 'trash' && op.groupKind === 'undo') ||
            op.kind === 'revert' ||
            op.kind === 'create',
        )
        .map((op) => op.recordId),
    );
    const binned = (record: GoneRecord) => trashedThen(record.id, start) && !brought.has(record.id);
    const there = (record: GoneRecord) => record.last >= start && (own.has(record.id) || !(record.made && record.first >= start)) && !binned(record);
    if (gone.some(there)) unsure.add(group);
    // The step's own writes to records then in the Trash, since deleted for good: a re-key's, which summary.ts leaves
    // out of what the person moved.
    const left = gone.filter((record) => own.has(record.id) && record.last >= start && binned(record)).map((record) => record.id);
    if (left.length > 0) trashed.set(group, new Set([...(trashed.get(group) ?? []), ...left]));
  }
  // A frame's place is proven by its letter (summary.ts), in the project's own lettering: the project as it was at the
  // step, which no move writes and nothing deletes, so it's named for every step that has to prove its place.
  const proving = [...unsure].flatMap((group) => {
    const ops = byGroup.get(group) ?? [];
    const named = around.get(group);
    if ([...(named?.values() ?? [])].some((r) => r.type === 'project') || ops.some((op) => (op.after ?? op.before)?.type === 'project')) return [];
    return [{ group, seq: ops.reduce((max, op) => Math.max(max, op.seq), 0) + 1 }];
  });
  const projects = await projectAt(file, proving.map((ask) => ask.seq));
  proving.forEach((ask, i) => {
    const project = projects[i];
    if (!project) return;
    const named = around.get(ask.group) ?? new Map<string, SbdRecord>();
    named.set(project.id, project);
    around.set(ask.group, named);
  });
  // An issued call sheet that already existed (4.7): its day, which only the call sheet record knows.
  const days = [...around].flatMap(([group, named]) => {
    const issued = byGroup.get(group)?.find((op) => op.after?.type === 'media' && typeof op.after.props.issue_version === 'number');
    const parent = issued?.after?.parentId;
    const sheet = parent ? named.get(parent) : undefined;
    return issued && sheet?.parentId && !named.has(sheet.parentId) ? [{ group, id: sheet.parentId, seq: issued.seq }] : [];
  });
  keep(days, await recordsBefore(file, days));
  return { around, unsure, trashed };
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

/** A shoot day's own history as last read (readDayLog): its steps, newest first, each worded as History words it. */
export interface DayLog extends DayRecords {
  dayId: string;
  steps: { group: OpGroup; line: Line }[];
  /** The newest op's seq when the read began: writes after it are the next read's. */
  through: number;
}

/**
 * A shoot day's own history (Kevin, Nov 18): only a view, nothing stored. Every step that wrote the day, its call sheet
 * (and what's under it), or a frame whose `shoot_day_id` is or was the day, with the frame's whole log as its own
 * History reads it (its strokes and picture too, and its steps from before it was scheduled), so a frame moved off
 * the day stays in it ("Moved 4A to shoot day Wed, Nov 25" in both days'). Undos, redos and restores of those steps
 * write the same records, so they're found by the same rule. Each line is History's own (describeSteps).
 *
 * Opening costs two or three passes over the whole log, each a plain text search for the ids asked before any JSON is
 * read (dayOpsSince): one for the day's id, one for the frames and call sheets it found; then a read of their strokes
 * and pictures by record; and the lines of the day's steps: each edit's ops and the steps an undo, redo or restore
 * names. A later read (moreDayLog) costs what the new steps wrote, unless one of them brings a record new to the day
 * (a frame scheduled on it, a call sheet, a sketch's stroke): that record is read from the log's start, as here.
 */
export async function readDayLog(file: ProjectFile, dayId: string, unit?: PlanUnit): Promise<DayLog> {
  // Taken first, so a write landing during the read is read again next time rather than missed (kept once, by group).
  const through = await lastOpSeq(file);
  const { ops, ...found } = await dayOpsSince(file, 0, dayId, NO_DAY_RECORDS);
  return { dayId, ...found, through, steps: await dayLines(file, ops, new Set(), unit) };
}

/**
 * The same history after more steps: only the writes since `known` are read. After an Empty Trash it's read afresh,
 * since older writes it emptied no longer say where they were, so a fresh read and this one always agree.
 */
export async function moreDayLog(file: ProjectFile, dayId: string, known: DayLog, unit?: PlanUnit): Promise<DayLog> {
  if (known.dayId !== dayId) return readDayLog(file, dayId, unit);
  // Taken before the Empty Trash check: one landing between the two is then either seen by it or after `through`, for
  // the next read's check, never skipped.
  const through = await lastOpSeq(file);
  if (await purgedSince(file, known.through)) return readDayLog(file, dayId, unit);
  const { ops, ...found } = await dayOpsSince(file, known.through, dayId, known);
  const have = new Set(known.steps.map((step) => step.group.id));
  const added = await dayLines(file, ops, have, unit);
  return { dayId, ...found, through: Math.max(known.through, through), steps: [...added, ...known.steps].sort((a, b) => b.group.seq - a.group.seq) };
}

/** The steps these ops belong to, leaving out those already `have`, each with its line, newest first. */
async function dayLines(file: ProjectFile, ops: readonly LoggedOp[], have: ReadonlySet<string>, unit?: PlanUnit): Promise<DayLog['steps']> {
  const ids = [...new Set(ops.map((op) => op.groupId))].filter((id) => !have.has(id));
  if (ids.length === 0) return [];
  // The steps, and every step an undo, redo or restore among them names (and those name), for their lines.
  const named = await withNamed(file, ids);
  const found = new Map(named.map((g) => [g.id, g]));
  // Only an edit's own ops are read, as the top bar's lines read them: an undo or a restore is named by the step it
  // names, and a Restore to here can hold about 125k ops (#241).
  const { titles } = await describeSteps(file, named, unit, { everyOp: false });
  return ids
    .map((id) => found.get(id))
    .filter((group): group is OpGroup => group !== undefined)
    .sort((a, b) => b.seq - a.seq)
    .map((group) => ({ group, line: titles.get(group.id) ?? [t('history.aStep')] }));
}

/**
 * What the tile says after Bring back what was undone (item 7): how many changes came back, and what stayed as it is
 * now and why ("Brought back 3 changes. 4A’s lens kept its later edit.").
 */
export function broughtBackNotice(done: Pick<BroughtBack, 'written' | 'kept'> & { deleted?: number }, unit?: PlanUnit): string {
  const said = done.written > 0 ? tn('history.broughtBackNotice', done.written) : t('history.nothingBroughtBack');
  const deleted = done.deleted ?? 0;
  return done.kept.length > 0 || deleted > 0 ? `${said} ${keptText(done.kept, unit, deleted)}` : said;
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

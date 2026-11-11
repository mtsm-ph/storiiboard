import { isRecordType, type Props, type RecordType, type SbdRecord } from '../model/record';
import { forgetSeenStatement } from '../storage/seen';
import type { ProjectFile, Row, Statement } from '../storage/driver';
import { recordSlateNumbers } from '../storage/slateNumbers';

// Every change to a project is an operation (CLAUDE.md, Edits, undo and autosave). One user action is one op group:
// its record changes, its op rows and its group row commit in a single transaction, which is the autosave. Each op
// keeps the whole record before and after, so undo writes "before" back and redo writes "after", with no per-kind
// inverse to get wrong.
//
// The log is append-only: undo, redo and restore are op groups of their own, written like any edit, and no op or
// group row is ever changed or deleted. So nothing a person did is lost, not even work undone and then edited over:
// restoreTo can bring back the project as it was after any group.

/** `revert` is a record set back to an earlier point by restoreTo. Undo and redo rows keep the kind they reverse. */
export type OpKind = 'create' | 'update' | 'move' | 'retype' | 'trash' | 'restore' | 'revert' | 'purge';

/** Ids to delete for good together with a purge, given every record and the ids being purged. */
export type AlsoPurge = (records: readonly SbdRecord[], purgedIds: readonly string[]) => Iterable<string>;

/** What one op group was: an edit, or one of the three ways of going back and forth through the log. */
export type GroupKind = 'edit' | 'undo' | 'redo' | 'restore' | 'empty_trash';

export interface OpGroup {
  id: string;
  seq: number;
  kind: GroupKind;
  /** For undo and redo: the group undone or redone. */
  targetGroupId: string | null;
  /** For restore: the group whose end state the project went back to, or null for the project as created. */
  restoreTo: string | null;
  author: string;
  timestamp: string;
  /** How many records the group wrote. */
  opCount: number;
}

export type Change =
  | {
      kind: 'create';
      record: { id?: string; type: RecordType; parentId: string | null; sortKey: string; props?: Props };
    }
  /** Sets the props in `set` and removes the ones in `unset`; every other prop stays as it was. */
  | { kind: 'update'; id: string; set?: Props; unset?: readonly string[] }
  | { kind: 'move'; id: string; parentId: string | null; sortKey: string }
  /** Changes the type and keeps every prop, so a reference image can become a frame without losing anything. */
  | { kind: 'retype'; id: string; type: RecordType }
  | { kind: 'trash'; id: string }
  | { kind: 'restore'; id: string };

export interface OpOptions {
  /** `local` until people sign in. */
  author?: string;
  now?: () => Date;
  /**
   * Statements that land in the same transaction as the edit: an image's bytes (src/core/media/store.ts), so the
   * frame and its picture are saved together or not at all. Content-addressed and written with INSERT OR IGNORE, so
   * they're never part of the History themselves; the media record that points at them is.
   */
  alsoWrite?: readonly Statement[];
}

/** Each record an apply, undo or redo touched, as it is now; null where it no longer exists. */
export type Touched = Map<string, SbdRecord | null>;

const RECORD_COLUMNS = 'id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at';

const text = (value: Row[string] | undefined) => (value === null || value === undefined ? null : String(value));

function fromRow(row: Row): SbdRecord {
  const type = row.type;
  if (!isRecordType(type)) throw new Error(`Unknown record type "${String(type)}".`);
  return {
    id: String(row.id),
    type,
    parentId: text(row.parent_id ?? null),
    sortKey: String(row.sort_key),
    props: JSON.parse(String(row.props)) as Props,
    trashedAt: text(row.trashed_at ?? null),
    trashedBy: text(row.trashed_by ?? null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** The JSON kept in ops.before and ops.after: the row as stored, with props as an object. */
function snapshot(record: SbdRecord | null): string | null {
  if (record === null) return null;
  return JSON.stringify({
    id: record.id,
    type: record.type,
    parent_id: record.parentId,
    sort_key: record.sortKey,
    props: record.props,
    trashed_at: record.trashedAt,
    trashed_by: record.trashedBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  });
}

function fromSnapshot(json: Row[string] | undefined): SbdRecord | null {
  if (json === null || json === undefined) return null;
  const row = JSON.parse(String(json)) as Record<string, unknown> & { props: Props };
  return fromRow({ ...(row as Row), props: JSON.stringify(row.props) });
}

function write(id: string, record: SbdRecord | null): Statement {
  if (record === null) return { sql: 'DELETE FROM records WHERE id = ?', params: [id] };
  return {
    sql: `INSERT INTO records (${RECORD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET type = excluded.type, parent_id = excluded.parent_id,
        sort_key = excluded.sort_key, props = excluded.props, trashed_at = excluded.trashed_at,
        trashed_by = excluded.trashed_by, updated_at = excluded.updated_at`,
    params: [
      record.id,
      record.type,
      record.parentId,
      record.sortKey,
      JSON.stringify(record.props),
      record.trashedAt,
      record.trashedBy,
      record.createdAt,
      record.updatedAt,
    ],
  };
}

export async function getRecord(file: ProjectFile, id: string): Promise<SbdRecord | null> {
  const [row] = await file.query(`SELECT ${RECORD_COLUMNS} FROM records WHERE id = ?`, [id]);
  return row ? fromRow(row) : null;
}

/** Every record, trashed ones included, in sibling order. Views filter; they never copy. */
export async function loadRecords(file: ProjectFile): Promise<SbdRecord[]> {
  const rows = await file.query(`SELECT ${RECORD_COLUMNS} FROM records ORDER BY parent_id, sort_key`);
  return rows.map(fromRow);
}

/** What a change does to a record, or an error a person can read. */
function changed(change: Change, before: SbdRecord | null, at: string, author: string): SbdRecord {
  if (change.kind === 'create') {
    if (before) throw new Error('That item already exists.');
    const { id = crypto.randomUUID(), type, parentId, sortKey, props = {} } = change.record;
    return { id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
  }
  if (!before) throw new Error('That item no longer exists.');
  const next = { ...before, updatedAt: at };
  switch (change.kind) {
    case 'update': {
      const unset = new Set(change.unset);
      const props = Object.fromEntries(
        Object.entries({ ...before.props, ...change.set }).filter(([key]) => !unset.has(key)),
      );
      return { ...next, props };
    }
    case 'move':
      return { ...next, parentId: change.parentId, sortKey: change.sortKey };
    case 'retype':
      return { ...next, type: change.type };
    case 'trash':
      // A project is archived through its state prop, never trashed: the two must not mix (CLAUDE.md).
      if (before.type === 'project') throw new Error('A project is archived, not moved to the Trash.');
      return { ...next, trashedAt: at, trashedBy: author };
    case 'restore':
      return { ...next, trashedAt: null, trashedBy: null };
  }
}

const changeId = (change: Change) => (change.kind === 'create' ? change.record.id : change.id);

interface PendingOp {
  recordId: string;
  kind: OpKind;
  before: SbdRecord | null;
  after: SbdRecord | null;
}

/** The undo and redo stacks as they stand after the newest group: the next group ⌘Z and ⌘⇧Z would take. */
interface Tops {
  undoTop: string | null;
  redoTop: string | null;
}

async function tops(file: ProjectFile): Promise<Tops> {
  const [row] = await file.query('SELECT undo_top, redo_top FROM op_groups ORDER BY seq DESC LIMIT 1');
  return { undoTop: text(row?.undo_top), redoTop: text(row?.redo_top) };
}

interface GroupRow extends Tops {
  kind: GroupKind;
  targetGroupId?: string | null;
  restoreTo?: string | null;
  /**
   * The stacks are linked lists threaded through the log, so ⌘Z never replays it. On an edit or restore: the group
   * ⌘Z takes once this one is undone. On an undo: the group ⌘⇧Z takes once the undone group is redone.
   */
  stackBelow: string | null;
}

const isNumbered = (record: SbdRecord | null) => record?.type === 'shot' || record?.type === 'scene';

/** Writes the records, the op rows and the group row in one transaction. Nothing already in the log is touched. */
async function commit(
  file: ProjectFile,
  group: GroupRow,
  ops: readonly PendingOp[],
  author: string,
  at: string,
  alsoWrite: readonly Statement[] = [],
): Promise<string> {
  const groupId = crypto.randomUUID();
  const [top] = await file.query(
    'SELECT (SELECT coalesce(max(seq), 0) FROM ops) AS op, (SELECT coalesce(max(seq), 0) FROM op_groups) AS grp',
  );
  const firstSeq = Number(top?.op ?? 0) + 1;
  const records = new Map<string, SbdRecord | null>();
  for (const op of ops) records.set(op.recordId, op.after);
  // Any number this group gives a shot in a locked scene, or a scene as it's locked, joins its slate numbers (1.26).
  // Undo, redo and restores write through here too, and never take a number out.
  const numbered = recordSlateNumbers(
    [...new Set(ops.filter((op) => isNumbered(op.after ?? op.before)).map((op) => op.recordId))],
    at,
  );
  await file.tx([
    ...alsoWrite,
    ...[...records].map(([id, record]) => write(id, record)),
    ...(numbered ? [numbered] : []),
    {
      sql: `INSERT INTO op_groups (id, seq, kind, target_group_id, restore_to, stack_below, undo_top, redo_top, author,
        timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        groupId,
        Number(top?.grp ?? 0) + 1,
        group.kind,
        group.targetGroupId ?? null,
        group.restoreTo ?? null,
        group.stackBelow,
        // An edit or restore becomes the top of the undo stack itself; its id only exists here.
        group.kind === 'edit' || group.kind === 'restore' ? groupId : group.undoTop,
        group.redoTop,
        author,
        at,
        at,
        at,
      ],
    },
    ...ops.map((op, i) => ({
      sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, created_at,
        updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), firstSeq + i, groupId, op.recordId, op.kind, snapshot(op.before), snapshot(op.after), author, at, at, at],
    })),
  ]);
  return groupId;
}

/**
 * Applies one user action as one op group. A new edit ends the redo stack, as in every editor, but the undone groups
 * stay in the log and restoreTo can still bring them back. Resolves once the group is on disk.
 */
export async function apply(file: ProjectFile, changes: readonly Change[], options: OpOptions = {}): Promise<Touched> {
  const { author = 'local', now = () => new Date() } = options;
  if (changes.length === 0) return new Map();
  const at = now().toISOString();

  // Every record the changes name, as it is now, read in one query rather than one a change (each is a round trip in
  // the desktop app: a drop of 30 pictures was 60 of them, renumbering a long scene hundreds; quality pass).
  const ids = [...new Set(changes.map(changeId).filter((id): id is string => id !== undefined))];
  const stored = new Map(
    (await file.query(`SELECT ${RECORD_COLUMNS} FROM records WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)])).map((row) => {
      const record = fromRow(row);
      return [record.id, record] as const;
    }),
  );
  const state: Touched = new Map();
  const ops: PendingOp[] = [];
  for (const change of changes) {
    const id = changeId(change);
    const before = id === undefined ? null : state.has(id) ? (state.get(id) ?? null) : (stored.get(id) ?? null);
    const after = changed(change, before, at, author);
    state.set(after.id, after);
    ops.push({ recordId: after.id, kind: change.kind, before, after });
  }

  const { undoTop } = await tops(file);
  await commit(file, { kind: 'edit', stackBelow: undoTop, undoTop: null, redoTop: null }, ops, author, at, options.alsoWrite);
  return state;
}

async function groupOps(file: ProjectFile, groupId: string): Promise<PendingOp[]> {
  const rows = await file.query('SELECT record_id, kind, before, after FROM ops WHERE group_id = ? ORDER BY seq', [groupId]);
  return rows.map((row) => ({
    recordId: String(row.record_id),
    kind: String(row.kind) as OpKind,
    before: fromSnapshot(row.before),
    after: fromSnapshot(row.after),
  }));
}

const touchedBy = (ops: readonly PendingOp[]): Touched => new Map(ops.map((op) => [op.recordId, op.after]));

/** Undoes the newest group on the undo stack, as a new undo group. Null when there's nothing to undo. */
export async function undo(file: ProjectFile, options: OpOptions = {}): Promise<Touched | null> {
  const { author = 'local', now = () => new Date() } = options;
  const { undoTop, redoTop } = await tops(file);
  if (undoTop === null) return null;
  const [target] = await file.query('SELECT stack_below FROM op_groups WHERE id = ?', [undoTop]);
  // Backwards through the group, each op swapped: the last write per record is its state before the group began.
  const ops = (await groupOps(file, undoTop)).reverse().map((op) => ({ ...op, before: op.after, after: op.before }));
  await commit(
    file,
    {
      kind: 'undo',
      targetGroupId: undoTop,
      stackBelow: redoTop,
      undoTop: text(target?.stack_below),
      redoTop: undoTop,
    },
    ops,
    author,
    now().toISOString(),
  );
  return touchedBy(ops);
}

/** Redoes the group undone most recently, as a new redo group. Null when there's nothing to redo. */
export async function redo(file: ProjectFile, options: OpOptions = {}): Promise<Touched | null> {
  const { author = 'local', now = () => new Date() } = options;
  const { redoTop } = await tops(file);
  if (redoTop === null) return null;
  // The redo stack beneath this group is what it was when the group was last undone.
  const [lastUndo] = await file.query(
    "SELECT stack_below FROM op_groups WHERE kind = 'undo' AND target_group_id = ? ORDER BY seq DESC LIMIT 1",
    [redoTop],
  );
  const ops = await groupOps(file, redoTop);
  await commit(
    file,
    {
      kind: 'redo',
      targetGroupId: redoTop,
      stackBelow: null,
      undoTop: redoTop,
      redoTop: text(lastUndo?.stack_below),
    },
    ops,
    author,
    now().toISOString(),
  );
  return touchedBy(ops);
}

/**
 * Brings the project back to how it was right after `groupId`, or as created when it's null, as one new restore
 * group: undo takes it back like any edit. Any group can be the point, undone ones and earlier restores included.
 * Null when the project is already that way.
 */
export async function restoreTo(file: ProjectFile, groupId: string | null, options: OpOptions = {}): Promise<Touched | null> {
  const { author = 'local', now = () => new Date() } = options;
  let lastSeq = 0;
  if (groupId !== null) {
    const [point] = await file.query(
      'SELECT g.id, (SELECT coalesce(max(o.seq), 0) FROM ops o JOIN op_groups e ON e.id = o.group_id WHERE e.seq <= g.seq) AS last FROM op_groups g WHERE g.id = ?',
      [groupId],
    );
    if (!point) throw new Error('That point is not in this project’s history.');
    lastSeq = Number(point.last);
  }
  // Every write goes through the log, so a record's first op after the point starts from its state at the point.
  const rows = await file.query(
    'SELECT record_id, before FROM ops WHERE seq IN (SELECT min(seq) FROM ops WHERE seq > ? GROUP BY record_id) ORDER BY seq',
    [lastSeq],
  );
  // Each record as it is now, read in one query rather than one a record (each is a round trip in the desktop app).
  const current = new Map(
    (
      await file.query(`SELECT ${RECORD_COLUMNS} FROM records WHERE id IN (SELECT value FROM json_each(?))`, [
        JSON.stringify(rows.map((row) => String(row.record_id))),
      ])
    ).map((row) => {
      const record = fromRow(row);
      return [record.id, record] as const;
    }),
  );
  const found: PendingOp[] = [];
  for (const row of rows) {
    const recordId = String(row.record_id);
    const before = current.get(recordId) ?? null;
    const after = fromSnapshot(row.before);
    if (snapshot(before) !== snapshot(after)) found.push({ recordId, kind: 'revert', before, after });
  }
  // Empty Trash deleted some records for good, and their data in the log with them, so the point can't always be
  // reached exactly. A record that would go back under a parent that won't be there stays as it is now (or stays away,
  // if it isn't there now), and a record that stays where it is keeps its parent from being deleted. Each step only
  // moves a record back to how it is now, so this ends, and every record written sits under one that exists.
  const final = new Map(found.map((op) => [op.recordId, op.after]));
  const byId = new Map(found.map((op) => [op.recordId, op]));
  const existsNow = new Map<string, boolean>();
  const exists = async (id: string): Promise<boolean> => {
    if (final.has(id)) return final.get(id) !== null;
    if (!existsNow.has(id)) existsNow.set(id, (await getRecord(file, id)) !== null);
    return existsNow.get(id) === true;
  };
  // Looked up once, so each record kept as it is now is handled once, however large the restore.
  const under = new Map<string, string[]>();
  const framesOf = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string | null | undefined, id: string) => {
    if (key) map.set(key, [...(map.get(key) ?? []), id]);
  };
  for (const op of found) {
    add(under, op.before?.parentId, op.recordId);
    const isShot = op.before?.type === 'shot' || op.after?.type === 'shot';
    if (isShot) for (const parentId of new Set([op.before?.parentId, op.after?.parentId])) add(framesOf, parentId, op.recordId);
  }
  let keptAny = false;
  const waiting: string[] = [];
  const keepAsNow = (id: string): boolean => {
    const before = byId.get(id)?.before ?? null;
    if (final.get(id) === before) return false;
    final.set(id, before);
    keptAny = true;
    waiting.push(id);
    return true;
  };
  /**
   * What a record kept as it is now holds on to, as it is now too:
   * - what's under it, and every record it names (a frame's picture, a scene's location, the theme's image): sent
   *   back to the point, a newer one would be deleted from under a record that still shows it;
   * - for a frame, its scene as it is now; for one in a scene it wasn't in at the point, every frame in it or going
   *   back into it too: the frame keeps the number it has there, alongside the scene's numbers as they are now;
   * - for a scene, every frame in it or going back into it: a scene kept as it is now may be locked now when it
   *   wasn't at the point, and a frame going back into it would land on a number from the point, which another shot
   *   may have been slated with since (1.26).
   */
  const settleKept = () => {
    for (let id = waiting.pop(); id !== undefined; id = waiting.pop()) {
      const kept = final.get(id);
      if (!kept) continue;
      for (const ref of namedBy(kept)) if (byId.has(ref)) keepAsNow(ref);
      for (const child of under.get(id) ?? []) keepAsNow(child);
      if (kept.type === 'scene') for (const frame of framesOf.get(id) ?? []) keepAsNow(frame);
      // Its scene too, even one it was in at the point: a scene going back to the point could come back locked
      // around a frame whose number is from now, never on a slate there (1.26). The scene then keeps its frames.
      if (kept.type === 'shot' && kept.parentId !== null && byId.has(kept.parentId)) keepAsNow(kept.parentId);
      if (kept.type === 'shot' && kept.parentId !== byId.get(id)?.after?.parentId && kept.parentId !== null) {
        for (const frame of framesOf.get(kept.parentId) ?? []) keepAsNow(frame);
      }
    }
  };
  // Once anything stays as it is now, the board is part now, part the point, and two scenes or two frames could land
  // on one number. One going back onto a number another holds stays as it is now. This always settles: each step only
  // moves a record to how it is now, once. (Two frames can share a number as the board is now, a locked scene
  // renumbered 9 keeping 4A beside a new scene 4's 4A; they stay as they are now, with their scenes.) Read only when
  // needed, since it takes every record.
  let everything: Map<string, SbdRecord> | null = null;
  const keepNumbersUnique = async (): Promise<boolean> => {
    if (!keptAny) return false;
    everything ??= new Map((await loadRecords(file)).map((r) => [r.id, r]));
    const now = everything;
    const groups = new Map<string, string[]>();
    for (const id of new Set([...now.keys(), ...final.keys()])) {
      const record = final.has(id) ? final.get(id) : now.get(id);
      if (!record || record.trashedAt !== null || (record.type !== 'scene' && record.type !== 'shot')) continue;
      const number = record.props.number;
      if (typeof number === 'string' && number !== '') add(groups, `${record.type}:${number}`, id);
    }
    let moved = false;
    for (const same of groups.values()) if (same.length > 1) for (const id of same) if (byId.has(id)) moved = keepAsNow(id) || moved;
    return moved;
  };
  for (let changed = true; changed; ) {
    changed = false;
    settleKept();
    for (const [id, record] of final) {
      const parentId = record?.parentId ?? null;
      if (!record || parentId === null || (await exists(parentId))) continue;
      const op = byId.get(id);
      const parent = byId.get(parentId);
      if (record !== op?.before) changed = keepAsNow(id) || changed;
      // As it is now, under a parent this restore would delete: the parent stays as it is now too.
      else if (parent?.before) changed = keepAsNow(parentId) || changed;
    }
    if (waiting.length > 0) changed = true;
    else if (await keepNumbersUnique()) changed = true;
  }
  const ops = found.flatMap((op) => {
    const after = final.get(op.recordId) ?? null;
    return snapshot(after) === snapshot(op.before) ? [] : [{ ...op, after }];
  });
  if (ops.length === 0) return null;
  const { undoTop } = await tops(file);
  await commit(
    file,
    { kind: 'restore', restoreTo: groupId, stackBelow: undoTop, undoTop: null, redoTop: null },
    ops,
    author,
    now().toISOString(),
  );
  return touchedBy(ops);
}

/**
 * The kinds a person deletes to the Trash, and so the kinds Empty Trash deletes for good. An erased sketch stroke is
 * trashed too but isn't in the Trash (1.13, 1.20): it goes only with its frame, so a frame still on the board keeps
 * its sketch's History.
 */
const TRASHED_BY_PEOPLE: ReadonlySet<string> = new Set(['scene', 'shot', 'note', 'media', 'location', 'person', 'shoot_day', 'gear_item', 'board', 'board_item']);

/** What the Trash holds as Empty Trash sees it: each trashed scene, frame, note, picture, location, person, shoot day, gear item, board or board item (not what's under them). */
export function trashedRoots(records: readonly SbdRecord[]): string[] {
  return records.filter((r) => r.trashedAt !== null && TRASHED_BY_PEOPLE.has(r.type)).map((r) => r.id);
}

/**
 * The records a record names in its props, which a restore keeps with it: a frame's picture, a scene's location and
 * its characters (3.13), a character's cast member, the theme's image. (A frame's shoot day and gear aren't among them
 * yet: kept as now, a frame can point at a day the restore leaves in the Trash, and reads as unscheduled.)
 */
function namedBy(record: SbdRecord): string[] {
  const { props } = record;
  const theme = props.theme && typeof props.theme === 'object' && !Array.isArray(props.theme) ? (props.theme as Record<string, unknown>) : null;
  const characters = Array.isArray(props.character_ids) ? props.character_ids : [];
  return [props.media_id, props.location_id, props.cast_id, theme?.image_id, ...characters].filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * Every record Empty Trash deletes: each trashed scene, frame, note, picture, location, person, shoot day, gear item, board or board item and everything under it. With `only`,
 * just those of them the person confirmed (anything trashed while the confirm was up stays in the Trash).
 */
export function purgeIds(records: readonly SbdRecord[], only?: ReadonlySet<string>): string[] {
  const children = new Map<string, SbdRecord[]>();
  for (const record of records) {
    if (!record.parentId) continue;
    const list = children.get(record.parentId);
    if (list) list.push(record);
    else children.set(record.parentId, [record]);
  }
  const ids = new Set<string>();
  const add = (record: SbdRecord) => {
    if (ids.has(record.id)) return;
    ids.add(record.id);
    for (const child of children.get(record.id) ?? []) add(child);
  };
  for (const record of records) {
    if (record.trashedAt !== null && TRASHED_BY_PEOPLE.has(record.type) && (!only || only.has(record.id))) add(record);
  }
  return [...ids];
}

/** A stored picture: its address, and the space it takes with its thumbnails. */
export interface StoredPicture {
  sha256: string;
  bytes: number;
}

/** Each stored picture's space, with its thumbnails. */
const PICTURE_SIZE = `f.byte_size + coalesce((SELECT sum(length(t.bytes)) FROM thumbnails t WHERE t.sha256 = f.sha256), 0)`;

/**
 * Stored pictures nothing uses once `without` records are gone: no record's props name them, and no op of a remaining
 * record does. What Empty Trash may delete with the records.
 */
async function unusedPictures(file: ProjectFile, without: readonly string[]): Promise<StoredPicture[]> {
  const rows = await file.query(
    `WITH gone(id) AS (SELECT value FROM json_each(?)),
      used(sha) AS (
        SELECT json_extract(props, '$.file') FROM records WHERE type = 'media' AND id NOT IN (SELECT id FROM gone)
        UNION SELECT json_extract(before, '$.props.file') FROM ops
          WHERE json_extract(before, '$.type') = 'media' AND record_id NOT IN (SELECT id FROM gone)
        UNION SELECT json_extract(after, '$.props.file') FROM ops
          WHERE json_extract(after, '$.type') = 'media' AND record_id NOT IN (SELECT id FROM gone)
      )
    SELECT f.sha256, ${PICTURE_SIZE} AS size
      FROM media_files f WHERE f.sha256 NOT IN (SELECT sha FROM used WHERE sha IS NOT NULL)`,
    [JSON.stringify(without)],
  );
  return rows.map((row) => ({ sha256: String(row.sha256), bytes: Number(row.size) }));
}

/**
 * Records that exist only in History (made and then undone, say) and could only ever come back under what Empty
 * Trash is deleting: every parent they had in any step is going, was deleted by an earlier Empty Trash (no step of it
 * holds data any more), or is one of these. A restore never brings a record back under a parent that's gone, so their
 * data in the log would stay in the file for good; Empty Trash clears it with the rest.
 */
async function onlyInHistoryUnder(file: ProjectFile, live: readonly SbdRecord[], deleting: readonly string[]): Promise<string[]> {
  const rows = await file.query(
    `SELECT record_id, before, after FROM ops WHERE record_id NOT IN (SELECT id FROM records)
      AND (before IS NOT NULL OR after IS NOT NULL) ORDER BY seq`,
  );
  const parents = new Map<string, Set<string | null>>();
  for (const row of rows) {
    const id = String(row.record_id);
    const seen = parents.get(id) ?? new Set<string | null>();
    for (const snap of [fromSnapshot(row.before), fromSnapshot(row.after)]) if (snap) seen.add(snap.parentId);
    parents.set(id, seen);
  }
  const exists = new Set(live.map((r) => r.id));
  const gone = new Set(deleting);
  const isGone = (id: string | null) => id !== null && (gone.has(id) || (!exists.has(id) && !parents.has(id)));
  const found: string[] = [];
  for (let more = true; more; ) {
    more = false;
    for (const [id, had] of parents) {
      if (gone.has(id) || had.size === 0 || ![...had].every(isGone)) continue;
      gone.add(id);
      found.push(id);
      more = true;
    }
  }
  return found;
}

function deletePictures(pictures: readonly StoredPicture[]): Statement[] {
  const list = JSON.stringify(pictures.map((p) => p.sha256));
  // Thumbnails first: they point at the file.
  return [
    { sql: 'DELETE FROM thumbnails WHERE sha256 IN (SELECT value FROM json_each(?))', params: [list] },
    { sql: 'DELETE FROM media_files WHERE sha256 IN (SELECT value FROM json_each(?))', params: [list] },
  ];
}

/**
 * A migration that changes records (schemas 9 and 12) writes them through here: the records, and one `edit` group
 * with an `update` op for each (and a `create` op for each record it makes, schema 12's characters), so History shows
 * what changed and Restore to here reads the records as they are now, never a snapshot from before. Its undo and redo stacks end there, as Empty Trash's do: ⌘Z after an upgrade never writes a
 * record back in the shape the older schema had. Read before the migration's transaction; run inside it.
 */
export async function loggedRewrite(
  file: ProjectFile,
  changes: readonly { before: SbdRecord; props: Props }[],
  at: string,
  author = 'local',
  created: readonly SbdRecord[] = [],
): Promise<Statement[]> {
  if (changes.length === 0 && created.length === 0) return [];
  const [top] = await file.query(
    'SELECT (SELECT coalesce(max(seq), 0) FROM ops) AS op, (SELECT coalesce(max(seq), 0) FROM op_groups) AS grp',
  );
  const firstSeq = Number(top?.op ?? 0) + 1;
  const groupId = crypto.randomUUID();
  const ops: { kind: 'create' | 'update'; before: SbdRecord | null; after: SbdRecord }[] = [
    ...created.map((record) => ({ kind: 'create' as const, before: null, after: record })),
    ...changes.map(({ before, props }) => ({ kind: 'update' as const, before, after: { ...before, props, updatedAt: at } })),
  ];
  return [
    ...ops.map(({ after }) => write(after.id, after)),
    {
      sql: `INSERT INTO op_groups (id, seq, kind, target_group_id, restore_to, stack_below, undo_top, redo_top, author,
        timestamp, created_at, updated_at) VALUES (?, ?, 'edit', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      params: [groupId, Number(top?.grp ?? 0) + 1, author, at, at, at],
    },
    ...ops.map((op, i) => ({
      sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, created_at,
        updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), firstSeq + i, groupId, op.after.id, op.kind, snapshot(op.before), snapshot(op.after), author, at, at, at],
    })),
  ];
}

/**
 * Empty Trash (1.21, docs/SBD_FORMAT.md): deletes every trashed record and everything under it for good, in one
 * transaction. Their data goes from older ops too, so neither undo nor a History restore can bring back half of one;
 * the purge is recorded as an `empty_trash` group of `purge` ops, and the undo and redo stacks end there. Stored
 * pictures nothing left refers to are deleted with them. Null when the Trash is empty.
 */
export async function emptyTrash(
  file: ProjectFile,
  options: OpOptions & { only?: ReadonlySet<string>; alsoPurge?: AlsoPurge } = {},
): Promise<{ touched: Touched; removed: number; freed: number; pictures: string[] } | null> {
  const { author = 'local', now = () => new Date(), only, alsoPurge } = options;
  const all = await loadRecords(file);
  const purged = purgeIds(all, only);
  // Records a feature names to go with what is deleted (a board's connectors joined to a deleted item), live or not, worked
  // out here from the records as they are now and the final set, so what was restored while a confirm was up stays. They go
  // only when something else does, only if they are there, and only if they have nothing under them: extras must be
  // childless records the caller has checked, since a child left behind would hang from nothing.
  const known = new Set(all.map((r) => r.id));
  const parents = new Set(all.flatMap((r) => (r.parentId ? [r.parentId] : [])));
  const extra = purged.length === 0 || !alsoPurge ? [] : [...alsoPurge(all, purged)].filter((id) => known.has(id) && !parents.has(id));
  const ids = [...new Set([...purged, ...extra])];
  if (ids.length === 0) return null;
  const unreachable = await onlyInHistoryUnder(file, all, ids);
  const pictures = await unusedPictures(file, [...ids, ...unreachable]);
  const at = now().toISOString();
  const groupId = crypto.randomUUID();
  const gone = JSON.stringify([...ids, ...unreachable]);
  const [top] = await file.query(
    'SELECT (SELECT coalesce(max(seq), 0) FROM ops) AS op, (SELECT coalesce(max(seq), 0) FROM op_groups) AS grp',
  );
  const firstSeq = Number(top?.op ?? 0) + 1;
  await file.tx([
    { sql: 'UPDATE ops SET before = NULL, after = NULL WHERE record_id IN (SELECT value FROM json_each(?))', params: [gone] },
    { sql: 'DELETE FROM records WHERE id IN (SELECT value FROM json_each(?))', params: [gone] },
    // A frame's Seen goes with it (schema 7); nothing else reads those rows.
    forgetSeenStatement(gone),
    // The address searches (3.4) hold addresses, which are private, and the hospital searches (4.5) are around a
    // location's place: once a location goes for good, the cache of both goes too (it can't say whose each was; it's
    // only a cache, asked again when pressed).
    ...(ids.some((id) => all.find((r) => r.id === id)?.type === 'location') ? [{ sql: "DELETE FROM lookups WHERE kind IN ('address_search', 'hospital_search')" }] : []),
    {
      sql: `INSERT INTO op_groups (id, seq, kind, target_group_id, restore_to, stack_below, undo_top, redo_top, author,
        timestamp, created_at, updated_at) VALUES (?, ?, 'empty_trash', NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      params: [groupId, Number(top?.grp ?? 0) + 1, author, at, at, at],
    },
    ...ids.map((id, i) => ({
      sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, created_at,
        updated_at) VALUES (?, ?, ?, ?, 'purge', NULL, NULL, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), firstSeq + i, groupId, id, author, at, at, at],
    })),
    ...deletePictures(pictures),
  ]);
  return {
    touched: new Map(ids.map((id) => [id, null])),
    removed: ids.length,
    freed: pictures.reduce((sum, p) => sum + p.bytes, 0),
    pictures: pictures.map((p) => p.sha256),
  };
}

/**
 * Pictures only History still uses (1.21): no record in the project, live or in the Trash, shows them, but an older
 * step does (a picture added and undone, say). Clean up old pictures deletes them for good; those steps then show
 * "picture removed". A picture a named version's point shows isn't one of them (1.23): it stays until the version is
 * deleted (CLAUDE.md: Going back in time), so Clean up never takes a picture Open version would show.
 *
 * Settings → Storage reads this after every edit, and on the desktop each query holds the file, so its cost must not
 * grow with versions times the log. It narrows in steps: the pictures no record shows (usually none, and then it's
 * done), the versions' points, the media records the log names with one of those pictures (mediaInLog), and for each
 * point and each such record the first op after the point, through the ops_by_record (record_id, seq) index.
 *
 * `fresh` reads the whole log again rather than trusting what an earlier call took in: for Clean up itself, which
 * deletes what this finds.
 */
export async function historyOnlyPictures(file: ProjectFile, options: { fresh?: boolean } = {}): Promise<StoredPicture[]> {
  const loose = (
    await file.query(
      `SELECT f.sha256, ${PICTURE_SIZE} AS size FROM media_files f
        WHERE f.sha256 NOT IN (
          SELECT json_extract(props, '$.file') AS sha FROM records WHERE type = 'media' AND sha IS NOT NULL
        )`,
    )
  ).map((row): StoredPicture => ({ sha256: String(row.sha256), bytes: Number(row.size) }));
  if (loose.length === 0) return [];
  // Only a media record some op's `before` shows with a loose picture can keep one, through undo or a version.
  const naming = await mediaInLog(file, options.fresh ?? false);
  const media = [...new Set(loose.flatMap((p) => [...(naming.get(p.sha256) ?? [])]))];
  if (media.length === 0) return loose;
  // What one ⌘Z can still bring back stays (1.21): the pictures any step on the undo stack had before it ran (a frame
  // a History restore took away, say). Only the redo stack's are History's alone.
  const undoable = await file.query(
    `WITH RECURSIVE undoable(id) AS (
        SELECT undo_top FROM op_groups WHERE seq = (SELECT max(seq) FROM op_groups) AND undo_top IS NOT NULL
        UNION SELECT g.stack_below FROM op_groups g JOIN undoable u ON g.id = u.id WHERE g.stack_below IS NOT NULL
      )
      SELECT DISTINCT json_extract(o.before, '$.props.file') AS sha FROM json_each(?) m
        JOIN ops o ON o.record_id = m.value WHERE o.group_id IN (SELECT id FROM undoable)`,
    [JSON.stringify(media)],
  );
  const kept = new Set(undoable.map((row) => row.sha).filter((sha) => sha !== null && sha !== undefined).map(String));
  // Each version's point as restoreTo finds it: the last op of its group or any group before it. Ops and groups are
  // numbered together, each write appending both (commit, emptyTrash, the v2 backfill), so that's the last op of the
  // nearest group at or before it that has any: found by walking back from the group, not by reading every op before.
  const points = (
    await file.query(
      `SELECT DISTINCT coalesce((
          SELECT max(o.seq) FROM ops o WHERE o.group_id = (
            SELECT e.id FROM op_groups e WHERE e.seq <= g.seq AND EXISTS (SELECT 1 FROM ops x WHERE x.group_id = e.id)
              ORDER BY e.seq DESC LIMIT 1)
        ), 0) AS last
        FROM versions v JOIN op_groups g ON g.id = v.op_group_id`,
    )
  ).map((row) => Number(row.last));
  if (points.length === 0) return loose.filter((p) => !kept.has(p.sha256));
  // A record touched after a point was, at the point, the `before` of its first op after it; one untouched since is as
  // it is now, and so already counted above.
  const shown = await file.query(
    `SELECT DISTINCT json_extract(
        (SELECT o.before FROM ops o WHERE o.record_id = m.value AND o.seq > p.value ORDER BY o.seq LIMIT 1), '$.props.file'
      ) AS sha
      FROM json_each(?) p, json_each(?) m`,
    [JSON.stringify(points), JSON.stringify(media)],
  );
  for (const row of shown) if (row.sha !== null && row.sha !== undefined) kept.add(String(row.sha));
  return loose.filter((p) => !kept.has(p.sha256));
}

/** Per open file: the media records each picture appears in as some op's `before`, read up to op `through`. */
const mediaRead = new WeakMap<ProjectFile, { through: number; naming: Map<string, Set<string>> }>();

/**
 * Which media records the log shows with which picture. The log has no index by record type, so finding them reads
 * every op; that's done once per open file, and each later call reads only the ops written since. Ops are only ever
 * appended, each above the last; Empty Trash empties old ones, which leaves a name here whose op now shows nothing.
 */
async function mediaInLog(file: ProjectFile, fresh: boolean): Promise<Map<string, Set<string>>> {
  const known = fresh ? undefined : mediaRead.get(file);
  // One statement, so the newest seq and the ops read up to it are the same moment of the log.
  const rows = await file.query(
    `WITH top(seq) AS (SELECT coalesce(max(seq), 0) FROM ops)
      SELECT top.seq AS through, o.record_id, json_extract(o.before, '$.props.file') AS sha
        FROM top LEFT JOIN ops o ON o.seq > ? AND o.seq <= top.seq
          -- instr first: a plain text search skips the sketch and other writes that make up most of a log before the
          -- slower JSON read, which alone decides. A media record's JSON always holds the word; nothing escapes letters.
          AND instr(o.before, 'media') > 0 AND json_extract(o.before, '$.type') = 'media'`,
    [known?.through ?? 0],
  );
  const naming = known?.naming ?? new Map<string, Set<string>>();
  let through = known?.through ?? 0;
  for (const row of rows) {
    through = Math.max(through, Number(row.through));
    if (typeof row.sha !== 'string' || row.record_id === null || row.record_id === undefined) continue;
    const ids = naming.get(row.sha) ?? new Set<string>();
    ids.add(String(row.record_id));
    naming.set(row.sha, ids);
  }
  const now = mediaRead.get(file);
  // Calls can overlap; what each took in is true of the log, so it's all kept, as far as the furthest read went.
  if (now && now.naming !== naming) for (const [sha, ids] of now.naming) naming.set(sha, new Set([...(naming.get(sha) ?? []), ...ids]));
  mediaRead.set(file, { through: Math.max(through, now?.through ?? 0), naming });
  return naming;
}

/**
 * Clean up old pictures: deletes the stored pictures only History uses, in one transaction. The log is unchanged.
 * With `only`, just those of them the person confirmed.
 */
export async function cleanUpPictures(
  file: ProjectFile,
  only?: ReadonlySet<string>,
): Promise<{ removed: number; freed: number; pictures: string[] }> {
  const pictures = (await historyOnlyPictures(file, { fresh: true })).filter((p) => !only || only.has(p.sha256));
  if (pictures.length > 0) await file.tx(deletePictures(pictures));
  return { removed: pictures.length, freed: pictures.reduce((sum, p) => sum + p.bytes, 0), pictures: pictures.map((p) => p.sha256) };
}

export async function history(file: ProjectFile): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const { undoTop, redoTop } = await tops(file);
  return { canUndo: undoTop !== null, canRedo: redoTop !== null };
}

/** One write in the log, as the History tile reads it. */
export interface LoggedOp {
  /** The op's own id: what keeps a row of History the same row when newer steps arrive above it. */
  id: string;
  /** Its place in the log. */
  seq: number;
  groupId: string;
  /** The group's kind: an undo's ops keep the kind they reverse, so this is what tells an undone add from an add. */
  groupKind: GroupKind;
  recordId: string;
  kind: OpKind;
  before: SbdRecord | null;
  after: SbdRecord | null;
  author: string;
  timestamp: string;
}

const loggedOp = (row: Row): LoggedOp => ({
  id: String(row.id),
  seq: Number(row.seq),
  groupId: String(row.group_id),
  groupKind: String(row.group_kind) as GroupKind,
  recordId: String(row.record_id),
  kind: String(row.kind) as OpKind,
  before: fromSnapshot(row.before),
  after: fromSnapshot(row.after),
  author: String(row.author),
  timestamp: String(row.timestamp),
});

const LOGGED_COLUMNS = 'o.id, o.seq, o.group_id, g.kind AS group_kind, o.record_id, o.kind, o.before, o.after, o.author, o.timestamp';

/** The ops of some groups, in log order, for the History tile's page of steps. */
export async function opsOfGroups(file: ProjectFile, groupIds: readonly string[]): Promise<LoggedOp[]> {
  if (groupIds.length === 0) return [];
  const rows = await file.query(
    `SELECT ${LOGGED_COLUMNS} FROM ops o
      JOIN op_groups g ON g.id = o.group_id WHERE o.group_id IN (SELECT value FROM json_each(?)) ORDER BY o.seq`,
    [JSON.stringify(groupIds)],
  );
  return rows.map(loggedOp);
}

/** Every write to one record, oldest first (ops_by_record): an item's own history. */
export function opsOfRecord(file: ProjectFile, recordId: string): Promise<LoggedOp[]> {
  return opsOfRecords(file, [recordId]);
}

/** Every write to some records, oldest first: a frame's history with its sketch and picture. */
export async function opsOfRecords(file: ProjectFile, recordIds: readonly string[]): Promise<LoggedOp[]> {
  if (recordIds.length === 0) return [];
  const rows = await file.query(
    `SELECT ${LOGGED_COLUMNS} FROM ops o
      JOIN op_groups g ON g.id = o.group_id WHERE o.record_id IN (SELECT value FROM json_each(?)) ORDER BY o.seq`,
    [JSON.stringify(recordIds)],
  );
  return rows.map(loggedOp);
}

/**
 * Every record the log ever put under `parentId` (a frame's strokes and picture), from both sides of its writes: a
 * sketch that was undone, or taken away by Restore to here, has no record any more, but its steps are still the
 * frame's. Not those Empty Trash deleted for good, whose writes no longer say where they were.
 */
export async function childrenInLog(file: ProjectFile, parentId: string): Promise<string[]> {
  const rows = await file.query(
    `SELECT DISTINCT record_id FROM ops WHERE record_id <> ?
      AND (json_extract(before, '$.parent_id') = ? OR json_extract(after, '$.parent_id') = ?)`,
    [parentId, parentId, parentId],
  );
  return rows.map((row) => String(row.record_id));
}

/** The newest op's seq, 0 for an empty log: where a later read of one item's new writes starts (opsSince). */
export async function lastOpSeq(file: ProjectFile): Promise<number> {
  const rows = await file.query('SELECT coalesce(max(seq), 0) AS seq FROM ops');
  return Number(rows[0]?.seq ?? 0);
}

/**
 * The writes after `seq` to some records, or to what they put under `parentId`, oldest first: an item's new history
 * since it was last read. Only the ops after `seq` are looked at (seq is indexed), so it costs what the new steps
 * wrote, not the whole log, as childrenInLog does.
 */
export async function opsSince(file: ProjectFile, seq: number, recordIds: readonly string[], parentId: string | null): Promise<LoggedOp[]> {
  const rows = await file.query(
    `SELECT ${LOGGED_COLUMNS} FROM ops o
      JOIN op_groups g ON g.id = o.group_id WHERE o.seq > ?
      AND (o.record_id IN (SELECT value FROM json_each(?))
        OR json_extract(o.before, '$.parent_id') = ? OR json_extract(o.after, '$.parent_id') = ?)
      ORDER BY o.seq`,
    [seq, JSON.stringify(recordIds), parentId, parentId],
  );
  return rows.map(loggedOp);
}

/**
 * Each record as its last write before `seq` left it, in the order asked; null where there's none (or Empty Trash
 * took its data). For naming a record a step touched without writing it, as it was then: a sketch's frame.
 */
export async function recordsBefore(file: ProjectFile, asks: readonly { id: string; seq: number }[]): Promise<(SbdRecord | null)[]> {
  if (asks.length === 0) return [];
  const rows = await file.query(
    `SELECT j.key AS i, (SELECT o.after FROM ops o WHERE o.record_id = json_extract(j.value, '$.id')
        AND o.seq < json_extract(j.value, '$.seq') ORDER BY o.seq DESC LIMIT 1) AS after
      FROM json_each(?) j ORDER BY j.key`,
    [JSON.stringify(asks)],
  );
  return rows.map((row) => fromSnapshot(row.after));
}

/** The picture files still stored: a step whose picture isn't among them shows "picture removed" (1.21). */
export async function storedPictures(file: ProjectFile): Promise<Set<string>> {
  return new Set((await file.query('SELECT sha256 FROM media_files')).map((row) => String(row.sha256)));
}

/** Every op group, oldest first, undos, redos and restores included: what the History panel lists. */
export async function log(file: ProjectFile): Promise<OpGroup[]> {
  const rows = await file.query(
    `SELECT g.id, g.seq, g.kind, g.target_group_id, g.restore_to, g.author, g.timestamp,
      (SELECT count(*) FROM ops o WHERE o.group_id = g.id) AS op_count FROM op_groups g ORDER BY g.seq`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    seq: Number(row.seq),
    kind: String(row.kind) as GroupKind,
    targetGroupId: text(row.target_group_id),
    restoreTo: text(row.restore_to),
    author: String(row.author),
    timestamp: String(row.timestamp),
    opCount: Number(row.op_count),
  }));
}

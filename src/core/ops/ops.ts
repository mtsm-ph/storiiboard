import { isRecordType, type Props, type RecordType, type SbdRecord } from '../model/record';
import type { ProjectFile, Row, Statement } from '../storage/driver';

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
  await file.tx([
    ...alsoWrite,
    ...[...records].map(([id, record]) => write(id, record)),
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

  const state: Touched = new Map();
  const ops: PendingOp[] = [];
  for (const change of changes) {
    const id = changeId(change);
    const before = id === undefined ? null : state.has(id) ? (state.get(id) ?? null) : await getRecord(file, id);
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
  const found: PendingOp[] = [];
  for (const row of rows) {
    const recordId = String(row.record_id);
    const before = await getRecord(file, recordId);
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
  const keepAsNow = (id: string): boolean => {
    const before = byId.get(id)?.before ?? null;
    if (final.get(id) === before) return false;
    final.set(id, before);
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    // A record kept as it is now keeps what's under it and the picture it names as they are now too: sent back to
    // the point, a newer picture or sketch would be deleted from under a frame that still shows it.
    for (const [id, op] of byId) {
      const kept = final.get(id);
      if (!kept || kept !== op.before) continue;
      const mediaId = typeof kept.props.media_id === 'string' ? kept.props.media_id : null;
      if (mediaId !== null && byId.has(mediaId)) changed = keepAsNow(mediaId) || changed;
      for (const [other, otherOp] of byId) if (otherOp.before?.parentId === id) changed = keepAsNow(other) || changed;
    }
    // A frame kept as it is now in a scene it wasn't in at the point keeps the number it has there, so that scene
    // and every frame in it or going back into it stay as they are now too: otherwise two frames could share a slate
    // number (the board as it is now has none).
    for (const [id, op] of byId) {
      const kept = final.get(id);
      if (!kept || kept !== op.before || kept.type !== 'shot' || kept.parentId === op.after?.parentId) continue;
      const sceneId = kept.parentId;
      if (sceneId !== null && byId.has(sceneId)) changed = keepAsNow(sceneId) || changed;
      for (const [other, otherOp] of byId) {
        const isShot = otherOp.before?.type === 'shot' || otherOp.after?.type === 'shot';
        const there = otherOp.before?.parentId === sceneId || final.get(other)?.parentId === sceneId;
        if (isShot && there) changed = keepAsNow(other) || changed;
      }
    }
    for (const [id, record] of final) {
      const parentId = record?.parentId ?? null;
      if (!record || parentId === null || (await exists(parentId))) continue;
      const op = byId.get(id);
      const parent = byId.get(parentId);
      if (record !== op?.before) {
        final.set(id, op?.before ?? null);
        changed = true;
      } else if (parent?.before && final.get(parentId) !== parent.before) {
        // As it is now, under a parent this restore would delete: the parent stays as it is now too.
        final.set(parentId, parent.before);
        changed = true;
      }
    }
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
const TRASHED_BY_PEOPLE: ReadonlySet<string> = new Set(['scene', 'shot', 'note', 'media']);

/** What the Trash holds as Empty Trash sees it: each trashed scene, frame, note or picture (not what's under them). */
export function trashedRoots(records: readonly SbdRecord[]): string[] {
  return records.filter((r) => r.trashedAt !== null && TRASHED_BY_PEOPLE.has(r.type)).map((r) => r.id);
}

/**
 * Every record Empty Trash deletes: each trashed scene, frame, note or picture and everything under it. With `only`,
 * just those of them the person confirmed (anything trashed while the confirm was up stays in the Trash).
 */
export function purgeIds(records: readonly SbdRecord[], only?: ReadonlySet<string>): string[] {
  const children = new Map<string, SbdRecord[]>();
  for (const record of records) if (record.parentId) children.set(record.parentId, [...(children.get(record.parentId) ?? []), record]);
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

/**
 * Stored pictures nothing uses once `without` records are gone: no record's props name them, and either (when
 * `historyToo`) no op of a remaining record does, or no named version's point does. A version is kept until someone
 * deletes it (CLAUDE.md: Going back in time), so Clean up never takes a picture Open version would show. Its point is
 * read as restoreTo reads it: a record touched after the point was, at the point, the `before` of its first op after
 * it; one untouched since is as it is now, and so is already counted.
 */
async function unusedPictures(file: ProjectFile, without: readonly string[], historyToo: boolean): Promise<StoredPicture[]> {
  const fromOps = historyToo
    ? `UNION SELECT json_extract(before, '$.props.file') FROM ops
         WHERE json_extract(before, '$.type') = 'media' AND record_id NOT IN (SELECT id FROM gone)
       UNION SELECT json_extract(after, '$.props.file') FROM ops
         WHERE json_extract(after, '$.type') = 'media' AND record_id NOT IN (SELECT id FROM gone)`
    : `UNION SELECT json_extract(o.before, '$.props.file') FROM ops o
         JOIN (SELECT min(x.seq) AS first FROM points p JOIN ops x ON x.seq > p.last GROUP BY p.last, x.record_id) f
           ON o.seq = f.first
         WHERE json_extract(o.before, '$.type') = 'media' AND o.record_id NOT IN (SELECT id FROM gone)`;
  // Each version's point as restoreTo finds it: the last op of its group or any group before it.
  const points = historyToo
    ? ''
    : `points(last) AS (
        SELECT DISTINCT (SELECT coalesce(max(o.seq), 0) FROM ops o JOIN op_groups e ON e.id = o.group_id WHERE e.seq <= g.seq)
          FROM versions v JOIN op_groups g ON g.id = v.op_group_id
      ),`;
  const rows = await file.query(
    `WITH gone(id) AS (SELECT value FROM json_each(?)),
      ${points}
      used(sha) AS (
        SELECT json_extract(props, '$.file') FROM records WHERE type = 'media' AND id NOT IN (SELECT id FROM gone)
        ${fromOps}
      )
    SELECT f.sha256, f.byte_size + coalesce((SELECT sum(length(t.bytes)) FROM thumbnails t WHERE t.sha256 = f.sha256), 0) AS size
      FROM media_files f WHERE f.sha256 NOT IN (SELECT sha FROM used WHERE sha IS NOT NULL)`,
    [JSON.stringify(without)],
  );
  return rows.map((row) => ({ sha256: String(row.sha256), bytes: Number(row.size) }));
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
 * Empty Trash (1.21, docs/SBD_FORMAT.md): deletes every trashed record and everything under it for good, in one
 * transaction. Their data goes from older ops too, so neither undo nor a History restore can bring back half of one;
 * the purge is recorded as an `empty_trash` group of `purge` ops, and the undo and redo stacks end there. Stored
 * pictures nothing left refers to are deleted with them. Null when the Trash is empty.
 */
export async function emptyTrash(
  file: ProjectFile,
  options: OpOptions & { only?: ReadonlySet<string> } = {},
): Promise<{ touched: Touched; removed: number; freed: number; pictures: string[] } | null> {
  const { author = 'local', now = () => new Date(), only } = options;
  const all = await loadRecords(file);
  const ids = purgeIds(all, only);
  if (ids.length === 0) return null;
  const pictures = await unusedPictures(file, ids, true);
  const at = now().toISOString();
  const groupId = crypto.randomUUID();
  const gone = JSON.stringify(ids);
  const [top] = await file.query(
    'SELECT (SELECT coalesce(max(seq), 0) FROM ops) AS op, (SELECT coalesce(max(seq), 0) FROM op_groups) AS grp',
  );
  const firstSeq = Number(top?.op ?? 0) + 1;
  await file.tx([
    { sql: 'UPDATE ops SET before = NULL, after = NULL WHERE record_id IN (SELECT value FROM json_each(?))', params: [gone] },
    { sql: 'DELETE FROM records WHERE id IN (SELECT value FROM json_each(?))', params: [gone] },
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
 * deleted.
 */
export function historyOnlyPictures(file: ProjectFile): Promise<StoredPicture[]> {
  return unusedPictures(file, [], false);
}

/**
 * Clean up old pictures: deletes the stored pictures only History uses, in one transaction. The log is unchanged.
 * With `only`, just those of them the person confirmed.
 */
export async function cleanUpPictures(
  file: ProjectFile,
  only?: ReadonlySet<string>,
): Promise<{ removed: number; freed: number; pictures: string[] }> {
  const pictures = (await historyOnlyPictures(file)).filter((p) => !only || only.has(p.sha256));
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

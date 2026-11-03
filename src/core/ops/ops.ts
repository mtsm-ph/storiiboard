import { isRecordType, type Props, type RecordType, type SbdRecord } from '../model/record';
import type { ProjectFile, Row, Statement } from '../storage/driver';
import { setMeta } from '../storage/migrate';

// Every change to a project is an operation (CLAUDE.md, Edits, undo and autosave). One user action is one op group:
// its record changes, its op rows and the undo cursor commit in a single transaction, which is the autosave. Each op
// keeps the whole record before and after, so undo writes "before" back and redo writes "after", with no per-kind
// inverse to get wrong.

export type OpKind = 'create' | 'update' | 'move' | 'retype' | 'trash' | 'restore';

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
}

/** Each record an apply, undo or redo touched, as it is now; null where it no longer exists. */
export type Touched = Map<string, SbdRecord | null>;

const RECORD_COLUMNS = 'id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at';

function fromRow(row: Row): SbdRecord {
  const type = row.type;
  if (!isRecordType(type)) throw new Error(`Unknown record type "${String(type)}".`);
  const text = (value: Row[string]) => (value === null ? null : String(value));
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

/**
 * Applies one user action as one op group. Anything undone before it can no longer be redone: those ops are marked
 * discarded, as in every editor. Resolves once the group is on disk.
 */
export async function apply(file: ProjectFile, changes: readonly Change[], options: OpOptions = {}): Promise<Touched> {
  const { author = 'local', now = () => new Date() } = options;
  if (changes.length === 0) return new Map();
  const at = now().toISOString();
  const groupId = crypto.randomUUID();

  const state: Touched = new Map();
  const ops: { recordId: string; kind: OpKind; before: SbdRecord | null; after: SbdRecord }[] = [];
  for (const change of changes) {
    const id = changeId(change);
    const before = id === undefined ? null : state.has(id) ? (state.get(id) ?? null) : await getRecord(file, id);
    const after = changed(change, before, at, author);
    state.set(after.id, after);
    ops.push({ recordId: after.id, kind: change.kind, before, after });
  }

  const [top] = await file.query('SELECT coalesce(max(seq), 0) AS seq FROM ops');
  const firstSeq = Number(top?.seq ?? 0) + 1;
  const lastSeq = firstSeq + ops.length - 1;
  await file.tx([
    { sql: "UPDATE ops SET state = 'discarded', updated_at = ? WHERE state = 'undone'", params: [at] },
    ...[...state].map(([id, record]) => write(id, record)),
    ...ops.map((op, i) => ({
      sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, state, created_at,
        updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)`,
      params: [crypto.randomUUID(), firstSeq + i, groupId, op.recordId, op.kind, snapshot(op.before), snapshot(op.after), author, at, at, at],
    })),
    setMeta('undo_cursor', String(lastSeq), now()),
  ]);
  return state;
}

async function moveGroup(file: ProjectFile, direction: 'undo' | 'redo', now: () => Date): Promise<Touched | null> {
  const undoing = direction === 'undo';
  // Undo takes the newest applied group; redo the oldest undone one, so redo replays in the order things happened.
  const [pick] = await file.query(
    undoing
      ? "SELECT group_id FROM ops WHERE state = 'applied' ORDER BY seq DESC LIMIT 1"
      : "SELECT group_id FROM ops WHERE state = 'undone' ORDER BY seq ASC LIMIT 1",
  );
  if (!pick) return null;
  const groupId = String(pick.group_id);
  const rows = await file.query(
    `SELECT seq, record_id, before, after FROM ops WHERE group_id = ? ORDER BY seq ${undoing ? 'DESC' : 'ASC'}`,
    [groupId],
  );

  // Walking the group backwards for undo, the last write for a record is its state before the group began.
  const state: Touched = new Map();
  for (const row of rows) state.set(String(row.record_id), fromSnapshot(undoing ? row.before : row.after));

  const [cursor] = await file.query(
    undoing
      ? "SELECT coalesce(max(seq), 0) AS seq FROM ops WHERE state = 'applied' AND group_id <> ?"
      : 'SELECT max(seq) AS seq FROM ops WHERE group_id = ?',
    [groupId],
  );
  const at = now().toISOString();
  await file.tx([
    ...[...state].map(([id, record]) => write(id, record)),
    { sql: 'UPDATE ops SET state = ?, updated_at = ? WHERE group_id = ?', params: [undoing ? 'undone' : 'applied', at, groupId] },
    setMeta('undo_cursor', String(Number(cursor?.seq ?? 0)), now()),
  ]);
  return state;
}

/** Undoes the last applied op group. Null when there's nothing to undo. Works across restarts: it's all on disk. */
export function undo(file: ProjectFile, options: Pick<OpOptions, 'now'> = {}): Promise<Touched | null> {
  return moveGroup(file, 'undo', options.now ?? (() => new Date()));
}

/** Redoes the op group undone first. Null when there's nothing to redo. */
export function redo(file: ProjectFile, options: Pick<OpOptions, 'now'> = {}): Promise<Touched | null> {
  return moveGroup(file, 'redo', options.now ?? (() => new Date()));
}

export async function history(file: ProjectFile): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const [row] = await file.query(
    "SELECT sum(state = 'applied') AS applied, sum(state = 'undone') AS undone FROM ops",
  );
  return { canUndo: Number(row?.applied ?? 0) > 0, canRedo: Number(row?.undone ?? 0) > 0 };
}

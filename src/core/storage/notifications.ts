import type { ProjectFile, Statement } from './driver';
import { UUID_V4 } from './slateNumbers';

// Notification read state (schema 10, 3.10, docs/SBD_FORMAT.md): per person, every step up to `read_through_seq` (Mark
// all read: a place in the log, which only grows, never a clock time another computer's clock could skew), and the
// items read one by one since. Not an op, like Seen: never undone, never a step in History. The person
// is the one picked with This is me in the project's Cast and crew, or `local` until they have (and until sign-in comes
// with the web, Phase 9).

export const LOCAL_READER = 'local';

/** The kinds of item the feed lists: History's steps now; suggestions and comments come with Phases 7 and 9. */
export type NotificationKind = 'op_group';

export interface ReadState {
  /** Every step at or before this place in the log (`op_groups.seq`) is read; null before the first Mark all read. */
  readThrough: number | null;
  /** Items read one by one, as `kind:id`. */
  read: ReadonlySet<string>;
}

export const NOTHING_READ: ReadState = { readThrough: null, read: new Set() };

export const readKey = (kind: NotificationKind, id: string): string => `${kind}:${id}`;

export async function loadReadState(file: ProjectFile, userId: string): Promise<ReadState> {
  const [cursor] = await file.query('SELECT read_through_seq FROM notification_cursors WHERE user_id = ?', [userId]);
  const rows = await file.query('SELECT item_kind, item_id FROM notification_reads WHERE user_id = ?', [userId]);
  return {
    readThrough: cursor ? Number(cursor.read_through_seq) : null,
    read: new Set(rows.map((row) => `${String(row.item_kind)}:${String(row.item_id)}`)),
  };
}

/** An item read; one already read keeps its first time. */
export function markReadStatement(userId: string, kind: NotificationKind, itemId: string, at: string): Statement {
  return {
    sql: `INSERT INTO notification_reads (id, user_id, item_kind, item_id, read_at, created_at, updated_at)
      VALUES (${UUID_V4}, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, item_kind, item_id) DO NOTHING`,
    params: [userId, kind, itemId, at, at, at],
  };
}

/**
 * Every step up to `seq` read: the cursor moves (never back), and the steps read one by one at or before it no longer
 * need a row of their own.
 */
export function markAllReadStatements(userId: string, seq: number, at: string): Statement[] {
  return [
    {
      sql: `INSERT INTO notification_cursors (id, user_id, read_through_seq, created_at, updated_at) VALUES (${UUID_V4}, ?, ?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET read_through_seq = max(read_through_seq, excluded.read_through_seq), updated_at = excluded.updated_at`,
      params: [userId, seq, at, at],
    },
    {
      sql: `DELETE FROM notification_reads WHERE user_id = ? AND item_kind = 'op_group'
        AND item_id IN (SELECT id FROM op_groups WHERE seq <= ?)`,
      params: [userId, seq],
    },
  ];
}

/** Whether a step is unread: after the cursor, and not read one by one. */
export function isUnread(state: ReadState, kind: NotificationKind, itemId: string, seq: number): boolean {
  if (state.readThrough !== null && seq <= state.readThrough) return false;
  return !state.read.has(readKey(kind, itemId));
}

/** A step as the feed counts it: what it is, where it sits in the log, and who made it. */
export interface FeedStep {
  id: string;
  seq: number;
  author: string;
}

/** The steps after `seq`, oldest first: read once, then only what's new, since the log only grows. */
export async function stepsSince(file: ProjectFile, seq: number): Promise<FeedStep[]> {
  const rows = await file.query('SELECT id, seq, author FROM op_groups WHERE seq > ? ORDER BY seq', [seq]);
  return rows.map((row) => ({ id: String(row.id), seq: Number(row.seq), author: String(row.author) }));
}

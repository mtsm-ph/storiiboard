import type { ProjectFile, Statement } from './driver';
import { UUID_V4 } from './slateNumbers';

// Seen (schema 7, polish 6b): which departments have opened each frame, in a table of its own outside the records and
// the History. Seen is automatic, like a notification read: not an op, never undone, and written only the first time.
// Empty Trash deletes a frame's rows with the frame.

/** The departments that have seen each frame, by shot id, in the order they first did. */
export type Seen = Readonly<Record<string, readonly string[]>>;

export const NO_SEEN: Seen = {};

export async function loadSeen(file: ProjectFile): Promise<Seen> {
  // By time, so Compact (which can renumber rowids) keeps the order they first did.
  const rows = await file.query('SELECT shot_id, department FROM shot_seen ORDER BY seen_at, rowid');
  const seen: Record<string, string[]> = {};
  for (const row of rows) {
    const shot = String(row.shot_id);
    (seen[shot] ??= []).push(String(row.department));
  }
  return seen;
}

/** Marks a frame seen by these departments; one already marked keeps its first time. */
export function markSeenStatement(shotId: string, departments: readonly string[], at: string): Statement {
  return {
    sql: `INSERT INTO shot_seen (id, shot_id, department, seen_at, created_at, updated_at)
      SELECT ${UUID_V4}, ?, value, ?, ?, ? FROM json_each(?) WHERE true
      ON CONFLICT (shot_id, department) DO NOTHING`,
    params: [shotId, at, at, at, JSON.stringify(departments)],
  };
}

/** Deletes the Seen rows of frames deleted for good (Empty Trash), in its transaction. */
export function forgetSeenStatement(gone: string): Statement {
  return { sql: 'DELETE FROM shot_seen WHERE shot_id IN (SELECT value FROM json_each(?))', params: [gone] };
}

import type { SlateNumbers } from '../model/shotNumbers';
import type { ProjectFile, Statement } from './driver';

// Slate numbers (schema 5, 1.26, Kevin Nov 4): every shot number a scene has given out while its numbers were locked,
// so a letter that has been on a slate is never given out again. They live in a table of their own, outside the
// records and the History: undo, redo and Restore to here write whole records back, and a list kept in a scene's
// props would lose numbers to any of them. Nothing ever deletes a row, not even Empty Trash (docs/SBD_FORMAT.md).
//
// Unlocked scenes record nothing: their letters follow the board, so boarding never leaves gaps. Each number keeps the
// shot it went to first, so a scene unlocked and locked again gives every frame back the number on its slate, and a
// frame whose number another shot was slated with takes a new one (src/features/storyboard/board.ts).

/**
 * The meta key set when the schema 5 migration couldn't recover every number: an Empty Trash had run after a scene had
 * been locked, and what it deleted is gone from the file, numbers and all.
 */
export const SLATE_NUMBERS_UNKNOWN = 'slate_numbers_unknown';

/** A UUID v4 made inside SQLite, one per row an INSERT … SELECT writes. */
const UUID_V4 = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

// Live frames only: a frame trashed while its scene was locked was live there at the end of an earlier group, and
// recorded then; one in the Trash that never was holds a number from an unlocked board, never on a slate.
const KEPT = `sh.type = 'shot' AND sh.trashed_at IS NULL AND sc.type = 'scene' AND json_extract(sc.props, '$.numbers_locked') = 1
  AND typeof(json_extract(sh.props, '$.number')) = 'text' AND json_extract(sh.props, '$.number') <> ''`;

/**
 * Records the number of every shot in a locked scene among `ids`, which can name shots or scenes (a scene names all of
 * its shots, for the moment it's locked). Runs in an edit's own transaction, after its records are written, so what
 * it reads is the edit's result. Numbers already recorded stay as they are. Null with no shot or scene to look at.
 * Each half starts from the ids, through the primary key and records_by_parent, so a write never scans every shot.
 */
export function recordSlateNumbers(ids: readonly string[], at: string): Statement | null {
  if (ids.length === 0) return null;
  const list = JSON.stringify(ids);
  return {
    sql: `INSERT INTO slate_numbers (id, scene_id, number, shot_id, created_at, updated_at)
      SELECT ${UUID_V4}, scene_id, number, shot_id, ?, ? FROM (
        SELECT sc.id AS scene_id, json_extract(sh.props, '$.number') AS number, sh.id AS shot_id
          FROM json_each(?) j JOIN records sh ON sh.id = j.value JOIN records sc ON sc.id = sh.parent_id WHERE ${KEPT}
        UNION
        SELECT sc.id, json_extract(sh.props, '$.number'), sh.id
          FROM json_each(?) j JOIN records sc ON sc.id = j.value JOIN records sh ON sh.parent_id = sc.id WHERE ${KEPT}
      ) WHERE true
      ON CONFLICT (scene_id, number) DO NOTHING`,
    params: [at, at, list, list],
  };
}

/**
 * The slate numbers written after row `after` (0 for all of them), in the order they were written, and the last row's
 * number to read on from. Rows are only ever added, so the store reads just the new ones after each edit.
 */
export async function slateNumbersAfter(file: ProjectFile, after: number): Promise<{ rows: SlateNumbers; last: number }> {
  const rows = await file.query('SELECT rowid AS row, scene_id, number, shot_id FROM slate_numbers WHERE rowid > ? ORDER BY rowid', [after]);
  return {
    rows: rows.map((row) => ({ sceneId: String(row.scene_id), number: String(row.number), shotId: String(row.shot_id) })),
    last: rows.length > 0 ? Number(rows.at(-1)?.row) : after,
  };
}

/** Every slate number, oldest first. */
export async function loadSlateNumbers(file: ProjectFile): Promise<SlateNumbers> {
  return (await slateNumbersAfter(file, 0)).rows;
}

/**
 * Whether some numbers given out before schema 5 are unknown: frames an Empty Trash deleted from a scene that had been
 * locked, in this file or under another number since. A locked scene could give one out again; the Empty Trash
 * confirm says so.
 */
export async function slateNumbersUnknown(file: ProjectFile): Promise<boolean> {
  const [row] = await file.query('SELECT value FROM meta WHERE key = ?', [SLATE_NUMBERS_UNKNOWN]);
  return row !== undefined;
}

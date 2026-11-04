import type { SlateNumbers } from '../model/shotNumbers';
import type { ProjectFile, Statement } from './driver';

// Slate numbers (schema 5, 1.26, Kevin Nov 4): every shot number a scene has given out while its numbers were locked,
// so a letter that has been on a slate is never given out again. They live in a table of their own, outside the
// records and the History: undo, redo and Restore to here write whole records back, and a list kept in a scene's
// props would lose numbers to any of them. Nothing ever deletes a row, not even Empty Trash (docs/SBD_FORMAT.md).
//
// Unlocked scenes record nothing: their letters follow the board, so boarding never leaves gaps.

/** The meta key listing scenes whose numbers the schema 5 migration couldn't all recover (Empty Trash had run). */
export const SLATE_NUMBERS_UNKNOWN = 'slate_numbers_unknown';

/** A UUID v4 made inside SQLite, one per row an INSERT … SELECT writes. */
const UUID_V4 = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/**
 * Records the number of every shot in a locked scene among `ids`, which can name shots or scenes (a scene names all of
 * its shots, for the moment it's locked). Runs in an edit's own transaction, after its records are written, so what
 * it reads is the edit's result. Numbers already recorded stay as they are.
 */
export function recordSlateNumbers(ids: readonly string[], at: string): Statement {
  const list = JSON.stringify(ids);
  return {
    sql: `INSERT INTO slate_numbers (id, scene_id, number, created_at, updated_at)
      SELECT ${UUID_V4}, scene_id, number, ?, ? FROM (
        SELECT DISTINCT sc.id AS scene_id, json_extract(sh.props, '$.number') AS number
          FROM records sh JOIN records sc ON sc.id = sh.parent_id
          WHERE sh.type = 'shot' AND sc.type = 'scene' AND json_extract(sc.props, '$.numbers_locked') = 1
            AND typeof(json_extract(sh.props, '$.number')) = 'text' AND json_extract(sh.props, '$.number') <> ''
            AND (sh.id IN (SELECT value FROM json_each(?)) OR sc.id IN (SELECT value FROM json_each(?)))
      ) WHERE true
      ON CONFLICT (scene_id, number) DO NOTHING`,
    params: [at, at, list, list],
  };
}

/** Every scene's slate numbers, by scene id. */
export async function loadSlateNumbers(file: ProjectFile): Promise<SlateNumbers> {
  const rows = await file.query('SELECT scene_id, number FROM slate_numbers');
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const scene = String(row.scene_id);
    const numbers = out.get(scene) ?? new Set<string>();
    numbers.add(String(row.number));
    out.set(scene, numbers);
  }
  return out;
}

/**
 * Scenes that were locked when an Empty Trash ran before schema 5: it may have deleted frames whose numbers nothing
 * in the file still holds, so a new frame there could be given one of them. The Empty Trash confirm says so.
 */
export async function slateNumbersUnknown(file: ProjectFile): Promise<ReadonlySet<string>> {
  const [row] = await file.query('SELECT value FROM meta WHERE key = ?', [SLATE_NUMBERS_UNKNOWN]);
  if (!row) return new Set();
  const ids: unknown = JSON.parse(String(row.value));
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
}

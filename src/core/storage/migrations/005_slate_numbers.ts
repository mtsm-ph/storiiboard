import type { ProjectFile, Statement } from '../driver';
import { setMeta, type Migration } from '../migrate';
import { recordSlateNumbers, SLATE_NUMBERS_UNKNOWN } from '../slateNumbers';

// Schema v5 (1.26, Kevin Nov 4): slate numbers. A locked scene remembers every shot number it has given out, in a
// table that undo, History restores and Empty Trash never take a row from (src/core/storage/slateNumbers.ts).
//
// The backfill replays the History to find every number a shot had while its scene was locked: frames live, in the
// Trash, or only in History (made and then undone). What an Empty Trash deleted before this can't be found, since it
// cleared those frames' steps too. When one ran after any scene had been locked, meta says some numbers are unknown,
// and the Empty Trash confirm still warns while a scene is locked.

interface Known {
  type: string;
  parentId: string | null;
  number: string;
  locked: boolean;
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const at = now().toISOString();
  // Only what the replay needs, worked out in SQLite: a sketched project's log is mostly stroke points.
  const rows = await file.query(
    `SELECT record_id, group_id, kind, json_extract(after, '$.type') AS type, json_extract(after, '$.parent_id') AS parent_id,
        json_extract(after, '$.props.number') AS number, json_extract(after, '$.props.numbers_locked') AS locked
      FROM ops
      WHERE kind = 'purge' OR json_extract(after, '$.type') IN ('shot', 'scene') OR json_extract(before, '$.type') IN ('shot', 'scene')
      ORDER BY seq`,
  );
  const state = new Map<string, Known>();
  const children = new Map<string, Set<string>>();
  // Scene, then number, then the shot it went to first.
  const found = new Map<string, Map<string, string>>();
  let everLocked = false;
  let unknown = false;

  const add = (sceneId: string, number: string, shotId: string) => {
    if (number === '') return;
    const numbers = found.get(sceneId) ?? new Map<string, string>();
    if (!numbers.has(number)) numbers.set(number, shotId);
    found.set(sceneId, numbers);
  };
  // What a group gave out is what it left behind, as the app records it: a frame moved from an unlocked scene into a
  // locked one passes through with its old number on the way, and that number was never on a slate there.
  let group: string | null = null;
  const touched = new Set<string>();
  const settle = () => {
    for (const id of touched) {
      const record = state.get(id);
      if (record?.type === 'shot' && record.parentId !== null) {
        const scene = state.get(record.parentId);
        if (scene?.type === 'scene' && scene.locked) add(record.parentId, record.number, id);
      }
      if (record?.type === 'scene' && record.locked) {
        for (const child of children.get(id) ?? []) {
          const shot = state.get(child);
          if (shot?.type === 'shot') add(id, shot.number, child);
        }
      }
    }
    touched.clear();
  };

  for (const row of rows) {
    if (String(row.group_id) !== group) {
      settle();
      group = String(row.group_id);
      // An Empty Trash: what it deleted had its steps cleared, so the numbers it had are gone from the file. Once any
      // scene had been locked, some may have been on slates: frames trashed while locked keep their number even after
      // an unlock, and a whole scene deleted leaves no trace of which scene it was.
      if (row.kind === 'purge' && everLocked) unknown = true;
    }
    const id = String(row.record_id);
    const was = state.get(id);
    if (was?.parentId) children.get(was.parentId)?.delete(id);
    if (row.kind === 'purge' || row.type === null || row.type === undefined) {
      state.delete(id);
      continue;
    }
    const after: Known = {
      type: String(row.type),
      parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
      number: typeof row.number === 'string' ? row.number : '',
      locked: row.locked === 1,
    };
    state.set(id, after);
    touched.add(id);
    if (after.type === 'scene' && after.locked) everLocked = true;
    if (after.parentId) {
      const siblings = children.get(after.parentId) ?? new Set<string>();
      siblings.add(id);
      children.set(after.parentId, siblings);
    }
  }
  settle();

  const statements: Statement[] = [];
  for (const [sceneId, numbers] of found) {
    for (const [number, shotId] of numbers) {
      statements.push({
        sql: `INSERT INTO slate_numbers (id, scene_id, number, shot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (scene_id, number) DO NOTHING`,
        params: [crypto.randomUUID(), sceneId, number, shotId, at, at],
      });
    }
  }
  // And the file as it stands, should any record have reached it outside the log.
  const scenes = await file.query("SELECT id FROM records WHERE type = 'scene'");
  const sceneIds = scenes.map((scene) => String(scene.id));
  const current = recordSlateNumbers(sceneIds, at);
  if (current) statements.push(current);
  if (unknown) statements.push(setMeta(SLATE_NUMBERS_UNKNOWN, 'true', now()));
  return statements;
}

export const slateNumbers: Migration = {
  version: 5,
  description: 'Slate numbers: every shot number a locked scene has given out',
  statements: [
    {
      // No reference to the scene's record: a scene Empty Trash deletes keeps its numbers too, so a locked scene given
      // its number later skips them.
      sql: `CREATE TABLE slate_numbers (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        number TEXT NOT NULL,
        shot_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (scene_id, number)
      ) STRICT`,
    },
  ],
  backfill,
};

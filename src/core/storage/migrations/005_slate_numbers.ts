import type { ProjectFile, Statement } from '../driver';
import { setMeta, type Migration } from '../migrate';
import { recordSlateNumbers, SLATE_NUMBERS_UNKNOWN } from '../slateNumbers';

// Schema v5 (1.26, Kevin Nov 4): slate numbers. A locked scene remembers every shot number it has given out, in a
// table that undo, History restores and Empty Trash never take a row from (src/core/storage/slateNumbers.ts).
//
// The backfill replays the History to find every number a shot had while its scene was locked: frames live, in the
// Trash, or only in History (made and then undone). What an Empty Trash deleted before this can't be found, since it
// cleared those frames' steps too, and which scene they were in. When one ran, meta says some numbers are unknown,
// and the Empty Trash confirm still warns while a scene is locked.

interface Known {
  type: string;
  parentId: string | null;
  number: string;
  locked: boolean;
  trashed: boolean;
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const at = now().toISOString();
  // Only what the replay needs, worked out in SQLite: a sketched project's log is mostly stroke points.
  const rows = await file.query(
    `SELECT record_id, group_id, kind, json_extract(after, '$.type') AS type, json_extract(after, '$.parent_id') AS parent_id,
        json_extract(after, '$.props.number') AS number, json_extract(after, '$.props.numbers_locked') AS locked,
        json_extract(after, '$.trashed_at') IS NOT NULL AS trashed
      FROM ops
      WHERE kind = 'purge' OR json_extract(after, '$.type') IN ('shot', 'scene') OR json_extract(before, '$.type') IN ('shot', 'scene')
      ORDER BY seq`,
  );
  const state = new Map<string, Known>();
  const children = new Map<string, Set<string>>();
  // Scene, then number, then the shots seen holding it while the scene was locked, the first one first.
  const found = new Map<string, Map<string, string[]>>();
  let unknown = false;

  const add = (sceneId: string, number: string, shotId: string) => {
    if (number === '') return;
    const numbers = found.get(sceneId) ?? new Map<string, string[]>();
    const seen = numbers.get(number) ?? [];
    if (!seen.includes(shotId)) seen.push(shotId);
    numbers.set(number, seen);
    found.set(sceneId, numbers);
  };
  // What a group gave out is what it left behind, as the app records it: a frame moved from an unlocked scene into a
  // locked one passes through with its old number on the way, and that number was never on a slate there. Live
  // frames only, as the app records them: a v4 lock left frames in the Trash with numbers from the unlocked board
  // (a deleted 4C, with a newer frame slated as 4C), and those were never on a slate.
  let group: string | null = null;
  const touched = new Set<string>();
  const settle = () => {
    for (const id of touched) {
      const record = state.get(id);
      if (record?.type === 'shot' && !record.trashed && record.parentId !== null) {
        const scene = state.get(record.parentId);
        if (scene?.type === 'scene' && scene.locked) add(record.parentId, record.number, id);
      }
      if (record?.type === 'scene' && record.locked) {
        for (const child of children.get(id) ?? []) {
          const shot = state.get(child);
          if (shot?.type === 'shot' && !shot.trashed) add(id, shot.number, child);
        }
      }
    }
    touched.clear();
  };

  for (const row of rows) {
    if (String(row.group_id) !== group) {
      settle();
      group = String(row.group_id);
      // An Empty Trash: what it deleted had its steps cleared, so the numbers it had are gone from the file, and so is
      // any sign of whether they were on slates: a locked scene deleted whole leaves no lock behind to see. Any one
      // counts; the warning it brings shows only while a scene is locked.
      if (row.kind === 'purge') unknown = true;
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
      trashed: row.trashed === 1,
    };
    state.set(id, after);
    touched.add(id);
    if (after.parentId) {
      const siblings = children.get(after.parentId) ?? new Set<string>();
      siblings.add(id);
      children.set(after.parentId, siblings);
    }
  }
  settle();

  // A v4 locked scene could give one number to two shots (an undone frame's letter given out again, or letters closed
  // up by an unlock and kept by a relock). Of the shots seen holding it while locked, the one holding it now is the
  // one on footage, so it owns the number; otherwise the first seen. A shot holding it now that was never seen with it
  // while locked (a frame added after an unlock) never owns it: it wasn't on a slate.
  const holders = new Map<string, string>();
  for (const trashed of [true, false]) {
    for (const [id, record] of state) {
      if (record.type === 'shot' && record.trashed === trashed && record.parentId !== null && record.number !== '') {
        holders.set(`${record.parentId} ${record.number}`, id);
      }
    }
  }
  const statements: Statement[] = [];
  for (const [sceneId, numbers] of found) {
    for (const [number, seen] of numbers) {
      const holder = holders.get(`${sceneId} ${number}`);
      const shotId = holder !== undefined && seen.includes(holder) ? holder : (seen[0] ?? '');
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

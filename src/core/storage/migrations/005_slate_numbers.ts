import type { ProjectFile, Row, Statement } from '../driver';
import { setMeta, type Migration } from '../migrate';
import { recordSlateNumbers, SLATE_NUMBERS_UNKNOWN } from '../slateNumbers';

// Schema v5 (1.26, Kevin Nov 4): slate numbers. A locked scene remembers every shot number it has given out, in a
// table that undo, History restores and Empty Trash never take a row from (src/core/storage/slateNumbers.ts).
//
// The backfill replays the History to find every number a shot had while its scene was locked: frames live, in the
// Trash, or only in History (made and then undone). What an Empty Trash deleted before this can't be found, since it
// cleared those frames' steps too; scenes that were locked when one ran are listed in meta, and the Empty Trash
// confirm still warns about them.

interface Known {
  type: string;
  parentId: string | null;
  number: string;
  locked: boolean;
}

function known(json: Row[string] | undefined): Known | null {
  if (json === null || json === undefined) return null;
  const row = JSON.parse(String(json)) as { type?: unknown; parent_id?: unknown; props?: Record<string, unknown> };
  const props = row.props ?? {};
  return {
    type: String(row.type),
    parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
    number: typeof props.number === 'string' ? props.number : '',
    locked: props.numbers_locked === true,
  };
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const at = now().toISOString();
  const rows = await file.query('SELECT record_id, group_id, kind, after FROM ops ORDER BY seq');
  const state = new Map<string, Known>();
  const children = new Map<string, Set<string>>();
  const found = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  let emptied: string | null = null;

  const add = (sceneId: string, number: string) => {
    if (number === '') return;
    const numbers = found.get(sceneId) ?? new Set<string>();
    numbers.add(number);
    found.set(sceneId, numbers);
  };
  const lockedScene = (id: string | null) => {
    const scene = id === null ? undefined : state.get(id);
    return scene?.type === 'scene' && scene.locked;
  };

  for (const row of rows) {
    const id = String(row.record_id);
    const was = state.get(id);
    if (was?.parentId) children.get(was.parentId)?.delete(id);
    if (row.kind === 'purge') {
      // An Empty Trash: frames it deleted had their steps cleared, so whatever numbers they had are gone from the file.
      if (emptied !== String(row.group_id)) {
        emptied = String(row.group_id);
        for (const [sceneId, record] of state) if (record.type === 'scene' && record.locked) unknown.add(sceneId);
      }
      state.delete(id);
      continue;
    }
    const after = known(row.after);
    if (after === null) {
      state.delete(id);
      continue;
    }
    state.set(id, after);
    if (after.parentId) {
      const siblings = children.get(after.parentId) ?? new Set<string>();
      siblings.add(id);
      children.set(after.parentId, siblings);
    }
    if (after.type === 'shot' && after.parentId !== null && lockedScene(after.parentId)) add(after.parentId, after.number);
    if (after.type === 'scene' && after.locked) {
      for (const child of children.get(id) ?? []) {
        const shot = state.get(child);
        if (shot?.type === 'shot') add(id, shot.number);
      }
    }
  }

  const statements: Statement[] = [];
  for (const [sceneId, numbers] of found) {
    for (const number of numbers) {
      statements.push({
        sql: `INSERT INTO slate_numbers (id, scene_id, number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (scene_id, number) DO NOTHING`,
        params: [crypto.randomUUID(), sceneId, number, at, at],
      });
    }
  }
  // And the file as it stands, should any record have reached it outside the log.
  const scenes = await file.query("SELECT id FROM records WHERE type = 'scene'");
  const sceneIds = scenes.map((scene) => String(scene.id));
  statements.push(recordSlateNumbers(sceneIds, at));
  const stillThere = [...unknown].filter((id) => sceneIds.includes(id)).sort();
  if (stillThere.length > 0) statements.push(setMeta(SLATE_NUMBERS_UNKNOWN, JSON.stringify(stillThere), now()));
  return statements;
}

export const slateNumbers: Migration = {
  version: 5,
  description: 'Slate numbers: every shot number a locked scene has given out',
  statements: [
    {
      // No reference to the scene's record: a scene Empty Trash deletes keeps its numbers too, so a later scene with
      // the same number never hands out a slate number that's on footage.
      sql: `CREATE TABLE slate_numbers (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        number TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (scene_id, number)
      ) STRICT`,
    },
  ],
  backfill,
};

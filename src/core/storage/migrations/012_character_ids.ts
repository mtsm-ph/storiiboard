import type { JsonValue, Props, SbdRecord } from '../../model/record';
import { approvalsKeptThrough } from '../../model/sceneApprovals';
import { keyBetween } from '../../ops/order';
import { loadRecords, loggedRewrite } from '../../ops/ops';
import type { ProjectFile, Statement } from '../driver';
import type { Migration } from '../migrate';

// Schema v12 (3.13, approved by Kevin Nov 9, the change to existing data included): a scene's characters become ids.
// Until now a script import wrote each scene's speaking characters as names (`characters`, as the script spelled
// them); from here a scene lists `character_ids`, the project's character records, so a rename in Cast and crew is a
// rename everywhere and Phase 4's call sheets can read who's in each scene and who plays them.
//
// Each name is matched to a live character of the scene's project, trimmed and in any case ("MARY " is Mary). A name
// with no match gets a character of its own, named as the scene had it (trimmed), so nothing a scene listed is lost; a
// character in the Trash isn't matched (a scene would read it as none), so a new one is made beside it. A name listed
// twice is one id. A value in `characters` that isn't a name (no version wrote one) stays where it was. Scenes in the
// Trash are changed too, so a restore brings back their characters.
//
// As migration 9 does, the changes are one logged step in History (loggedRewrite), and the undo and redo stacks end
// there. migrate() copies the file to a backup before this runs, as before every migration.

const key = (name: string): string => name.trim().toLowerCase();

const nameOf = (record: SbdRecord): string => (typeof record.props.name === 'string' ? record.props.name : '');

/**
 * The scenes' new props and the characters to make, from every record in the file. Exported for its tests; `newId`
 * and `at` are the migration's.
 */
export function characterIdChanges(
  list: readonly SbdRecord[],
  at: string,
  newId: () => string = () => crypto.randomUUID(),
): { created: SbdRecord[]; changes: { before: SbdRecord; props: Props }[] } {
  const created: SbdRecord[] = [];
  const changes: { before: SbdRecord; props: Props }[] = [];
  // Per project: its live characters by name (the first in the list's order for a name two share), and its last
  // character's place, so new ones go after every other (in the Trash too, so no two share a place).
  const byProject = new Map<string, { names: Map<string, string>; last: string | null }>();
  const project = (id: string) => {
    let found = byProject.get(id);
    if (!found) {
      const characters = list.filter((r) => r.type === 'character' && r.parentId === id).sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      const names = new Map<string, string>();
      for (const c of characters) if (c.trashedAt === null && key(nameOf(c)) !== '' && !names.has(key(nameOf(c)))) names.set(key(nameOf(c)), c.id);
      found = { names, last: characters.at(-1)?.sortKey ?? null };
      byProject.set(id, found);
    }
    return found;
  };

  for (const scene of list) {
    if (scene.type !== 'scene' || scene.parentId === null || !Array.isArray(scene.props.characters)) continue;
    const own = project(scene.parentId);
    const ids: string[] = Array.isArray(scene.props.character_ids) ? scene.props.character_ids.filter((id): id is string => typeof id === 'string') : [];
    const kept: JsonValue[] = [];
    for (const value of scene.props.characters) {
      if (typeof value !== 'string') {
        kept.push(value);
        continue;
      }
      const name = value.trim();
      if (name === '') continue;
      let id = own.names.get(key(name));
      if (id === undefined) {
        id = newId();
        own.last = keyBetween(own.last, null);
        created.push({ id, type: 'character', parentId: scene.parentId, sortKey: own.last, props: { name }, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at });
        own.names.set(key(name), id);
      }
      if (!ids.includes(id)) ids.push(id);
    }
    const props: Props = Object.fromEntries(Object.entries(scene.props).filter(([prop]) => prop !== 'characters' && prop !== 'character_ids'));
    if (ids.length > 0) props.character_ids = ids;
    if (kept.length > 0) props.characters = kept;
    if (JSON.stringify(props) !== JSON.stringify(scene.props)) changes.push({ before: scene, props });
  }
  // A scene's characters are part of what its approvals read (3.6b's rule, 3.18's), so the upgrade alone would show
  // them "Changed since approval": every one current before it is re-stamped on the scene as it is after (Kevin Nov 9).
  if (changes.length > 0) {
    const before: Record<string, SbdRecord> = Object.fromEntries(list.map((r) => [r.id, r]));
    const after: Record<string, SbdRecord> = { ...before };
    for (const { before: scene, props } of changes) after[scene.id] = { ...scene, props };
    for (const change of changes) {
      const approvals = approvalsKeptThrough(before, after, change.before.id);
      if (approvals) change.props = { ...change.props, department_approvals: approvals };
    }
  }
  return { created, changes };
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const at = now().toISOString();
  const { created, changes } = characterIdChanges(await loadRecords(file), at);
  return loggedRewrite(file, changes, at, 'local', created);
}

export const characterIds: Migration = {
  version: 12,
  description: 'Scene characters as ids: character_ids on scenes, characters made for names with none',
  statements: [],
  backfill,
};

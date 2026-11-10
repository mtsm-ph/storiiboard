import { isObject } from '../../model/departmentStatus';
import type { JsonValue, Props, SbdRecord } from '../../model/record';
import { approvalsKeptThrough } from '../../model/sceneApprovals';
import { loadRecords, loggedRewrite } from '../../ops/ops';
import type { ProjectFile, Statement } from '../driver';
import type { Migration } from '../migrate';

// Schema v13 (3.18, Kevin Nov 9: "An approval that was current before an upgrade stays current after it"): a repair
// for files schema 12 upgraded before it re-stamped approvals. Schema 12 turned a scene's character names into ids;
// 3.6b's approval rule reads the scene's props, characters among them, so on a scene whose characters a script import
// had written, an approval given before the upgrade read "Changed since approval" though nothing a department did had
// changed. Schema 12 now re-stamps them itself (012_character_ids.ts); this finds the ones it left.
//
// For each scene with approvals, schema 12's own step in History (an update whose before held a `characters` list and
// whose after holds no names there and differs in nothing else but `character_ids`) gives the characters it had. When the scene's characters are still what schema
// 12 wrote, the scene is read as it is now but with its old characters back: each approval current then, and not now,
// is re-stamped by its own rule on the scene as it is now (approvalsKeptThrough). An approval that changed for any
// other reason stays changed, and a scene whose characters were edited since is left as it is: that change is real.
//
// One logged step in History (loggedRewrite) when there is anything to re-stamp, as schemas 9 and 12 do; migrate()
// copies the file to a backup before it runs. A file with nothing to repair is left as it was.

const CAST = ['character_ids', 'characters'] as const;

const cast = (props: Props): string => JSON.stringify(CAST.map((key) => props[key] ?? null));

function withCast(props: Props, from: Props): Props {
  const out: Props = Object.fromEntries(Object.entries(props).filter(([key]) => !(CAST as readonly string[]).includes(key)));
  for (const key of CAST) if (from[key] !== undefined) out[key] = from[key];
  return out;
}

const propsOf = (snapshot: unknown): Props | null => {
  if (typeof snapshot !== 'string') return null;
  try {
    const parsed = JSON.parse(snapshot) as JsonValue;
    return isObject(parsed) && isObject(parsed.props) ? parsed.props : null;
  } catch {
    return null;
  }
};

const OWN_CHANGES = new Set<string>([...CAST, 'department_approvals']);
const rest = (props: Props): string => JSON.stringify(Object.entries(props).filter(([key]) => !OWN_CHANGES.has(key)));

/**
 * Schema 12's step for a scene: a `characters` list before, and after it no name left in `characters` and nothing else
 * changed but `character_ids` (and, from 3.18, the approvals). That covers a list it emptied too (`[]`, or only blank
 * names): it took the prop off and wrote no ids. Nothing else in the app writes a scene's `characters`.
 */
const isSchema12Step = (before: Props, after: Props): boolean =>
  Array.isArray(before.characters) &&
  !(Array.isArray(after.characters) && after.characters.some((v) => typeof v === 'string')) &&
  // A step that left the cast as it was (an Approved tick on a scene whose list holds no names) isn't 12's: passed
  // over, so it can't hide 12's own step behind it.
  cast(before) !== cast(after) &&
  rest(before) === rest(after);

/**
 * The scenes whose approvals schema 12 left "Changed" and their re-stamped props, from every record and each scene's
 * props before and after schema 12's step. Exported for its tests.
 */
export function approvalRepairs(
  list: readonly SbdRecord[],
  upgrades: ReadonlyMap<string, { before: Props; after: Props }>,
): { before: SbdRecord; props: Props }[] {
  const now: Record<string, SbdRecord> = Object.fromEntries(list.map((r) => [r.id, r]));
  const changes: { before: SbdRecord; props: Props }[] = [];
  for (const scene of list) {
    if (scene.type !== 'scene' || !isObject(scene.props.department_approvals)) continue;
    const step = upgrades.get(scene.id);
    if (!step || cast(scene.props) !== cast(step.after)) continue;
    const then = { ...now, [scene.id]: { ...scene, props: withCast(scene.props, step.before) } };
    const approvals = approvalsKeptThrough(then, now, scene.id);
    if (approvals) changes.push({ before: scene, props: { ...scene.props, department_approvals: approvals } });
  }
  return changes;
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const list = await loadRecords(file);
  const scenes = list.filter((r) => r.type === 'scene' && isObject(r.props.department_approvals)).map((r) => r.id);
  if (scenes.length === 0) return [];
  const rows = await file.query(
    `SELECT record_id, before, after FROM ops
      WHERE kind = 'update' AND record_id IN (SELECT value FROM json_each(?))
        AND json_type(before, '$.props.characters') = 'array'
      ORDER BY seq DESC`,
    [JSON.stringify(scenes)],
  );
  // The newest such step per scene: only schema 12 writes one.
  const upgrades = new Map<string, { before: Props; after: Props }>();
  for (const row of rows) {
    const id = row.record_id;
    if (typeof id !== 'string' || upgrades.has(id)) continue;
    const before = propsOf(row.before);
    const after = propsOf(row.after);
    if (before && after && isSchema12Step(before, after)) upgrades.set(id, { before, after });
  }
  if (upgrades.size === 0) return [];
  return loggedRewrite(file, approvalRepairs(list, upgrades), now().toISOString());
}

export const approvalsKept: Migration = {
  version: 13,
  description: 'Approvals kept through the upgrade: those schema 12 left "Changed" re-stamped',
  statements: [],
  backfill,
};

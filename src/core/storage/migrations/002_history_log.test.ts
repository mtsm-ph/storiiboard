import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRecord, history, log, redo, restoreTo, undo } from '../../ops/ops';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { initial } from './001_initial';

let folder: TestFolder;
let project: Project | undefined;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await project?.close();
  folder.remove();
});

const at = '2026-11-01T10:00:00.000Z';
const sceneAt = (number: string) =>
  JSON.stringify({
    id: 'sc4', type: 'scene', parent_id: null, sort_key: 'V', props: { number }, trashed_at: null, trashed_by: null,
    created_at: at, updated_at: at,
  });

/**
 * A v1 file as 0.5 left it. Scene 4 was created (g1), renumbered 5 (g2), undone, renumbered 6 (g3, which discarded
 * g2), then renumbered 7 (g4) and undone: the scene reads 6, and only g4 can be redone.
 */
async function v1File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: [initial], now: () => new Date(at) });
  const op = (seq: number, group: string, kind: string, before: string | null, after: string, state: string) => ({
    sql: `INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, state, created_at,
      updated_at) VALUES (?, ?, ?, 'sc4', ?, ?, ?, 'local', ?, ?, ?, ?)`,
    params: [`op${String(seq)}`, seq, group, kind, before, after, at, state, at, at],
  });
  await file.tx([
    {
      sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at)
        VALUES ('sc4', 'scene', NULL, 'V', '{"number":"6"}', ?, ?)`,
      params: [at, at],
    },
    op(1, 'g1', 'create', null, sceneAt('4'), 'applied'),
    op(2, 'g2', 'update', sceneAt('4'), sceneAt('5'), 'discarded'),
    op(3, 'g3', 'update', sceneAt('4'), sceneAt('6'), 'applied'),
    op(4, 'g4', 'update', sceneAt('6'), sceneAt('7'), 'undone'),
    {
      sql: "INSERT INTO meta (id, key, value, created_at, updated_at) VALUES ('m', 'undo_cursor', '3', ?, ?)",
      params: [at, at],
    },
  ]);
  await file.close();
  return path;
}

const number = async (p: Project) => (await getRecord(p.file, 'sc4'))?.props.number;

describe('schema 2: an append-only History', () => {
  it('turns v1 undo marks into undo groups, so the log replays to the file as it was', async () => {
    project = await openProject(await v1File(), { driver: nodeDriver, backups: false });
    expect(project.migration.backup).toMatch(/^Bey County\.sbd\.bak-v1-/);

    const groups = await log(project.file);
    expect(groups.map((g) => (g.targetGroupId ? `${g.kind}:${g.targetGroupId}` : `${g.kind}:${g.id}`))).toEqual([
      'edit:g1',
      'edit:g2',
      'undo:g2',
      'edit:g3',
      'edit:g4',
      'undo:g4',
    ]);
    expect(await project.file.query("SELECT value FROM meta WHERE key = 'undo_cursor'")).toEqual([]);
    expect((await project.file.query('PRAGMA table_info(ops)')).map((c) => c.name)).not.toContain('state');

    // Only g4 can be redone; g2 was edited over. Undo then walks g3 and g1.
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: true });
    await redo(project.file);
    expect(await number(project)).toBe('7');
    expect(await redo(project.file)).toBeNull();
    await undo(project.file);
    await undo(project.file);
    expect(await number(project)).toBe('4');

    // The discarded renumbering is still in the History and can be restored.
    await restoreTo(project.file, 'g2');
    expect(await number(project)).toBe('5');
  });
});

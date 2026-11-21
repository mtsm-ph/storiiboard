import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { opsOfGroups, undoTops } from '../../core/ops/ops';
import type { ProjectFile, SqlValue } from '../../core/storage/driver';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { loadSteps, undoRedoLines } from './steps';
import { describeEdit, lineText, stepPictures } from './summary';

// The top bar's Undo and Redo (item 8) read after every edit while a project is open, outside the store's queue, on the
// same file as the writes (#241's review): a read costs only what its steps name. No list of every stored picture, no
// scan of the log; an undo, redo or restore's own ops are never read, only the step it names.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([{ kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } }]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

/** The file with every query it's asked kept. */
function spied(file: ProjectFile) {
  const asked: { sql: string; params: readonly SqlValue[] }[] = [];
  const wrapped: ProjectFile = Object.assign(Object.create(file) as ProjectFile, {
    query: (sql: string, params: readonly SqlValue[] = []) => {
      asked.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return file.query(sql, params);
    },
  });
  return { wrapped, asked };
}

/** The group ids a query that names groups by a json_each list asks for. */
const askedGroups = (asked: { sql: string; params: readonly SqlValue[] }[]) =>
  asked.filter((q) => /(g\.id|o\.group_id) IN \(SELECT value FROM json_each\(\?\)\)/.test(q.sql)).flatMap((q) => JSON.parse(String(q.params[0])) as string[]);

/**
 * The one known read whose cost grows with the later log: placesBefore's pass (ops.ts; childrenBefore is its one-ask
 * form) over every op since the oldest move it's asked about, for where a dragged frame went and what it went after.
 * Once per read, never once per move (#240), about 33 ms under 50,000 later ops on the memory driver. An exact bound
 * needs an index on the ops' parent, a schema change that waits for Kevin; until then it alone passes unbounded, by its
 * whole text, so no other read can slip through beside it.
 */
const PLACES_SCAN =
  "SELECT record_id, parent, max(seq) AS last FROM ( SELECT o.record_id, o.seq, json_extract(o.before, '$.parent_id') AS parent, o.before IS NULL AND o.after IS NULL AS emptied FROM ops o WHERE o.seq >= ? ) WHERE emptied OR parent IN (SELECT value FROM json_each(?)) GROUP BY record_id, parent";

function expectBounded(asked: { sql: string; params: readonly SqlValue[] }[]) {
  for (const { sql } of asked) {
    if (sql === PLACES_SCAN) continue;
    // Pictures only by the hashes the steps name.
    if (/\bmedia_files\b/.test(sql)) expect(sql).toMatch(/WHERE sha256 IN \(SELECT value FROM json_each\(\?\)\)/);
    // The log only by the steps named, by a record's own writes, or its newest row.
    if (/\bFROM (ops|op_groups)\b/.test(sql)) expect(sql, sql).toMatch(/json_each\(\?\)|ORDER BY seq DESC LIMIT 1|WHERE o\.group_id = g\.id/);
    expect(sql).not.toMatch(/FROM op_groups g ORDER BY/);
    expect(sql).not.toMatch(/json_extract\(o\.(before|after)/);
  }
}

describe('a read of the top bar’s Undo and Redo lines', () => {
  it('after an edit with a picture, asks only for the picture and the steps it names', async () => {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    await store.getState().apply([
      {
        kind: 'create',
        record: { id: 'pic1', type: 'media', parentId: added.shotId, sortKey: 'a', props: { kind: 'image', file: 'a'.repeat(64), width: 640, height: 360 } },
      },
    ]);
    const { undoTop } = await undoTops(project.file);
    const { wrapped, asked } = spied(project.file);
    const lines = await undoRedoLines(wrapped);
    expect(lines.undo && lineText(lines.undo)).toBe((await loadSteps(project.file, 1)).steps.map((s) => lineText(s.line))[0]);
    expectBounded(asked);
    expect(asked.some((q) => /\bmedia_files\b/.test(q.sql))).toBe(true);
    const shas = asked.filter((q) => /\bmedia_files\b/.test(q.sql)).flatMap((q) => JSON.parse(String(q.params[0])) as string[]);
    expect(shas).toEqual(['a'.repeat(64)]);
    expect(new Set(askedGroups(asked))).toEqual(new Set([undoTop]));
  });

  it('after an edit with no picture, never asks for pictures', async () => {
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    const { wrapped, asked } = spied(project.file);
    await undoRedoLines(wrapped);
    expectBounded(asked);
    expect(asked.some((q) => /\bmedia_files\b/.test(q.sql))).toBe(false);
  });

  it('after an undo and a restore, reads the ops only of the edits they name', async () => {
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    await store.getState().undo();
    let { wrapped, asked } = spied(project.file);
    await undoRedoLines(wrapped);
    expectBounded(asked);
    const opsAsked = (list: typeof asked) =>
      list.filter((q) => /o\.group_id IN \(SELECT value FROM json_each\(\?\)\)/.test(q.sql)).flatMap((q) => JSON.parse(String(q.params[0])) as string[]);
    const kinds = new Map((await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => [s.group.id, s.group.kind]));
    expect(opsAsked(asked).every((id) => kinds.get(id) === 'edit')).toBe(true);

    const first = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.at(-1)?.group.id ?? null;
    await store.getState().restoreTo(first);
    ({ wrapped, asked } = spied(project.file));
    const lines = await undoRedoLines(wrapped);
    expectBounded(asked);
    const restoreKinds = new Map((await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => [s.group.id, s.group.kind]));
    expect(opsAsked(asked).every((id) => restoreKinds.get(id) === 'edit')).toBe(true);
    expect(lines.undo && lineText(lines.undo)).toBe(lineText((await loadSteps(project.file, 1)).steps[0]?.line ?? []));
  });

  it('with a move under an undo, lets only placesBefore’s pass through unbounded, once', async () => {
    const a = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(a.changes);
    const b = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(b.changes);
    // 4B dragged before 4A, then undone: Redo names the move, read through placesBefore.
    await store.getState().apply([{ kind: 'move', id: b.shotId, parentId: 'sc4', sortKey: '0' }]);
    const moved = (await loadSteps(project.file, 1)).steps[0]?.line ?? [];
    await store.getState().undo();
    const { wrapped, asked } = spied(project.file);
    const lines = await undoRedoLines(wrapped);
    expect(lines.redo && lineText(lines.redo)).toBe(lineText(moved));
    expect(lineText(moved)).toMatch(/^Moved/);
    expectBounded(asked);
    expect(asked.filter((q) => q.sql === PLACES_SCAN)).toHaveLength(1);
  });

  it('asks for exactly the pictures describeEdit checks', async () => {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    const pic = (id: string, sha: string) => ({
      kind: 'create' as const,
      record: { id, type: 'media' as const, parentId: added.shotId, sortKey: id, props: { kind: 'image', file: sha, width: 640, height: 360 } },
    });
    await store.getState().apply([pic('p1', 'b'.repeat(64)), pic('p2', 'c'.repeat(64))]);
    const { undoTop } = await undoTops(project.file);
    const ops = await opsOfGroups(project.file, [undoTop ?? '']);
    const { wrapped, asked } = spied(project.file);
    await undoRedoLines(wrapped);
    const shas = asked.filter((q) => /\bmedia_files\b/.test(q.sql)).flatMap((q) => JSON.parse(String(q.params[0])) as string[]);
    expect([...shas].sort()).toEqual([...stepPictures(ops)].sort());
    expect([...shas].sort()).toEqual(['b'.repeat(64), 'c'.repeat(64)]);
    // describeEdit's tag turns on these hashes alone: all stored, none removed; one missing, removed.
    const tag = t('history.pictureRemovedTag');
    expect(lineText(describeEdit(ops, new Set(shas)))).not.toContain(tag.trim());
    expect(lineText(describeEdit(ops, new Set(shas.slice(1))))).toContain(tag.trim());
  });

  it('names a restore to an Empty Trash from the log’s own count, never reading the Empty Trash’s ops', async () => {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    await store.getState().apply([{ kind: 'trash', id: added.shotId }]);
    await store.getState().emptyTrash();
    const emptied = (await loadSteps(project.file, 1)).steps[0]?.group;
    expect(emptied?.kind).toBe('empty_trash');
    await store.getState().apply(addShot(store.getState().records, project.projectId, 'sc4').changes);
    await store.getState().restoreTo(emptied?.id ?? null);
    const { wrapped, asked } = spied(project.file);
    const lines = await undoRedoLines(wrapped);
    expectBounded(asked);
    const opsAsked = asked.filter((q) => /o\.group_id IN \(SELECT value FROM json_each\(\?\)\)/.test(q.sql)).flatMap((q) => JSON.parse(String(q.params[0])) as string[]);
    expect(opsAsked).not.toContain(emptied?.id);
    // The same line History shows, which reads every op.
    const history = await loadSteps(project.file, Number.MAX_SAFE_INTEGER);
    expect(lines.undo && lineText(lines.undo)).toBe(lineText(history.steps[0]?.line ?? []));
    expect(lineText(history.steps.find((s) => s.group.id === emptied?.id)?.line ?? [])).toMatch(/^Emptied the Trash: \d+ items? deleted for good$/);
  });
});

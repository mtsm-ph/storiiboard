import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { undoRedoLines } from '../../features/history/steps';
import { lineText } from '../../features/history/summary';
import type { ProjectFile } from '../storage/driver';
import { createMemoryDriver } from '../storage/memoryDriver';
import { createProject, type Project } from '../storage/project';
import { apply, childrenBefore, log, restoreTo, undo, undoTops, type Change } from './ops';

// What a move's line reads (childrenBefore, steps.ts): the records its target held just before the step. The top bar's
// Undo names the step ⌘Z would take after every edit, and after many undos that step sits deep in the log (#241's
// review). Measured on the end-to-end tests' driver (sql.js); the numbers print with SB_PERF=1, and the 50,000-write
// runs only then (`SB_PERF=1 npx vitest run src/core/ops/childrenBefore.test.ts`), as perf.test.ts does.
const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let project: Project;
beforeEach(async () => {
  project = await createProject('/memory/Bey County.sbd', { driver: await createMemoryDriver({ wasm }), backups: false });
});
afterEach(async () => {
  await project.close();
});

const scene = (id: string, sortKey: string): Change => ({ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number: id.slice(2) } } });
const shot = (id: string, parentId: string, sortKey: string): Change => ({ kind: 'create', record: { id, type: 'shot', parentId, sortKey, props: { number: id } } });
const notes = (e: number, size: number): Change[] =>
  Array.from({ length: size }, (_, i): Change => ({ kind: 'create', record: { type: 'note', parentId: 'sc2', sortKey: `n${String(e)}_${String(i)}`, props: { text: 'Push in' } } }));

/** A move of 1C to after 1A in SC 1, then `edits` steps of `size` notes each in SC 2, all undone: the move is undo's top. */
async function moveUnder(edits: number, size: number): Promise<{ seq: number; later: number }> {
  await apply(project.file, [scene('sc1', 'a'), scene('sc2', 'b'), shot('1A', 'sc1', 'a'), shot('1B', 'sc1', 'b'), shot('1C', 'sc1', 'c')]);
  await apply(project.file, [{ kind: 'move', id: '1C', parentId: 'sc1', sortKey: 'aa' }]);
  const moved = (await log(project.file)).at(-1);
  for (let e = 0; e < edits; e += 1) await apply(project.file, notes(e, size));
  for (let e = 0; e < edits; e += 1) await undo(project.file);
  expect((await undoTops(project.file)).undoTop).toBe(moved?.id);
  const [row] = await project.file.query('SELECT min(seq) AS seq FROM ops WHERE group_id = ?', [moved?.id ?? '']);
  const seq = Number(row?.seq);
  const [later] = await project.file.query('SELECT count(*) AS n FROM ops WHERE seq >= ?', [seq]);
  return { seq, later: Number(later?.n) };
}

async function timed(run: () => Promise<unknown>, times = 5): Promise<number> {
  const all: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    await run();
    all.push(performance.now() - start);
  }
  return [...all].sort((a, b) => a - b)[Math.floor(times / 2)] ?? 0;
}

/** The file with its queries counted, and the rows they returned. */
function counted(file: ProjectFile) {
  const seen = { queries: 0, rows: 0 };
  const spied: ProjectFile = Object.assign(Object.create(file) as ProjectFile, {
    query: async (sql: string, params?: Parameters<ProjectFile['query']>[1]) => {
      const rows = await file.query(sql, params);
      seen.queries += 1;
      seen.rows += rows.length;
      return rows;
    },
  });
  return { spied, seen };
}

const report = (what: string, ms: number, extra = '') => {
  if (process.env.SB_PERF) console.log(`${what}: ${ms.toFixed(1)} ms${extra}`);
};

describe('a move’s neighbours as they were (childrenBefore)', () => {
  it('finds them under an undo top with later writes', async () => {
    const { seq } = await moveUnder(3, 20);
    const [kids] = await childrenBefore(project.file, [{ parentId: 'sc1', seq }]);
    expect((kids ?? []).map((r) => r.id).sort()).toEqual(['1A', '1B', '1C']);
    expect(lineText((await undoRedoLines(project.file)).undo ?? [])).toBe('Moved 1C to after 1A');
  });

  it('finds one a later write took away', async () => {
    const { seq } = await moveUnder(0, 0);
    await apply(project.file, [{ kind: 'move', id: '1B', parentId: 'sc2', sortKey: 'a' }]);
    await apply(project.file, notes(0, 20));
    const [kids] = await childrenBefore(project.file, [{ parentId: 'sc1', seq }]);
    expect((kids ?? []).map((r) => r.id).sort()).toEqual(['1A', '1B', '1C']);
  });

  it.runIf(process.env.SB_PERF)('costs what the log since costs, measured with few and with 50,000 later writes', { timeout: 600_000 }, async () => {
    const { seq, later } = await moveUnder(25, 1000);
    expect(later).toBeGreaterThanOrEqual(50_000);
    report(`childrenBefore under ${String(later)} later ops`, await timed(() => childrenBefore(project.file, [{ parentId: 'sc1', seq }])));
    const { spied, seen } = counted(project.file);
    const ms = await timed(() => undoRedoLines(spied), 1);
    report(`undoRedoLines under ${String(later)} later ops`, ms, `, ${String(seen.queries)} queries, ${String(seen.rows)} rows`);
  });

  it.runIf(process.env.SB_PERF)('costs little with few later writes', async () => {
    const { seq, later } = await moveUnder(0, 0);
    report(`childrenBefore under ${String(later)} later ops`, await timed(() => childrenBefore(project.file, [{ parentId: 'sc1', seq }])));
  });

  it.runIf(process.env.SB_PERF)('a Restore to here of 25,000 writes and its undo', { timeout: 600_000 }, async () => {
    await apply(project.file, [scene('sc1', 'a'), scene('sc2', 'b')]);
    const start = (await log(project.file)).at(-1)?.id ?? null;
    for (let e = 0; e < 25; e += 1) await apply(project.file, notes(e, 1000));
    await restoreTo(project.file, start);
    let { spied, seen } = counted(project.file);
    let ms = await timed(() => undoRedoLines(spied), 1);
    report('undoRedoLines after a restore of 25,000 writes', ms, `, ${String(seen.queries)} queries, ${String(seen.rows)} rows`);
    await undo(project.file);
    ({ spied, seen } = counted(project.file));
    ms = await timed(() => undoRedoLines(spied), 1);
    report('undoRedoLines after undoing it', ms, `, ${String(seen.queries)} queries, ${String(seen.rows)} rows`);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { log, type LoggedOp } from '../../core/ops/ops';
import type { ProjectFile } from '../../core/storage/driver';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { addStroke, eraseStrokes } from '../storyboard/sketch/strokes';
import { moreItemLog, namedRecords, readItemLog, type ItemLog } from './steps';
import { byStep, frameRows } from './summary';

// The History tile (1.22) on a long project: one step can be tens of thousands of ops (a Restore to here, an Empty
// Trash, a big erase), and the tile reads its steps, and the shown frame's history, again after every edit.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const pen = { tool: 'pen' as const, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null };
const frame = async () => {
  const added = addShot(records(), project.projectId, 'sc4');
  await store.getState().apply(added.changes);
  return added.shotId;
};
const shot = (id: string): SbdRecord => {
  const record = records()[id];
  if (!record) throw new Error('no frame');
  return record;
};
/**
 * One step of `n` stroke ops on a frame, as the log hands them back: built in memory, since writing that many through
 * the store takes minutes, and what's tested is what the tile does with them once read.
 */
function bigStep(frameId: string, n: number, kind: 'create' | 'trash'): LoggedOp[] {
  return Array.from({ length: n }, (_, i): LoggedOp => {
    const stroke: SbdRecord = {
      id: `stroke-${String(i)}`,
      type: 'stroke',
      parentId: frameId,
      sortKey: String(i),
      props: { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008 },
      trashedAt: kind === 'trash' ? 'then' : null,
      trashedBy: kind === 'trash' ? 'local' : null,
      createdAt: '',
      updatedAt: '',
    };
    return {
      id: `op-${String(i)}`,
      seq: 1000 + i,
      groupId: 'big',
      groupKind: 'edit',
      recordId: stroke.id,
      kind,
      before: kind === 'create' ? null : { ...stroke, trashedAt: null, trashedBy: null },
      after: stroke,
      author: 'local',
      timestamp: '2026-11-04T09:00:00.000Z',
    };
  });
}

// Copying a step's list for every op in it, as both did, is quadratic: 5 s for 30k ops, minutes for 200k. In one pass
// 200k take well under a second, so the bound is generous for a slow machine yet far below what copying costs.
const N = 200_000;

describe('one step of hundreds of thousands of ops', () => {
  it('is put together in one pass', () => {
    const started = performance.now();
    const steps = byStep(bigStep('f1', N, 'create'));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(steps.get('big')?.length).toBe(N);
  });

  it('is one row of a frame’s own history, read in one pass', () => {
    const started = performance.now();
    const rows = frameRows(bigStep('f1', N, 'trash'), 'f1');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(rows.map((r) => r.change)).toEqual([`Erased ${String(N)} strokes`]);
  });

  it('names the frame it was on without running out of stack', async () => {
    const a = await frame();
    // Math.max(...seqs) throws past about 125k arguments, which took the whole History tile down with it.
    const named = await namedRecords(project.file, new Map([['big', bigStep(a, N, 'create')]]));
    expect(named.get('big')?.get(a)?.type).toBe('shot');
  });
});

/** The file, keeping every query it runs, so a test can ask SQLite how each one looks for its rows. */
function watched(file: ProjectFile): { file: ProjectFile; asked: { sql: string; params: readonly unknown[] }[] } {
  const asked: { sql: string; params: readonly unknown[] }[] = [];
  return {
    asked,
    file: {
      ...file,
      query: (sql, params = []) => {
        asked.push({ sql, params });
        return file.query(sql, params);
      },
    },
  };
}
/** Whether any query read every op in the log: a SCAN of ops (or its alias) in SQLite's plan. */
async function scansTheLog(asked: readonly { sql: string; params: readonly unknown[] }[]): Promise<boolean> {
  for (const { sql, params } of asked) {
    const plan = await project.file.query(`EXPLAIN QUERY PLAN ${sql}`, params as never);
    if (plan.some((row) => /^SCAN (ops|o)\b/.test(String(row.detail)))) return true;
  }
  return false;
}

describe('a frame’s own history after more steps', () => {
  it('reads only the new writes, never the whole log again, and comes out as a fresh read does', async () => {
    const [a, b] = [await frame(), await frame()];
    await store.getState().apply([addStroke(records(), a, pen)]);
    let known: ItemLog = await readItemLog(project.file, shot(a));

    const step = async (work: () => Promise<void>) => {
      await work();
      const seen = watched(project.file);
      known = await moreItemLog(seen.file, shot(a), known);
      expect(await scansTheLog(seen.asked)).toBe(false);
      expect(known.ops.map((op) => op.id)).toEqual((await readItemLog(project.file, shot(a))).ops.map((op) => op.id));
    };
    // A new sketch, an edit elsewhere, an undo that takes a stroke's record away, a redo, and a restore.
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await step(() => store.getState().apply([addStroke(records(), a, pen)]));
    await step(() => store.getState().apply([{ kind: 'update', id: b, set: { lens_mm: 50 } }]));
    await step(() => store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]));
    await step(() => store.getState().undo());
    await step(() => store.getState().redo());
    await step(async () => {
      await store.getState().restoreTo(point);
    });
    await step(() => store.getState().apply(eraseStrokes(Object.values(records()).filter((r) => r.type === 'stroke').map((r) => r.id))));
    expect(frameRows(known.ops, a).map((r) => r.change)).toEqual([
      'Erased 1 stroke',
      'lens, restored',
      'Restore to here: the sketch',
      'lens, redone',
      'lens, undone',
      'lens',
      'Sketched',
      'Sketched',
      'Added',
    ]);
  });

  it('the first read of a frame does look through the whole log, which is why it isn’t done after every step', async () => {
    const a = await frame();
    const seen = watched(project.file);
    await readItemLog(seen.file, shot(a));
    expect(await scansTheLog(seen.asked)).toBe(true);
  });
});

describe('Restore to here in flight', () => {
  it('is busy from the click until it lands, and until it fails', async () => {
    const a = await frame();
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await frame();
    const restoring = store.getState().restoreTo(point);
    expect(store.getState().restoring).toBe(true);
    expect(await restoring).toBe(true);
    expect(store.getState().restoring).toBe(false);
    expect(records()[a]).toBeDefined();

    // A file that refuses the write: the store says why, and the tile takes clicks again.
    const tx = project.file.tx.bind(project.file);
    project.file.tx = () => Promise.reject(new Error('The disk is full.'));
    try {
      const failing = store.getState().restoreTo(null);
      expect(store.getState().restoring).toBe(true);
      expect(await failing).toBe(false);
      expect(store.getState().restoring).toBe(false);
      expect(store.getState().error).toBe('The disk is full.');
    } finally {
      project.file.tx = tx;
    }
  });

  it('stays busy while a second restore queued behind the first still runs', async () => {
    await frame();
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await frame();
    const first = store.getState().restoreTo(point);
    const second = store.getState().restoreTo(null);
    await first;
    expect(store.getState().restoring).toBe(true);
    await second;
    expect(store.getState().restoring).toBe(false);
  });
});

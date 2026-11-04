import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { shotFields } from '../../core/model/storyboard';
import { log, opsOfRecord, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, board, moveItem, setCustomField, trashShot } from '../storyboard/board';
import { putBackChange } from './putBack';
import { loadSteps, PAGE } from './steps';
import { changeValue, fieldChanges, frameRows, lineText, type FieldChange } from './summary';

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
const numbers = () => (board(records(), project.projectId)[0]?.shots ?? []).map((s) => s.fields.number);
const frame = async () => {
  const added = addShot(records(), project.projectId, 'sc4');
  await store.getState().apply(added.changes);
  return added.shotId;
};
const reopen = async () => {
  await store.getState().close();
  project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
};
/** Every step's line, oldest first, as the History tile works them out. */
async function lines(): Promise<string[]> {
  const { steps } = await loadSteps(project.file, Number.MAX_SAFE_INTEGER);
  return steps.map((step) => lineText(step.line)).reverse();
}
const lastGroup = async (): Promise<OpGroup> => {
  const group = (await log(project.file)).at(-1);
  if (!group) throw new Error('no history');
  return group;
};

describe('History', () => {
  it('says what each step did, in the board’s words, a drag that renumbers as one step', async () => {
    const [a, , c] = [await frame(), await frame(), await frame()];
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, c, 'sc4', a) }));
    await store.getState().undo();
    await store.getState().redo();
    expect(await lines()).toEqual([
      'Added scene SC 04',
      'Added frame 4A',
      'Added frame 4B',
      'Added frame 4C',
      '4A: lens — → 50mm',
      'Moved 4C',
      'Undid: Moved 4C',
      'Redid: Moved 4C',
    ]);
  });

  it('restores the project to a step as one new step that undo takes back', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await frame();
    expect(await store.getState().restoreTo(point.id)).toBe(true);
    expect(numbers()).toEqual(['4A']);
    expect((await lines()).at(-1)).toBe('Restored the project to: Added frame 4A');
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('restores after the project is closed and opened again, and the restore lasts another restart', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await reopen();
    await store.getState().restoreTo(point.id);
    await reopen();
    expect(numbers()).toEqual(['4A']);
    // And it can still be undone after the restart.
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B']);
  });

  it('changes nothing when a restore’s write dies halfway', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await frame();
    const write = project.file.tx.bind(project.file);
    project.file.tx = (statements) => {
      project.file.tx = write;
      const half = Math.ceil(statements.length / 2);
      return write([...statements.slice(0, half), { sql: 'INSERT INTO no_such_table VALUES (1)' }, ...statements.slice(half)]);
    };
    expect(await store.getState().restoreTo(point.id)).toBe(false);
    expect(store.getState().error).not.toBeNull();
    await reopen();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await lines()).at(-1)).toBe('Added frame 4C');
  });

  it('keeps one frame’s own changes, field by field, and an old value goes back as one step', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    const own = await opsOfRecord(project.file, a);
    expect(own.map((op) => [op.kind, op.after ? shotFields(op.after.props).lensMm : null])).toEqual([
      ['create', null],
      ['update', 35],
      ['update', 50],
    ]);
    // Put back: the 35mm the last change replaced.
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    expect(shotFields(records()[a]?.props ?? {}).lensMm).toBe(35);
    expect((await lines()).at(-1)).toBe('4A: lens 50mm → 35mm');
  });
});

/** The ids of scene 4's live frames, in board order. */
const order = () => (board(records(), project.projectId)[0]?.shots ?? []).map((s) => s.record.id);
const numberOf = (id: string) => shotFields(records()[id]?.props ?? {}).number;
const stepCount = async () => (await log(project.file)).length;
/** Put back as the tile does it: from the frame as it is now; false when there was nothing to write. */
const putBack = async (id: string, field: FieldChange) => {
  const change = putBackChange(records()[id], field);
  if (change) await store.getState().apply([change]);
  return change !== null;
};
/** The change a field's last edit made, as the frame's history lists it. */
const lastChange = async (id: string, prop: string, key?: string): Promise<FieldChange> => {
  const ops = await opsOfRecord(project.file, id);
  const found = ops
    .flatMap((op) => (op.before && op.after ? fieldChanges(op.before, op.after) : []))
    .filter((f) => f.prop === prop && f.key === key)
    .at(-1);
  if (!found) throw new Error(`no change to ${prop}`);
  return found;
};

describe('Restore to here', () => {
  it('brings back whether a frame was in the Trash, both ways, as the board had it', async () => {
    const [a, b] = [await frame(), await frame()];
    const live = await lastGroup();
    await store.getState().apply(trashShot(records(), project.projectId, a));
    const trashed = await lastGroup();
    expect(order()).toEqual([b]);

    expect(await store.getState().restoreTo(live.id)).toBe(true);
    expect(records()[a]?.trashedAt).toBeNull();
    expect(order()).toEqual([a, b]);
    expect([numberOf(a), numberOf(b)]).toEqual(['4A', '4B']);

    expect(await store.getState().restoreTo(trashed.id)).toBe(true);
    expect(records()[a]?.trashedAt).not.toBeNull();
    expect(order()).toEqual([b]);
    expect(numberOf(b)).toBe('4A');
  });

  it('puts frames back in the order they had, with the numbers they had', async () => {
    const [a, b, c] = [await frame(), await frame(), await frame()];
    const point = await lastGroup();
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, c, 'sc4', a) }));
    expect(order()).toEqual([c, a, b]);
    expect(await store.getState().restoreTo(point.id)).toBe(true);
    expect(order()).toEqual([a, b, c]);
    expect([numberOf(a), numberOf(b), numberOf(c)]).toEqual(['4A', '4B', '4C']);
  });
});

describe('Put back', () => {
  it('sets one custom field’s old value and leaves the frame’s other custom fields as they are now', async () => {
    const a = await frame();
    await store.getState().apply(setCustomField(records(), a, 'Drone', 'DJI Inspire'));
    await store.getState().apply(setCustomField(records(), a, 'VFX', 'Sky replace'));
    await store.getState().apply(setCustomField(records(), a, 'Drone', 'FPV'));
    expect((await lines()).at(-1)).toBe('4A: Drone DJI Inspire → FPV');

    expect(await putBack(a, await lastChange(a, 'custom', 'Drone'))).toBe(true);
    expect(records()[a]?.props.custom).toEqual({ Drone: 'DJI Inspire', VFX: 'Sky replace' });
    // A field that wasn't there before goes again, and the others stay.
    expect(await putBack(a, await lastChange(a, 'custom', 'VFX'))).toBe(true);
    expect(records()[a]?.props.custom).toEqual({ Drone: 'DJI Inspire' });
    expect((await lines()).slice(-2)).toEqual(['4A: Drone FPV → DJI Inspire', '4A: removed the field VFX']);
  });

  it('tells a custom field taken off from one emptied, so the two Put backs never read the same', async () => {
    const a = await frame();
    await store.getState().apply(setCustomField(records(), a, 'VFX', ''));
    await store.getState().apply(setCustomField(records(), a, 'VFX', 'Sky replace'));
    expect((await lines()).slice(-2)).toEqual(['4A: added the field VFX', '4A: VFX — → Sky replace']);
    const rows = frameRows(await opsOfRecord(project.file, a)).flatMap((r) => (r.field ? [[changeValue(r.field, r.field.before), changeValue(r.field, r.field.after)]] : []));
    expect(rows).toEqual([
      ['—', 'Sky replace'],
      ['no field', '—'],
    ]);
  });

  it('puts back a field other than the lens: the action', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { action: 'Truck pulls into the dock' } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { action: 'Truck backs out' } }]);
    expect(await putBack(a, await lastChange(a, 'action'))).toBe(true);
    expect(records()[a]?.props.action).toBe('Truck pulls into the dock');
    expect((await lines()).at(-1)).toBe('4A: action Truck backs out → Truck pulls into the dock');
  });

  it('writes no step when the frame already has that value', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    const field = await lastChange(a, 'lens_mm');
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    const steps = await stepCount();
    expect(await putBack(a, field)).toBe(false);
    expect(await stepCount()).toBe(steps);
  });

  it('takes a custom field off again when it wasn’t on the frame, even emptied', async () => {
    const a = await frame();
    await store.getState().apply(setCustomField(records(), a, 'VFX', ''));
    expect(await putBack(a, await lastChange(a, 'custom', 'VFX'))).toBe(true);
    expect(records()[a]?.props.custom).toBeUndefined();
  });

  it('never puts a number back on its own: the board keeps those in step', async () => {
    const [a, , c] = [await frame(), await frame(), await frame()];
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, c, 'sc4', a) }));
    expect(putBackChange(records()[a], await lastChange(a, 'number'))).toBeNull();
  });
});

describe('a frame’s own history', () => {
  const rows = async (id: string) => frameRows(await opsOfRecord(project.file, id)).map((r) => [r.change, r.field?.before ?? null, r.field?.after ?? null]);

  it('tells an undone add, and a delete and its undo, apart from the edits they reverse', async () => {
    const a = await frame();
    await store.getState().undo();
    await store.getState().redo();
    expect((await rows(a)).map(([change]) => change)).toEqual(['Redid: Added', 'Undid: Added', 'Added']);

    await store.getState().apply(trashShot(records(), project.projectId, a));
    await store.getState().undo();
    expect((await rows(a)).slice(0, 2).map(([change]) => change)).toEqual(['Undid: Deleted', 'Deleted']);
  });

  it('shows what Restore to here changed, field by field, and the number a drag gave the frame', async () => {
    const [a, , c] = [await frame(), await frame(), await frame()];
    const point = await lastGroup();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, c, 'sc4', a) }));
    await store.getState().restoreTo(point.id);
    expect((await rows(a)).slice(0, 3)).toEqual([
      ['number, restored', '4B', '4A'],
      ['lens, restored', 50, null],
      ['number', '4A', '4B'],
    ]);
    expect((await rows(c)).slice(0, 2)).toEqual([
      ['Restore to here: moved', null, null],
      ['number, restored', '4A', '4C'],
    ]);
    await store.getState().undo();
    expect((await rows(c)).slice(0, 2)).toEqual([
      ['Undid: Restore to here', null, null],
      ['number, undone', '4C', '4A'],
    ]);
  });

  it('says who made each change', async () => {
    const a = await frame();
    expect(frameRows(await opsOfRecord(project.file, a)).map((r) => r.op.author)).toEqual(['local']);
  });

  it('sets slate and camera values in mono in a step’s line, and never a count', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { t_stop: 2.8 } }]);
    const { steps } = await loadSteps(project.file, 3);
    expect(steps.map((s) => s.line)).toEqual([
      [{ mono: '4A' }, ': T-stop ', '—', ' → ', { mono: 'T2.8' }, ''],
      [{ mono: '4A' }, ': lens ', '—', ' → ', { mono: '50mm' }, ''],
      ['Added frame ', { mono: '4A' }],
    ]);
    await frame();
    await store.getState().apply(Object.values(records()).filter((r) => r.type === 'shot').map((r) => ({ kind: 'trash' as const, id: r.id })));
    expect((await loadSteps(project.file, 1)).steps[0]?.line).toEqual(['Deleted 2 frames']);
  });
});

describe('Show older steps', () => {
  it('reads a page at a time, newest first, and an undo still names a step older than the page', async () => {
    const a = await frame();
    for (let i = 0; i < PAGE + 4; i += 1) await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 20 + i } }]);
    await store.getState().undo();
    const all = await stepCount();

    const first = await loadSteps(project.file, PAGE);
    expect(first.steps).toHaveLength(PAGE);
    expect(first.more).toBe(true);
    expect(lineText(first.steps[0]?.line ?? [])).toBe('Undid: 4A: lens 122mm → 123mm');
    expect(lineText(first.steps.at(-1)?.line ?? [])).toBe(`4A: lens ${String(20 + all - PAGE - 3)}mm → ${String(20 + all - PAGE - 2)}mm`);

    const older = await loadSteps(project.file, PAGE * 2);
    expect(older.steps).toHaveLength(all);
    expect(older.more).toBe(false);
    expect(lineText(older.steps.at(-1)?.line ?? [])).toBe('Added scene SC 04');
  });

  it('names the point of an undone restore even when both are older than the page', async () => {
    await frame();
    const point = await lastGroup();
    await frame();
    await store.getState().restoreTo(point.id);
    await store.getState().undo();
    expect(lineText((await loadSteps(project.file, 1)).steps[0]?.line ?? [])).toBe('Undid: Restored the project to: Added frame 4A');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { shotFields } from '../../core/model/storyboard';
import { log, opsOfRecord, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addNote, addShot, board, moveItem, setCustomField, setSceneLocation, trashShot } from '../storyboard/board';
import { addStroke, eraseStrokes } from '../storyboard/sketch/strokes';
import { putBackChange } from './putBack';
import { frameOps, itemOps, loadSteps, PAGE, restoreNotice } from './steps';
import { changeLabel, changeText, changeValue, fieldChanges, frameRows, lineText, valueLabel, type FieldChange } from './summary';

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

  it('says what each Watermark Settings step did, and shows the watermark itself in the project’s own changes', async () => {
    const id = project.projectId;
    const mark = (text: string, opacity: number) => ({ text, position: 'bottom-right', opacity, applies_to: ['pdf', 'png'] });
    await store.getState().apply([{ kind: 'update', id, set: { watermark: mark('DRAFT', 0.35) } }]);
    await store.getState().apply([{ kind: 'update', id, set: { watermark: mark('DRAFT', 0.5) } }]);
    await store.getState().apply([{ kind: 'update', id, set: { watermark: mark('NOT FOR AIR', 0.5) } }]);
    await store.getState().apply([{ kind: 'update', id, set: { watermark: { ...mark('NOT FOR AIR', 0.8), position: 'center' } } }]);
    await store.getState().apply([{ kind: 'update', id, unset: ['watermark'] }]);
    expect((await lines()).slice(-5)).toEqual([
      'Set the watermark “DRAFT”',
      'Watermark “DRAFT” strength: 35% → 50%',
      'Watermark text: “DRAFT” → “NOT FOR AIR”',
      'Changed the watermark “NOT FOR AIR”: position, strength',
      'Removed the watermark “NOT FOR AIR”',
    ]);
    expect(valueLabel('watermark', mark('DRAFT', 0.35))).toBe('“DRAFT”, bottom right, 35%');
    expect(valueLabel('watermark', { ...mark('DRAFT', 0.5), position: 'center' })).toBe('“DRAFT”, centre, 50%');
  });

  it('names a video’s LUT change in words, never by its row’s id (2.5)', async () => {
    const lut = 'b1d3c0de-0000-4000-8000-000000000001';
    await store.getState().apply([
      { kind: 'create', record: { id: 'v1', type: 'media', parentId: project.projectId, sortKey: 'a', props: { kind: 'video', source_name: 'C0042.MP4' } } },
    ]);
    await store.getState().apply([{ kind: 'update', id: 'v1', set: { lut } }]);
    await store.getState().apply([{ kind: 'update', id: 'v1', unset: ['lut'] }]);
    const [set, off] = (await lines()).slice(-2);
    for (const line of [set, off]) {
      expect(line).toContain('LUT');
      expect(line).not.toContain(lut);
    }
    expect([set, off]).toEqual([expect.stringContaining('— → a LUT'), expect.stringContaining('a LUT → —')]);
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
    const rows = frameRows(await opsOfRecord(project.file, a), a).flatMap((r) => (r.field ? [[changeValue(r.field, r.field.before), changeValue(r.field, r.field.after)]] : []));
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

  it('reads a palette step by its colours, a locked one marked (polish PP)', async () => {
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { palette: { size: 8, colors: [{ hex: '#A35139' }, { hex: '#1F2F4D' }] } } }]);
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { palette: { size: 8, colors: [{ hex: '#A35139', locked: true }, { hex: '#1F2F4D' }] } } }]);
    expect((await lines()).slice(-2)).toEqual([
      'SC 04: palette — → #A35139, #1F2F4D (count 8)',
      'SC 04: palette #A35139, #1F2F4D (count 8) → #A35139 (locked), #1F2F4D (count 8)',
    ]);
  });

  it('lists each department’s status on its own, and never offers one to put back (polish 6)', async () => {
    const a = await frame();
    const approval = { name: 'Kevin Matos', roles: ['director', 'dp'], at: '2026-11-05T10:00:00.000Z' };
    await store.getState().apply([{ kind: 'update', id: a, set: { department_status: { camera: { priority: true } } } }]);
    await store.getState().apply([
      { kind: 'update', id: a, set: { department_status: { camera: { priority: true, done: true, approvals: [approval] }, art: { working: true } } } },
    ]);
    const done = await lastChange(a, 'department_status', 'camera');
    expect(changeLabel(done)).toBe('Camera');
    expect(changeValue(done, done.before)).toBe('Priority');
    expect(changeValue(done, done.after)).toBe('Priority, Done, approved by Kevin Matos (Director and DP)');
    const art = await lastChange(a, 'department_status', 'art');
    expect([changeLabel(art), changeValue(art, art.before), changeValue(art, art.after)]).toEqual(['Art', '—', 'Working on it']);
    // A first tick reads as a change in the board's words, never as a field put on by its stored id.
    expect((await lines()).slice(-2)).toEqual([
      '4A: Camera — → Priority',
      '4A: Camera, Art',
    ]);
    // A sign-off has a name and a time: it goes back only with Restore to here, never by hand.
    expect(putBackChange(records()[a], done)).toBeNull();
    // Nor does the list a frame kept before polish 6: the frame reads its status now.
    await store.getState().apply([{ kind: 'update', id: a, set: { departments: ['sound'] } }]);
    expect(putBackChange(records()[a], await lastChange(a, 'departments'))).toBeNull();
  });

  it('names a shoot day by its date, and frames moved into one together by the day (3.7)', async () => {
    const a = await frame();
    const b = await frame();
    await store.getState().apply([{ kind: 'create', record: { id: 'day', type: 'shoot_day', parentId: project.projectId, sortKey: 'V', props: { date: '2026-11-16' } } }]);
    expect((await lines()).at(-1)).toBe('Added shoot day Mon, Nov 16');
    await store.getState().apply([
      { kind: 'update', id: a, set: { shoot_day_id: 'day' } },
      { kind: 'update', id: b, set: { shoot_day_id: 'day' } },
    ]);
    expect((await lines()).at(-1)).toBe('Moved 2 frames to shoot day Mon, Nov 16');
    await store.getState().apply([
      { kind: 'update', id: a, unset: ['shoot_day_id'] },
      { kind: 'update', id: b, unset: ['shoot_day_id'] },
    ]);
    expect((await lines()).at(-1)).toBe('Took 2 frames out of their shoot day');
    await store.getState().apply([{ kind: 'update', id: 'day', set: { date: '2026-11-18' } }]);
    const moved = await lastChange('day', 'date');
    expect(changeValue(moved, moved.after)).toBe('Wed, Nov 18');
    // Who's confirmed (3.8), kept by person id, is said as how many: never the ids.
    await store.getState().apply([{ kind: 'update', id: 'day', set: { crew: { 'person-1': 'confirmed', 'person-2': 'confirmed' } } }]);
    const crew = await lastChange('day', 'crew');
    expect([changeLabel(crew), changeValue(crew, crew.after)]).toEqual(['crew confirmed', '2 confirmed']);
    expect((await lines()).at(-1)).not.toContain('person-1');
  });

  it('names a gear item, and says its department and whose it is in words (3.9a)', async () => {
    await store.getState().apply([{ kind: 'create', record: { id: 'fx3', type: 'gear_item', parentId: project.projectId, sortKey: 'V', props: { name: 'FX3 package', source: 'owned' } } }]);
    expect((await lines()).at(-1)).toBe('Added gear FX3 package');
    await store.getState().apply([{ kind: 'update', id: 'fx3', set: { department: 'grip-electric', source: 'rental' } }]);
    const department = await lastChange('fx3', 'department');
    const source = await lastChange('fx3', 'source');
    expect([changeLabel(department), changeValue(department, department.after)]).toEqual(['department', 'Grip & electric']);
    expect([changeValue(source, source.before), changeValue(source, source.after)]).toEqual(['Owned', 'Rental']);
  });

  it('says a person’s Full view as on or off (3.6c)', async () => {
    await store.getState().apply([{ kind: 'create', record: { id: 'sam', type: 'person', parentId: project.projectId, sortKey: 'V', props: { name: 'Sam Ortiz' } } }]);
    await store.getState().apply([{ kind: 'update', id: 'sam', set: { full_view: true } }]);
    const set = await lastChange('sam', 'full_view');
    expect([changeLabel(set), changeValue(set, set.before), changeValue(set, set.after)]).toEqual(['full view', '—', 'on']);
  });

  it('lists a scene’s approvals by department, without the fingerprint, and never offers one to put back (3.6b)', async () => {
    const approval = { name: 'Sam Reyes', roles: ['dp'], at: '2026-11-09T10:00:00.000Z', basis: '0123456789abcd' };
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { department_approvals: { camera: [approval] } } }]);
    const given = await lastChange('sc4', 'department_approvals', 'camera');
    expect([changeLabel(given), changeValue(given, given.before), changeValue(given, given.after)]).toEqual(['Camera', '—', 'approved by Sam Reyes (DP)']);
    expect((await lines()).at(-1)).not.toContain('0123456789abcd');
    expect(putBackChange(records().sc4, given)).toBeNull();
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
  const rows = async (id: string) => frameRows(await opsOfRecord(project.file, id), id).map((r) => [r.change, r.field?.before ?? null, r.field?.after ?? null]);

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

  it('names departments, status, size and move in the board’s words, never their stored codes', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { departments: ['camera', 'grip-electric', 'hmu'] } }]);
    // A new frame is one still to shoot.
    await store.getState().apply([{ kind: 'update', id: a, set: { status: 'have' } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { size: 'INSERT' } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { move: 'push in' } }]);
    expect((await lines()).slice(-4)).toEqual([
      '4A: departments — → Camera, Grip & electric, HMU',
      '4A: status Need to shoot → Have',
      '4A: size — → INS',
      '4A: move — → Push in',
    ]);
    // The frame's own rows, and so its Put back labels, read the same words.
    const status = await lastChange(a, 'status');
    expect([changeValue(status, status.before), changeValue(status, status.after)]).toEqual(['Need to shoot', 'Have']);
    // A value this version doesn't know is shown as it's stored.
    await store.getState().apply([{ kind: 'update', id: a, set: { departments: ['camera', 'stunts'] } }]);
    expect((await lines()).at(-1)).toBe('4A: departments Camera, Grip & electric, HMU → Camera, stunts');
  });

  it('says who made each change', async () => {
    const a = await frame();
    expect(frameRows(await opsOfRecord(project.file, a), a).map((r) => r.op.author)).toEqual(['local']);
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

describe('after Empty Trash', () => {
  it('words a step whose records are gone for good by what it did, never as an edit of the frames it renumbered', async () => {
    const [a] = [await frame(), await frame(), await frame()];
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    await store.getState().apply(trashShot(records(), project.projectId, a));
    expect((await lines()).at(-1)).toBe('Deleted frame 4A');
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toEqual([
      'Added scene SC 04',
      'Added an item, since deleted for good',
      'Added frame 4B',
      'Added frame 4C',
      'Changed an item, since deleted for good',
      'Deleted an item, since deleted for good',
      'Emptied the Trash: 1 item deleted for good',
    ]);
  });
});

const pen = { tool: 'pen' as const, points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null };
/** A frame's own history as the tile reads it: the frame, and its strokes and picture. */
const withChildren = async (id: string) => frameRows(await frameOps(project.file, id), id);

describe('sketching in History', () => {
  it('names the frame a sketch or an erase was on, by its number then', async () => {
    const [a, b] = [await frame(), await frame()];
    await store.getState().apply([addStroke(records(), b, pen)]);
    await store.getState().apply([addStroke(records(), b, pen)]);
    const strokes = Object.values(records()).filter((r) => r.type === 'stroke').map((r) => r.id);
    await store.getState().apply(eraseStrokes(strokes));
    // 4A goes, so 4B is 4A now; the steps keep the number the frame had when it was drawn on.
    await store.getState().apply(trashShot(records(), project.projectId, a));
    expect(numberOf(b)).toBe('4A');
    expect((await lines()).slice(-4)).toEqual(['Sketched on 4B', 'Sketched on 4B', 'Erased 2 strokes on 4B', 'Deleted frame 4A']);
  });

  it('lists a frame’s sketching in its own history, one row a step, undos included', async () => {
    const a = await frame();
    await store.getState().apply([addStroke(records(), a, pen)]);
    await store.getState().apply([addStroke(records(), a, pen)]);
    const strokes = Object.values(records()).filter((r) => r.type === 'stroke').map((r) => r.id);
    await store.getState().apply(eraseStrokes(strokes));
    await store.getState().undo();
    expect((await withChildren(a)).map((r) => r.change)).toEqual(['Undid: Erased 2 strokes', 'Erased 2 strokes', 'Sketched', 'Sketched', 'Added']);
  });

  it('keeps a row’s key when a newer step arrives above it, so focus and the row stay together', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    await store.getState().apply([addStroke(records(), a, pen)]);
    const before = (await withChildren(a)).map((r) => r.key);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    const after = (await withChildren(a)).map((r) => r.key);
    expect(after.slice(1)).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });
});

describe('a frame’s own history, from the log', () => {
  it('keeps an undone sketch, whose stroke has no record any more', async () => {
    const a = await frame();
    await store.getState().apply([addStroke(records(), a, pen)]);
    await store.getState().undo();
    expect(Object.values(records()).some((r) => r.type === 'stroke')).toBe(false);
    expect((await withChildren(a)).map((r) => r.change)).toEqual(['Undid: Sketched', 'Sketched', 'Added']);
  });

  it('keeps a sketch Restore to here took away', async () => {
    const a = await frame();
    const point = await lastGroup();
    await store.getState().apply([addStroke(records(), a, pen)]);
    await store.getState().restoreTo(point.id);
    expect((await withChildren(a)).map((r) => r.change)).toEqual(['Restore to here: the sketch', 'Sketched', 'Added']);
  });
});

describe('values kept by id', () => {
  it('names a location picked for a scene, as it was then, never by its id', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc5', type: 'scene', parentId: project.projectId, sortKey: 'W', props: { number: '5' } } },
    ]);
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc4', 'Dock') }));
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc5', 'Dock') }));
    const dock = Object.values(records()).find((r) => r.type === 'location');
    if (!dock) throw new Error('no location');
    await store.getState().apply([{ kind: 'update', id: dock.id, set: { name: 'Pier 9' } }]);
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc4', 'Diner') }));
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc5', 'Diner') }));
    expect((await lines()).slice(-5)).toEqual([
      'Added location Dock',
      'SC 05: location — → Dock',
      'Pier 9: name Dock → Pier 9',
      'Added location Diner',
      'SC 05: location Pier 9 → Diner',
    ]);
  });

  it('says a frame’s picture was set, replaced or removed, never its id', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { media_id: 'b7c1e0a2-0000-4000-8000-000000000001' } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { media_id: 'b7c1e0a2-0000-4000-8000-000000000002' } }]);
    await store.getState().apply([{ kind: 'update', id: a, unset: ['media_id'] }]);
    expect((await lines()).slice(-3)).toEqual(['4A: picture set', '4A: picture replaced', '4A: picture removed']);
    const rows = (await withChildren(a)).flatMap((r) => (r.field ? [[r.change, changeValue(r.field, r.field.before), changeValue(r.field, r.field.after)]] : []));
    expect(rows).toEqual([
      ['picture removed', 'a picture', '—'],
      ['picture replaced', 'a picture', 'a picture'],
      ['picture set', '—', 'a picture'],
    ]);
  });
});

describe('Restore to here’s notice', () => {
  it('names the step pressed, and says so when the project is already as it was then', async () => {
    const [a, b] = [await frame(), await frame()];
    const steps = (await loadSteps(project.file, PAGE)).steps;
    const added4A = steps[1]?.group.id ?? '';
    expect(restoreNotice(steps, added4A, true, '⌘Z')).toBe('Restored the project to after “Added frame 4A”. ⌘Z takes it back.');
    expect(restoreNotice(steps, added4A, false, '⌘Z')).toBe('Nothing to restore: the project is already as it was after “Added frame 4A”.');

    // Just below an Empty Trash, the point differs from now only by what it deleted for good.
    await store.getState().apply(trashShot(records(), project.projectId, a));
    await store.getState().emptyTrash();
    const after = (await loadSteps(project.file, PAGE)).steps;
    const deleted = after[1]?.group.id ?? '';
    expect(await store.getState().restoreTo(deleted)).toBe(false);
    expect(restoreNotice(after, deleted, false, '⌘Z')).toBe(
      'Nothing to restore: the project is already as it was after “Deleted an item, since deleted for good”. What Empty Trash deleted can’t come back.',
    );
    expect(records()[b]).toBeDefined();
  });
});

describe('Restore to here’s notice past an Empty Trash', () => {
  it('says what Empty Trash deleted can’t come back when the restore changed things too', async () => {
    const [a, b] = [await frame(), await frame()];
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    const point = await lastGroup();
    await store.getState().apply(trashShot(records(), project.projectId, b));
    await store.getState().emptyTrash();
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    const steps = (await loadSteps(project.file, PAGE)).steps;
    expect(await store.getState().restoreTo(point.id)).toBe(true);
    expect(shotFields(records()[a]?.props ?? {}).lensMm).toBe(35);
    // 4B is gone for good, so the project isn't as it was after that step: the notice says why.
    expect(records()[b]).toBeUndefined();
    expect(restoreNotice(steps, point.id, true, 'Ctrl+Z')).toBe(
      'Restored the project to after “4A: lens — → 35mm”. What Empty Trash deleted can’t come back. Ctrl+Z takes it back.',
    );
  });
});

describe('a long value in an item’s own history', () => {
  const action = 'INT. KITCHEN - she turns from the window,\nsees him at the door, drops the cup.';

  it('is shown in full, line breaks kept, though a step’s line cuts it short', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: a, set: { action } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { action: 'x' } }]);
    const field = await lastChange(a, 'action');
    expect(changeText(field, field.before)).toBe(action);
    expect(changeValue(field, field.before)).toBe('INT. KITCHEN - she turns from the windo…');
    expect((await lines()).at(-1)).toBe('4A: action INT. KITCHEN - she turns from the windo… → x');
  });
});

describe('a scene’s and a note’s own history', () => {
  it('lists a scene’s own changes field by field, never its frames’, and puts back its name and time of day', async () => {
    const a = await frame();
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { name: 'Penn Station', int_ext: 'INT', day_night: 'DAY' } }]);
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { name: 'Dock', int_ext: 'EXT', day_night: 'NIGHT' } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    const scene = records().sc4;
    if (!scene) throw new Error('no scene');
    const ops = await itemOps(project.file, scene);
    expect(ops.every((op) => op.recordId === 'sc4')).toBe(true);
    const rows = frameRows(ops, 'sc4').map((r) => [r.change, r.field ? changeText(r.field, r.field.before) : null, r.field ? changeText(r.field, r.field.after) : null]);
    expect(rows.slice(0, 3)).toEqual([
      ['name', 'Penn Station', 'Dock'],
      ['INT/EXT', 'INT', 'EXT'],
      ['time of day', 'DAY', 'NIGHT'],
    ]);
    expect(await putBack('sc4', await lastChange('sc4', 'name'))).toBe(true);
    expect(await putBack('sc4', await lastChange('sc4', 'day_night'))).toBe(true);
    expect(records().sc4?.props).toMatchObject({ name: 'Penn Station', int_ext: 'EXT', day_night: 'DAY' });
    // The number the board keeps in step, and a location kept by id, go back only with Restore to here.
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    expect(putBackChange(records().sc4, await lastChange('sc4', 'number'))).toBeNull();
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc4', 'Dock') }));
    expect(putBackChange(records().sc4, await lastChange('sc4', 'location_id'))).toBeNull();
  });

  it('puts back a note’s old text, in full', async () => {
    const note = addNote(records(), 'sc4', null, 'Wait for the ferry horn,\nthen roll.');
    await store.getState().apply([note]);
    await store.getState().apply([{ kind: 'update', id: note.record.id, set: { text: 'Roll' } }]);
    const field = await lastChange(note.record.id, 'text');
    expect(changeText(field, field.before)).toBe('Wait for the ferry horn,\nthen roll.');
    expect(await putBack(note.record.id, field)).toBe(true);
    expect(records()[note.record.id]?.props.text).toBe('Wait for the ferry horn,\nthen roll.');
  });

  it('reads a scene’s length as a breakdown sheet does', async () => {
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { page_eighths: 11 } }]);
    const field = await lastChange('sc4', 'page_eighths');
    expect(changeText(field, field.after)).toBe('1 3/8 pg');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { apply, getRecord, history, loadRecords, log, redo, restoreTo, undo, type Change } from './ops';

let folder: TestFolder;
let project: Project;
const path = () => folder.path('Bey County.sbd');

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(path(), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

const scene = (id: string, number: string, sortKey = 'V'): Change => ({
  kind: 'create',
  record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number, heading: `INT. CABIN - NIGHT` } },
});
const shot = (id: string, parentId: string, props = {}): Change => ({
  kind: 'create',
  record: { id, type: 'shot', parentId, sortKey: 'V', props },
});

async function opKinds(): Promise<string[]> {
  const rows = await project.file.query('SELECT kind FROM ops ORDER BY seq');
  return rows.map((row) => String(row.kind));
}

/** The log as group kinds, each undo or redo with the position of the group it reverses or replays. */
async function groups(): Promise<string[]> {
  const all = await log(project.file);
  const position = (id: string | null) => all.findIndex((g) => g.id === id) + 1;
  return all.map((g) => (g.targetGroupId ? `${g.kind}:${String(position(g.targetGroupId))}` : g.kind));
}

/** Every op row, exactly as stored: what append-only means is that this list only ever grows. */
async function opRows(): Promise<string[]> {
  return (await project.file.query('SELECT * FROM ops ORDER BY seq')).map((row) => JSON.stringify(row));
}

const number = async (id: string) => (await getRecord(project.file, id))?.props.number;

describe('operations', () => {
  it('creates, edits and moves records, one op per change', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { size: 'MS', lens_mm: 35 })]);
    await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50 }, unset: ['size'] }]);
    await apply(project.file, [scene('sc5', '5', 'k'), { kind: 'move', id: '4A', parentId: 'sc5', sortKey: 'V' }]);

    const record = await getRecord(project.file, '4A');
    expect(record?.props).toEqual({ lens_mm: 50 });
    expect(record?.parentId).toBe('sc5');
    expect(await opKinds()).toEqual(['create', 'create', 'update', 'create', 'move']);
    expect(await groups()).toEqual(['edit', 'edit', 'edit']);
  });

  it('keeps every prop when a record changes type', async () => {
    await apply(project.file, [
      { kind: 'create', record: { id: 'ref', type: 'media', parentId: project.projectId, sortKey: 'V', props: { file: 'still_12.jpg', note: 'window light', drone: true } } },
    ]);
    await apply(project.file, [{ kind: 'retype', id: 'ref', type: 'shot' }]);
    const record = await getRecord(project.file, 'ref');
    expect(record?.type).toBe('shot');
    expect(record?.props).toEqual({ file: 'still_12.jpg', note: 'window light', drone: true });
  });

  it('undoes and redoes a whole group at a time', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4'), shot('4B', 'sc4'), { kind: 'update', id: 'sc4', set: { number: '4X' } }]);

    const undone = await undo(project.file);
    expect([...(undone?.keys() ?? [])].sort()).toEqual(['4A', '4B', 'sc4']);
    expect(await getRecord(project.file, '4A')).toBeNull();
    expect((await getRecord(project.file, 'sc4'))?.props.number).toBe('4');
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: true });

    await redo(project.file);
    expect((await getRecord(project.file, 'sc4'))?.props.number).toBe('4X');
    expect(await getRecord(project.file, '4B')).not.toBeNull();
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: false });
  });

  it('brings a record back to exactly how it was, even after several edits in one group', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    const before = await getRecord(project.file, 'sc4');
    await apply(project.file, [
      { kind: 'update', id: 'sc4', set: { number: '5' } },
      { kind: 'update', id: 'sc4', set: { heading: 'EXT. DOCK - DAY' } },
      { kind: 'move', id: 'sc4', parentId: project.projectId, sortKey: 'k' },
    ]);
    await undo(project.file);
    expect(await getRecord(project.file, 'sc4')).toEqual(before);
  });

  it('ends the redo stack when a new edit follows an undo, but keeps the undone work in the log', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    await undo(project.file);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '6' } }]);

    expect(await redo(project.file)).toBeNull();
    expect(await number('sc4')).toBe('6');
    expect(await groups()).toEqual(['edit', 'edit', 'undo:2', 'edit']);
    expect(await opKinds()).toEqual(['create', 'update', 'update', 'update']);
  });

  it('moves to the Trash and back, and undo reverses either', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'trash', id: 'sc4' }], { author: 'local', now: () => new Date('2026-11-02T14:05:00Z') });
    const trashed = await getRecord(project.file, 'sc4');
    expect(trashed?.trashedAt).toBe('2026-11-02T14:05:00.000Z');
    expect(trashed?.trashedBy).toBe('local');

    await undo(project.file);
    expect((await getRecord(project.file, 'sc4'))?.trashedAt).toBeNull();
    await redo(project.file);
    await apply(project.file, [{ kind: 'restore', id: 'sc4' }]);
    expect((await getRecord(project.file, 'sc4'))?.trashedAt).toBeNull();
    await undo(project.file);
    expect((await getRecord(project.file, 'sc4'))?.trashedAt).not.toBeNull();
  });

  it('never trashes the project itself: a project is archived instead', async () => {
    await expect(apply(project.file, [{ kind: 'trash', id: project.projectId }])).rejects.toThrow('archived');
  });

  it('writes nothing when any change in a group fails', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await expect(
      apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '9' } }, { kind: 'update', id: 'gone', set: {} }]),
    ).rejects.toThrow('no longer exists');
    expect((await getRecord(project.file, 'sc4'))?.props.number).toBe('4');
    expect(await opKinds()).toEqual(['create']);
    expect(await groups()).toEqual(['edit']);
  });

  it('undoes and redoes across a restart: the log is on disk', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '4B' } }]);
    await undo(project.file);
    await project.close();

    project = await openProject(path(), { driver: nodeDriver, backups: false });
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: true });
    await redo(project.file);
    expect(await number('sc4')).toBe('4B');
    await undo(project.file);
    await undo(project.file);
    expect(await getRecord(project.file, 'sc4')).toBeNull();
  });

  it('can undo everything back to the empty project, but never past it', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await undo(project.file);
    expect(await undo(project.file)).toBeNull();
    expect((await loadRecords(project.file)).map((r) => r.type)).toEqual(['project']);
  });
});

describe('an append-only history', () => {
  it('records every undo and redo as its own group, linked to the group it reverses or replays', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    await undo(project.file, { author: 'kevin', now: () => new Date('2026-11-02T15:00:00Z') });
    await undo(project.file);
    await redo(project.file);
    await redo(project.file);

    expect(await groups()).toEqual(['edit', 'edit', 'undo:2', 'undo:1', 'redo:1', 'redo:2']);
    const undoGroup = (await log(project.file))[2];
    expect(undoGroup).toMatchObject({ kind: 'undo', author: 'kevin', timestamp: '2026-11-02T15:00:00.000Z', opCount: 1 });
    // The undo's own op swaps the edit's before and after.
    const [op] = await project.file.query('SELECT before, after FROM ops WHERE group_id = ?', [undoGroup?.id ?? '']);
    const numberIn = (json: unknown) => (JSON.parse(String(json)) as { props: { number: string } }).props.number;
    expect(numberIn(op?.before)).toBe('5');
    expect(numberIn(op?.after)).toBe('4');
    expect(await number('sc4')).toBe('5');
  });

  it('never changes or deletes a row already in the log', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    let seen = await opRows();
    const steps = [
      () => undo(project.file),
      () => redo(project.file),
      () => undo(project.file),
      () => apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '6' } }]),
      () => restoreTo(project.file, null),
      () => undo(project.file),
    ];
    for (const step of steps) {
      await step();
      const now = await opRows();
      expect(now.slice(0, seen.length)).toEqual(seen);
      expect(now.length).toBeGreaterThan(seen.length);
      seen = now;
    }
  });

  it('restores work that was undone and then edited over', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4', { size: 'CU', lens_mm: 85 }), { kind: 'update', id: 'sc4', set: { number: '4X' } }]);
    await undo(project.file);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { heading: 'EXT. DOCK - DAY' } }]);
    expect(await redo(project.file)).toBeNull();

    // The shot group is the second in the log; restoring to right after it brings the shot back.
    const shotGroup = (await log(project.file))[1];
    const touched = await restoreTo(project.file, shotGroup?.id ?? null);
    expect([...(touched?.keys() ?? [])].sort()).toEqual(['4A', 'sc4']);
    expect((await getRecord(project.file, '4A'))?.props).toEqual({ size: 'CU', lens_mm: 85 });
    expect((await getRecord(project.file, 'sc4'))?.props).toEqual({ number: '4X', heading: 'INT. CABIN - NIGHT' });
    expect((await groups()).at(-1)).toBe('restore');
    expect((await log(project.file)).at(-1)?.restoreTo).toBe(shotGroup?.id);
    expect(await opKinds()).toEqual(['create', 'create', 'update', 'update', 'create', 'update', 'revert', 'revert']);
  });

  it('undoes a restore like any edit, and redoes it', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    const first = (await log(project.file))[0];
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }, shot('5A', 'sc4')]);
    await restoreTo(project.file, first?.id ?? null);
    expect(await number('sc4')).toBe('4');
    expect(await getRecord(project.file, '5A')).toBeNull();

    await undo(project.file);
    expect(await number('sc4')).toBe('5');
    expect(await getRecord(project.file, '5A')).not.toBeNull();
    await redo(project.file);
    expect(await number('sc4')).toBe('4');
    expect(await groups()).toEqual(['edit', 'edit', 'restore', 'undo:3', 'redo:3']);
  });

  it('restores to the project as created, which never removes the project record', async () => {
    await apply(project.file, [{ kind: 'update', id: project.projectId, set: { title: 'Bey County: Pilot' } }]);
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4')]);
    await restoreTo(project.file, null);
    const records = await loadRecords(project.file);
    expect(records.map((r) => r.type)).toEqual(['project']);
    expect(records[0]?.props.title).toBe('Bey County');
  });

  it('restores to a point that itself was an undo, and does nothing when already there', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    await undo(project.file);
    const undoPoint = (await log(project.file))[2];
    await redo(project.file);
    expect(await number('sc4')).toBe('5');

    await restoreTo(project.file, undoPoint?.id ?? null);
    expect(await number('sc4')).toBe('4');
    expect(await restoreTo(project.file, undoPoint?.id ?? null)).toBeNull();
    await expect(restoreTo(project.file, 'not-a-group')).rejects.toThrow('history');
  });

  it('ends the redo stack with a restore, as with any edit', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    await undo(project.file);
    await restoreTo(project.file, null);
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: false });
  });
});

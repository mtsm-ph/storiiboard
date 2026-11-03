import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { apply, getRecord, history, loadRecords, redo, undo, type Change } from './ops';

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

async function opStates(): Promise<string[]> {
  const rows = await project.file.query('SELECT kind, state FROM ops ORDER BY seq');
  return rows.map((row) => `${String(row.kind)}:${String(row.state)}`);
}

describe('operations', () => {
  it('creates, edits and moves records, one op per change', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { size: 'MS', lens_mm: 35 })]);
    await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50 }, unset: ['size'] }]);
    await apply(project.file, [scene('sc5', '5', 'k'), { kind: 'move', id: '4A', parentId: 'sc5', sortKey: 'V' }]);

    const record = await getRecord(project.file, '4A');
    expect(record?.props).toEqual({ lens_mm: 50 });
    expect(record?.parentId).toBe('sc5');
    expect(await opStates()).toEqual([
      'create:applied',
      'create:applied',
      'update:applied',
      'create:applied',
      'move:applied',
    ]);
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

  it('drops the redo tail when a new edit follows an undo', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '5' } }]);
    await undo(project.file);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '6' } }]);

    expect(await redo(project.file)).toBeNull();
    expect(await opStates()).toEqual(['create:applied', 'update:discarded', 'update:applied']);
    expect((await getRecord(project.file, 'sc4'))?.props.number).toBe('6');
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
    expect(await opStates()).toEqual(['create:applied']);
  });

  it('undoes across a restart: the log and the cursor are on disk', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { number: '4B' } }]);
    await project.close();

    project = await openProject(path(), { driver: nodeDriver, backups: false });
    await undo(project.file);
    expect((await getRecord(project.file, 'sc4'))?.props.number).toBe('4');
    const [cursor] = await project.file.query("SELECT value FROM meta WHERE key = 'undo_cursor'");
    expect(cursor?.value).toBe('1');
  });

  it('can undo everything back to the empty project, but never past it', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await undo(project.file);
    expect(await undo(project.file)).toBeNull();
    expect((await loadRecords(project.file)).map((r) => r.type)).toEqual(['project']);
  });
});

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore, projectStore as appStore } from '../../app/projectStore';
import { pressSave } from '../../app/shell/saveShortcut';
import { settledThrough, settleUndone } from '../../app/undoSettle';
import { apply, bringBack, getRecord, history, log, redo, restoreTo, undo, undoRun, type Change, type OpGroup } from '../../core/ops/ops';
import { createMemoryDriver } from '../../core/storage/memoryDriver';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { setLocale } from '../../core/i18n';
import { broughtBackNotice, itemOps, loadSteps } from './steps';
import { describeGroup, frameRows, lineText } from './summary';
import { NO_UNDONE, shownRun, undoneFacts } from './undone';

// Undoing from History (item 7, Kevin, Nov 18 and 20): the run of undos, the bring_back step that takes one back, the
// outline and its settling, and the "Before restoring" mark, all read from the log.

let folder: TestFolder;
let project: Project;
const path = () => folder.path('Bey County.sbd');

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(path(), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  setLocale('en');
  await project.close().catch(() => undefined);
  folder.remove();
});

const scene = (id: string, number: string): Change => ({
  kind: 'create',
  record: { id, type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number, heading: 'INT. DINER - NIGHT' } },
});
const shot = (id: string, parentId: string, props = {}, sortKey = 'V'): Change => ({ kind: 'create', record: { id, type: 'shot', parentId, sortKey, props } });
const lens = (id: string, mm: number): Change => ({ kind: 'update', id, set: { lens_mm: mm } });
const kinds = async () => (await log(project.file)).map((g) => g.kind);
const lines = async () => (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line));
const group = (id: string, kind: OpGroup['kind'], targetGroupId: string | null = null): OpGroup => ({
  id,
  seq: 0,
  kind,
  targetGroupId,
  restoreTo: null,
  author: 'local',
  timestamp: '',
  opCount: 0,
});

describe('a run of undos', () => {
  it('is five undos in a row; an edit between ends it; a restore is a run of its own', () => {
    const groups = [group('e1', 'edit'), ...['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => group(id, 'undo')), group('e2', 'edit'), group('u6', 'undo')];
    expect(undoRun(groups, 5)?.map((g) => g.id)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    // Not the newest undo of its run.
    expect(undoRun(groups, 3)).toBeNull();
    // The edit ends the first run: the undo after it is a run of one.
    expect(undoRun(groups, 7)?.map((g) => g.id)).toEqual(['u6']);
    expect(undoRun(groups, 0)).toBeNull();
    const restored = [group('e1', 'edit'), group('u1', 'undo'), group('r1', 'restore'), group('u2', 'undo')];
    expect(undoRun(restored, 2)?.map((g) => g.id)).toEqual(['r1']);
    // An undo of the restore starts a run of its own: the restore isn't part of it.
    expect(undoRun(restored, 3)?.map((g) => g.id)).toEqual(['u2']);
  });

  it('is what History outlines: the steps the run undid, until three further steps', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    for (const id of ['4A', '4B', '4C']) await apply(project.file, [shot(id, 'sc4')]);
    for (let i = 0; i < 3; i += 1) await undo(project.file);
    const groups = await log(project.file);
    const facts = undoneFacts(groups);
    expect(facts.run?.target).toBe(groups.at(-1)?.id);
    expect([...(facts.run?.undone ?? [])].sort()).toEqual(groups.slice(1, 4).map((g) => g.id).sort());
    expect(shownRun(facts, 0)).not.toBeNull();
    for (let i = 0; i < 2; i += 1) await apply(project.file, [scene(`sc${String(i + 5)}`, String(i + 5))]);
    expect(shownRun(undoneFacts(await log(project.file)), 0)).not.toBeNull();
    await apply(project.file, [scene('sc7', '7')]);
    expect(shownRun(undoneFacts(await log(project.file)), 0)).toBeNull();
    expect(shownRun(NO_UNDONE, 0)).toBeNull();
  });
});

describe('a bring_back step', () => {
  it('takes back a whole run as one group, and History reads “Brought back: …”', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    for (const id of ['4A', '4B', '4C']) await apply(project.file, [shot(id, 'sc4', { number: id })]);
    for (let i = 0; i < 3; i += 1) await undo(project.file);
    expect(await getRecord(project.file, '4A')).toBeNull();
    const target = (await log(project.file)).at(-1)?.id ?? '';
    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(3);
    expect(done?.kept).toEqual([]);
    for (const id of ['4A', '4B', '4C']) expect((await getRecord(project.file, id))?.props.number).toBe(id);
    expect(await kinds()).toEqual(['edit', 'edit', 'edit', 'edit', 'undo', 'undo', 'undo', 'bring_back']);
    const [newest] = await log(project.file).then((g) => g.slice(-1));
    expect(newest?.targetGroupId).toBe(target);
    // Named by the step its newest undo undid: the run's first, frame 4A.
    expect((await lines())[0]).toBe('Brought back: Added frame 4A');
    expect(broughtBackNotice(done ?? { written: 0, kept: [] })).toBe('Brought back 3 changes.');
    // Brought back once: no second time.
    expect(await bringBack(project.file, target)).toBeNull();
  });

  it('keeps a field a later step changed, and names it', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35, size: 'WS' })]);
    await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50, size: 'MS' } }]);
    await undo(project.file);
    const target = (await log(project.file)).at(-1)?.id ?? '';
    // The lens is changed again after the undo: that later edit stays; the size comes back.
    await apply(project.file, [lens('4A', 85)]);
    const done = await bringBack(project.file, target);
    expect(done?.written).toBe(1);
    const record = await getRecord(project.file, '4A');
    expect(record?.props.lens_mm).toBe(85);
    expect(record?.props.size).toBe('MS');
    expect(done?.kept.map((k) => [k.record.id, k.prop])).toEqual([['4A', 'lens_mm']]);
    expect(broughtBackNotice(done ?? { written: 0, kept: [] })).toBe('Brought back 1 change. 4A’s lens kept its later edit.');
    setLocale('es');
    expect(broughtBackNotice(done ?? { written: 0, kept: [] })).toBe('Se recuperó 1 cambio. En 4A, la lente conservó su cambio posterior.');
  });

  it('sends a trashed item back to the Trash, as the undone step had it', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A' })]);
    await apply(project.file, [{ kind: 'trash', id: '4A' }]);
    const trashedAt = (await getRecord(project.file, '4A'))?.trashedAt;
    await undo(project.file);
    expect((await getRecord(project.file, '4A'))?.trashedAt).toBeNull();
    await bringBack(project.file, (await log(project.file)).at(-1)?.id ?? '');
    expect((await getRecord(project.file, '4A'))?.trashedAt).toBe(trashedAt);
    const ops = await project.file.query("SELECT o.kind FROM ops o JOIN op_groups g ON g.id = o.group_id WHERE g.kind = 'bring_back'");
    expect(ops.map((o) => o.kind)).toEqual(['trash']);
  });

  it('makes a created item again, and leaves out one whose scene is gone', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4', { number: '4A' })]);
    await undo(project.file);
    await bringBack(project.file, (await log(project.file)).at(-1)?.id ?? '');
    expect((await getRecord(project.file, '4A'))?.props.number).toBe('4A');
    const ops = await project.file.query("SELECT o.kind FROM ops o JOIN op_groups g ON g.id = o.group_id WHERE g.kind = 'bring_back'");
    expect(ops.map((o) => o.kind)).toEqual(['create']);

    // A frame and its scene undone in two runs; only the frame's run is brought back once the scene is gone again.
    await apply(project.file, [scene('sc5', '5')]);
    await apply(project.file, [shot('5A', 'sc5', { number: '5A' })]);
    await undo(project.file);
    const frameRun = (await log(project.file)).at(-1)?.id ?? '';
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { heading: 'EXT. PIER - DAY' } }]);
    await undo(project.file);
    await undo(project.file);
    expect(await getRecord(project.file, 'sc5')).toBeNull();
    const done = await bringBack(project.file, frameRun);
    expect(done?.written).toBe(0);
    expect(done?.kept.map((k) => [k.record.id, k.prop])).toEqual([['5A', null]]);
    expect(await getRecord(project.file, '5A')).toBeNull();
    expect(broughtBackNotice(done ?? { written: 0, kept: [] })).toBe(
      'Nothing to bring back: everything there is already back, or was changed again since. 5A couldn’t come back: its scene is gone.',
    );
  });

  it('is an edit on the stacks: ⌘Z undoes it, ⌘⇧Z’s stack empties', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35 })]);
    await apply(project.file, [lens('4A', 50)]);
    await apply(project.file, [lens('4A', 85)]);
    await undo(project.file);
    await undo(project.file);
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: true });
    const before = (await project.file.query('SELECT undo_top FROM op_groups ORDER BY seq DESC LIMIT 1'))[0]?.undo_top;
    await bringBack(project.file, (await log(project.file)).at(-1)?.id ?? '');
    const [row] = await project.file.query('SELECT id, stack_below, undo_top, redo_top FROM op_groups ORDER BY seq DESC LIMIT 1');
    expect(row?.stack_below).toBe(before);
    expect(row?.undo_top).toBe(row?.id);
    expect(row?.redo_top).toBeNull();
    expect((await getRecord(project.file, '4A'))?.props.lens_mm).toBe(85);
    expect(await history(project.file)).toEqual({ canUndo: true, canRedo: false });
    // ⌘Z takes the bring_back back as one step; ⌘⇧Z then brings it again.
    await undo(project.file);
    expect((await getRecord(project.file, '4A'))?.props.lens_mm).toBe(35);
    expect((await lines())[0]).toBe('Undid: Brought back: 4A: lens 35mm → 50mm');
    await redo(project.file);
    expect((await getRecord(project.file, '4A'))?.props.lens_mm).toBe(85);
  });

  it('takes back a restore, keeping the steps made after it; the mark stays', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4', { number: '4A' })]);
    await apply(project.file, [shot('4B', 'sc4', { number: '4B' }, 'W')]);
    const groups = await log(project.file);
    const point = groups[0]?.id ?? null;
    const before = groups.at(-1)?.id;
    await restoreTo(project.file, point);
    expect(await getRecord(project.file, '4A')).toBeNull();
    const restore = (await log(project.file)).at(-1);
    expect(undoneFacts(await log(project.file)).marks.get(before ?? '')).toBe(restore?.id);
    await apply(project.file, [{ kind: 'update', id: 'sc4', set: { heading: 'EXT. PIER - DAY' } }]);
    const done = await bringBack(project.file, restore?.id ?? '');
    expect(done?.written).toBe(2);
    expect((await getRecord(project.file, '4B'))?.props.number).toBe('4B');
    expect((await getRecord(project.file, 'sc4'))?.props.heading).toBe('EXT. PIER - DAY');
    // Named by the step current just before the restore.
    expect((await lines())[0]).toBe('Brought back: Added frame 4B');
    const facts = undoneFacts(await log(project.file));
    expect(facts.marks.get(before ?? '')).toBe(restore?.id);
    expect(shownRun(facts, 0)).toBeNull();
  });
});

describe('History’s words', () => {
  it('reads “a step” for a kind this version doesn’t know, and undo still works on it', async () => {
    const later = { ...group('x', 'edit'), kind: 'merge_from_web' as unknown as OpGroup['kind'] };
    expect(describeGroup(later, [], new Map(), new Set())).toEqual(['a step']);
    // A group of an unknown kind, written by hand as a later version would: undo reads only its ops and the stacks.
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [lens('sc4', 1)]);
    await project.file.tx([{ sql: "UPDATE op_groups SET kind = 'merge_from_web' WHERE seq = (SELECT max(seq) FROM op_groups)" }]);
    expect((await lines())[0]).toBe('a step');
    await undo(project.file);
    expect((await getRecord(project.file, 'sc4'))?.props.lens_mm).toBeUndefined();
  });

  it('says a field came back in an item’s own history', async () => {
    await apply(project.file, [scene('sc4', '4'), shot('4A', 'sc4', { number: '4A', lens_mm: 35 })]);
    await apply(project.file, [lens('4A', 50)]);
    await undo(project.file);
    await bringBack(project.file, (await log(project.file)).at(-1)?.id ?? '');
    const frame = await getRecord(project.file, '4A');
    if (!frame) throw new Error('no frame');
    const rows = frameRows(await itemOps(project.file, frame), '4A');
    expect(rows[0]?.change).toBe('lens, brought back');
  });
});

describe('settling', () => {
  it('settles at open, at Ctrl+S, and at a project switch', async () => {
    const store = createProjectStore();
    await store.getState().open(project);
    await store.getState().apply([scene('sc4', '4')]);
    await store.getState().apply([shot('4A', 'sc4', { number: '4A' })]);
    await store.getState().undo();
    // Made after the open: it shows.
    expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).not.toBeNull();
    await settleUndone(project.file);
    expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).toBeNull();

    // A new run after the settle shows again; switching to another project and back settles it.
    await store.getState().undo();
    expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).not.toBeNull();
    const other = await createProject(folder.path('Pier.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(other);
    const again = await openProject(path(), { driver: nodeDriver, backups: false });
    await store.getState().open(again);
    expect(shownRun(undoneFacts(await log(again.file)), settledThrough(again.file))).toBeNull();
    await store.getState().close();
    project = again;
  });

  it('Ctrl+S settles the open project’s outline', async () => {
    vi.stubGlobal('document', { activeElement: null, body: null });
    try {
      await appStore.getState().open(project);
      await appStore.getState().apply([scene('sc4', '4')]);
      await appStore.getState().undo();
      expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).not.toBeNull();
      await pressSave();
      expect(shownRun(undoneFacts(await log(project.file)), settledThrough(project.file))).toBeNull();
    } finally {
      await appStore.getState().close();
      vi.unstubAllGlobals();
    }
  });

  it('the mark is read again after a reload; the outline isn’t', async () => {
    await apply(project.file, [scene('sc4', '4')]);
    await apply(project.file, [shot('4A', 'sc4', { number: '4A' })]);
    const before = (await log(project.file)).at(-1)?.id ?? '';
    await restoreTo(project.file, (await log(project.file))[0]?.id ?? null);
    await project.close();
    const store = createProjectStore();
    project = await openProject(path(), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    const facts = undoneFacts(await log(project.file));
    expect(facts.marks.has(before)).toBe(true);
    expect(facts.run?.restore).not.toBeNull();
    expect(shownRun(facts, settledThrough(project.file))).toBeNull();
    await store.getState().close();
  });
});

describe('a file holding a bring_back', () => {
  /** Two edits, undone, brought back: what the doors are asked to open. */
  async function withBringBack(file: Project['file'], root: string) {
    await apply(file, [{ kind: 'create', record: { id: 'sc4', type: 'scene', parentId: root, sortKey: 'V', props: { number: '4' } } }]);
    await apply(file, [{ kind: 'create', record: { id: '4A', type: 'shot', parentId: 'sc4', sortKey: 'V', props: { number: '4A' } } }]);
    await undo(file);
    await bringBack(file, (await log(file)).at(-1)?.id ?? '');
  }

  it('opens, lists and undoes through the node driver', async () => {
    await withBringBack(project.file, project.projectId);
    await project.close();
    project = await openProject(path(), { driver: nodeDriver, backups: false });
    expect((await log(project.file)).map((g) => g.kind)).toEqual(['edit', 'edit', 'undo', 'bring_back']);
    expect((await lines())[0]).toBe('Brought back: Added frame 4A');
    await undo(project.file);
    expect(await getRecord(project.file, '4A')).toBeNull();
  });

  it('opens, lists and undoes through the page’s driver', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
    const created = await createProject('/memory/Pier.sbd', { driver: await createMemoryDriver({ wasm, storage }), backups: false });
    await withBringBack(created.file, created.projectId);
    await created.close();
    const reopened = await openProject('/memory/Pier.sbd', { driver: await createMemoryDriver({ wasm, storage }), backups: false });
    try {
      expect((await log(reopened.file)).map((g) => g.kind)).toEqual(['edit', 'edit', 'undo', 'bring_back']);
      expect(lineText((await loadSteps(reopened.file, 10)).steps[0]?.line ?? [])).toBe('Brought back: Added frame 4A');
      await undo(reopened.file);
      expect(await getRecord(reopened.file, '4A')).toBeNull();
    } finally {
      await reopened.close();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { dayDateLabel } from '../../core/model/shootDay';
import type { Props, SbdRecord } from '../../core/model/record';
import { log, opsOfRecord, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, moveItem } from '../storyboard/board';
import { loadSteps } from './steps';
import { describeEdit, frameRows, lineText } from './summary';

// History's lines name what changed and where (Kevin, Nov 18): a move by the place it went, several records changed
// together by the kind of change and the scene, a scene scheduled at once as the scene, an undo or a restore by its
// target's own line however old, and a field's change by the item's name in the main feed only. English and Spanish.

const at = '2026-11-18T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, sortKey: string, props: Props = {}): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
let seq = 0;
const op = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null, recordId = (after ?? before)?.id ?? ''): LoggedOp => {
  seq += 1;
  return { id: `o${String(seq)}`, seq, groupId: 'g', groupKind: 'edit', recordId, kind, before, after, author: 'local', timestamp: at };
};
const moved = (r: SbdRecord, parentId: string, sortKey: string) => op('move', r, { ...r, parentId, sortKey });
const changed = (r: SbdRecord, props: Props) => op('update', r, { ...r, props: { ...r.props, ...props } });

const project = record('p', 'project', null, 'a');
const sc3 = record('sc3', 'scene', 'p', 'c', { number: '3' });
const sc4 = record('sc4', 'scene', 'p', 'd', { number: '4' });
const sc12 = record('sc12', 'scene', 'p', 'm', { number: '12', name: 'INT. DINER' });
const shot = (id: string, parentId: string, sortKey: string, number: string, props: Props = {}) => record(id, 'shot', parentId, sortKey, { number, ...props });
const a3 = shot('a3', 'sc3', 'a', '3A');
const b3 = shot('b3', 'sc3', 'b', '3B');
const c3 = shot('c3', 'sc3', 'c', '3C');
const a4 = shot('a4', 'sc4', 'a', '4A');
const b4 = shot('b4', 'sc4', 'b', '4B');
const c4 = shot('c4', 'sc4', 'c', '4C');
const note = record('n4', 'note', 'sc4', 'bm', { text: 'Rain on the glass' });
const near = (...records: SbdRecord[]) => new Map(records.map((r) => [r.id, r]));
const board = near(project, sc3, sc4, sc12, a3, b3, c3, a4, b4, c4, note);
const none = new Set<string>();
const say = (ops: LoggedOp[], around: ReadonlyMap<string, SbdRecord> = board) => lineText(describeEdit(ops, none, around));

afterEach(() => {
  setLocale('en');
});

describe('a move names where it went', () => {
  it('one frame after another in its scene, by their numbers when it was dragged', () => {
    expect(say([moved(a4, 'sc4', 'cm')])).toBe('Moved 4A to after 4C');
    setLocale('es');
    expect(say([moved(a4, 'sc4', 'cm')])).toBe('Se movió 4A después de 4C');
  });

  it('one frame into another scene, after the frame before its new place', () => {
    expect(say([moved(a4, 'sc3', 'cm')])).toBe('Moved 4A to after 3C');
    setLocale('es');
    expect(say([moved(a4, 'sc3', 'cm')])).toBe('Se movió 4A después de 3C');
  });

  it('to the start of a scene', () => {
    expect(say([moved(c4, 'sc4', '0')])).toBe('Moved 4C to the start of SC 04');
    expect(say([moved(c4, 'sc12', 'a')])).toBe('Moved 4C to the start of SC 12');
    setLocale('es');
    expect(say([moved(c4, 'sc12', 'a')])).toBe('Se movió 4C al principio de ESC 12');
  });

  it('into a scene, when the frame before it has no number', () => {
    const blank = shot('x', 'sc12', 'a', '');
    expect(say([moved(c4, 'sc12', 'b')], near(sc12, blank, c4))).toBe('Moved 4C to SC 12');
    setLocale('es');
    expect(say([moved(c4, 'sc12', 'b')], near(sc12, blank, c4))).toBe('Se movió 4C a ESC 12');
  });

  it('a note, after the frame before it; a note in the way is passed over, never named', () => {
    expect(say([moved(note, 'sc4', 'cm')])).toBe('Moved a note to after 4C');
    expect(say([moved(c4, 'sc4', 'bz')])).toBe('Moved 4C to after 4B');
    setLocale('es');
    expect(say([moved(note, 'sc4', 'cm')])).toBe('Se movió una nota después de 4C');
  });

  it('several together, by what they are: frames, scenes, or items when mixed', () => {
    expect(say([moved(a4, 'sc3', 'cm'), moved(b4, 'sc3', 'cn'), moved(c4, 'sc3', 'co')])).toBe('Moved 3 frames to after 3C');
    expect(say([moved(a4, 'sc3', 'cm'), moved(note, 'sc3', 'cn')])).toBe('Moved 2 items to after 3C');
    expect(say([moved(sc3, 'p', 'n'), moved(sc12, 'p', 'o')])).toBe('Moved 2 scenes to after SC 04');
    expect(say([moved(sc4, 'p', '0'), moved(sc12, 'p', '1')])).toBe('Moved 2 scenes to the start of the project');
    setLocale('es');
    expect(say([moved(a4, 'sc3', 'cm'), moved(b4, 'sc3', 'cn'), moved(c4, 'sc3', 'co')])).toBe('Se movieron 3 cuadros después de 3C');
    expect(say([moved(a4, 'sc3', 'cm'), moved(note, 'sc3', 'cn')])).toBe('Se movieron 2 elementos después de 3C');
    expect(say([moved(sc3, 'p', 'n'), moved(sc12, 'p', 'o')])).toBe('Se movieron 2 escenas después de ESC 04');
  });

  it('says what moved when where it went isn’t known, and a record deleted for good keeps its words', () => {
    expect(say([moved(a4, 'sc3', 'cm')], new Map())).toBe('Moved 4A');
    expect(say([moved(a4, 'sc3', 'cm'), moved(b4, 'sc3', 'cn')], new Map())).toBe('Moved 2 frames');
    expect(say([op('move', null, null, 'gone')])).toBe('Moved an item, since deleted for good');
    setLocale('es');
    expect(say([moved(a4, 'sc3', 'cm')], new Map())).toBe('Se movió 4A');
    expect(say([op('move', null, null, 'gone')])).toBe('Se movió un elemento, borrado para siempre después');
  });

  it('stays one short line with a long scene heading: the scene by its number, as every line names it', () => {
    const long = record('sc12', 'scene', 'p', 'm', { number: '12', name: `INT. ${'VERY LONG DINER '.repeat(20)}- NIGHT` });
    const said = say([moved(c4, 'sc12', 'a')], near(long, c4));
    expect(said).toBe('Moved 4C to the start of SC 12');
    expect(said.length).toBeLessThan(48);
    setLocale('es');
    expect(say([moved(c4, 'sc12', 'a')], near(long, c4))).toBe('Se movió 4C al principio de ESC 12');
  });
});

describe('several records changed in one step', () => {
  const sc12shot = (id: string, sortKey: string, number: string, props: Props = {}) => shot(id, 'sc12', sortKey, number, props);
  const s1 = sc12shot('s1', 'a', '12A', { lens_mm: 35 });
  const s2 = sc12shot('s2', 'b', '12B', { lens_mm: 35 });
  const s3 = sc12shot('s3', 'c', '12C', { lens_mm: 35 });
  const here = near(sc12, s1, s2, s3, a4);

  it('a renumber of a scene’s shots, with or without the scene’s own number', () => {
    expect(say([changed(s2, { number: '12C' }), changed(s3, { number: '12B' })], here)).toBe('Renumbered SC 12’s shots');
    const was = { ...sc12, props: { ...sc12.props, number: '4' } };
    expect(say([op('update', was, sc12), changed(s1, { number: '12A' }), changed(s2, { number: '12B' })], here)).toBe('Renumbered SC 04 to SC 12 and its shots');
    setLocale('es');
    expect(say([changed(s2, { number: '12C' }), changed(s3, { number: '12B' })], here)).toBe('Se renumeraron los planos de ESC 12');
    expect(say([op('update', was, sc12), changed(s1, { number: '12A' }), changed(s2, { number: '12B' })], here)).toBe('Se renumeró ESC 04 a ESC 12 con sus planos');
  });

  it('a lock or unlock of a scene’s shot numbers that renumbered frames', () => {
    const locked = { ...sc12, props: { ...sc12.props, numbers_locked: true } };
    expect(say([op('update', sc12, locked), changed(s3, { number: '12E' })], here)).toBe('Locked SC 12’s shot numbers');
    expect(say([op('update', locked, sc12), changed(s3, { number: '12C' })], here)).toBe('Unlocked SC 12’s shot numbers');
    setLocale('es');
    expect(say([op('update', sc12, locked), changed(s3, { number: '12E' })], here)).toBe('Se bloquearon los números de plano de ESC 12');
    expect(say([op('update', locked, sc12), changed(s3, { number: '12C' })], here)).toBe('Se desbloquearon los números de plano de ESC 12');
  });

  it('one field of several frames, in their scene when they share one', () => {
    const lens = [changed(s1, { lens_mm: 50 }), changed(s2, { lens_mm: 50 }), changed(s3, { lens_mm: 85 })];
    expect(say(lens, here)).toBe('Changed the lens of 3 frames in SC 12');
    expect(say([changed(s1, { lens_mm: 50 }), changed(a4, { lens_mm: 50 })], here)).toBe('Changed the lens of 2 frames');
    setLocale('es');
    expect(say(lens, here)).toBe('Se cambió lente en 3 cuadros de ESC 12');
    expect(say([changed(s1, { lens_mm: 50 }), changed(a4, { lens_mm: 50 })], here)).toBe('Se cambió lente en 2 cuadros');
  });

  it('otherwise counted, in their scene when they share one', () => {
    const mixed = [changed(s1, { lens_mm: 50 }), changed(s2, { size: 'CU' })];
    expect(say(mixed, here)).toBe('Changed 2 items in SC 12');
    expect(say([changed(s1, { lens_mm: 50 }), changed(a4, { size: 'CU' })], here)).toBe('Changed 2 items');
    setLocale('es');
    expect(say(mixed, here)).toBe('Se cambiaron 2 elementos de ESC 12');
    expect(say([changed(s1, { lens_mm: 50 }), changed(a4, { size: 'CU' })], here)).toBe('Cambiado: 2 elementos');
  });
});

describe('the last fallback', () => {
  const retyped = (r: SbdRecord, type: SbdRecord['type']) => op('retype', r, { ...r, type });
  const n2 = record('n2', 'note', 'sc12', 'b');
  const n3 = record('n3', 'note', 'sc12', 'c');
  const here = near(sc12, n2, n3);

  it('names what kind of record and the scene, as far as the step can say', () => {
    expect(say([retyped(n2, 'note'), retyped(n3, 'note')], here)).toBe('2 changes to 2 notes in SC 12');
    const l1 = record('l1', 'location', 'p', 'a', { name: 'Diner' });
    const l2 = record('l2', 'location', 'p', 'b', { name: 'Dock' });
    expect(say([retyped(l1, 'location'), retyped(l2, 'location')], here)).toBe('2 changes to 2 locations');
    const s = shot('s', 'sc12', 'd', '12A');
    expect(say([retyped(n2, 'note'), retyped(s, 'shot')], near(sc12, n2, s))).toBe('2 changes in SC 12');
    const d = record('d', 'department', 'p', 'a');
    expect(say([retyped(l1, 'location'), retyped(d, 'department')], here)).toBe('2 changes');
    setLocale('es');
    expect(say([retyped(n2, 'note'), retyped(n3, 'note')], here)).toBe('2 cambios en 2 notas de ESC 12');
    expect(say([retyped(l1, 'location'), retyped(l2, 'location')], here)).toBe('2 cambios en 2 locaciones');
    expect(say([retyped(n2, 'note'), retyped(s, 'shot')], near(sc12, n2, s))).toBe('2 cambios en ESC 12');
    expect(say([retyped(l1, 'location'), retyped(d, 'department')], here)).toBe('2 cambios');
  });
});

describe('a scene scheduled at once', () => {
  const day = record('day', 'shoot_day', 'p', 'a', { date: '2026-11-16' });
  const f1 = shot('f1', 'sc12', 'a', '12A');
  const f2 = shot('f2', 'sc12', 'b', '12B');
  const kept = shot('f3', 'sc12', 'c', '12C', { status: 'have' });
  const onDay = (r: SbdRecord) => ({ ...r, props: { ...r.props, shoot_day_id: 'day' } });
  const steps = [changed(f1, { shoot_day_id: 'day' }), changed(f2, { shoot_day_id: 'day' })];

  it('reads as the scene when it’s all of the scene’s frames still to shoot', () => {
    // As the step left them (steps.ts reads them so): its own frames on the day, a frame already shot off it.
    const after = near(day, sc12, onDay(f1), onDay(f2), kept);
    expect(say(steps, after)).toBe(`Moved SC 12 to shoot day ${dayDateLabel('2026-11-16')}`);
    setLocale('es');
    expect(say(steps, after)).toBe(`Se movió ESC 12 al día de rodaje ${dayDateLabel('2026-11-16')}`);
  });

  it('reads as the frames when part of the scene is left, or the scene’s frames aren’t known', () => {
    const left = shot('f4', 'sc12', 'd', '12D');
    expect(say(steps, near(day, sc12, onDay(f1), onDay(f2), left))).toBe(`Moved 2 frames to shoot day ${dayDateLabel('2026-11-16')}`);
    expect(say(steps, near(day, sc12))).toBe(`Moved 2 frames to shoot day ${dayDateLabel('2026-11-16')}`);
    setLocale('es');
    expect(say(steps, near(day, sc12, onDay(f1), onDay(f2), left))).toBe(`Se movieron 2 cuadros al día de rodaje ${dayDateLabel('2026-11-16')}`);
  });
});

describe('History as read from the file', () => {
  let folder: TestFolder;
  let file: Project;
  let store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    file = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    store = createProjectStore();
    await store.getState().open(file);
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc3', type: 'scene', parentId: file.projectId, sortKey: 'U', props: { number: '3' } } },
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: file.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });
  const frame = async (scene: string) => {
    const added = addShot(store.getState().records, file.projectId, scene);
    await store.getState().apply(added.changes);
    return added.shotId;
  };
  const move = async (id: string, scene: string, beforeId: string | null) => {
    await store.getState().applyWith((now) => ({ changes: moveItem(now, file.projectId, id, scene, beforeId) }));
  };
  const lines = async (count = Number.MAX_SAFE_INTEGER) => (await loadSteps(file.file, count)).steps.map((s) => lineText(s.line));
  const lastGroup = async (): Promise<OpGroup> => {
    const group = (await log(file.file)).at(-1);
    if (!group) throw new Error('no history');
    return group;
  };

  it('names the frame before a drag’s new place as it was then, though it moved away since', async () => {
    const [a, b, c] = [await frame('sc4'), await frame('sc4'), await frame('sc4')];
    await frame('sc3');
    await move(c, 'sc4', b);
    expect((await lines())[0]).toBe('Moved 4C to after 4A');
    // 4A goes to scene 3 later: the first drag still names it where it was.
    await move(a, 'sc3', null);
    expect(await lines(2)).toEqual(['Moved 4A to after 3A', 'Moved 4C to after 4A']);
    await store.getState().undo();
    expect((await lines(1))[0]).toBe('Undid: Moved 4A to after 3A');
    setLocale('es');
    expect(await lines(3)).toEqual(['Se deshizo: Se movió 4A después de 3A', 'Se movió 4A después de 3A', 'Se movió 4C después de 4A']);
  });

  it('names a scene put into a shoot day whole as the scene, read back from the file', async () => {
    const [a, b] = [await frame('sc4'), await frame('sc4')];
    await store.getState().apply([{ kind: 'create', record: { id: 'day', type: 'shoot_day', parentId: file.projectId, sortKey: 'W', props: { date: '2026-11-16' } } }]);
    await store.getState().apply([
      { kind: 'update', id: a, set: { shoot_day_id: 'day' } },
      { kind: 'update', id: b, set: { shoot_day_id: 'day' } },
    ]);
    expect((await lines())[0]).toBe(`Moved SC 04 to shoot day ${dayDateLabel('2026-11-16')}`);
    const c = await frame('sc4');
    await store.getState().apply([{ kind: 'update', id: c, set: { shoot_day_id: 'day', size: 'CU' } }]);
    await store.getState().apply([
      { kind: 'update', id: a, unset: ['shoot_day_id'] },
      { kind: 'update', id: b, unset: ['shoot_day_id'] },
    ]);
    await store.getState().apply([
      { kind: 'update', id: a, set: { shoot_day_id: 'day' } },
      { kind: 'update', id: b, set: { shoot_day_id: 'day' } },
    ]);
    // 4C was on the day already: the scene is whole again.
    expect((await lines())[0]).toBe(`Moved SC 04 to shoot day ${dayDateLabel('2026-11-16')}`);
    const d = await frame('sc4');
    expect(d).not.toBe('');
    await store.getState().apply([
      { kind: 'update', id: a, unset: ['shoot_day_id'] },
      { kind: 'update', id: b, unset: ['shoot_day_id'] },
    ]);
    await store.getState().apply([
      { kind: 'update', id: a, set: { shoot_day_id: 'day' } },
      { kind: 'update', id: b, set: { shoot_day_id: 'day' } },
    ]);
    // 4D is still to shoot and isn't on it: the frames, as before.
    expect((await lines())[0]).toBe(`Moved 2 frames to shoot day ${dayDateLabel('2026-11-16')}`);
  });

  it('an undo, a redo and a restore name their target’s own line though it’s older than the page', async () => {
    const a = await frame('sc4');
    const point = await lastGroup();
    for (let i = 0; i < 4; i += 1) await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 20 + i } }]);
    await store.getState().restoreTo(point.id);
    expect(await lines(1)).toEqual(['Restored the project to: Added frame 4A']);
    await store.getState().undo();
    expect(await lines(1)).toEqual(['Undid: Restored the project to: Added frame 4A']);
    await store.getState().redo();
    expect(await lines(1)).toEqual(['Redid: Restored the project to: Added frame 4A']);
    setLocale('es');
    expect(await lines(1)).toEqual(['Se rehízo: Se restauró el proyecto a: Se agregó el cuadro 4A']);
  });

  it('a field’s change has the item’s name first in the main feed, and not in the item’s own History', async () => {
    const a = await frame('sc4');
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 35 } }]);
    await store.getState().apply([{ kind: 'update', id: a, set: { lens_mm: 50 } }]);
    expect((await lines(1))[0]).toBe('4A: lens 35mm → 50mm');
    const own = frameRows(await opsOfRecord(file.file, a), a);
    expect(own[0]?.change).toBe('lens');
    expect(own[0]?.change).not.toContain('4A');
    setLocale('es');
    expect((await lines(1))[0]).toBe('4A: lente 35mm → 50mm');
    expect(frameRows(await opsOfRecord(file.file, a), a)[0]?.change).toBe('lente');
  });
});

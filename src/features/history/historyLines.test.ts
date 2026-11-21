import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { dayDateLabel } from '../../core/model/shootDay';
import type { Props, SbdRecord } from '../../core/model/record';
import { log, opsOfGroups, opsOfRecord, type Change, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, moveItem, trashShot } from '../storyboard/board';
import { reorderChanges } from '../moodboards/items';
import { movePageChanges } from '../moodboards/pages';
import { loadSteps, stepRecords } from './steps';
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

  it('neither counts nor places moves when one of them is deleted for good and not known to be the Trash’s', () => {
    const steps = [moved(a4, 'sc3', 'cm'), op('move', null, null, 'gone'), moved(b4, 'sc3', 'cn')];
    expect(say(steps)).toBe('Moved items, some since deleted for good');
    setLocale('es');
    expect(say(steps)).toBe('Se movieron elementos, algunos borrados para siempre después');
  });

  it('a scene to the start of the project, with the project’s own words in Spanish, its record known or not', () => {
    expect(say([moved(sc12, 'p', '0')])).toBe('Moved SC 12 to the start of the project');
    // A real file's project record isn't in the log (ensureProjectRecord): the place needs no record.
    expect(say([moved(sc12, 'p', '0')], near(sc3, sc4, sc12))).toBe('Moved SC 12 to the start of the project');
    expect(say([moved(sc3, 'p', 'n')], near(sc3, sc4, sc12))).toBe('Moved SC 03 to after SC 12');
    setLocale('es');
    expect(say([moved(sc12, 'p', '0')])).toBe('Se movió ESC 12 al principio del proyecto');
    expect(say([moved(sc4, 'p', '0'), moved(sc12, 'p', '1')])).toBe('Se movieron 2 escenas al principio del proyecto');
    expect(say([moved(sc4, 'p', '0'), moved(sc12, 'p', '1')], near(sc3, sc4, sc12))).toBe('Se movieron 2 escenas al principio del proyecto');
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

describe('a drag in a file whose sort keys couldn’t be read (6.23)', () => {
  // Scene 1's frames A, B and C, C's key one keyBetween can't read (boardKeys.test.ts): a drag past it writes the
  // scene's frames afresh in the same step.
  const s1 = record('s1', 'scene', 'p', 'b', { number: '1' });
  const s2 = record('s2', 'scene', 'p', 's', { number: '2' });
  const fa = shot('fa', 's1', 'b', '1A', { status: 'need' });
  const fb = shot('fb', 's1', 'd', '1B', { status: 'need' });
  const fc = shot('fc', 's1', '~', '1C', { status: 'need' });
  const fx = shot('fx', 's2', 'b', '2A', { status: 'need' });
  const odd = { p: project, s1, s2, fa, fb, fc, fx };
  /** The changes as the log would hold them: each op with the record before and after it. */
  const logged = (changes: readonly Change[]): LoggedOp[] => {
    const now: Record<string, SbdRecord> = { ...odd };
    return changes.map((change) => {
      const was = change.kind === 'create' ? undefined : now[change.id];
      if (!was) throw new Error('not in the test');
      const after =
        change.kind === 'move'
          ? { ...was, parentId: change.parentId, sortKey: change.sortKey }
          : change.kind === 'update'
            ? { ...was, props: { ...was.props, ...(change.set ?? {}) } }
            : was;
      now[was.id] = after;
      return op(change.kind === 'move' ? 'move' : 'update', was, after);
    });
  };
  const around = near(project, s1, s2, fa, fb, fc, fx);

  it('counts and places only the frame the person moved, not the ones written afresh with it', () => {
    const changes = moveItem(odd, 'p', 'fa', 's1', null);
    expect(changes.filter((c) => c.kind === 'move').length).toBeGreaterThan(1);
    expect(say(logged(changes), around)).toBe('Moved 1A to after 1C');
    // Into scene 1 from scene 2, at its end: only 2A moved.
    expect(say(logged(moveItem(odd, 'p', 'fx', 's1', null)), around)).toBe('Moved 2A to after 1C');
    setLocale('es');
    expect(say(logged(changes), around)).toBe('Se movió 1A después de 1C');
  });
});

describe('a deck’s page moved', () => {
  const deck = record('d', 'board', 'p', 'k', { kind: 'deck', name: 'Pitch' });
  const page = (id: string, sortKey: string, name: string) => record(id, 'board_item', 'd', sortKey, { kind: 'page', x: 0, y: 0, width: 1920, height: 1080, name });
  const p1 = page('p1', 'a', '');
  const p2 = page('p2', 'b', 'Cover');
  const p3 = page('p3', 'c', '');
  const pages = near(deck, p1, p2, p3);

  it('names the deck as the deck lines do, and a page by its name or its number then', () => {
    expect(say([moved(p3, 'd', '0')], pages)).toBe('Moved page 3 to the start of deck Pitch');
    expect(say([moved(p1, 'd', 'bm')], pages)).toBe("Moved page 1 to after page 'Cover'");
    expect(say([moved(p2, 'd', 'cm')], pages)).toBe("Moved page 'Cover' to after page 3");
    setLocale('es');
    expect(say([moved(p3, 'd', '0')], pages)).toBe('Se movió la página 3 al principio de la presentación Pitch');
    expect(say([moved(p2, 'd', 'cm')], pages)).toBe('Se movió la página «Cover» después de la página 3');
  });

  it('names an unnamed page “a page”, never by a number, when a record of the project then is gone for good', () => {
    const unsure = (ops: LoggedOp[], around: ReadonlyMap<string, SbdRecord>) => lineText(describeEdit(ops, none, around, undefined, true));
    // Page 1 purged since: the deck's pages as the step knows them are only 2 and 3, so a number could be wrong.
    expect(unsure([moved(p3, 'd', '0')], near(deck, p2, p3))).toBe('Moved a page');
    expect(unsure([moved(p2, 'd', '0')], near(deck, p2, p3))).toBe("Moved page 'Cover'");
    setLocale('es');
    expect(unsure([moved(p3, 'd', '0')], near(deck, p2, p3))).toBe('Se movió una página');
    expect(unsure([moved(p2, 'd', '0')], near(deck, p2, p3))).toBe('Se movió la página «Cover»');
  });
});

describe('a page dragged in a deck whose keys couldn’t be read (6.23)', () => {
  // A deck's pages and a rectangle, page 3's key one keyBetween can't read: a page's drag writes every item afresh.
  const deck = record('d', 'board', 'p', 'k', { kind: 'deck', name: 'Pitch' });
  const page = (id: string, sortKey: string, x: number) =>
    record(id, 'board_item', 'd', sortKey, { kind: 'page', x, y: 0, width: 1920, height: 1080, format: '16:9', orientation: 'portrait', name: '' });
  const p1 = page('p1', 'b', 0);
  const rect = record('r1', 'board_item', 'd', 'c', { kind: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0 });
  const p2 = page('p2', 'd', 2200);
  const p3 = page('p3', '~', 4400);
  const odd: Record<string, SbdRecord> = { p: project, d: deck, p1, r1: rect, p2, p3 };
  const around = near(project, deck, p1, rect, p2, p3);
  const logged = (changes: readonly Change[], records: Record<string, SbdRecord> = odd): LoggedOp[] => {
    const now: Record<string, SbdRecord> = { ...records };
    return changes.map((change) => {
      const was = change.kind === 'move' ? now[change.id] : undefined;
      if (!was || change.kind !== 'move') throw new Error('not in the test');
      const after = { ...was, parentId: change.parentId, sortKey: change.sortKey };
      now[was.id] = after;
      return op('move', was, after);
    });
  };

  it('names the page the person moved and where, not the items written afresh with it', () => {
    const last = movePageChanges(odd, 'd', 'p1', 2);
    expect(last.length).toBeGreaterThan(2);
    expect(say(logged(last), around)).toBe('Moved page 1 to after page 3');
    const first = movePageChanges(odd, 'd', 'p3', 0);
    expect(say(logged(first), around)).toBe('Moved page 3 to the start of deck Pitch');
    setLocale('es');
    expect(say(logged(last), around)).toBe('Se movió la página 1 después de la página 3');
    expect(say(logged(first), around)).toBe('Se movió la página 3 al principio de la presentación Pitch');
  });

  it('a rectangle sent to the front in that deck still reads as its items reordered', () => {
    const r2 = record('r2', 'board_item', 'd', '~~', { kind: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0 });
    const withTwo = { ...odd, r2 };
    const front = reorderChanges(withTwo, 'd', ['r1'], 'front');
    expect(front.length).toBeGreaterThan(1);
    expect(say(logged(front, withTwo), near(...Object.values(withTwo)))).toBe('Reordered 5 items');
  });
});

describe('a frame’s place proven by its letter (a record of the project then gone for good)', () => {
  const unsure = (ops: LoggedOp[], around: ReadonlyMap<string, SbdRecord>) => lineText(describeEdit(ops, none, around, undefined, true));
  const d4 = shot('d4', 'sc4', 'd', '4D');

  it('proves nothing from a move that didn’t re-letter its scene: the letters after it must follow', () => {
    // Scene 4 held A, B, C and D; B dragged after C by a step that wrote no renumber, so it keeps the letter B; C was
    // deleted for good since. One known frame before it (A) matches B's letter, but D after it isn't C: not proven.
    expect(unsure([moved(b4, 'sc4', 'cm')], near(project, sc4, a4, d4))).toBe('Moved 4B');
    // The same drag as moveItem writes it (B and C re-lettered with it), D deleted for good since: proven.
    const asC = { ...b4, sortKey: 'cm', props: { ...b4.props, number: '4C' } };
    const steps = [moved(b4, 'sc4', 'cm'), op('update', { ...b4, sortKey: 'cm' }, asC), changed(c4, { number: '4B' })];
    expect(unsure(steps, near(project, sc4, a4, c4))).toBe('Moved 4B to after 4C');
    setLocale('es');
    expect(unsure([moved(b4, 'sc4', 'cm')], near(project, sc4, a4, d4))).toBe('Se movió 4B');
    expect(unsure(steps, near(project, sc4, a4, c4))).toBe('Se movió 4B después de 4C');
  });

  it('proves nothing when the step didn’t write the moved frame’s letter, though no frame is left after it', () => {
    // Scene 4 held A, B and C; B moved to the end by a step that wrote no renumber, so it keeps "4B"; C was deleted for
    // good since: one known frame before it and none after, yet B went after 4C, not after 4A.
    expect(unsure([moved(b4, 'sc4', 'cm')], near(project, sc4, a4))).toBe('Moved 4B');
    setLocale('es');
    expect(unsure([moved(b4, 'sc4', 'cm')], near(project, sc4, a4))).toBe('Se movió 4B');
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

  it('names board items and attachments by the nouns the other lines give them', () => {
    const item = (id: string, kind: string) => record(id, 'board_item', 'b', id, { kind, x: 0, y: 0, width: 100, height: 100 });
    const pdf = (id: string) => record(id, 'media', 'p', id, { kind: 'pdf', source_name: `${id}.pdf`, file: 'f'.repeat(64), byte_size: 10 });
    const mixed = [retyped(item('i1', 'rect'), 'board_item'), retyped(item('i2', 'sticky'), 'board_item')];
    const rects = [retyped(item('i1', 'rect'), 'board_item'), retyped(item('i3', 'rect'), 'board_item')];
    const pdfs = [retyped(pdf('m1'), 'media'), retyped(pdf('m2'), 'media')];
    expect(say(mixed, here)).toBe('2 changes to 2 items');
    expect(say(rects, here)).toBe('2 changes to 2 rectangles');
    expect(say(pdfs, here)).toBe('2 changes to 2 attachments');
    setLocale('es');
    expect(say(mixed, here)).toBe('2 cambios en 2 elementos');
    expect(say(pdfs, here)).toBe('2 cambios en 2 adjuntos');
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

  it('says where a dragged scene went, though the project record is never in the log', async () => {
    await store.getState().apply([{ kind: 'create', record: { id: 'sc5', type: 'scene', parentId: file.projectId, sortKey: 'W', props: { number: '5' } } }]);
    const sceneMove = (id: string, sortKey: string) => ({ kind: 'move' as const, id, parentId: file.projectId, sortKey });
    // SC 05 to the start, SC 03 after SC 04, then SC 03 and SC 04 together to the start.
    await store.getState().apply([sceneMove('sc5', 'A')]);
    await store.getState().apply([sceneMove('sc3', 'Vm')]);
    await store.getState().apply([sceneMove('sc4', '1'), sceneMove('sc3', '2')]);
    expect(await lines(3)).toEqual(['Moved 2 scenes to the start of the project', 'Moved SC 03 to after SC 04', 'Moved SC 05 to the start of the project']);
    setLocale('es');
    expect(await lines(3)).toEqual(['Se movieron 2 escenas al principio del proyecto', 'Se movió ESC 03 después de ESC 04', 'Se movió ESC 05 al principio del proyecto']);
  });

  it('says only what moved once a frame of the scene then is deleted for good, and where while the one gone was elsewhere', async () => {
    const [a, b, c] = [await frame('sc4'), await frame('sc4'), await frame('sc4')];
    const elsewhere = await frame('sc3');
    await move(c, 'sc4', b);
    expect((await lines(1))[0]).toBe('Moved 4C to after 4A');
    // 3A, in another scene, deleted for good: 4C's place is still proven by its letter.
    await store.getState().apply(trashShot(store.getState().records, file.projectId, elsewhere));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toContain('Moved 4C to after 4A');
    // 4A deleted for good: what was before 4C then isn't known, so the line says what moved, never "to the start".
    await store.getState().apply(trashShot(store.getState().records, file.projectId, a));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    const now = await lines();
    expect(now).toContain('Moved 4C');
    expect(now.some((l) => l.startsWith('Moved 4C to'))).toBe(false);
    setLocale('es');
    expect(await lines()).toContain('Se movió 4C');
  });

  it('a drag after a frame deleted for good since never names the frame before that one', async () => {
    const [, b, , d] = [await frame('sc4'), await frame('sc4'), await frame('sc4'), await frame('sc4')];
    // 4D after 4B: "after 4B" while 4B is known; once 4B is gone for good, never "after 4A".
    const c = Object.values(store.getState().records).find((r) => r.type === 'shot' && r.props.number === '4C')?.id ?? null;
    await move(d, 'sc4', c);
    expect((await lines(1))[0]).toBe('Moved 4D to after 4B');
    await store.getState().apply(trashShot(store.getState().records, file.projectId, b));
    await store.getState().emptyTrash();
    const now = await lines();
    expect(now).toContain('Moved 4D');
    expect(now).not.toContain('Moved 4D to after 4A');
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

  it('a page’s number never stands for an unnamed page once a page of the deck then is deleted for good', async () => {
    const page = (id: string, sortKey: string) => ({
      kind: 'create' as const,
      record: { id, type: 'board_item' as const, parentId: 'deck', sortKey, props: { kind: 'page', x: 0, y: 0, width: 1920, height: 1080, format: '16:9', orientation: 'landscape', name: '' } },
    });
    await store.getState().apply([
      { kind: 'create', record: { id: 'deck', type: 'board', parentId: file.projectId, sortKey: 'X', props: { kind: 'deck', name: 'Pitch' } } },
      page('P1', 'a'),
      page('P2', 'b'),
      page('P3', 'c'),
    ]);
    await store.getState().apply(movePageChanges(store.getState().records, 'deck', 'P3', 0));
    expect((await lines(1))[0]).toBe('Moved page 3 to the start of deck Pitch');
    await store.getState().apply([{ kind: 'trash', id: 'P1' }]);
    expect(await store.getState().emptyTrash()).not.toBeNull();
    const now = await lines();
    expect(now).toContain('Moved a page');
    expect(now.some((l) => /^Moved page \d/.test(l))).toBe(false);
    setLocale('es');
    expect(await lines()).toContain('Se movió una página');
  });

  it('a drag while a record was in the Trash keeps its place once the Trash is emptied; one restored then doesn’t', async () => {
    const sceneMove = (id: string, sortKey: string) => [{ kind: 'move' as const, id, parentId: file.projectId, sortKey }];
    // 4A deleted, SC 03 dragged after SC 04, then the Trash emptied: 4A was in the Trash at the drag, never beside it.
    const a = await frame('sc4');
    await store.getState().apply(trashShot(store.getState().records, file.projectId, a));
    await store.getState().apply(sceneMove('sc3', 'Vm'));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toContain('Moved SC 03 to after SC 04');
    // Deleted and restored before the drag, deleted for good after it: it was in the project then, so the place isn't said.
    const b = await frame('sc4');
    await store.getState().apply(trashShot(store.getState().records, file.projectId, b));
    await store.getState().apply([{ kind: 'restore', id: b }]);
    await store.getState().apply(sceneMove('sc4', 'Vz'));
    await store.getState().apply(trashShot(store.getState().records, file.projectId, b));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toContain('Moved SC 04');
    expect(await lines()).not.toContain('Moved SC 04 to after SC 03');
    // Restored, then the restore undone: back in the Trash at the drag.
    const c = await frame('sc4');
    await store.getState().apply(trashShot(store.getState().records, file.projectId, c));
    await store.getState().apply([{ kind: 'restore', id: c }]);
    await store.getState().undo();
    await store.getState().apply(sceneMove('sc4', '0'));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toContain('Moved SC 04 to the start of the project');
    setLocale('es');
    expect(await lines()).toEqual(expect.arrayContaining(['Se movió ESC 03 después de ESC 04', 'Se movió ESC 04', 'Se movió ESC 04 al principio del proyecto']));
  });

  it('a frame lettered past H keeps its place after a purge elsewhere, in the project’s own lettering', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await frame('sc4'));
    const elsewhere = await frame('sc3');
    const number = (id: string | undefined) => {
      const value = store.getState().records[id ?? '']?.props.number;
      return typeof value === 'string' ? value : '';
    };
    const [eighth, ninth, tenth] = [ids[7], ids[8], ids[9]];
    const [h, last] = [number(eighth), number(tenth)];
    expect(h).toBe('4H');
    // The tenth frame dragged before the ninth: lettered by its new place, past H, where the two alphabets differ.
    await move(tenth ?? '', 'sc4', ninth ?? null);
    expect((await lines(1))[0]).toBe(`Moved ${last} to after 4H`);
    await store.getState().apply(trashShot(store.getState().records, file.projectId, elsewhere));
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(await lines()).toContain(`Moved ${last} to after 4H`);
    setLocale('es');
    expect(await lines()).toContain(`Se movió ${last} después de 4H`);
  });

  it('a page dragged in a deck whose keys couldn’t be read keeps its line once an item it re-keyed in the Trash is gone for good', async () => {
    const item = (id: string, sortKey: string, props: Props) => ({ kind: 'create' as const, record: { id, type: 'board_item' as const, parentId: 'deck', sortKey, props } });
    const page = (id: string, sortKey: string) => item(id, sortKey, { kind: 'page', x: 0, y: 0, width: 1920, height: 1080, format: '16:9', orientation: 'landscape', name: '' });
    const rect = (id: string, sortKey: string) => item(id, sortKey, { kind: 'rect', x: 0, y: 0, width: 100, height: 100, rotation: 0 });
    // Keys keyBetween can't read (an odd imported file's), so the drag writes every item of the deck afresh, the
    // rectangle in the Trash among them.
    await store.getState().apply([
      { kind: 'create', record: { id: 'deck', type: 'board', parentId: file.projectId, sortKey: 'X', props: { kind: 'deck', name: 'Pitch' } } },
      page('P1', '~a'),
      page('P2', '~b'),
      page('P3', '~c'),
      rect('R1', '~d'),
      rect('T', '~e'),
    ]);
    await store.getState().apply([{ kind: 'trash', id: 'T' }]);
    const changes = movePageChanges(store.getState().records, 'deck', 'P3', 0);
    expect(changes.map((c) => c.kind === 'move' && c.id).sort()).toEqual(['P1', 'P2', 'P3', 'R1', 'T']);
    await store.getState().apply(changes);
    expect((await lines(1))[0]).toBe('Moved page 3 to the start of deck Pitch');
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect((await lines(2))[1]).toBe('Moved page 3 to the start of deck Pitch');
    setLocale('es');
    expect((await lines(2))[1]).toBe('Se movió la página 3 al principio de la presentación Pitch');
  });

  it('a frame dragged in a scene whose keys couldn’t be read keeps its line once a frame it re-keyed in the Trash is gone for good', async () => {
    const make = (id: string, sortKey: string, number: string) => ({ kind: 'create' as const, record: { id, type: 'shot' as const, parentId: 'sc4', sortKey, props: { number } } });
    await store.getState().apply([make('A', 'b', '4A'), make('B', '~', '4B'), make('C', '~c', '4C'), make('X', '~cx', '4X'), make('D', '~d', '4D')]);
    await store.getState().apply([{ kind: 'trash', id: 'X' }]);
    // 4D before 4B, so after 4A: the scene's frames written afresh, X in the Trash among them.
    const changes = moveItem(store.getState().records, file.projectId, 'D', 'sc4', 'B');
    expect(changes.filter((c) => c.kind === 'move').map((c) => c.id).sort()).toEqual(['A', 'B', 'C', 'D', 'X']);
    await store.getState().apply(changes);
    expect((await lines(1))[0]).toBe('Moved 4D to after 4A');
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect((await lines(2))[1]).toBe('Moved 4D to after 4A');
    setLocale('es');
    expect((await lines(2))[1]).toBe('Se movió 4D después de 4A');
  });

  it('a step that restores a record then in the Trash counts it as there once it is gone for good', async () => {
    // A hand-made step: 4A deleted, then one step brings it back and moves SC 03 after SC 04; 4A deleted for good since.
    const a = await frame('sc4');
    await store.getState().apply([{ kind: 'trash', id: a }]);
    await store.getState().apply([
      { kind: 'restore', id: a },
      { kind: 'move', id: 'sc3', parentId: file.projectId, sortKey: 'Vm' },
    ]);
    const step = await lastGroup();
    await store.getState().apply([{ kind: 'trash', id: a }]);
    expect(await store.getState().emptyTrash()).not.toBeNull();
    const ops = await opsOfGroups(file.file, [step.id]);
    const { unsure, trashed } = await stepRecords(file.file, new Map([[step.id, ops]]));
    expect(unsure.has(step.id)).toBe(true);
    expect(trashed.get(step.id)).toBeUndefined();
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

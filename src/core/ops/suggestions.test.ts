import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n';
import type { JsonValue, Props, SbdRecord } from '../model/record';
import { flagWords, foldEdits, reviewSuggestion, type SuggestionFlag } from '../model/suggestion';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { callsheetNoteChange, departmentCallChange, personTimeChange } from './callsheetEdits';
import { dayChange, scheduleFrames } from './dayEdits';
import { gearListChange } from './gearEdits';
import { apply, getRecord, loadRecords, log, redo, undo, type Change } from './ops';
import { addNoteChanges, addSceneChanges, addShot, moveItem, trashScene, trashShot } from './storyboardEdits';
import { applySuggestion, applySuggestionChanges, rejectSuggestion, rejectSuggestionChanges } from './suggestions';

// Suggestions applied and rejected (7.0): Apply writes exactly what the app's own edit writes, then the suggestion's
// decision, in one op group; Reject writes only the decision. Every flag, every refusal and every bad value is kept
// and never applied. Made-up people and projects only: Robin Vale, "Harbor Lights".

const at = '2026-11-21T10:00:00.000Z';
const earlier = '2026-11-20T09:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'V', updatedAt = earlier): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: earlier,
  updatedAt,
});
const recordsOf = (...list: SbdRecord[]): Record<string, SbdRecord> => Object.fromEntries(list.map((r) => [r.id, r]));

/** Harbor Lights: scene 4 with 4A, 4B and a note; scene 5 with 5A; a location, a day, gear, a person, a character, a lens. */
function harbor(): Record<string, SbdRecord> {
  return recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('sc4', 'scene', 'p', { number: '4', name: 'Dock' }, 'M'),
    record('a', 'shot', 'sc4', { number: '4A', status: 'need', size: 'WS' }, 'M'),
    record('b', 'shot', 'sc4', { number: '4B', status: 'need', size: 'WS', lens_mm: 35 }, 'V'),
    record('n', 'note', 'sc4', { text: 'Wide first' }, 'h'),
    record('sc5', 'scene', 'p', { number: '5', name: 'Lighthouse' }, 'V'),
    record('c', 'shot', 'sc5', { number: '5A', status: 'need' }, 'V'),
    record('loc1', 'location', 'p', { name: 'Pier 9' }),
    // No people_ids: nobody has chosen who's on it, so everyone is (4.2), and every person can have times on its sheet.
    record('d1', 'shoot_day', 'p', { date: '2026-12-01' }),
    record('g1', 'gear_item', 'p', { name: 'C-stand', quantity: 4, source: 'owned' }, 'M'),
    record('g2', 'gear_item', 'p', { name: 'Dolly', quantity: 1, source: 'rental' }, 'V'),
    record('lens', 'gear_item', 'p', { name: 'Zoom', kind: 'lens', focal_min_mm: 24, focal_max_mm: 70 }, 'h'),
    record('robin', 'person', 'p', { name: 'Robin Vale', role: 'dp', phone: '555-0100', email: 'robin@example.test' }),
    record('ch1', 'character', 'p', { name: 'MARA' }),
  );
}

let made = 0;
beforeEach(() => {
  made = 0;
  // The edits make their own ids: the same sequence on both sides, so their writes compare exactly.
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    made += 1;
    return `00000000-0000-4000-8000-${String(made).padStart(12, '0')}` as ReturnType<typeof crypto.randomUUID>;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
const resetIds = () => {
  made = 0;
};

const suggestion = (id: string, props: Props): SbdRecord =>
  record(id, 'suggestion', 'p', {
    status: 'pending',
    source: 'mcp',
    change_file_id: 'cf1',
    author: { name: 'Robin Vale', role: 'assistant' },
    suggested_at: earlier,
    note: '',
    ...props,
  });
const on = (records: Record<string, SbdRecord>, ...more: SbdRecord[]) => ({ ...records, ...recordsOf(...more) });
const decision = { by: 'Robin Vale' };

/** Apply's writes to the project: its change list without the suggestion's own update (the last one). */
function writes(records: Record<string, SbdRecord>, id = 's1'): Change[] {
  const { changes } = applySuggestionChanges(records, 'p', id, decision);
  expect(changes).not.toBeNull();
  const list = changes ?? [];
  expect(list.at(-1)).toEqual({ kind: 'update', id, set: expect.objectContaining({ status: 'approved', decided_by: 'Robin Vale' }) as Props, stamp: ['decided_at'] });
  return list.slice(0, -1);
}

/** What the UI's own edit writes, from the ids' start, as Apply's does. */
function ui<T>(make: () => T): T {
  resetIds();
  return make();
}

const flagsOf = (records: Record<string, SbdRecord>, id = 's1'): SuggestionFlag[] => reviewSuggestion(records, 'p', id)?.flags ?? [];
const canApply = (records: Record<string, SbdRecord>, id = 's1'): boolean => reviewSuggestion(records, 'p', id)?.canApply ?? false;
const target = (id: string, type: string) => ({ target_id: id, target_type: type, target_label: `the ${type}`, target_updated_at: earlier });

describe('Apply writes what the app’s own edit writes', () => {
  it('trash: a frame as the board deletes it, a scene with what’s in it, a note', () => {
    const base = harbor();
    const frame = on(base, suggestion('s1', { kind: 'trash', ...target('b', 'shot'), data: {} }));
    expect(writes(frame)).toEqual(trashShot(base, 'p', 'b'));
    const scene = on(base, suggestion('s1', { kind: 'trash', ...target('sc4', 'scene'), data: {} }));
    expect(writes(scene)).toEqual(trashScene(base, 'sc4'));
    const note = on(base, suggestion('s1', { kind: 'trash', ...target('n', 'note'), data: {} }));
    expect(writes(note)).toEqual([{ kind: 'trash', id: 'n' }]);
  });

  it('update: the named fields of a frame in one op, as the Inspector sets them', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: 'CU', lens_mm: 85, title: '' }, before: { size: 'WS', lens_mm: 35, title: null } } });
    // An empty title takes it off, as the board does; it has none, so nothing is taken off.
    expect(writes(on(base, s))).toEqual([{ kind: 'update', id: 'b', set: { size: 'CU', lens_mm: 85 } }]);
    const off = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { lens_mm: null }, before: { lens_mm: 35 } } });
    expect(writes(on(base, off))).toEqual([{ kind: 'update', id: 'b', unset: ['lens_mm'] }]);
  });

  it('update: a frame onto a day and off it, as the Days tile schedules it', () => {
    const base = harbor();
    const into = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { shoot_day_id: 'd1' }, before: { shoot_day_id: null } } });
    expect(writes(on(base, into))).toEqual(scheduleFrames(base, ['b'], 'd1'));
    const scheduled = on(base, record('b', 'shot', 'sc4', { ...base.b?.props, shoot_day_id: 'd1' }, 'V'));
    const out = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { shoot_day_id: null }, before: { shoot_day_id: 'd1' } } });
    expect(writes(on(scheduled, out))).toEqual(scheduleFrames(scheduled, ['b'], null));
  });

  it('update: a day’s gear list, as the Gear picker writes it', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { gear_ids: ['g1'] }, before: { gear_ids: null } } });
    expect(writes(on(base, s))).toEqual(gearListChange(base, 'd1', ['g1'], true));
    const listed = on(base, record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [], gear_ids: ['g1', 'g2'] }));
    const off = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { gear_ids: ['g1'] }, before: { gear_ids: ['g1', 'g2'] } } });
    expect(writes(on(listed, off))).toEqual(gearListChange(listed, 'd1', ['g2'], false));
    // What the list holds that this version can't read stays, emptied or not, as the picker keeps it.
    const odd = on(base, record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [], gear_ids: ['g1', 7] }));
    const emptied = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { gear_ids: [] }, before: { gear_ids: ['g1', 7] } } });
    expect(writes(on(odd, emptied))).toEqual(gearListChange(odd, 'd1', ['g1'], false));
    const swapped = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { gear_ids: ['g2'] }, before: { gear_ids: ['g1', 7] } } });
    expect(writes(on(odd, swapped))).toEqual([{ kind: 'update', id: 'd1', set: { gear_ids: [7, 'g2'] } }]);
  });

  it('update: a call sheet’s notes and calls, as the sheet writes them, made by the first one', () => {
    const base = harbor();
    const notes = suggestion('s1', { kind: 'update', ...target('d1', 'callsheet'), data: { props: { notes: 'Park in lot B' }, before: { notes: null } } });
    const applied = writes(on(base, notes));
    expect(applied).toEqual(ui(() => callsheetNoteChange(base, 'd1', 'notes', 'Park in lot B')));
    const calls = suggestion('s1', { kind: 'update', ...target('d1', 'callsheet'), data: { props: { department_calls: { camera: '06:30' } }, before: {} } });
    resetIds();
    expect(writes(on(base, calls))).toEqual(ui(() => departmentCallChange(base, 'd1', 'camera', '06:30')));
    const sheet = on(base, record('cs', 'callsheet', 'd1', { notes: 'Park behind' }));
    const times = suggestion('s1', { kind: 'update', ...target('d1', 'callsheet'), data: { props: { person_times: { robin: { call: '07:00' } } }, before: {} } });
    expect(writes(on(sheet, times))).toEqual(personTimeChange(sheet, 'd1', 'robin', 'call', '07:00'));
    const cleared = suggestion('s1', { kind: 'update', ...target('d1', 'callsheet'), data: { props: { notes: '' }, before: { notes: 'Park behind' } } });
    expect(writes(on(sheet, cleared))).toEqual(callsheetNoteChange(sheet, 'd1', 'notes', ''));
  });

  it('create: a frame numbered and placed as the board adds one, with its fields', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'create', target_type: 'shot', target_label: 'New frame', data: { type: 'shot', parent_id: 'sc4', after_id: 'a', props: { size: 'INSERT', action: 'Her hand on the latch.' } } });
    const { changes } = applySuggestionChanges(on(base, s), 'p', 's1', decision);
    const board = ui(() => addShot(base, 'p', 'sc4', 'a', { size: 'INSERT', action: 'Her hand on the latch.' }));
    expect(changes?.slice(0, -1)).toEqual(board.changes);
    expect(changes?.at(-1)).toMatchObject({ set: { created_id: board.shotId } });
    // Its number is the scene's own rule: 4B, between 4A and the old 4B (now 4C).
    expect(board.changes[0]).toMatchObject({ kind: 'create', record: { props: { number: '4B', size: 'INSERT' } } });
  });

  it('create: first in the scene when after_id is null', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: null, props: {} } });
    const first = writes(on(base, s))[0];
    expect(first?.kind === 'create' && first.record.sortKey < 'M').toBe(true);
    expect(first).toMatchObject({ record: { props: { number: '4A' } } });
  });

  it('create: a note and a scene as the board adds them; a scene first can’t be applied, since no one can add one there', () => {
    const base = harbor();
    const note = suggestion('s1', { kind: 'create', target_type: 'note', data: { type: 'note', parent_id: 'sc4', after_id: 'b', props: { text: 'Hold for the ferry' } } });
    expect(writes(on(base, note))).toEqual(ui(() => addNoteChanges(base, 'sc4', 'b', 'Hold for the ferry').changes));
    const scene = suggestion('s1', { kind: 'create', target_type: 'scene', data: { type: 'scene', parent_id: 'p', after_id: 'sc4', props: { name: 'Gangway', int_ext: 'EXT' } } });
    const board = ui(() => addSceneChanges(base, 'p', 'sc4'));
    const withFields = board.changes.map((c) => (c.kind === 'create' ? { ...c, record: { ...c.record, props: { ...c.record.props, name: 'Gangway', int_ext: 'EXT' } } } : c));
    resetIds();
    expect(writes(on(base, scene))).toEqual(withFields);
    // 7.0 round 2: a person adds a scene after a scene or at the end, never first, so Apply doesn't either.
    const firstScene = suggestion('s1', { kind: 'create', target_type: 'scene', data: { type: 'scene', parent_id: 'p', after_id: null, props: {} } });
    expect(flagsOf(on(base, firstScene))).toContainEqual({ kind: 'cant_apply', why: 'scene_first' });
    expect(applySuggestionChanges(on(base, firstScene), 'p', 's1', decision).changes).toBeNull();
  });

  it('reorder: a frame within its scene and into another, as a drag does; a scene, which no one can move by hand, is refused', () => {
    const base = harbor();
    const firstInScene = suggestion('s1', { kind: 'reorder', ...target('b', 'shot'), data: { parent_id: 'sc4', after_id: null } });
    expect(writes(on(base, firstInScene))).toEqual(moveItem(base, 'p', 'b', 'sc4', 'a'));
    const across = suggestion('s1', { kind: 'reorder', ...target('c', 'shot'), data: { parent_id: 'sc4', after_id: 'b' } });
    expect(writes(on(base, across))).toEqual(moveItem(base, 'p', 'c', 'sc4', 'n'));
    // 7.0 round 2: outside the row.
    const scene = suggestion('s1', { kind: 'reorder', ...target('sc5', 'scene'), data: { parent_id: 'p', after_id: null } });
    expect(flagsOf(on(base, scene))).toContainEqual({ kind: 'outside_scope', what: 'kind', name: 'reorder' });
    expect(applySuggestionChanges(on(base, scene), 'p', 's1', decision).changes).toBeNull();
  });
});

describe('Flags', () => {
  it('a create waiting for its scene, then applied under the scene it made', () => {
    const base = harbor();
    const sceneSuggestion = suggestion('s1', { kind: 'create', target_type: 'scene', data: { type: 'scene', parent_id: 'p', after_id: 'sc5', props: { name: 'Gangway' } } });
    const frame = suggestion('s2', { kind: 'create', target_type: 'shot', after_suggestion: 's1', data: { type: 'shot', parent_id: 's1', after_id: null, props: { size: 'WS' } } });
    const pending = on(base, sceneSuggestion, frame);
    expect(flagsOf(pending, 's2')).toContainEqual({ kind: 'waiting', on: 's1' });
    expect(canApply(pending, 's2')).toBe(false);
    expect(applySuggestionChanges(pending, 'p', 's2', decision).changes).toBeNull();
    // s1 applied: its scene is there, and s2 goes under it.
    const applied = on(
      base,
      { ...sceneSuggestion, props: { ...sceneSuggestion.props, status: 'approved', created_id: 'sc9' } },
      frame,
      record('sc9', 'scene', 'p', { number: '6', name: 'Gangway' }, 'k'),
    );
    expect(canApply(applied, 's2')).toBe(true);
    expect(writes(applied, 's2')[0]).toMatchObject({ kind: 'create', record: { parentId: 'sc9', props: { number: '6A', size: 'WS' } } });
    // s1 rejected: the scene will never come.
    const rejected = on(base, { ...sceneSuggestion, props: { ...sceneSuggestion.props, status: 'rejected' } }, frame);
    expect(flagsOf(rejected, 's2')).toContainEqual({ kind: 'gone', what: 'parent' });
  });

  it('an after_id gone: placed at the end, and said', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: 'gone-frame', props: {} } });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'gone', what: 'after' });
    expect(canApply(on(base, s))).toBe(true);
    const atEnd = ui(() => addShot(base, 'p', 'sc4', null, {}).changes);
    resetIds();
    expect(writes(on(base, s))).toEqual(atEnd);
  });

  it('a field changed since, with the three values; a person may still apply it', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: 'CU', lens_mm: 50 }, before: { size: 'MS', lens_mm: 35 } } });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'changed_since', fields: [{ field: 'size', then: 'MS', suggested: 'CU', now: 'WS' }] });
    expect(writes(on(base, s))).toEqual([{ kind: 'update', id: 'b', set: { size: 'CU', lens_mm: 50 } }]);
  });

  it('a target written after it was suggested, for the other kinds', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'trash', ...target('b', 'shot'), target_updated_at: '2026-11-19T09:00:00.000Z', data: {} });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'changed_since', fields: [] });
    expect(canApply(on(base, s))).toBe(true);
    const seen = suggestion('s1', { kind: 'trash', ...target('b', 'shot'), data: {} });
    expect(flagsOf(on(base, seen)).some((f) => f.kind === 'changed_since')).toBe(false);
  });

  it('a target in the Trash, or gone; a parent in the Trash', () => {
    const base = harbor();
    const trashed = on(base, { ...(base.b as SbdRecord), trashedAt: at, trashedBy: 'local' });
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: 'CU' }, before: { size: 'WS' } } });
    expect(flagsOf(on(trashed, s))).toContainEqual({ kind: 'trashed', what: 'target' });
    expect(canApply(on(trashed, s))).toBe(false);
    const gone = suggestion('s1', { kind: 'trash', ...target('nobody', 'shot'), data: {} });
    expect(flagsOf(on(base, gone))).toContainEqual({ kind: 'gone', what: 'target' });
    const inTrashScene = on(base, { ...(base.sc5 as SbdRecord), trashedAt: at, trashedBy: 'local' });
    const create = suggestion('s1', { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc5', after_id: null, props: {} } });
    expect(flagsOf(on(inTrashScene, create))).toContainEqual({ kind: 'trashed', what: 'parent' });
  });

  it('a frame can’t leave a scene whose numbers are locked', () => {
    const base = harbor();
    const locked = on(base, record('sc4', 'scene', 'p', { number: '4', name: 'Dock', numbers_locked: true }, 'M'));
    const s = suggestion('s1', { kind: 'reorder', ...target('b', 'shot'), data: { parent_id: 'sc5', after_id: null } });
    expect(flagsOf(on(locked, s))).toContainEqual({ kind: 'locked' });
    expect(canApply(on(locked, s))).toBe(false);
  });

  it('decided already: neither applied nor rejected again', () => {
    const base = harbor();
    const s = suggestion('s1', { kind: 'trash', ...target('b', 'shot'), status: 'rejected', data: {} });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'decided', status: 'rejected' });
    expect(applySuggestionChanges(on(base, s), 'p', 's1', decision).changes).toBeNull();
    expect(rejectSuggestionChanges(on(base, s), 's1', decision)).toBeNull();
  });
});

describe('Refusals: outside the assistant’s row, kept and never applied', () => {
  const refused = (props: Props, flag: SuggestionFlag) => {
    const records = on(harbor(), suggestion('s1', props));
    expect(flagsOf(records)).toContainEqual(flag);
    expect(applySuggestionChanges(records, 'p', 's1', decision).changes).toBeNull();
    // Kept: a person can still reject it.
    expect(rejectSuggestionChanges(records, 's1', decision)).not.toBeNull();
  };

  it('a type the row doesn’t name: a person’s phone, a project setting, a picture', () => {
    refused({ kind: 'update', ...target('robin', 'person'), data: { props: { phone: '555-0199' }, before: { phone: '555-0100' } } }, { kind: 'outside_scope', what: 'type', name: 'person' });
    refused({ kind: 'update', ...target('p', 'project'), data: { props: { aspect_ratio: '2.39:1' }, before: {} } }, { kind: 'outside_scope', what: 'type', name: 'project' });
    refused({ kind: 'trash', ...target('pic', 'media'), data: {} }, { kind: 'outside_scope', what: 'type', name: 'media' });
    refused({ kind: 'update', ...target('g1', 'gear_item'), data: { props: { quantity: -2 }, before: { quantity: 4 } } }, { kind: 'outside_scope', what: 'type', name: 'gear_item' });
  });

  it('a field the row doesn’t name: a phone, a shot number, a picture, custom fields', () => {
    refused({ kind: 'update', ...target('b', 'shot'), data: { props: { phone: '555-0199' }, before: {} } }, { kind: 'outside_scope', what: 'field', name: 'phone' });
    refused({ kind: 'update', ...target('b', 'shot'), data: { props: { number: '4Z' }, before: { number: '4B' } } }, { kind: 'outside_scope', what: 'field', name: 'number' });
    refused({ kind: 'update', ...target('b', 'shot'), data: { props: { media_id: 'pic' }, before: {} } }, { kind: 'outside_scope', what: 'field', name: 'media_id' });
    refused({ kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: null, props: { custom: { Drone: 'Mavic' } } } }, { kind: 'outside_scope', what: 'field', name: 'custom' });
    refused({ kind: 'update', ...target('sc4', 'scene'), data: { props: { numbers_locked: true }, before: {} } }, { kind: 'outside_scope', what: 'field', name: 'numbers_locked' });
  });

  it('a kind the row doesn’t allow for the type', () => {
    refused({ kind: 'trash', ...target('d1', 'shoot_day'), data: {} }, { kind: 'outside_scope', what: 'kind', name: 'trash' });
    refused({ kind: 'create', target_type: 'callsheet', data: { type: 'callsheet', parent_id: 'd1', after_id: null, props: {} } }, { kind: 'outside_scope', what: 'kind', name: 'create' });
  });

  it('an unknown kind, or an unknown field, is kept as it is and never applied', () => {
    refused({ kind: 'restore', ...target('b', 'shot'), data: {} }, { kind: 'newer', what: 'kind', name: 'restore' });
    refused({ kind: 'trash', ...target('b', 'shot'), data: {}, priority: 'high' }, { kind: 'newer', what: 'field', name: 'priority' });
    refused({ kind: 'trash', ...target('b', 'shot'), data: { reason: 'dup' } }, { kind: 'newer', what: 'field', name: 'data.reason' });
  });
});

describe('Bad values: flagged "can’t be applied", naming the field', () => {
  const invalid = (field: string, value: JsonValue, problem: string, type = 'shot', id = 'b') => {
    const records = on(harbor(), suggestion('s1', { kind: 'update', ...target(id, type), data: { props: { [field]: value }, before: {} } }));
    expect(flagsOf(records)).toContainEqual({ kind: 'invalid', field, problem });
    expect(applySuggestionChanges(records, 'p', 's1', decision).changes).toBeNull();
  };

  it('a 10 MB string', () => {
    invalid('action', 'x'.repeat(10 * 1024 * 1024), 'too_long');
  });

  it('NaN, a negative number, a number out of range, a T-stop off the list', () => {
    invalid('lens_mm', Number.NaN, 'range');
    invalid('lens_mm', -35, 'range');
    invalid('page_eighths', -3, 'range', 'scene', 'sc4');
    invalid('page_eighths', 2.5, 'range', 'scene', 'sc4');
    invalid('t_stop', 2.7, 'choice');
  });

  it('an id of the wrong type, or naming nothing', () => {
    invalid('shoot_day_id', 'loc1', 'not_found');
    invalid('location_id', 'd1', 'not_found');
    invalid('gear_ids', ['g1', 'robin'], 'not_found', 'shoot_day', 'd1');
    invalid('gear_ids', ['g1', 'g1'], 'repeated', 'shoot_day', 'd1');
    invalid('person_times', { ch1: { call: '07:00' } }, 'not_found', 'callsheet', 'd1');
    invalid('department_calls', { catering: '06:00' }, 'not_found', 'callsheet', 'd1');
  });

  it('the wrong kind of value, a choice off its list, a time that isn’t one', () => {
    invalid('size', 'MEDIUM', 'choice');
    invalid('size', null, 'empty');
    invalid('action', 42, 'type');
    invalid('department_calls', { camera: '6:30am' }, 'type', 'callsheet', 'd1');
  });

  it('a focal length outside the picked lens’s range', () => {
    const records = on(harbor(), record('b', 'shot', 'sc4', { number: '4B', status: 'need', lens_id: 'lens', lens_mm: 35 }, 'V'));
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { lens_mm: 85 }, before: { lens_mm: 35 } } });
    expect(flagsOf(on(records, s))).toContainEqual({ kind: 'invalid', field: 'lens_mm', problem: 'lens_range' });
  });

  it('a prototype key reaches nothing but a refusal', () => {
    const data = JSON.parse('{"props": {"__proto__": {"polluted": true}, "constructor": "x"}, "before": {}}') as JsonValue;
    const records = on(harbor(), suggestion('s1', { kind: 'update', ...target('b', 'shot'), data }));
    const flags = flagsOf(records);
    expect(flags).toContainEqual({ kind: 'outside_scope', what: 'field', name: '__proto__' });
    expect(flags).toContainEqual({ kind: 'outside_scope', what: 'field', name: 'constructor' });
    expect(applySuggestionChanges(records, 'p', 's1', decision).changes).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // A target id spelled as one of Object's own keys names nothing.
    const proto = on(harbor(), suggestion('s1', { kind: 'trash', ...target('__proto__', 'shot'), data: {} }));
    expect(flagsOf(proto)).toContainEqual({ kind: 'gone', what: 'target' });
  });
});

// Round 2 (7.0): what the review found. Each test names its item.
const later = '2026-11-20T12:00:00.000Z';
/** Harbor Lights with Sam on the crew, a third gear item and a second character. */
const harborPlus = () =>
  on(
    harbor(),
    record('sam', 'person', 'p', { name: 'Sam Reyes', role: 'gaffer' }),
    record('g3', 'gear_item', 'p', { name: 'Apple box', quantity: 6, source: 'owned' }, 'k'),
    record('ch2', 'character', 'p', { name: 'JONAH' }),
  );
const trashedRecord = (r: SbdRecord | undefined): SbdRecord => ({ ...(r as SbdRecord), trashedAt: at, trashedBy: 'local' });
const sheetUpdate = (props: Props, before: Props = {}) => suggestion('s1', { kind: 'update', ...target('d1', 'callsheet'), data: { props, before } });

describe('Round 2: a call sheet’s calls and times merge key by key (item 1)', () => {
  const sheet = () =>
    on(
      harborPlus(),
      record('cs', 'callsheet', 'd1', {
        department_calls: { camera: '06:00', sound: '05:30', catering: '06:00' },
        person_times: { sam: { call: '07:00' }, robin: { call: '08:00', later_key: 'kept' } },
      }),
    );

  it('Sam’s call survives a suggestion naming only Robin’s; an unknown department with a time survives', () => {
    const base = sheet();
    const s = sheetUpdate({ person_times: { robin: { call: '07:30' } }, department_calls: { camera: '06:15', sound: null } });
    const applied = writes(on(base, s));
    expect(applied).toEqual([
      {
        kind: 'update',
        id: 'cs',
        set: { department_calls: { camera: '06:15', catering: '06:00' }, person_times: { sam: { call: '07:00' }, robin: { later_key: 'kept', call: '07:30' } } },
      },
    ]);
    // The sheet's own edits, one key after another, write the same.
    let now: Record<string, SbdRecord> = base;
    for (const edit of [
      (r: Record<string, SbdRecord>) => personTimeChange(r, 'd1', 'robin', 'call', '07:30'),
      (r: Record<string, SbdRecord>) => departmentCallChange(r, 'd1', 'camera', '06:15'),
      (r: Record<string, SbdRecord>) => departmentCallChange(r, 'd1', 'sound', ''),
    ]) {
      const [change] = edit(now);
      if (change?.kind === 'update') now = { ...now, cs: { ...(now.cs as SbdRecord), props: { ...now.cs?.props, ...change.set } } };
    }
    expect(applied[0]?.kind === 'update' && applied[0].set).toEqual(now.cs?.props);
  });

  it('a person given null has their three times taken off, and their other keys kept', () => {
    const base = sheet();
    const s = sheetUpdate({ person_times: { robin: null } });
    expect(writes(on(base, s))).toEqual([{ kind: 'update', id: 'cs', set: { person_times: { sam: { call: '07:00' }, robin: { later_key: 'kept' } } } }]);
  });

  it('only the named keys compare for changed since, with the three values', () => {
    const base = sheet();
    // Sam's call and the sound call differ from what's in before: not named, so not compared.
    const quiet = sheetUpdate({ person_times: { robin: { call: '07:30' } } }, { person_times: { robin: { call: '08:00' }, sam: { call: '09:00' } }, department_calls: {} });
    expect(flagsOf(on(base, quiet)).some((f) => f.kind === 'changed_since')).toBe(false);
    const moved = sheetUpdate({ department_calls: { camera: '06:15' } }, { department_calls: { camera: '05:45', sound: '05:30' } });
    expect(flagsOf(on(base, moved))).toContainEqual({
      kind: 'changed_since',
      fields: [{ field: 'department_calls', then: { camera: '05:45' }, suggested: { camera: '06:15' }, now: { camera: '06:00' } }],
    });
  });

  it('the field itself can’t be taken off whole, which would drop what isn’t named', () => {
    const base = sheet();
    expect(flagsOf(on(base, sheetUpdate({ department_calls: null })))).toContainEqual({ kind: 'invalid', field: 'department_calls', problem: 'type' });
    expect(flagsOf(on(base, sheetUpdate({ person_times: null })))).toContainEqual({ kind: 'invalid', field: 'person_times', problem: 'type' });
  });
});

describe('Round 2: a list keeps what the person can’t see (item 2)', () => {
  it('frame 4B with g2 in the Trash keeps g2 after a suggestion setting [g1, g3], and isn’t flagged changed since', () => {
    const base = on(harborPlus(), record('b', 'shot', 'sc4', { number: '4B', status: 'need', size: 'WS', gear_ids: ['g1', 'g2'] }, 'V'));
    const withG2Trashed = on(base, trashedRecord(base.g2));
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { gear_ids: ['g1', 'g3'] }, before: { gear_ids: ['g1'] } } });
    const records = on(withG2Trashed, s);
    expect(flagsOf(records).some((f) => f.kind === 'changed_since')).toBe(false);
    expect(writes(records)).toEqual([{ kind: 'update', id: 'b', set: { gear_ids: ['g1', 'g2', 'g3'] } }]);
    // The Gear picker's own edit: g3 ticked on.
    expect(writes(records)).toEqual(gearListChange(withG2Trashed, 'b', ['g3'], true));
  });

  it('a scene’s characters are outside the scope (round 3, item 2: no hand edit sets them)', () => {
    const base = on(harborPlus(), record('sc4', 'scene', 'p', { number: '4', name: 'Dock', character_ids: ['ch1', 'gone-character', 'ch2'] }, 'M'));
    const s = suggestion('s1', { kind: 'update', ...target('sc4', 'scene'), data: { props: { character_ids: ['ch2', 'ch1'] }, before: { character_ids: ['ch1', 'ch2'] } } });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'outside_scope', what: 'field', name: 'character_ids' });
    expect(applySuggestionChanges(on(base, s), 'p', 's1', decision).changes).toBeNull();
    const created = suggestion('s1', { kind: 'create', target_type: 'scene', data: { type: 'scene', parent_id: 'p', after_id: 'sc5', props: { character_ids: ['ch1'] } } });
    expect(flagsOf(on(base, created))).toContainEqual({ kind: 'outside_scope', what: 'field', name: 'character_ids' });
  });
});

describe('Round 2: the same edits as the UI (item 3)', () => {
  it('a frame’s fields, its day and its gear named together are the Inspector’s, the Days tile’s and the picker’s edits in one op', () => {
    const base = harborPlus();
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: 'CU', shoot_day_id: 'd1', gear_ids: ['g3'] }, before: {} } });
    expect(writes(on(base, s))).toEqual([{ kind: 'update', id: 'b', set: { size: 'CU', shoot_day_id: 'd1', gear_ids: ['g3'] } }]);
    const scheduled = scheduleFrames(base, ['b'], 'd1');
    const geared = gearListChange(base, 'b', ['g3'], true);
    expect([scheduled[0], geared[0]]).toEqual([
      { kind: 'update', id: 'b', set: { shoot_day_id: 'd1' } },
      { kind: 'update', id: 'b', set: { gear_ids: ['g3'] } },
    ]);
  });

  it('a gear list swapped is the picker’s remove then add', () => {
    const base = on(harborPlus(), record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [], gear_ids: ['g1', 'g2'] }));
    const s = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { gear_ids: ['g3', 'g2'] }, before: { gear_ids: ['g1', 'g2'] } } });
    const removed = gearListChange(base, 'd1', ['g1'], false)[0];
    expect(removed).toEqual({ kind: 'update', id: 'd1', set: { gear_ids: ['g2'] } });
    const afterRemove = on(base, record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [], gear_ids: ['g2'] }));
    expect(writes(on(base, s))).toEqual(gearListChange(afterRemove, 'd1', ['g3'], true));
  });
});

describe('Round 2: decided_at is the decision’s own step time (item 4)', () => {
  it('Apply and Reject stamp the update, never a time of their own', () => {
    const s = suggestion('s1', { kind: 'trash', ...target('b', 'shot'), data: {} });
    const applied = applySuggestionChanges(on(harbor(), s), 'p', 's1', decision).changes?.at(-1);
    expect(applied).toMatchObject({ stamp: ['decided_at'] });
    expect(applied?.kind === 'update' && applied.set && 'decided_at' in applied.set).toBe(false);
    expect(rejectSuggestionChanges(on(harbor(), s), 's1', decision)?.[0]).toEqual({ kind: 'update', id: 's1', set: { status: 'rejected', decided_by: 'Robin Vale' }, stamp: ['decided_at'] });
  });
});

describe('Round 2: no false changed since (item 5)', () => {
  it('what reads as empty equals absent, and a map’s key order doesn’t count', () => {
    const base = on(harborPlus(), record('cs', 'callsheet', 'd1', { department_calls: { camera: '06:00', sound: '05:30' } }));
    const empties = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: 'CU' }, before: { size: 'WS', title: '', gear_ids: [] } } });
    expect(flagsOf(on(base, empties)).some((f) => f.kind === 'changed_since')).toBe(false);
    const titled = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { title: 'Reveal' }, before: { title: '' } } });
    expect(flagsOf(on(base, titled)).some((f) => f.kind === 'changed_since')).toBe(false);
    const reordered = sheetUpdate({ person_times: { robin: { call: '07:00' } }, department_calls: { sound: '05:30', camera: '06:00' } }, { department_calls: { sound: '05:30', camera: '06:00' } });
    expect(flagsOf(on(base, reordered)).some((f) => f.kind === 'changed_since')).toBe(false);
  });

  it('an update that writes only what already reads so writes nothing but the decision', () => {
    const base = on(harborPlus(), record('cs', 'callsheet', 'd1', { department_calls: { sound: '05:30', camera: '06:00' } }));
    const sameCalls = sheetUpdate({ department_calls: { camera: '06:00', sound: '05:30' } }, { department_calls: { sound: '05:30', camera: '06:00' } });
    const records = on(base, sameCalls);
    expect(flagsOf(records)).toContainEqual({ kind: 'no_change' });
    expect(writes(records)).toEqual([]);
    const emptyAction = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { action: '', title: null }, before: {} } });
    expect(writes(on(base, emptyAction))).toEqual([]);
  });
});

describe('Round 2: a place after a create not yet applied waits (item 6)', () => {
  it('a create or a reorder after a pending create of the same file is waiting, then goes after what it made', () => {
    const base = harbor();
    const frame = suggestion('s1', { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: 'a', props: {} } });
    const note = suggestion('s2', { kind: 'create', target_type: 'note', data: { type: 'note', parent_id: 'sc4', after_id: 's1', props: { text: 'Ferry horn' } } });
    const moved = suggestion('s3', { kind: 'reorder', ...target('c', 'shot'), data: { parent_id: 'sc4', after_id: 's1' } });
    const pending = on(base, frame, note, moved);
    expect(flagsOf(pending, 's2')).toContainEqual({ kind: 'waiting_after', on: 's1' });
    expect(flagsOf(pending, 's3')).toContainEqual({ kind: 'waiting_after', on: 's1' });
    expect(canApply(pending, 's2')).toBe(false);
    expect(canApply(pending, 's3')).toBe(false);
    const made = record('x', 'shot', 'sc4', { number: '4B', status: 'need' }, 'Q');
    const applied = on(base, { ...frame, props: { ...frame.props, status: 'approved', created_id: 'x' } }, note, made);
    expect(canApply(applied, 's2')).toBe(true);
    resetIds();
    expect(writes(applied, 's2')).toEqual(ui(() => addNoteChanges(applied, 'sc4', 'x', 'Ferry horn').changes));
  });
});

describe('Round 2: trashing a scene compares what goes with it (item 7)', () => {
  it('a frame added to the scene since flags changed since', () => {
    const s = suggestion('s1', { kind: 'trash', ...target('sc4', 'scene'), data: {} });
    expect(flagsOf(on(harbor(), s)).some((f) => f.kind === 'changed_since')).toBe(false);
    const added = on(harbor(), record('z', 'shot', 'sc4', { number: '4C', status: 'need' }, 'z', later), s);
    expect(flagsOf(added)).toContainEqual({ kind: 'changed_since', fields: [] });
    // One in the Trash doesn't go with it, so it doesn't count.
    const binned = on(harbor(), trashedRecord(record('z', 'shot', 'sc4', { number: '4C', status: 'need' }, 'z', later)), s);
    expect(flagsOf(binned).some((f) => f.kind === 'changed_since')).toBe(false);
  });
});

describe('Round 2: a frame goes on a day only if it is Need to shoot (item 8)', () => {
  const have = () => on(harbor(), record('b', 'shot', 'sc4', { number: '4B', status: 'have', size: 'WS' }, 'V'));

  it('another status can’t be applied, with words saying why', () => {
    const s = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { shoot_day_id: 'd1' }, before: {} } });
    const flags = flagsOf(on(have(), s));
    expect(flags).toContainEqual({ kind: 'cant_apply', why: 'not_need' });
    expect(canApply(on(have(), s))).toBe(false);
    expect(flagWords({ kind: 'cant_apply', why: 'not_need' })).toBe('Can’t be applied: only frames marked Need to shoot go on a shoot day.');
    setLocale('es');
    expect(flagWords({ kind: 'cant_apply', why: 'not_need' })).toBe('No se puede aplicar: solo los cuadros marcados Por filmar van a un día de rodaje.');
    setLocale('en');
    const create = suggestion('s1', { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: 'a', props: { status: 'source', shoot_day_id: 'd1' } } });
    expect(flagsOf(on(harbor(), create))).toContainEqual({ kind: 'cant_apply', why: 'not_need' });
  });

  it('one that also sets Need to shoot may, and taking a frame off a day always may', () => {
    const both = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { status: 'need', shoot_day_id: 'd1' }, before: {} } });
    expect(canApply(on(have(), both))).toBe(true);
    const onDay = on(harbor(), record('b', 'shot', 'sc4', { number: '4B', status: 'have', shoot_day_id: 'd1' }, 'V'));
    const off = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { shoot_day_id: null }, before: { shoot_day_id: 'd1' } } });
    expect(writes(on(onDay, off))).toEqual(scheduleFrames(onDay, ['b'], null));
  });
});

describe('Round 2: what a person can empty in the Inspector, a suggestion can (item 10)', () => {
  it('a scene’s time of day goes back to none; INT/EXT and a frame’s size can’t be emptied', () => {
    const base = on(harbor(), record('sc4', 'scene', 'p', { number: '4', name: 'Dock', int_ext: 'EXT', day_night: 'NIGHT' }, 'M'));
    const cleared = suggestion('s1', { kind: 'update', ...target('sc4', 'scene'), data: { props: { day_night: null }, before: { day_night: 'NIGHT' } } });
    expect(writes(on(base, cleared))).toEqual([{ kind: 'update', id: 'sc4', unset: ['day_night'] }]);
    const intExt = suggestion('s1', { kind: 'update', ...target('sc4', 'scene'), data: { props: { int_ext: null }, before: {} } });
    expect(flagsOf(on(base, intExt))).toContainEqual({ kind: 'invalid', field: 'int_ext', problem: 'empty' });
    const size = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { size: null }, before: {} } });
    expect(flagsOf(on(base, size))).toContainEqual({ kind: 'invalid', field: 'size', problem: 'empty' });
  });
});

describe('Round 2: the day’s crew call and wrap (item 11)', () => {
  it('set and taken off as the Days tile does, in one op on the day', () => {
    const base = on(harbor(), record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [], wrap_time: '18:00' }));
    const s = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { call_time: '06:00', wrap_time: null }, before: { wrap_time: '18:00' } } });
    expect(writes(on(base, s))).toEqual([{ kind: 'update', id: 'd1', set: { call_time: '06:00' }, unset: ['wrap_time'] }]);
    expect([...dayChange(base, 'd1', 'call_time', '06:00'), ...dayChange(base, 'd1', 'wrap_time', '')]).toEqual([
      { kind: 'update', id: 'd1', set: { call_time: '06:00' } },
      { kind: 'update', id: 'd1', unset: ['wrap_time'] },
    ]);
    const bad = suggestion('s1', { kind: 'update', ...target('d1', 'shoot_day'), data: { props: { call_time: '6am' }, before: {} } });
    expect(flagsOf(on(base, bad))).toContainEqual({ kind: 'invalid', field: 'call_time', problem: 'type' });
  });
});

describe('Round 2: a reorder that changes nothing (item 12)', () => {
  it('already after after_id under parent_id: no change, no move', () => {
    const base = harbor();
    const already = suggestion('s1', { kind: 'reorder', ...target('b', 'shot'), data: { parent_id: 'sc4', after_id: 'a' } });
    expect(flagsOf(on(base, already))).toContainEqual({ kind: 'no_change' });
    expect(writes(on(base, already))).toEqual([]);
    const first = suggestion('s1', { kind: 'reorder', ...target('a', 'shot'), data: { parent_id: 'sc4', after_id: null } });
    expect(writes(on(base, first))).toEqual([]);
    // The note is last: an after_id gone puts it at the end, where it is.
    const last = suggestion('s1', { kind: 'reorder', ...target('n', 'note'), data: { parent_id: 'sc4', after_id: 'gone-frame' } });
    expect(writes(on(base, last))).toEqual([]);
  });
});

describe('Round 2: the words for the new flags', () => {
  it('a scene first and a place that waits, in English and Spanish', () => {
    expect(flagWords({ kind: 'cant_apply', why: 'scene_first' })).toBe('Can’t be applied: a scene is added after another scene or at the end of the board, never first.');
    expect(flagWords({ kind: 'waiting_after', on: 's1' })).toBe('Waiting: it goes after something another suggestion adds. Apply that one first.');
    expect(flagWords({ kind: 'no_change' })).toBeNull();
    setLocale('es');
    expect(flagWords({ kind: 'cant_apply', why: 'scene_first' })).toBe('No se puede aplicar: una escena se agrega después de otra escena o al final del storyboard, nunca al principio.');
    expect(flagWords({ kind: 'waiting_after', on: 's1' })).toBe('En espera: va después de algo que agrega otra sugerencia. Aplica esa primero.');
    setLocale('en');
  });
});

// Round 3 (7.0): the second review. Each test names its item.
const approved = (s: SbdRecord, createdId: string): SbdRecord => ({ ...s, props: { ...s.props, status: 'approved', created_id: createdId } });
const sceneCreate = (id: string, afterId: string | null, props: Props = {}) =>
  suggestion(id, { kind: 'create', target_type: 'scene', target_label: 'New scene', data: { type: 'scene', parent_id: 'p', after_id: afterId, props } });
const frameCreate = (id: string, afterId: string | null) => suggestion(id, { kind: 'create', target_type: 'shot', data: { type: 'shot', parent_id: 'sc4', after_id: afterId, props: {} } });

describe('Round 3: a first scene on a board with no live scene (item 1)', () => {
  /** The scene + Add Scene makes, with the suggestion's fields, as Apply writes it. */
  const added = (records: Record<string, SbdRecord>, after: string | null, props: Props) =>
    ui(() => addSceneChanges(records, 'p', after)).changes.map((c) => (c.kind === 'create' ? { ...c, record: { ...c.record, props: { ...c.record.props, ...props } } } : c));

  it('on an empty board, it is added as + Add Scene adds one', () => {
    const empty = recordsOf(record('p', 'project', null, { title: 'Harbor Lights' }));
    const s = sceneCreate('s1', null, { name: 'Gangway' });
    expect(flagsOf(on(empty, s)).some((f) => f.kind === 'cant_apply')).toBe(false);
    const board = added(empty, null, { name: 'Gangway' });
    resetIds();
    expect(writes(on(empty, s))).toEqual(board);
    expect(board[0]).toMatchObject({ kind: 'create', record: { type: 'scene', parentId: 'p', props: { number: '1', name: 'Gangway' } } });
  });

  it('with only scenes in the Trash, too; with a live scene it is still refused', () => {
    const base = harbor();
    const binned = on(base, trashedRecord(base.sc4), trashedRecord(base.sc5));
    const s = sceneCreate('s1', null);
    expect(flagsOf(on(binned, s)).some((f) => f.kind === 'cant_apply')).toBe(false);
    const board = added(binned, null, {});
    resetIds();
    expect(writes(on(binned, s))).toEqual(board);
    // Trashed scenes keep their numbers, so the new one takes the next: 6.
    expect(board[0]).toMatchObject({ record: { props: { number: '6' } } });
    expect(flagsOf(on(base, s))).toContainEqual({ kind: 'cant_apply', why: 'scene_first' });
  });

  it('a chain s1 → s2: s2 waits for s1, then goes after the scene s1 made', () => {
    const empty = recordsOf(record('p', 'project', null, { title: 'Harbor Lights' }));
    const s1 = sceneCreate('s1', null, { name: 'Gangway' });
    const s2 = sceneCreate('s2', 's1', { name: 'Deck' });
    const pending = on(empty, s1, s2);
    expect(canApply(pending, 's1')).toBe(true);
    expect(flagsOf(pending, 's2')).toContainEqual({ kind: 'waiting_after', on: 's1' });
    expect(canApply(pending, 's2')).toBe(false);
    const applied = on(empty, approved(s1, 'scA'), s2, record('scA', 'scene', 'p', { number: '1', name: 'Gangway' }, 'M'));
    expect(canApply(applied, 's2')).toBe(true);
    const board = added(applied, 'scA', { name: 'Deck' });
    resetIds();
    expect(writes(applied, 's2')).toEqual(board);
    // Now the board has a live scene: another scene first is refused.
    expect(flagsOf(on(applied, sceneCreate('s3', null)), 's3')).toContainEqual({ kind: 'cant_apply', why: 'scene_first' });
  });
});

describe('Round 3: the Need-to-shoot rule matches the Days tile (item 3)', () => {
  const day2 = record('d2', 'shoot_day', 'p', { date: '2026-12-02' });
  const move = (to: string) => suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { shoot_day_id: to }, before: {} } });

  it('a frame already on a day moves to another whatever its status, as Move to does', () => {
    const onDay = on(harbor(), day2, record('b', 'shot', 'sc4', { number: '4B', status: 'have', shoot_day_id: 'd1' }, 'V'));
    expect(flagsOf(on(onDay, move('d2'))).some((f) => f.kind === 'cant_apply')).toBe(false);
    expect(writes(on(onDay, move('d2')))).toEqual(scheduleFrames(onDay, ['b'], 'd2'));
    // The status read is the one after Apply: set to Source in the same suggestion, it still moves.
    const both = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { status: 'source', shoot_day_id: 'd2' }, before: {} } });
    expect(canApply(on(onDay, both))).toBe(true);
  });

  it('a frame on no live day (none, one in the Trash, one gone) needs Need to shoot after Apply', () => {
    const base = on(harbor(), day2);
    const binnedDay = on(base, trashedRecord(base.d1), record('b', 'shot', 'sc4', { number: '4B', status: 'have', shoot_day_id: 'd1' }, 'V'));
    expect(flagsOf(on(binnedDay, move('d2')))).toContainEqual({ kind: 'cant_apply', why: 'not_need' });
    const goneDay = on(base, record('b', 'shot', 'sc4', { number: '4B', status: 'have', shoot_day_id: 'old-day' }, 'V'));
    expect(flagsOf(on(goneDay, move('d2')))).toContainEqual({ kind: 'cant_apply', why: 'not_need' });
    // On a day, and set to Have in the same suggestion, it moves; on none, Have can't go on one.
    const onDay = on(base, record('b', 'shot', 'sc4', { number: '4B', status: 'need', shoot_day_id: 'd1' }, 'V'));
    const toHave = suggestion('s1', { kind: 'update', ...target('b', 'shot'), data: { props: { status: 'have', shoot_day_id: 'd2' }, before: {} } });
    expect(canApply(on(onDay, toHave))).toBe(true);
    expect(flagsOf(on(base, toHave))).toContainEqual({ kind: 'cant_apply', why: 'not_need' });
  });
});

describe('Round 3: a create can’t wait on itself (item 5)', () => {
  it('after_id its own id, or a chain of after_ids that comes back round, is invalid on after_id, never waiting', () => {
    const self = on(harbor(), frameCreate('s1', 's1'));
    expect(flagsOf(self)).toContainEqual({ kind: 'invalid', field: 'after_id', problem: 'not_found' });
    expect(flagsOf(self).some((f) => f.kind === 'waiting_after')).toBe(false);
    expect(canApply(self)).toBe(false);
    const round = on(harbor(), frameCreate('s1', 's2'), frameCreate('s2', 's3'), frameCreate('s3', 's1'));
    for (const id of ['s1', 's2', 's3']) {
      expect(flagsOf(round, id)).toContainEqual({ kind: 'invalid', field: 'after_id', problem: 'not_found' });
      expect(flagsOf(round, id).some((f) => f.kind === 'waiting_after')).toBe(false);
    }
    // A chain that ends waits as before.
    const chain = on(harbor(), frameCreate('s1', 'a'), frameCreate('s2', 's1'));
    expect(flagsOf(chain, 's2')).toContainEqual({ kind: 'waiting_after', on: 's1' });
  });

  it('a parent chain (after_suggestion) that loops is invalid on after_suggestion, never waiting', () => {
    const under = (id: string, parent: string) =>
      suggestion(id, { kind: 'create', target_type: 'shot', after_suggestion: parent, data: { type: 'shot', parent_id: parent, after_id: null, props: {} } });
    const self = on(harbor(), under('s1', 's1'));
    expect(flagsOf(self)).toContainEqual({ kind: 'invalid', field: 'after_suggestion', problem: 'not_found' });
    expect(flagsOf(self).some((f) => f.kind === 'waiting')).toBe(false);
    const round = on(harbor(), under('s1', 's2'), under('s2', 's1'));
    for (const id of ['s1', 's2']) {
      expect(flagsOf(round, id)).toContainEqual({ kind: 'invalid', field: 'after_suggestion', problem: 'not_found' });
      expect(flagsOf(round, id).some((f) => f.kind === 'waiting')).toBe(false);
    }
  });
});

describe('Round 3: foldEdits folds only creates and updates (item 6)', () => {
  it('throws on any other kind, so no write is lost', () => {
    const base = harbor();
    expect(() => foldEdits(base, [() => [{ kind: 'trash', id: 'b' }]])).toThrow(/trash/);
    expect(() => foldEdits(base, [() => [{ kind: 'move', id: 'b', parentId: 'sc5', sortKey: 'Z' }]])).toThrow(/move/);
    expect(() => foldEdits(base, [() => [{ kind: 'update', id: 'b', set: { size: 'CU' } }], () => [{ kind: 'restore', id: 'b' }]])).toThrow(/restore/);
    expect(foldEdits(base, [() => [{ kind: 'update', id: 'b', set: { size: 'CU' } }]])).toEqual([{ kind: 'update', id: 'b', set: { size: 'CU' } }]);
  });
});

describe('Round 3: a call sheet’s times only for people on the day (item 7)', () => {
  it('a day with a list refuses someone not on it; a day without one takes any live person', () => {
    const listed = on(harborPlus(), record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: ['robin'] }));
    expect(flagsOf(on(listed, sheetUpdate({ person_times: { sam: { call: '07:00' } } })))).toContainEqual({ kind: 'invalid', field: 'person_times', problem: 'not_on_day' });
    expect(flagsOf(on(listed, sheetUpdate({ person_times: { sam: null } })))).toContainEqual({ kind: 'invalid', field: 'person_times', problem: 'not_on_day' });
    expect(applySuggestionChanges(on(listed, sheetUpdate({ person_times: { sam: { call: '07:00' } } })), 'p', 's1', decision).changes).toBeNull();
    resetIds();
    expect(writes(on(listed, sheetUpdate({ person_times: { robin: { call: '07:00' } } })))).toEqual(ui(() => personTimeChange(listed, 'd1', 'robin', 'call', '07:00')));
    // An empty list is nobody on the day.
    const nobody = on(harborPlus(), record('d1', 'shoot_day', 'p', { date: '2026-12-01', people_ids: [] }));
    expect(flagsOf(on(nobody, sheetUpdate({ person_times: { robin: { call: '07:00' } } })))).toContainEqual({ kind: 'invalid', field: 'person_times', problem: 'not_on_day' });
    const everyone = harborPlus();
    resetIds();
    expect(writes(on(everyone, sheetUpdate({ person_times: { sam: { call: '07:00' } } })))).toEqual(ui(() => personTimeChange(everyone, 'd1', 'sam', 'call', '07:00')));
  });
});

describe('Round 3: stamp names only decided_at (item 8)', () => {
  it('is typed so', () => {
    const ok: Change = { kind: 'update', id: 's1', stamp: ['decided_at'] };
    // @ts-expect-error -- only decided_at takes the step's time
    const other: Change = { kind: 'update', id: 's1', stamp: ['updated_at'] };
    expect([ok, other]).toHaveLength(2);
  });
});

describe('Apply and Reject in a file: one op group each, undone and redone', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    vi.restoreAllMocks();
    folder = makeTestFolder();
    project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
    const p = project.projectId;
    await apply(project.file, [
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: p, sortKey: 'M', props: { number: '4', name: 'Dock' } } },
      { kind: 'create', record: { id: 'a', type: 'shot', parentId: 'sc4', sortKey: 'M', props: { number: '4A', status: 'need' } } },
      { kind: 'create', record: { id: 'b', type: 'shot', parentId: 'sc4', sortKey: 'V', props: { number: '4B', status: 'need', size: 'WS' } } },
    ]);
  });
  afterEach(async () => {
    await project.close();
    folder.remove();
  });

  const addSuggestion = async (id: string, props: Props) => {
    const b = await getRecord(project.file, 'b');
    await apply(project.file, [
      {
        kind: 'create',
        record: {
          id,
          type: 'suggestion',
          parentId: project.projectId,
          sortKey: id,
          props: { status: 'pending', source: 'mcp', change_file_id: 'cf1', author: { name: 'Robin Vale', role: 'assistant' }, target_updated_at: b?.updatedAt ?? at, ...props },
        },
      },
    ]);
  };
  const status = async (id: string) => (await getRecord(project.file, id))?.props.status;

  it('Apply: one group; undo brings the suggestion back to pending and the frame back; redo applies it again', async () => {
    await addSuggestion('s1', { kind: 'trash', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: {} });
    const groups = (await log(project.file)).length;
    const done = await applySuggestion(project.file, project.projectId, 's1', { author: 'Robin Vale' });
    expect(done.applied).toBe(true);
    expect((await log(project.file)).length).toBe(groups + 1);
    expect((await getRecord(project.file, 'b'))?.trashedAt).not.toBeNull();
    expect((await getRecord(project.file, 'b'))?.trashedBy).toBe('Robin Vale');
    expect(await getRecord(project.file, 's1')).toMatchObject({ props: { status: 'approved', decided_by: 'Robin Vale' } });
    await undo(project.file);
    expect(await status('s1')).toBe('pending');
    expect((await getRecord(project.file, 's1'))?.props.decided_by).toBeUndefined();
    expect((await getRecord(project.file, 'b'))?.trashedAt).toBeNull();
    expect((await getRecord(project.file, 'a'))?.props.number).toBe('4A');
    await redo(project.file);
    expect(await status('s1')).toBe('approved');
    expect((await getRecord(project.file, 'b'))?.trashedAt).not.toBeNull();
  });

  it('Apply of a create keeps the id it made; undo takes the frame and the id away', async () => {
    await addSuggestion('s1', { kind: 'create', target_type: 'shot', target_label: 'New frame', data: { type: 'shot', parent_id: 'sc4', after_id: 'b', props: { size: 'INSERT' } } });
    await applySuggestion(project.file, project.projectId, 's1');
    const stored = (await getRecord(project.file, 's1'))?.props.created_id;
    expect(typeof stored).toBe('string');
    const createdId = typeof stored === 'string' ? stored : '';
    expect(await getRecord(project.file, createdId)).toMatchObject({ type: 'shot', parentId: 'sc4', props: { number: '4C', size: 'INSERT', status: 'need' } });
    await undo(project.file);
    expect(await getRecord(project.file, createdId)).toBeNull();
    expect((await getRecord(project.file, 's1'))?.props.created_id).toBeUndefined();
    expect(await status('s1')).toBe('pending');
  });

  it('Reject: one group that writes only the suggestion; undo brings it back to pending', async () => {
    await addSuggestion('s1', { kind: 'update', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: { props: { size: 'CU' }, before: { size: 'WS' } } });
    const before = (await loadRecords(project.file)).filter((r) => r.id !== 's1');
    const groups = (await log(project.file)).length;
    expect(await rejectSuggestion(project.file, 's1', { author: 'Robin Vale' })).toBe(true);
    expect((await log(project.file)).length).toBe(groups + 1);
    expect((await loadRecords(project.file)).filter((r) => r.id !== 's1')).toEqual(before);
    expect(await getRecord(project.file, 's1')).toMatchObject({ props: { status: 'rejected', decided_by: 'Robin Vale' } });
    expect(await rejectSuggestion(project.file, 's1')).toBe(false);
    await undo(project.file);
    expect(await status('s1')).toBe('pending');
    await redo(project.file);
    expect(await status('s1')).toBe('rejected');
  });

  it('decided_at is the step’s own time, even when the clock reads earlier than the log (round 2, item 4)', async () => {
    await addSuggestion('s1', { kind: 'trash', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: {} });
    await addSuggestion('s2', { kind: 'update', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: { props: { size: 'CU' }, before: {} } });
    const behind = () => new Date('2020-01-01T00:00:00.000Z');
    await applySuggestion(project.file, project.projectId, 's1', { now: behind });
    await rejectSuggestion(project.file, 's2', { now: behind });
    const [applied, rejected] = (await log(project.file)).slice(-2);
    expect((await getRecord(project.file, 's1'))?.props.decided_at).toBe(applied?.timestamp);
    expect((await getRecord(project.file, 's2'))?.props.decided_at).toBe(rejected?.timestamp);
    expect(applied?.timestamp.startsWith('2020')).toBe(false);
    expect((await getRecord(project.file, 'b'))?.trashedAt).toBe(applied?.timestamp);
  });

  it('a suggestion flagged so it can’t be applied writes nothing', async () => {
    await addSuggestion('s1', { kind: 'update', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: { props: { number: '9Z' }, before: {} } });
    const groups = (await log(project.file)).length;
    const done = await applySuggestion(project.file, project.projectId, 's1');
    expect(done.applied).toBe(false);
    expect(done.review?.flags).toContainEqual({ kind: 'outside_scope', what: 'field', name: 'number' });
    expect((await log(project.file)).length).toBe(groups);
    expect(await status('s1')).toBe('pending');
  });
});

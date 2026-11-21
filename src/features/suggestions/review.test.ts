import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS } from '../../core/model/shotNumbers';
import { reviewFlagWords, type SuggestionFlag } from '../../core/model/suggestion';
import { apply, loadRecords, log, undo, type Change } from '../../core/ops/ops';
import { bringInChangeFile } from '../../core/ops/suggestions';
import { isUnread, loadReadState, markAllReadStatements, markReadStatement, stepsSince } from '../../core/storage/notifications';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { loadSlateNumbers } from '../../core/storage/slateNumbers';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { coveredSteps, suggestionNotes, suggestionUnread, unreadCount } from '../notifications/notificationsStore';
import { applyOne, applyRest, rejectOne, rejectRest, type DecisionQueue } from './decide';
import { groupReviews, groupReviewsRun, headline, plain, restToApply, restToReject, suggestionGroups, updateRows } from './review';

// The review screen's readers and decisions (7.2): imports grouped newest first, each in the file's order; Apply the rest
// takes only unflagged adds (a new scene's frames after it), Reject the rest everything pending; every decision its own
// op group, undone one at a time; one notification per import with its own read state; and a big import reviewed once
// per records object. Made-up people and projects only: Robin Vale, "Harbor Lights".

const earlier = '2026-11-20T09:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'V', createdAt = earlier): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt,
  updatedAt: earlier,
});
const recordsOf = (...list: SbdRecord[]): Record<string, SbdRecord> => Object.fromEntries(list.map((r) => [r.id, r]));

function harbor(): Record<string, SbdRecord> {
  return recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('sc4', 'scene', 'p', { number: '4', name: 'Dock' }, 'M'),
    record('a', 'shot', 'sc4', { number: '4A', status: 'need', size: 'WS' }, 'M'),
    record('b', 'shot', 'sc4', { number: '4B', status: 'need', size: 'WS', lens_mm: 35 }, 'V'),
  );
}

const suggestion = (id: string, sortKey: string, props: Props, changeFile = 'cf1', createdAt = earlier): SbdRecord =>
  record(
    id,
    'suggestion',
    'p',
    { status: 'pending', source: 'mcp', change_file_id: changeFile, author: { name: 'Robin Vale', role: 'dp' }, suggested_at: earlier, note: '', target_updated_at: earlier, ...props },
    sortKey,
    createdAt,
  );

/** One import with every kind: a trash, an update changed since, a scene and two frames after it, a bad frame, and a reorder. */
function mixed(): Record<string, SbdRecord> {
  return {
    ...harbor(),
    ...recordsOf(
      suggestion('s1', 'a1', { kind: 'trash', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: {} }),
      // 4B reads 35 mm now; the suggester saw 50.
      suggestion('s2', 'a2', { kind: 'update', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: { props: { lens_mm: 85 }, before: { lens_mm: 50 } } }),
      suggestion('s3', 'a3', { kind: 'create', target_type: 'scene', target_label: 'Pier', data: { type: 'scene', parent_id: 'p', after_id: 'sc4', props: { name: 'Pier' } } }),
      suggestion('s4', 'a4', { kind: 'create', target_type: 'shot', target_label: 'Wide', after_suggestion: 's3', data: { type: 'shot', parent_id: 's3', after_id: null, props: { size: 'WS' } } }),
      suggestion('s5', 'a5', { kind: 'create', target_type: 'shot', target_label: 'Close', after_suggestion: 's3', data: { type: 'shot', parent_id: 's3', after_id: 's4', props: { size: 'CU' } } }),
      // Flagged: not a size the board knows.
      suggestion('s6', 'a6', { kind: 'create', target_type: 'shot', target_label: 'Odd', data: { type: 'shot', parent_id: 'sc4', after_id: 'b', props: { size: 'XXL' } } }),
      suggestion('s7', 'a7', { kind: 'reorder', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: { parent_id: 'sc4', after_id: null } }),
    ),
  };
}

beforeEach(() => {
  setLocale('en');
});

describe('the review screen’s groups (7.2)', () => {
  it('groups by import, newest import first, each in the file’s order, with its source, authors, time and pending', () => {
    const records = {
      ...mixed(),
      ...recordsOf(
        suggestion('t1', 'b1', { kind: 'trash', target_id: 'b', target_type: 'shot', data: {}, author: { name: 'Sam Ortiz', role: 'client' }, source: 'change_file' }, 'cf2', '2026-11-21T10:00:00.000Z'),
        suggestion('t2', 'b2', { kind: 'trash', target_id: 'a', target_type: 'shot', data: {}, status: 'rejected' }, 'cf2', '2026-11-21T10:00:00.000Z'),
      ),
    };
    const groups = suggestionGroups(records, 'p');
    expect(groups.map((g) => g.id)).toEqual(['cf2', 'cf1']);
    expect(groups[0]).toMatchObject({ source: 'change_file', authors: ['Sam Ortiz', 'Robin Vale'], broughtInAt: '2026-11-21T10:00:00.000Z', ids: ['t1', 't2'], pending: ['t1'] });
    expect(groups[1]?.ids).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
    // Kept per records object: the same list again.
    expect(suggestionGroups(records, 'p')).toBe(groups);
  });

  it('Apply the rest takes only unflagged adds, the scene and then its frames; its confirmation lists them in that order', () => {
    const records = mixed();
    const [group] = suggestionGroups(records, 'p');
    if (!group) throw new Error('no group');
    const reviews = groupReviews(records, 'p', group, NO_SLATE_NUMBERS);
    expect(restToApply(group, reviews)).toEqual(['s3', 's4', 's5']);
    expect(['s3', 's4', 's5'].map((id) => plain(headline(records, reviews.get(id)?.suggestion ?? (null as never))))).toEqual([
      'Add a scene after SC 04',
      'Add a frame at the start of the new scene',
      'Add a frame after one another suggestion adds, in the new scene',
    ]);
    // Never the trash, the update changed since, the reorder or the flagged frame.
    expect(restToApply(group, reviews)).not.toContain('s6');
  });

  it('an update changed since shows the three values: then, suggested, now', () => {
    const records = mixed();
    const [group] = suggestionGroups(records, 'p');
    if (!group) throw new Error('no group');
    const review = groupReviews(records, 'p', group, NO_SLATE_NUMBERS).get('s2');
    if (!review) throw new Error('no review');
    expect(review.flags.map((f) => reviewFlagWords(f, 'shot'))).toEqual(['Changed since it was suggested. Apply still writes the suggested value.']);
    expect(updateRows(records, review)).toEqual([{ field: 'lens_mm', label: 'Lens', then: { mono: '50mm' }, suggested: { mono: '85mm' }, now: { mono: '35mm' } }]);
    expect(plain(headline(records, review.suggestion))).toBe('Change SC 04 · 4B');
  });

  it('Reject the rest takes every pending suggestion, any kind, in the file’s order', () => {
    const records = mixed();
    const [group] = suggestionGroups(records, 'p');
    if (!group) throw new Error('no group');
    expect(restToReject(group)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  });

  it('every flag has words, en and es', () => {
    const flags: SuggestionFlag[] = [
      { kind: 'decided', status: 'approved' },
      { kind: 'decided', status: 'rejected' },
      { kind: 'newer', what: 'kind', name: 'restore' },
      { kind: 'newer', what: 'field', name: 'mood' },
      { kind: 'outside_scope', what: 'kind', name: 'reorder' },
      { kind: 'outside_scope', what: 'type', name: 'person' },
      { kind: 'outside_scope', what: 'field', name: 'phone' },
      { kind: 'invalid', field: 'size', problem: 'choice' },
      { kind: 'invalid', field: 'after_id', problem: 'not_found' },
      { kind: 'invalid', field: 'after_id', problem: 'loop' },
      { kind: 'gone', what: 'target' },
      { kind: 'gone', what: 'parent' },
      { kind: 'gone', what: 'after' },
      { kind: 'trashed', what: 'target' },
      { kind: 'trashed', what: 'parent' },
      { kind: 'waiting', on: 's3' },
      { kind: 'waiting_after', on: 's4' },
      { kind: 'cant_apply', why: 'scene_first' },
      { kind: 'cant_apply', why: 'not_need' },
      { kind: 'locked' },
      { kind: 'changed_since', fields: [] },
      { kind: 'no_change' },
    ];
    for (const lang of ['en', 'es'] as const) {
      setLocale(lang);
      const words = flags.map((flag) => reviewFlagWords(flag, 'shot'));
      expect(words.every((w) => w.length > 0)).toBe(true);
      expect(new Set(words).size).toBe(words.length);
    }
    setLocale('en');
    expect(reviewFlagWords({ kind: 'invalid', field: 'size', problem: 'choice' }, 'shot')).toBe('Can’t be applied: size isn’t one of its choices.');
    setLocale('es');
    expect(reviewFlagWords({ kind: 'no_change' })).toBe('Sin cambios: el proyecto ya está como se sugiere. Aplicar solo la marca como aplicada.');
  });

  it('a 2,000-suggestion import is reviewed once per records object, never per render', () => {
    const many: SbdRecord[] = [suggestion('n0', 'k0000', { kind: 'create', target_type: 'scene', target_label: 'Pier', data: { type: 'scene', parent_id: 'p', after_id: 'sc4', props: { name: 'Pier' } } })];
    for (let i = 1; i < 2000; i += 1) {
      many.push(
        suggestion(`n${String(i)}`, `k${String(i).padStart(4, '0')}`, {
          kind: 'create',
          target_type: 'shot',
          target_label: `Frame ${String(i)}`,
          after_suggestion: 'n0',
          data: { type: 'shot', parent_id: 'n0', after_id: i === 1 ? null : `n${String(i - 1)}`, props: { size: 'WS' } },
        }),
      );
    }
    const records = { ...harbor(), ...recordsOf(...many) };
    const [group] = suggestionGroups(records, 'p');
    if (!group) throw new Error('no group');
    const before = groupReviewsRun();
    const started = performance.now();
    const reviews = groupReviews(records, 'p', group, NO_SLATE_NUMBERS);
    const first = performance.now() - started;
    // Every render after: no review at all.
    for (let i = 0; i < 50; i += 1) expect(groupReviews(records, 'p', group, NO_SLATE_NUMBERS)).toBe(reviews);
    expect(groupReviewsRun() - before).toBe(1);
    // One edit: a new records object, reviewed once more.
    const edited = { ...records, a: { ...(records.a as SbdRecord), props: { number: '4A', status: 'need', size: 'CU' } } };
    const [same] = suggestionGroups(edited, 'p');
    if (!same) throw new Error('no group');
    const again = performance.now();
    groupReviews(edited, 'p', same, NO_SLATE_NUMBERS);
    const oneEdit = performance.now() - again;
    groupReviews(edited, 'p', same, NO_SLATE_NUMBERS);
    expect(groupReviewsRun() - before).toBe(2);
    expect(restToApply(group, reviews)).toHaveLength(2000);
    // What one edit costs with the import open: one review of the group (said in the report).
    console.info(`7.2 cost: a 2,000-suggestion import reviewed in ${first.toFixed(0)} ms at first, ${oneEdit.toFixed(0)} ms after one edit`);
  });
});

describe('decisions in the file: each its own op group, undone one at a time (7.2)', () => {
  let folder: TestFolder;
  let project: Project;
  let queue: DecisionQueue;

  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
    const p = project.projectId;
    await apply(project.file, [
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: p, sortKey: 'M', props: { number: '4', name: 'Dock' } } },
      { kind: 'create', record: { id: 'a', type: 'shot', parentId: 'sc4', sortKey: 'M', props: { number: '4A', status: 'need' } } },
    ]);
    // The store's queue, on the open file: each build gets the records as they are when its turn comes.
    let turn: Promise<unknown> = Promise.resolve();
    queue = {
      projectId: () => project.projectId,
      by: () => 'Robin Vale',
      applyWith: (build) => {
        const next = turn.then(async () => {
          const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
          const { changes } = build(records, await loadSlateNumbers(project.file));
          if (changes.length === 0) return false;
          await apply(project.file, changes, { author: 'Robin Vale' });
          return true;
        });
        turn = next.catch(() => undefined);
        return next;
      },
    };
  });
  afterEach(async () => {
    await project.close();
    folder.remove();
  });

  const add = async (list: SbdRecord[]) => {
    await apply(
      project.file,
      list.map((r): Change => ({ kind: 'create', record: { id: r.id, type: r.type, parentId: project.projectId, sortKey: r.sortKey, props: r.props } })),
    );
  };
  const read = async () => Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
  const status = async (id: string) => (await read())[id]?.props.status;

  it('Apply the rest: the scene and its frames, one group each, in order; one undo takes back the last frame only', async () => {
    await add([
      suggestion('s3', 'a3', { kind: 'create', target_type: 'scene', target_label: 'Pier', data: { type: 'scene', parent_id: project.projectId, after_id: 'sc4', props: { name: 'Pier' } } }),
      suggestion('s4', 'a4', { kind: 'create', target_type: 'shot', target_label: 'Wide', after_suggestion: 's3', data: { type: 'shot', parent_id: 's3', after_id: null, props: { size: 'WS' } } }),
      suggestion('s5', 'a5', { kind: 'create', target_type: 'shot', target_label: 'Close', after_suggestion: 's3', data: { type: 'shot', parent_id: 's3', after_id: 's4', props: { size: 'CU' } } }),
      suggestion('s1', 'a6', { kind: 'trash', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: {} }),
    ]);
    const records = await read();
    const [group] = suggestionGroups(records, project.projectId);
    if (!group) throw new Error('no group');
    const rest = restToApply(group, groupReviews(records, project.projectId, group, NO_SLATE_NUMBERS));
    expect(rest).toEqual(['s3', 's4', 's5']);
    const steps = (await log(project.file)).length;
    expect(await applyRest(rest, queue)).toEqual({ done: 3, skipped: 0 });
    expect((await log(project.file)).length).toBe(steps + 3);
    const after = await read();
    const made = (id: string): string => {
      const value = after[id]?.props.created_id;
      return typeof value === 'string' ? value : '';
    };
    const scene = made('s3');
    const wide = made('s4');
    const close = made('s5');
    expect(after[scene]).toMatchObject({ type: 'scene', props: { name: 'Pier' } });
    expect(after[wide]).toMatchObject({ parentId: scene, props: { size: 'WS' } });
    expect(after[close]).toMatchObject({ parentId: scene, props: { size: 'CU' } });
    expect((after[wide]?.sortKey ?? '') < (after[close]?.sortKey ?? '')).toBe(true);
    // The trash wasn't taken.
    expect(after.s1?.props.status).toBe('pending');

    await undo(project.file);
    const undone = await read();
    expect(undone[close]).toBeUndefined();
    expect(undone.s5?.props.status).toBe('pending');
    expect(undone[wide]).toBeDefined();
    expect(undone.s4?.props.status).toBe('approved');
    expect(undone[scene]).toBeDefined();
  });

  it('Apply and Reject one by one are a group each; Reject the rest a group per suggestion; each undoes on its own', async () => {
    await add([
      suggestion('s1', 'a1', { kind: 'trash', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: {} }),
      suggestion('s2', 'a2', { kind: 'update', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: { props: { size: 'CU' }, before: {} } }),
      suggestion('s3', 'a3', { kind: 'update', target_id: 'a', target_type: 'shot', target_label: 'SC 04 · 4A', data: { props: { size: 'MS' }, before: {} } }),
    ]);
    const steps = (await log(project.file)).length;
    expect(await applyOne('s2', { queue })).toBe(true);
    expect(await rejectOne('s1', { queue })).toBe(true);
    // Decided already: nothing more is written.
    expect(await rejectOne('s1', { queue })).toBe(false);
    expect((await log(project.file)).length).toBe(steps + 2);
    expect((await read()).a?.props.size).toBe('CU');
    expect(await rejectRest(['s3'], queue)).toEqual({ done: 1, skipped: 0 });
    expect((await log(project.file)).length).toBe(steps + 3);
    await undo(project.file);
    expect(await status('s3')).toBe('pending');
    expect(await status('s1')).toBe('rejected');
    await undo(project.file);
    expect(await status('s1')).toBe('pending');
    expect(await status('s2')).toBe('approved');
    await undo(project.file);
    expect(await status('s2')).toBe('pending');
    expect((await read()).a?.props.size).toBeUndefined();
  });

  it('Apply the rest leaves one that changed meanwhile for a person', async () => {
    await add([suggestion('s6', 'a1', { kind: 'create', target_type: 'shot', target_label: 'Late', data: { type: 'shot', parent_id: 'sc4', after_id: 'a', props: { size: 'WS' } } })]);
    // 4A goes to the Trash before the run's turn: its place is gone now, a flag.
    await apply(project.file, [{ kind: 'trash', id: 'a' }]);
    expect(await applyRest(['s6'], queue)).toEqual({ done: 0, skipped: 1 });
    expect(await status('s6')).toBe('pending');
  });
});

describe('suggestions in Notifications: one per import, with its own read state (7.2)', () => {
  let folder: TestFolder;
  let project: Project;
  const file = (id: string, ids: string[], name: string) =>
    new TextEncoder().encode(
      JSON.stringify({
        format: 'storiiboard.changes',
        version: 1,
        id,
        project_id: project.projectId,
        created_by: 'mcp',
        people: [{ id: 'r1', name, role: 'dp' }],
        suggestions: ids.map((sid) => ({ id: sid, kind: 'trash', target: { id: 'b', type: 'shot', label: 'SC 04 · 4B' }, author: 'r1', data: {} })),
      }),
    );
  const sid = (n: number) => `f2b7a1c0-0000-4c47-9a7e-${String(n).padStart(12, '0')}`;
  const CF1 = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11';
  const CF2 = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a22';

  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
  });
  afterEach(async () => {
    await project.close();
    folder.remove();
  });

  it('each import is one notification at its step’s place, unread even though the step was yours, read once opened', async () => {
    await bringInChangeFile(project.file, project.projectId, file(CF1, [sid(1), sid(2), sid(3)], 'Robin Vale'), { author: 'Kevin' });
    await bringInChangeFile(project.file, project.projectId, file(CF2, [sid(4)], 'Claude Desktop'), { author: 'Kevin' });
    const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    const notes = await suggestionNotes(project.file, records, project.projectId);
    const steps = await stepsSince(project.file, 0);
    expect(notes.map(({ groupId, count, from, itemId }) => ({ groupId, count, from, itemId }))).toEqual([
      { groupId: CF1, count: 3, from: 'Robin Vale', itemId: sid(1) },
      { groupId: CF2, count: 1, from: 'Claude Desktop', itemId: sid(4) },
    ]);
    // Each at the place of the step that brought it in.
    expect(notes.map((n) => n.seq)).toEqual(steps.slice(-2).map((s) => s.seq));

    let read = await loadReadState(project.file, 'local');
    const state = { me: 'Kevin', read, steps, suggestions: notes, file: null, userId: 'local' };
    // The steps were Kevin's, so they read as read; the imports' notifications don't.
    expect(notes.every((n) => suggestionUnread(state, n))).toBe(true);
    expect(coveredSteps(state)).toEqual(new Set(notes.map((n) => n.seq)));
    expect(unreadCount(state)).toBe(2);

    // Opened: read, by its own kind, and kept with the file.
    const first = notes[0];
    if (!first) throw new Error('no note');
    await project.file.tx([markReadStatement('local', 'suggestion', first.itemId, earlier)]);
    read = await loadReadState(project.file, 'local');
    expect(isUnread(read, 'suggestion', first.itemId, first.seq)).toBe(false);
    expect(unreadCount({ ...state, read })).toBe(1);

    // Mark all read covers the other.
    await project.file.tx(markAllReadStatements('local', steps.at(-1)?.seq ?? 0, earlier));
    read = await loadReadState(project.file, 'local');
    expect(unreadCount({ ...state, read })).toBe(0);

    // An undone import has no notification.
    await undo(project.file);
    const now = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    expect((await suggestionNotes(project.file, now, project.projectId)).map((n) => n.groupId)).toEqual([CF1]);
  });
});

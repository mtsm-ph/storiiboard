import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { dayDateLabel } from '../../core/model/shootDay';
import type { Props, SbdRecord } from '../../core/model/record';
import { apply, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import { applySuggestion, rejectSuggestion } from '../../core/ops/suggestions';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from './steps';
import { describeEdit, describeGroup, lineText } from './summary';

// A suggestion in History (7.0): an Apply reads "Applied a suggestion: " and the applied change's own line; a Reject,
// "Rejected a suggestion: " and what it would have done, named as the suggester saw it. Made-up people only.

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'm',
  props,
  trashedAt,
  trashedBy: trashedAt ? 'Robin Vale' : null,
  createdAt: at,
  updatedAt: at,
});
const op = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null): LoggedOp => ({
  id: `o-${(after ?? before)?.id ?? ''}`,
  seq: 1,
  groupId: 'g',
  groupKind: 'edit',
  recordId: (after ?? before)?.id ?? '',
  kind,
  before,
  after,
  author: 'Robin Vale',
  timestamp: at,
});

const scene = record('sc4', 'scene', 'p', { number: '4', name: 'Dock' });
const around = new Map([['sc4', scene]]);
const none = new Set<string>();
const pending = (props: Props) => record('s1', 'suggestion', 'p', { status: 'pending', source: 'mcp', target_label: 'SC 04 · 4B', ...props });
const decided = (props: Props, status: 'approved' | 'rejected') => {
  const before = pending(props);
  return op('update', before, { ...before, props: { ...before.props, status, decided_by: 'Robin Vale', decided_at: at } });
};

const shot = record('b', 'shot', 'sc4', { number: '4B', size: 'WS' });
const trashed = op('trash', shot, { ...shot, trashedAt: at, trashedBy: 'Robin Vale' });

afterEach(() => {
  setLocale('en');
});

describe('History for a suggestion', () => {
  it('words an Apply as the applied change’s own line', () => {
    const own = lineText(describeEdit([trashed], none, around));
    expect(lineText(describeEdit([trashed, decided({ kind: 'trash', target_id: 'b', target_type: 'shot' }, 'approved')], none, around))).toBe(`Applied a suggestion: ${own}`);
    const sized = op('update', shot, { ...shot, props: { ...shot.props, size: 'CU' } });
    const sizedOwn = lineText(describeEdit([sized], none, around));
    expect(lineText(describeEdit([sized, decided({ kind: 'update', target_id: 'b', target_type: 'shot' }, 'approved')], none, around))).toBe(`Applied a suggestion: ${sizedOwn}`);
  });

  it('words a Reject by what it would have done, for each kind, and one this version can’t read', () => {
    const line = (props: Props) => lineText(describeEdit([decided(props, 'rejected')], none, around));
    expect(line({ kind: 'trash' })).toBe('Rejected a suggestion: move SC 04 · 4B to the Trash');
    expect(line({ kind: 'update' })).toBe('Rejected a suggestion: change SC 04 · 4B');
    expect(line({ kind: 'create', target_label: '' })).toBe('Rejected a suggestion: add an item');
    expect(line({ kind: 'reorder' })).toBe('Rejected a suggestion: move SC 04 · 4B');
    expect(line({ kind: 'restore' })).toBe('Rejected a suggestion: a change this version can’t read');
  });

  it('names the undo of an Apply by its step', () => {
    const titles = new Map([['g1', describeEdit([trashed, decided({ kind: 'trash' }, 'approved')], none, around)]]);
    const group: OpGroup = { id: 'g2', seq: 2, kind: 'undo', targetGroupId: 'g1', restoreTo: null, author: 'Robin Vale', timestamp: at, opCount: 2 };
    expect(lineText(describeGroup(group, [], titles, none))).toBe(`Undid: Applied a suggestion: ${lineText(describeEdit([trashed], none, around))}`);
  });

  it('words an Apply that wrote only the decision as one that changed nothing (round 2, item 9)', () => {
    expect(lineText(describeEdit([decided({ kind: 'update', target_id: 'b', target_type: 'shot' }, 'approved')], none, around))).toBe('Applied a suggestion that changed nothing');
    setLocale('es');
    expect(lineText(describeEdit([decided({ kind: 'update', target_id: 'b', target_type: 'shot' }, 'approved')], none, around))).toBe('Se aplicó una sugerencia que no cambiaba nada');
  });

  it('names a Reject’s target by its record’s own name, and by the file’s label only once the record is gone (round 2, item 9)', () => {
    // The frame is 4C now; the suggester saw 4B.
    const renumbered = new Map([...around, ['b', record('b', 'shot', 'sc4', { number: '4C' })]]);
    const rejected = decided({ kind: 'trash', target_id: 'b', target_type: 'shot' }, 'rejected');
    expect(lineText(describeEdit([rejected], none, renumbered))).toBe('Rejected a suggestion: move 4C to the Trash');
    expect(lineText(describeEdit([rejected], none, around))).toBe('Rejected a suggestion: move SC 04 · 4B to the Trash');
    const day = record('d1', 'shoot_day', 'p', { date: '2026-12-01' });
    const sheet = decided({ kind: 'update', target_id: 'd1', target_type: 'callsheet', target_label: 'Call sheet' }, 'rejected');
    expect(lineText(describeEdit([sheet], none, new Map([['d1', day]])))).toBe(`Rejected a suggestion: change Call sheet · ${dayDateLabel('2026-12-01')}`);
    setLocale('es');
    expect(lineText(describeEdit([rejected], none, renumbered))).toBe('Se rechazó una sugerencia: enviar 4C a la Papelera');
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    const own = lineText(describeEdit([trashed], none, around));
    expect(lineText(describeEdit([trashed, decided({ kind: 'trash' }, 'approved')], none, around))).toBe(`Se aplicó una sugerencia: ${own}`);
    expect(lineText(describeEdit([decided({ kind: 'trash' }, 'rejected')], none, around))).toBe('Se rechazó una sugerencia: enviar SC 04 · 4B a la Papelera');
  });
});

describe('History for a suggestion, read from a file (round 2, item 9)', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
    await apply(project.file, [
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'M', props: { number: '4', name: 'Dock' } } },
      { kind: 'create', record: { id: 'b', type: 'shot', parentId: 'sc4', sortKey: 'V', props: { number: '4B', status: 'need', size: 'CU' } } },
    ]);
  });
  afterEach(async () => {
    await project.close();
    folder.remove();
  });
  const add = (id: string, props: Props) =>
    apply(project.file, [
      { kind: 'create', record: { id, type: 'suggestion', parentId: project.projectId, sortKey: id, props: { status: 'pending', source: 'mcp', change_file_id: 'cf1', author: { name: 'Robin Vale', role: 'assistant' }, ...props } } },
    ]);
  const newest = async () => lineText((await loadSteps(project.file, 1)).steps[0]?.line ?? []);

  it('a Reject names the frame by its number as the step left it; an Apply that changed nothing says so', async () => {
    await add('s1', { kind: 'trash', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4A', data: {} });
    expect(await rejectSuggestion(project.file, 's1')).toBe(true);
    expect(await newest()).toBe('Rejected a suggestion: move 4B to the Trash');
    await add('s2', { kind: 'update', target_id: 'b', target_type: 'shot', target_label: 'SC 04 · 4B', data: { props: { size: 'CU' }, before: { size: 'CU' } } });
    expect((await applySuggestion(project.file, project.projectId, 's2')).applied).toBe(true);
    expect(await newest()).toBe('Applied a suggestion that changed nothing');
    setLocale('es');
    expect(await newest()).toBe('Se aplicó una sugerencia que no cambiaba nada');
  });
});

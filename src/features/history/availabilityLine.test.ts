import { afterEach, describe, expect, it } from 'vitest';
import { addStretch, removeStretch } from '../../core/model/availability';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject } from '../../core/storage/project';
import { makeTestFolder } from '../../core/storage/testFolder';
import { loadSteps, moreItemLog, readItemLog } from './steps';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import { apply, undo, type LoggedOp } from '../../core/ops/ops';
import { describeEdit, frameRows, lineText } from './summary';

// Unavailable dates in History (7.3): a stretch marked, taken off and put back, each one line named by the person as
// the step left them and the dates, never the note, in English and Spanish.

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'm',
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const op = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null): LoggedOp => ({
  id: 'o',
  seq: 1,
  groupId: 'g',
  groupKind: 'edit',
  recordId: (after ?? before)?.id ?? '',
  kind,
  before,
  after,
  author: 'local',
  timestamp: at,
});

const robin = record('robin', 'person', 'p', { name: 'Robin Vale' });
const week = record('a', 'availability', 'robin', { from: '2026-11-24', to: '2026-11-28', state: 'unavailable', note: 'Surgery' });
const day = record('b', 'availability', 'robin', { from: '2026-12-01', to: '2026-12-01', state: 'unavailable', note: '' });
const around = new Map<string, SbdRecord>([['robin', robin]]);
const none = new Set<string>();
const say = (ops: LoggedOp[], near: ReadonlyMap<string, SbdRecord> = around) => lineText(describeEdit(ops, none, near));

afterEach(() => {
  setLocale('en');
});

describe('History for unavailable dates', () => {
  it('says a stretch was marked, taken off and put back, by the person and the dates', () => {
    expect(say([op('create', null, week)])).toBe('Marked Robin Vale unavailable Nov 24 – Nov 28, 2026');
    expect(say([op('create', null, day)])).toBe('Marked Robin Vale unavailable Dec 1, 2026');
    expect(say([op('trash', week, { ...week, trashedAt: at })])).toBe('Took off Robin Vale’s unavailable dates Nov 24 – Nov 28, 2026');
    expect(say([op('restore', { ...week, trashedAt: at }, week)])).toBe('Put back Robin Vale’s unavailable dates Nov 24 – Nov 28, 2026');
  });

  it('never says the note, and still reads without the person or with dates it can’t read', () => {
    expect(say([op('create', null, week)])).not.toContain('Surgery');
    expect(say([op('create', null, week)], new Map())).toBe('Marked a person unavailable Nov 24 – Nov 28, 2026');
    const odd = record('x', 'availability', 'robin', { from: 'soon', to: 'later', state: 'unavailable' });
    expect(say([op('create', null, odd)])).toBe('Changed Robin Vale’s unavailable dates');
    expect(say([op('update', week, { ...week, props: { ...week.props, to: '2026-11-29' } })])).toBe('Changed Robin Vale’s unavailable dates');
  });

  it('says it in Spanish', () => {
    setLocale('es');
    expect(say([op('create', null, week)])).toMatch(/^Se marcó a Robin Vale como no disponible 24 nov\.? – 28 nov\.? 2026$/);
    expect(say([op('trash', week, { ...week, trashedAt: at })])).toMatch(/^Se quitaron las fechas no disponibles de Robin Vale: 24 nov\.? – 28 nov\.? 2026$/);
  });

  it('tells two stretches a year apart from each other', () => {
    const later = { ...week, id: 'c', props: { ...week.props, from: '2027-11-24', to: '2027-11-28' } };
    expect(say([op('create', null, later)])).toBe('Marked Robin Vale unavailable Nov 24 – Nov 28, 2027');
    expect(say([op('create', null, later)])).not.toBe(say([op('create', null, week)]));
  });
});

describe('a person’s own history', () => {
  it('shows their stretch steps, as a frame’s shows its strokes, and nothing else under them', async () => {
    const folder = makeTestFolder();
    const project = await createProject(folder.path('Harbor Lights (person).sbd'), { driver: nodeDriver, backups: false });
    try {
      const file = project.file;
      const person = { ...robin, parentId: project.projectId };
      await apply(file, [{ kind: 'create', record: { id: 'robin', type: 'person', parentId: project.projectId, sortKey: 'a', props: { name: 'Robin Vale' } } }]);
      await apply(file, addStretch({ robin: person }, 'robin', '2026-11-24', '2026-11-28', 'Surgery', 'a1'));
      // A link on the person (3.11) has a history of its own: not a row in theirs.
      await apply(file, [{ kind: 'create', record: { id: 'l1', type: 'media', parentId: 'robin', sortKey: 'b', props: { kind: 'link', url: 'https://example.com', name: 'Agent' } } }]);
      const first = await readItemLog(file, person);
      expect(first.ops.map((o) => o.recordId)).toEqual(['robin', 'a1']);
      // A later step reads only what's new, and still takes in the stretch.
      await apply(file, removeStretch({ robin: person, a1: { ...week, id: 'a1' } }, 'a1'));
      await undo(file);
      const later = await moreItemLog(file, person, first);
      expect(later.ops.map((o) => o.recordId)).toEqual(['robin', 'a1', 'a1', 'a1']);
      const rows = frameRows(later.ops, 'robin').map((row) => row.change);
      expect(rows.slice(0, 3)).toEqual([
        'Undid: Took off unavailable dates Nov 24 – Nov 28, 2026',
        'Took off unavailable dates Nov 24 – Nov 28, 2026',
        'Marked unavailable Nov 24 – Nov 28, 2026',
      ]);
      expect(rows.join(' ')).not.toContain('Surgery');
      // Read afresh, the same.
      expect((await readItemLog(file, person)).ops.map((o) => o.id)).toEqual(later.ops.map((o) => o.id));
      setLocale('es');
      expect(frameRows(later.ops, 'robin')[2]?.change).toMatch(/^Se marcó como no disponible 24 nov\.? – 28 nov\.? 2026$/);
    } finally {
      await project.close();
      folder.remove();
    }
  });
});

describe('History for unavailable dates, from the file', () => {
  it('names the person the step didn’t write, as it was then', async () => {
    const folder = makeTestFolder();
    const project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
    try {
      const file = project.file;
      await apply(file, [{ kind: 'create', record: { id: 'robin', type: 'person', parentId: project.projectId, sortKey: 'a', props: { name: 'Robin Vale' } } }]);
      const person = (): Record<string, SbdRecord> => ({ robin: { ...robin, parentId: project.projectId } });
      await apply(file, addStretch(person(), 'robin', '2026-11-24', '2026-11-28', 'Surgery', 'a1'));
      const marked = { ...person(), a1: { ...week, id: 'a1' } };
      await apply(file, removeStretch(marked, 'a1'));
      await undo(file);
      const { steps } = await loadSteps(file, Number.MAX_SAFE_INTEGER);
      expect(steps.map((step) => lineText(step.line)).reverse()).toEqual([
        'Added Robin Vale to cast and crew',
        'Marked Robin Vale unavailable Nov 24 – Nov 28, 2026',
        'Took off Robin Vale’s unavailable dates Nov 24 – Nov 28, 2026',
        'Undid: Took off Robin Vale’s unavailable dates Nov 24 – Nov 28, 2026',
      ]);
    } finally {
      await project.close();
      folder.remove();
    }
  });
});

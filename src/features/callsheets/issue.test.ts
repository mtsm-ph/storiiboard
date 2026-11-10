import { describe, expect, it } from 'vitest';
import { callSheetIssues, nextIssueVersion } from '../../core/model/callsheet';
import type { Props, SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS } from '../../core/model/shotNumbers';
import type { Change } from '../../core/ops/ops';
import { FINGERPRINT_VERSION } from './fingerprint';
import { issueChanges, issuedFileName, type IssueInput } from './issue';

// Issuing a call sheet (4.7) as a change list: the media record under the call sheet, the call sheet made when the day
// has none, and the lock on the scenes not locked yet.

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null, sortKey = 'm'): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

function project(extra: SbdRecord[] = [], day: Props = {}) {
  return recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', { date: '2026-11-16', call_time: '07:00', ...day }),
    record('s1', 'scene', 'p', { number: '1', name: 'Diner' }),
    record('s2', 'scene', 'p', { number: '2', name: 'Parking lot', numbers_locked: true }, null, 'n'),
    record('s3', 'scene', 'p', { number: '3', name: 'Not today' }, null, 'o'),
    record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
    record('b', 'shot', 's2', { number: '2A', shoot_day_id: 'd' }),
    record('c', 'shot', 's3', { number: '3A' }),
    ...extra,
  );
}

const input = (extra: Partial<IssueInput> = {}): IssueInput => ({
  projectId: 'p',
  dayId: 'd',
  version: 1,
  author: 'Kevin Matos',
  issuedAt: new Date('2030-11-16T23:04:00Z'),
  zone: 'America/New_York',
  sha256: 'abc',
  byteSize: 1234,
  name: 'Bey County — Call sheet — Day 1 — 2030-11-16.pdf',
  fingerprint: 'f1',
  ids: { callsheet: 'cs', media: 'm1' },
  ...extra,
});

/** Applies creates and updates to records the way ops would, enough to read the result back. */
function applied(records: ReturnType<typeof project>, changes: readonly Change[]) {
  const next: Record<string, SbdRecord> = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const { id = 'x', type, parentId, sortKey, props = {} } = change.record;
      next[id] = record(id, type, parentId, props, null, sortKey);
    } else if (change.kind === 'update' && next[change.id]) {
      const was = next[change.id] as SbdRecord;
      next[change.id] = { ...was, props: { ...was.props, ...change.set } };
    }
  }
  return next;
}

describe('the change list of an issue', () => {
  it('makes the call sheet when the day has none, and a PDF record under it with the issue props', () => {
    const result = issueChanges(project(), NO_SLATE_NUMBERS, input());
    if ('refused' in result) throw new Error('refused');
    expect(result.changes[0]).toMatchObject({ kind: 'create', record: { id: 'cs', type: 'callsheet', parentId: 'd', props: {} } });
    expect(result.changes[1]).toMatchObject({
      kind: 'create',
      record: {
        id: 'm1',
        type: 'media',
        parentId: 'cs',
        props: {
          kind: 'pdf',
          file: 'abc',
          byte_size: 1234,
          source_name: 'Bey County — Call sheet — Day 1 — 2030-11-16.pdf',
          issue_version: 1,
          issued_at: '2030-11-16T23:04:00.000Z',
          issued_by: 'Kevin Matos',
          fingerprint: 'f1',
          fingerprint_version: FINGERPRINT_VERSION,
        },
      },
    });
  });

  it('puts the PDF under the call sheet the day already has, making no other', () => {
    const records = project([record('old', 'callsheet', 'd', { notes: 'Park behind' })]);
    const result = issueChanges(records, NO_SLATE_NUMBERS, input());
    if ('refused' in result) throw new Error('refused');
    expect(result.changes.filter((c) => c.kind === 'create' && c.record.type === 'callsheet')).toEqual([]);
    expect(result.changes[0]).toMatchObject({ kind: 'create', record: { type: 'media', parentId: 'old' } });
  });

  it('locks the day’s scenes that are not locked, and leaves a locked one and a scene off the day alone', () => {
    const result = issueChanges(project(), NO_SLATE_NUMBERS, input());
    if ('refused' in result) throw new Error('refused');
    const locked = result.changes.flatMap((c) => (c.kind === 'update' && c.set?.numbers_locked === true ? [c.id] : []));
    expect(locked).toEqual(['s1']);
    expect(result.changes.some((c) => c.kind === 'update' && c.set?.numbers_locked !== undefined && c.id !== 's1')).toBe(false);
  });

  it('locks several scenes one after another, so two that would take the same letter do not', () => {
    const records = recordsOf(
      record('p', 'project', null, { title: 'Bey County' }),
      record('d', 'shoot_day', 'p', { date: '2026-11-16' }),
      record('s1', 'scene', 'p', { number: '4', name: 'Diner' }),
      record('s2', 'scene', 'p', { number: '4', name: 'Diner again' }, null, 'n'),
      record('a', 'shot', 's1', { number: '', shoot_day_id: 'd' }),
      record('b', 'shot', 's2', { number: '', shoot_day_id: 'd' }),
    );
    const result = issueChanges(records, NO_SLATE_NUMBERS, input());
    if ('refused' in result) throw new Error('refused');
    const numbers = result.changes.flatMap((c) => (c.kind === 'update' && typeof c.set?.number === 'string' && c.set.number !== '' ? [c.set.number] : []));
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size).toBe(2);
  });

  it('reads back as one issue on the day, with the scene locked', () => {
    const records = project();
    const result = issueChanges(records, NO_SLATE_NUMBERS, input());
    if ('refused' in result) throw new Error('refused');
    const after = applied(records, result.changes);
    expect(callSheetIssues(after, 'd').map((i) => [i.version, i.issuedBy, i.name])).toEqual([[1, 'Kevin Matos', 'Bey County — Call sheet — Day 1 — 2030-11-16.pdf']]);
    expect(after.s1?.props.numbers_locked).toBe(true);
  });

  it('refuses a day with no date, a day that is gone, a PDF over 50 MB, and a version already taken', () => {
    expect(issueChanges(project([], { date: '' }), NO_SLATE_NUMBERS, input())).toEqual({ refused: 'noDate' });
    expect(issueChanges(project(), NO_SLATE_NUMBERS, input({ dayId: 'nothing' }))).toEqual({ refused: 'noDay' });
    expect(issueChanges(project(), NO_SLATE_NUMBERS, input({ byteSize: 50 * 1024 * 1024 + 1 }))).toEqual({ refused: 'tooBig' });
    expect(issueChanges(project(), NO_SLATE_NUMBERS, input({ version: 2 }))).toEqual({ refused: 'versionTaken' });
  });
});

describe('issue numbers', () => {
  const issue = (id: string, version: number, trashedAt: string | null = null) =>
    record(id, 'media', 'cs', { kind: 'pdf', file: id, source_name: `${id}.pdf`, byte_size: 1, issue_version: version, issued_at: at, issued_by: 'local', fingerprint: 'x', fingerprint_version: 1 }, trashedAt, id);

  it('is the highest live issue’s plus one, newest first', () => {
    const records = project([record('cs', 'callsheet', 'd', {}), issue('a', 1), issue('b', 2)]);
    expect(nextIssueVersion(records, 'd')).toBe(3);
    expect(callSheetIssues(records, 'd').map((i) => i.version)).toEqual([2, 1]);
  });

  it('uses an undone issue’s number again, and starts at 1', () => {
    expect(nextIssueVersion(project([record('cs', 'callsheet', 'd', {}), issue('a', 1)]), 'd')).toBe(2);
    expect(nextIssueVersion(project([record('cs', 'callsheet', 'd', {})]), 'd')).toBe(1);
    expect(nextIssueVersion(project(), 'd')).toBe(1);
    // One in the Trash doesn't count.
    expect(nextIssueVersion(project([record('cs', 'callsheet', 'd', {}), issue('a', 1, at)]), 'd')).toBe(1);
  });

  it('ignores media on the call sheet that is not an issue', () => {
    const plain = record('pdf', 'media', 'cs', { kind: 'pdf', file: 'x', source_name: 'x.pdf', byte_size: 1 });
    expect(callSheetIssues(project([record('cs', 'callsheet', 'd', {}), plain]), 'd')).toEqual([]);
  });
});

describe('the file name of an issue', () => {
  it('is the sheet’s own for version 1 and has " v2" before .pdf from version 2', () => {
    expect(issuedFileName('Bey County — Call sheet — Day 1.pdf', 1)).toBe('Bey County — Call sheet — Day 1.pdf');
    expect(issuedFileName('Bey County — Call sheet — Day 1.pdf', 2)).toBe('Bey County — Call sheet — Day 1 v2.pdf');
    expect(issuedFileName('Day.PDF', 12)).toBe('Day v12.pdf');
  });
});

import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from './record';
import { flagAllowsApply, readSuggestion } from './suggestion';

// A suggestion record read clean (7.0): bounded and rebuilt, as a settings preset is, since it came from a change file
// or the assistant. Nothing in the record changes by being read. Made-up people only (Robin Vale).

const at = '2026-11-21T10:00:00.000Z';
const suggestion = (props: Props): SbdRecord => ({
  id: 's1',
  type: 'suggestion',
  parentId: 'p',
  sortKey: 'V',
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});

describe('readSuggestion', () => {
  it('reads each prop the format names', () => {
    const read = readSuggestion(
      suggestion({
        kind: 'update',
        target_id: 'b',
        target_type: 'shot',
        target_label: 'SC 04 · 4B',
        target_updated_at: at,
        status: 'pending',
        source: 'mcp',
        change_file_id: 'cf1',
        author: { name: 'Robin Vale', role: 'assistant', person_id: 'robin' },
        note: 'Tighter for the reveal.\nThen hold.',
        data: { props: { size: 'CU' }, before: { size: 'MCU' } },
        suggested_at: at,
      }),
    );
    expect(read).toMatchObject({
      kind: 'update',
      status: 'pending',
      targetId: 'b',
      targetType: 'shot',
      targetLabel: 'SC 04 · 4B',
      targetUpdatedAt: at,
      source: 'mcp',
      changeFileId: 'cf1',
      author: { name: 'Robin Vale', role: 'assistant', personId: 'robin' },
      note: 'Tighter for the reveal.\nThen hold.',
      createdId: null,
      afterSuggestion: null,
      unknown: [],
      dataProblem: null,
    });
    expect(read.data?.kind === 'update' && [...read.data.props]).toEqual([['size', 'CU']]);
  });

  it('keeps an author’s contact details out, and text bounded and clean', () => {
    const read = readSuggestion(
      suggestion({
        kind: 'trash',
        status: 'pending',
        data: {},
        author: { name: 'Robin\u202E Vale\u0007', role: 'dp', email: 'robin@example.test', phone: '555-0100' },
        target_label: 'x'.repeat(10_000),
        note: 'y'.repeat(10 * 1024 * 1024),
      }),
    );
    expect(read.author).toEqual({ name: 'Robin Vale', role: 'dp', personId: null });
    expect(JSON.stringify(read)).not.toContain('555-0100');
    expect(JSON.stringify(read)).not.toContain('example.test');
    expect(Array.from(read.targetLabel)).toHaveLength(200);
    expect(Array.from(read.note)).toHaveLength(2000);
  });

  it('reads an unknown kind as one this version doesn’t know, and lists unknown fields, bounded', () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`later_${String(i)}`, true]));
    const read = readSuggestion(suggestion({ kind: 'restore', status: 'pending', data: {}, ...many }));
    expect(read.kind).toBeNull();
    expect(read.kindName).toBe('restore');
    expect(read.data).toBeNull();
    expect(read.unknown).toHaveLength(20);
  });

  it('reads data that isn’t its kind’s shape as unreadable, naming the field', () => {
    expect(readSuggestion(suggestion({ kind: 'update', status: 'pending', data: { props: 'size=CU' } })).dataProblem).toBe('props');
    expect(readSuggestion(suggestion({ kind: 'update', status: 'pending', data: { props: {} } })).dataProblem).toBe('props');
    expect(readSuggestion(suggestion({ kind: 'create', status: 'pending', data: { type: 'shot', after_id: null } })).dataProblem).toBe('parent_id');
    expect(readSuggestion(suggestion({ kind: 'reorder', status: 'pending', data: { parent_id: 'sc4', after_id: 7 } })).dataProblem).toBe('after_id');
    expect(readSuggestion(suggestion({ kind: 'trash', status: 'pending', data: [] })).dataProblem).toBe('data');
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${String(i)}`, 1]));
    expect(readSuggestion(suggestion({ kind: 'update', status: 'pending', data: { props: tooMany } })).dataProblem).toBe('props');
  });

  it('reads a status, an id or a time that isn’t one as none', () => {
    const read = readSuggestion(suggestion({ kind: 'trash', status: 'maybe', target_id: 'x'.repeat(500), target_updated_at: 'yesterday', data: {} }));
    expect(read.status).toBeNull();
    expect(read.targetId).toBeNull();
    expect(read.targetUpdatedAt).toBeNull();
  });

  it('changes nothing in the record', () => {
    const record = suggestion({ kind: 'update', status: 'pending', data: { props: { size: 'CU' }, before: {} }, extra: { kept: true } });
    const before = JSON.stringify(record);
    readSuggestion(record);
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe('flagAllowsApply', () => {
  it('leaves Apply open only for changed since, no change and an after_id gone', () => {
    expect(flagAllowsApply({ kind: 'changed_since', fields: [] })).toBe(true);
    expect(flagAllowsApply({ kind: 'no_change' })).toBe(true);
    expect(flagAllowsApply({ kind: 'gone', what: 'after' })).toBe(true);
    expect(flagAllowsApply({ kind: 'gone', what: 'target' })).toBe(false);
    expect(flagAllowsApply({ kind: 'trashed', what: 'target' })).toBe(false);
    expect(flagAllowsApply({ kind: 'newer', what: 'kind', name: 'restore' })).toBe(false);
    expect(flagAllowsApply({ kind: 'outside_scope', what: 'field', name: 'phone' })).toBe(false);
    expect(flagAllowsApply({ kind: 'invalid', field: 'lens_mm', problem: 'range' })).toBe(false);
    expect(flagAllowsApply({ kind: 'waiting', on: 's0' })).toBe(false);
    expect(flagAllowsApply({ kind: 'locked' })).toBe(false);
    expect(flagAllowsApply({ kind: 'decided', status: 'approved' })).toBe(false);
  });
});

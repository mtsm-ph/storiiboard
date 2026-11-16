import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { NO_SLATE_NUMBERS } from '../../core/model/shotNumbers';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { callsheetNoteChange } from './callsheetEdits';
import { issueChanges } from './issue';

// A day's call sheet record and an issued PDF past a sort key keyBetween can't read (6.23, Kevin: an odd imported file
// never makes the app throw): after the last key that can be read; a sound day's keys are keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: trashedAt === null ? null : 'local',
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));
const keysMade = (changes: readonly Change[]) => changes.flatMap((c) => (c.kind === 'create' ? [c.record.sortKey] : []));

const day = () => [record('p', 'project', null, { name: 'Odd' }), record('d1', 'shoot_day', 'p', { date: '2026-12-01' }, 'b')];
const input = (ids: { callsheet?: string; media?: string }) => ({
  projectId: 'p',
  dayId: 'd1',
  version: 1,
  author: 'local',
  issuedAt: new Date('2026-11-16T10:00:00.000Z'),
  zone: 'UTC',
  sha256: 'a'.repeat(64),
  byteSize: 1000,
  name: 'Call sheet.pdf',
  fingerprint: '',
  ids,
});

describe('call sheets past an odd key (6.23)', () => {
  it('makes the day’s call sheet record after the last readable key; a sound day’s key as before', () => {
    const odd = recordsOf(...day(), record('old', 'callsheet', 'd1', {}, '~', at));
    expect(keysMade(callsheetNoteChange(odd, 'd1', 'notes', 'Rain cover', 'cs'))).toEqual([keyBetween(null, null)]);
    const sound = recordsOf(...day(), record('old', 'callsheet', 'd1', {}, 'd', at));
    expect(keysMade(callsheetNoteChange(sound, 'd1', 'notes', 'Rain cover', 'cs'))).toEqual([keyBetween('d', null)]);
  });

  it('issues a PDF after the sheet’s last readable key; a sound sheet’s key as before', () => {
    const odd = recordsOf(...day(), record('cs', 'callsheet', 'd1', {}, 'b'), record('x', 'media', 'cs', { kind: 'link', url: 'https://example.com' }, '~', at));
    const made = issueChanges(odd, NO_SLATE_NUMBERS, input({ media: 'm1' }));
    if (!('changes' in made)) throw new Error(`refused: ${made.refused}`);
    expect(made.changes.find((c) => c.kind === 'create' && c.record.id === 'm1')).toMatchObject({ record: { sortKey: keyBetween(null, null) } });
    const sound = recordsOf(...day(), record('cs', 'callsheet', 'd1', {}, 'b'), record('x', 'media', 'cs', { kind: 'link', url: 'https://example.com' }, 'd', at));
    const plain = issueChanges(sound, NO_SLATE_NUMBERS, input({ media: 'm1' }));
    if (!('changes' in plain)) throw new Error(`refused: ${plain.refused}`);
    expect(plain.changes.find((c) => c.kind === 'create' && c.record.id === 'm1')).toMatchObject({ record: { sortKey: keyBetween('d', null) } });
    // No sheet yet, one in the Trash with an odd key: the new one after the readable ones, the PDF under it.
    const fresh = recordsOf(...day(), record('gone', 'callsheet', 'd1', {}, '~', at));
    const first = issueChanges(fresh, NO_SLATE_NUMBERS, input({ callsheet: 'cs2', media: 'm2' }));
    if (!('changes' in first)) throw new Error(`refused: ${first.refused}`);
    expect(keysMade(first.changes).slice(0, 2)).toEqual([keyBetween(null, null), keyBetween(null, null)]);
  });
});

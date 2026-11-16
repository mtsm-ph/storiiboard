import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { newLink, newPdf } from './attachmentEdits';

// A PDF or link attached past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app
// throw): after the last key that can be read; a sound file's key is keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
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
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));
const keysMade = (changes: readonly Change[]) => changes.flatMap((c) => (c.kind === 'create' ? [c.record.sortKey] : []));

describe('attachments past an odd key (6.23)', () => {
  it('a PDF and a link go after the last readable key; a sound file’s key as before', () => {
    const project = record('p', 'project', null, { name: 'Odd' });
    const odd = recordsOf(project, record('s1', 'scene', 'p', { number: '1' }, 'b'), record('m1', 'media', 'p', { kind: 'link', url: 'https://example.com' }, '~'));
    expect(keysMade(newPdf(odd, 'p', 'Script.pdf', 'a'.repeat(64), 1000))).toEqual([keyBetween('b', null)]);
    expect(keysMade(newLink(odd, 'p', 'https://example.com/b', 'Recce'))).toEqual([keyBetween('b', null)]);
    const sound = recordsOf(project, record('s1', 'scene', 'p', { number: '1' }, 'b'), record('m1', 'media', 'p', { kind: 'link', url: 'https://example.com' }, 'd'));
    expect(keysMade(newPdf(sound, 'p', 'Script.pdf', 'a'.repeat(64), 1000))).toEqual([keyBetween('d', null)]);
  });
});

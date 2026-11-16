import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../../core/model/record';
import { keyBetween } from '../../../core/ops/order';
import { addStroke } from './strokes';

// A stroke drawn past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app throw):
// after the last key that can be read; a sound frame's key is keyBetween's, as before.

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
const line = { tool: 'pen' as const, points: [0, 0, 1, 1], width: 0.004, pressures: null };
const stroke = (id: string, sortKey: string) => record(id, 'stroke', 'f', { tool: 'pen', points: [0, 0, 1, 1], width: 0.004 }, sortKey);

describe('a stroke past an odd key (6.23)', () => {
  it('goes after the last readable key; a sound frame’s key as before', () => {
    const frame = record('f', 'shot', 's1', { number: '1A' });
    expect(addStroke(recordsOf(frame, stroke('a', 'b'), stroke('b', '~')), 'f', line).record.sortKey).toBe(keyBetween('b', null));
    expect(addStroke(recordsOf(frame, stroke('a', 'b'), stroke('b', 'd')), 'f', line).record.sortKey).toBe(keyBetween('d', null));
  });
});

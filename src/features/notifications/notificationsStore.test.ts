import { describe, expect, it } from 'vitest';
import { NOTHING_READ } from '../../core/storage/notifications';
import { merged, stepUnread } from './notificationsStore';

// What reads as unread (3.10): another's step after the cursor, not read one by one. Yours never: a step signed as you
// sign. By name, until sign-in brings a stable id (docs/PLAN.md, 3.10): a rename makes your older steps someone else's.

describe('an unread step', () => {
  const step = (id: string, seq: number, author: string) => ({ id, seq, author });

  it('is another’s, after the cursor, not read one by one', () => {
    const state = { me: 'Kevin Matos', read: { readThrough: 10, read: new Set(['op_group:b']) } };
    expect(stepUnread(state, step('a', 11, 'Sam Ortiz'))).toBe(true);
    expect(stepUnread(state, step('a', 10, 'Sam Ortiz'))).toBe(false);
    expect(stepUnread(state, step('b', 12, 'Sam Ortiz'))).toBe(false);
    expect(stepUnread(state, step('c', 13, 'Kevin Matos'))).toBe(false);
  });

  it('goes by the name signed: unnamed steps (local) are one person’s, and a rename makes the old name someone else', () => {
    expect(stepUnread({ me: 'local', read: NOTHING_READ }, step('a', 1, 'local'))).toBe(false);
    expect(stepUnread({ me: 'Kevin Matos', read: NOTHING_READ }, step('a', 1, 'Kev'))).toBe(true);
  });
});

describe('read state read while a step was being marked read', () => {
  it('keeps what was marked read since the read began: every read, and the furthest cursor', () => {
    const loaded = { readThrough: 5, read: new Set(['op_group:a']) };
    const now = { readThrough: 9, read: new Set(['op_group:b']) };
    expect(merged(loaded, now)).toEqual({ readThrough: 9, read: new Set(['op_group:a', 'op_group:b']) });
    expect(merged({ readThrough: null, read: new Set<string>() }, { readThrough: null, read: new Set(['op_group:c']) })).toEqual({
      readThrough: null,
      read: new Set(['op_group:c']),
    });
  });
});

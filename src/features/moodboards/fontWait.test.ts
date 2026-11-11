import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontReady } from './fonts';

// An edit waits for its font inside the project's queue, where every later edit, undo and delete waits behind it: a
// font that never settles must not hold them.
describe('waiting for a font inside an edit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up after its time limit when the font never settles', async () => {
    vi.useFakeTimers();
    let done = false;
    const never = () => new Promise<void>(() => undefined);
    void fontReady('Brand Sans', 400, false, 5000, never).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('goes on as soon as the font loads, or fails to', async () => {
    await expect(fontReady('Brand Sans', 400, false, 5000, () => Promise.resolve())).resolves.toBeUndefined();
    await expect(fontReady('Brand Sans', 400, false, 5000, () => Promise.reject(new Error('unreadable')))).resolves.toBeUndefined();
  });
});

describe('a face that kept an edit waiting', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not waited for again until it settles', async () => {
    vi.useFakeTimers();
    let settle: () => void = () => undefined;
    const slow = () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      });
    let first = false;
    void fontReady('Slow Sans', 400, false, 5000, slow).then(() => {
      first = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).toBe(true);
    // The load is still going: the next edit goes on at once.
    let second = false;
    void fontReady('Slow Sans', 400, false, 5000, slow).then(() => {
      second = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBe(true);
    // Once it settles, it is waited for again.
    settle();
    await vi.advanceTimersByTimeAsync(0);
    let third = false;
    void fontReady('Slow Sans', 400, false, 5000, () => new Promise<void>(() => undefined)).then(() => {
      third = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(third).toBe(true);
  });
});

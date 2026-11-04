import { describe, expect, it } from 'vitest';
import { openingVersionStore, whileOpening } from './openingVersion';

// Open version (1.23) says which version it's copying for as long as the copy takes, and takes no second press.

describe('Open version while it copies', () => {
  it('names the version until the copy lands, and ignores another press meanwhile', async () => {
    const done: { finish: () => void } = { finish: () => undefined };
    const copying = new Promise<void>((resolve) => {
      done.finish = resolve;
    });
    const first = whileOpening('Board sent to client', () => copying);
    expect(openingVersionStore.getState().name).toBe('Board sent to client');
    let ranAgain = false;
    expect(
      await whileOpening('Locked for shoot', () => {
        ranAgain = true;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(ranAgain).toBe(false);
    expect(openingVersionStore.getState().name).toBe('Board sent to client');
    done.finish();
    expect(await first).toBe(true);
    expect(openingVersionStore.getState().name).toBeNull();
  });

  it('stops saying so when the copy fails', async () => {
    await expect(whileOpening('Board sent to client', () => Promise.reject(new Error('The disk is full.')))).rejects.toThrow('The disk is full.');
    expect(openingVersionStore.getState().name).toBeNull();
    expect(await whileOpening('Board sent to client', () => Promise.resolve())).toBe(true);
  });
});

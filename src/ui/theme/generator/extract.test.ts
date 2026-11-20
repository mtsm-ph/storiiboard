import { afterEach, describe, expect, it, vi } from 'vitest';
import { askWorkerAlone, extractAccents } from './extract';

// The accent reader's worker asked alone (6.27l, for the launch check), and extractAccents still falling back to the
// page as before when the worker gives nothing. Node has no Worker: each test stands one in.

type Answer = { accents?: string[]; error?: string } | 'fail' | 'silent';

/** A Worker that answers every message as told, on the next turn, as a real one would. */
function standIn(answer: Answer) {
  const made: string[] = [];
  class StandIn {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    constructor(url: string | URL) {
      made.push(String(url));
    }
    postMessage(): void {
      setTimeout(() => {
        if (answer === 'silent') return;
        if (answer === 'fail') this.onerror?.();
        else this.onmessage?.({ data: answer });
      }, 0);
    }
    terminate(): void {
      this.terminated = true;
    }
  }
  vi.stubGlobal('Worker', StandIn);
  return made;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the accent worker asked alone', () => {
  it('is null where there is no worker', async () => {
    expect(typeof Worker).toBe('undefined');
    expect(await askWorkerAlone(new Blob())).toBeNull();
  });

  it('gives the worker’s accents, from the theme’s worker file', async () => {
    const made = standIn({ accents: ['#d02020'] });
    expect(await askWorkerAlone(new Blob())).toEqual(['#d02020']);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatch(/worker\.ts$/);
  });

  it('is null when the worker fails, and never asks the page', async () => {
    standIn('fail');
    const page = vi.fn(() => Promise.reject(new Error('the page was asked')));
    vi.stubGlobal('createImageBitmap', page);
    expect(await askWorkerAlone(new Blob())).toBeNull();
    expect(page).not.toHaveBeenCalled();
  });

  it('is null when the worker takes too long', async () => {
    vi.useFakeTimers();
    standIn('silent');
    const answer = askWorkerAlone(new Blob());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await answer).toBeNull();
  });

  it('rejects with the worker’s own reason when it read the image and couldn’t', async () => {
    standIn({ error: 'That image can’t be read.' });
    await expect(askWorkerAlone(new Blob())).rejects.toThrow('That image can’t be read.');
  });
});

describe('extractAccents, as before', () => {
  it('takes the worker’s answer when it gives one', async () => {
    standIn({ accents: ['#d02020', '#2040d0'] });
    expect(await extractAccents(new Blob())).toEqual(['#d02020', '#2040d0']);
  });

  it('does the work on the page when the worker fails', async () => {
    standIn('fail');
    // The page's own reading starts with createImageBitmap: reaching it is the fallback.
    const page = vi.fn(() => Promise.reject(new Error('the page read it')));
    vi.stubGlobal('createImageBitmap', page);
    await expect(extractAccents(new Blob())).rejects.toThrow('the page read it');
    expect(page).toHaveBeenCalledTimes(1);
  });
});

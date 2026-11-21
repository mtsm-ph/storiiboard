import { afterEach, describe, expect, it, vi } from 'vitest';
import { askWorkerAlone, extractAccents } from './extract';
import { accentCandidates } from './generate';
import { stageOf } from './sample';

// The accent reader's worker asked alone (6.27l, for the launch check), and extractAccents still falling back to the
// page as before when the worker gives nothing, and now when it reports an error (6.27r). Node has no Worker: each test
// stands one in.

type Answer = { accents?: string[]; error?: string; stage?: string } | 'fail' | 'silent';

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

  it('rejects with the same words and the worker’s stage beside them (6.27q)', async () => {
    standIn({ error: 'The object is in an invalid state.', stage: 'decode' });
    const thrown: unknown = await askWorkerAlone(new Blob()).catch((caught: unknown) => caught);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('The object is in an invalid state.');
    expect(stageOf(thrown)).toBe('decode');
  });

  it('carries no stage when the worker sent none, or one it doesn’t know', async () => {
    standIn({ error: 'That image can’t be read.' });
    expect(stageOf(await askWorkerAlone(new Blob()).catch((caught: unknown) => caught))).toBeUndefined();
    standIn({ error: 'That image can’t be read.', stage: 'elsewhere' });
    const thrown: unknown = await askWorkerAlone(new Blob()).catch((caught: unknown) => caught);
    expect((thrown as Error).message).toBe('That image can’t be read.');
    expect(stageOf(thrown)).toBeUndefined();
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

/** The pixels the page's fake engine reads: a red half and a white half, 16 by 16. */
const SIDE = 16;
function redAndWhite(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i += 1) {
    const red = i % SIDE < SIDE / 2;
    data.set(red ? [208, 32, 32, 255] : [255, 255, 255, 255], i * 4);
  }
  return data;
}

/** The page's engine, reading the red and white picture: what the page does when the worker gives no accents. */
function pageEngine(): { decoded: () => number } {
  let decoded = 0;
  vi.stubGlobal('createImageBitmap', () => {
    decoded += 1;
    return Promise.resolve({ width: SIDE, height: SIDE, close: () => undefined });
  });
  class FakeCanvas {
    getContext() {
      return { drawImage: () => undefined, getImageData: () => ({ data: redAndWhite() }) };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  return { decoded: () => decoded };
}

describe('extractAccents when the worker reports an error (6.27r)', () => {
  it('asks the page when the worker sent an error with a stage, and the page’s error is the answer (6.27r)', async () => {
    standIn({ error: 'The object is in an invalid state.', stage: 'read' });
    const page = vi.fn(() => Promise.reject(new Error('the page was asked')));
    vi.stubGlobal('createImageBitmap', page);
    const thrown: unknown = await extractAccents(new Blob()).catch((caught: unknown) => caught);
    expect((thrown as Error).message).toBe('the page was asked');
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('gives the page’s accents, whether the worker sent a stage or none', async () => {
    const expected = accentCandidates(redAndWhite(), SIDE, SIDE);
    expect(expected.length).toBeGreaterThan(0);
    for (const answer of [
      { error: 'The object is in an invalid state.', stage: 'read' },
      { error: 'Can’t find variable: OffscreenCanvas', stage: 'canvas' },
      { error: 'That image can’t be read.' },
    ]) {
      standIn(answer);
      const engine = pageEngine();
      expect(await extractAccents(new Blob())).toEqual(expected);
      expect(engine.decoded()).toBe(1);
    }
  });

  it('rejects with the page’s error, not the worker’s, when the page fails too', async () => {
    standIn({ error: 'The object is in an invalid state.', stage: 'draw' });
    pageEngine();
    class NoContext {
      getContext() {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', NoContext);
    const thrown: unknown = await extractAccents(new Blob()).catch((caught: unknown) => caught);
    expect((thrown as Error).message).toBe('This computer can’t read the image’s colours.');
    expect(stageOf(thrown)).toBe('canvas');
  });

  it('leaves askWorkerAlone rejecting with the worker’s own words and stage', async () => {
    standIn({ error: 'The object is in an invalid state.', stage: 'draw' });
    const engine = pageEngine();
    const thrown: unknown = await askWorkerAlone(new Blob()).catch((caught: unknown) => caught);
    expect((thrown as Error).message).toBe('The object is in an invalid state.');
    expect(stageOf(thrown)).toBe('draw');
    expect(engine.decoded()).toBe(0);
  });
});

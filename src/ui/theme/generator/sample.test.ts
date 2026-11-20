import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_STAGES, samplePixels, stageOf, type SampleStage } from './sample';

// samplePixels' four calls (6.27q): a failure keeps its own error and words, with the stage it failed at beside them,
// so the launch check can say where a webview failed. Node has neither createImageBitmap nor OffscreenCanvas: fakes
// stand in, each told where to fail.

/** A fake engine failing at `failAt` (never, when undefined) with `error`; returns what was closed and drawn. */
function engine(failAt?: SampleStage, error: Error = new Error('unused')) {
  const seen = { closed: 0, drawn: [] as number[][], canvas: [] as number[] };
  const bitmap = {
    width: 192,
    height: 96,
    close: () => {
      seen.closed += 1;
    },
  };
  vi.stubGlobal('createImageBitmap', () =>
    failAt === 'decode' ? Promise.reject(error) : Promise.resolve(bitmap),
  );
  class FakeCanvas {
    constructor(width: number, height: number) {
      if (failAt === 'canvas') throw error;
      seen.canvas.push(width, height);
    }
    getContext() {
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: (_image: unknown, x: number, y: number, w: number, h: number) => {
          if (failAt === 'draw') throw error;
          seen.drawn.push([x, y, w, h]);
        },
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (failAt === 'read') throw error;
          return { data: new Uint8ClampedArray(w * h * 4).fill(7) };
        },
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('samplePixels’ stages (6.27q)', () => {
  it('reads as before when nothing fails, with no stage anywhere', async () => {
    const seen = engine();
    const sampled = await samplePixels(new Blob());
    expect([sampled.width, sampled.height]).toEqual([96, 48]);
    expect(sampled.data).toHaveLength(96 * 48 * 4);
    expect(sampled.data[0]).toBe(7);
    expect(seen.canvas).toEqual([96, 48]);
    expect(seen.drawn).toEqual([[0, 0, 96, 48]]);
    expect(seen.closed).toBe(1);
  });

  for (const stage of SAMPLE_STAGES) {
    it(`a failure at ${stage} is the same error, its words kept, with stage ${stage}`, async () => {
      const error = new DOMException('The object is in an invalid state.', 'InvalidStateError');
      const seen = engine(stage, error);
      const thrown: unknown = await samplePixels(new Blob()).catch((caught: unknown) => caught);
      expect(thrown).toBe(error);
      expect((thrown as DOMException).message).toBe('The object is in an invalid state.');
      expect((thrown as DOMException).name).toBe('InvalidStateError');
      expect(stageOf(thrown)).toBe(stage);
      // The bitmap is closed whenever one was made.
      expect(seen.closed).toBe(stage === 'decode' ? 0 : 1);
    });
  }

  it('a canvas with no 2d context fails at canvas, with the words it always had', async () => {
    engine();
    class NoContext {
      getContext() {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', NoContext);
    const thrown: unknown = await samplePixels(new Blob()).catch((caught: unknown) => caught);
    expect((thrown as Error).message).toBe('This computer can’t read the image’s colours.');
    expect(stageOf(thrown)).toBe('canvas');
  });

  it('knows only the four stages', () => {
    expect(stageOf({ stage: 'decode' })).toBe('decode');
    expect(stageOf({ stage: 'elsewhere' })).toBeUndefined();
    expect(stageOf(new Error('x'))).toBeUndefined();
    expect(stageOf(null)).toBeUndefined();
  });
});

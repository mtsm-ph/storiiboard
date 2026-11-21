import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, tn } from '../../core/i18n';
import { picturesBusy, prepareEach, readingLine } from './picturesBusy';

// The files being added, and how many of them are done (6.27n): every add counts each file finished as it ends,
// worked or not, so the board's footer and the Locations tile's photo line can read "Reading 3 of 30…".

afterEach(() => {
  setLocale('en');
});

/** A promise and the hand that settles it. */
function gate() {
  let open: () => void = () => undefined;
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    shut,
    open: () => {
      open();
    },
  };
}

const seen = () => ({ ...picturesBusy.getState() });

describe('the files being read', () => {
  it('counts one add of five, each marked as it ends, failures included, and is back to nothing at the end', async () => {
    const states: { count: number; done: number }[] = [];
    const failed: [number, string][] = [];
    await prepareEach(
      [1, 2, 3, 4, 5],
      (n) => {
        states.push(seen());
        return n % 2 === 0 ? Promise.reject(new Error(`file ${String(n)} unreadable`)) : Promise.resolve();
      },
      (n, error) => {
        failed.push([n, (error as Error).message]);
      },
    );
    expect(states).toEqual([0, 1, 2, 3, 4].map((done) => ({ count: 5, done })));
    expect(failed).toEqual([
      [2, 'file 2 unreadable'],
      [4, 'file 4 unreadable'],
    ]);
    expect(seen()).toEqual({ count: 0, done: 0 });
  });

  it('takes its totals back off when the failed callback itself throws', async () => {
    const run = prepareEach(
      [1, 2, 3],
      () => Promise.reject(new Error('unreadable')),
      () => {
        throw new Error('the notice broke');
      },
    );
    await expect(run).rejects.toThrow('the notice broke');
    expect(seen()).toEqual({ count: 0, done: 0 });
  });

  it('adds two adds at once, totals and finished counts both', async () => {
    const first = [gate(), gate(), gate()];
    const second = [gate(), gate()];
    const a = prepareEach([0, 1, 2], (i) => first[i]?.shut ?? Promise.resolve(), () => undefined);
    const b = prepareEach([0, 1], (i) => second[i]?.shut ?? Promise.resolve(), () => undefined);
    expect(seen()).toEqual({ count: 5, done: 0 });
    first[0]?.open();
    second[0]?.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen()).toEqual({ count: 5, done: 2 });
    expect(readingLine(seen())).toBe('Reading 3 of 5…');
    second[1]?.open();
    await b;
    // The second add leaves with its own two: the first's one finished file stays counted.
    expect(seen()).toEqual({ count: 3, done: 1 });
    expect(readingLine(seen())).toBe('Reading 2 of 3…');
    first[1]?.open();
    first[2]?.open();
    await a;
    expect(seen()).toEqual({ count: 0, done: 0 });
    expect(readingLine(seen())).toBeNull();
  });

  it('says "Reading 3 of 30…" in English and Spanish, and nothing new for a single file', () => {
    expect(readingLine({ count: 30, done: 2 })).toBe('Reading 3 of 30…');
    // The last one being read never reads past the total.
    expect(readingLine({ count: 2, done: 2 })).toBe('Reading 2 of 2…');
    expect(readingLine({ count: 1, done: 0 })).toBeNull();
    expect(readingLine({ count: 0, done: 0 })).toBeNull();
    // One file keeps today's words.
    expect(tn('board.addingPictures', 1)).toBe('Adding 1 file…');
    setLocale('es');
    expect(readingLine({ count: 30, done: 2 })).toBe('Leyendo 3 de 30…');
    expect(tn('board.addingPictures', 1)).toBe('Agregando 1 archivo…');
  });
});

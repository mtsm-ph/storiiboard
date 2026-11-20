import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../../core/i18n';

/**
 * How many files are being prepared now, pictures or videos, so the board can say so (a 48 MP HEIC takes a second),
 * and how many of those are finished (6.27n), so a long add reads "Reading 3 of 30…". Every add counts in here, from
 * any tile, so two at once add up.
 */
export interface PicturesBusy {
  count: number;
  done: number;
}

export const picturesBusy = createStore<PicturesBusy>()(() => ({ count: 0, done: 0 }));

export function usePicturesBusy(): number {
  return useStore(picturesBusy, (s) => s.count);
}

/**
 * Prepares files one after another (never in parallel: Rust lets two HEICs in at a time, and one 48 MP photo holds
 * about 300 MB), each counted finished as it ends, worked or not. `failed` hears why one didn't; the rest go on. The
 * add's own totals leave the count at the end, whatever happened.
 */
export async function prepareEach<T>(files: readonly T[], work: (file: T) => Promise<void>, failed: (file: T, error: unknown) => void): Promise<void> {
  picturesBusy.setState((s) => ({ count: s.count + files.length }));
  let finished = 0;
  try {
    for (const file of files) {
      try {
        await work(file);
      } catch (error) {
        failed(file, error);
      } finally {
        finished += 1;
        picturesBusy.setState((s) => ({ done: s.done + 1 }));
      }
    }
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - files.length, done: s.done - finished }));
  }
}

/** "Reading 3 of 30…" (the one being read, of the total) while two or more files are in hand; null for one or none. */
export function readingLine({ count, done }: PicturesBusy): string | null {
  return count >= 2 ? t('pictures.reading', { done: Math.min(count, done + 1), total: count }) : null;
}

export function usePicturesReading(): string | null {
  return useStore(picturesBusy, readingLine);
}

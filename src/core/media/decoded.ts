import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ProjectFile } from '../storage/driver';
import { THUMBNAIL_LONG_EDGE } from './image';
import { imageUrl, type ImageSize } from './urls';

// The pictures a board draws (5.1b, decision 4). The canvas draws the 640 px thumbnail while an item is drawn at 640
// screen pixels or less on its long edge, and the stored picture (at most 2560 px) only up close. Pictures are decoded
// once and kept in a bounded cache, the least recently drawn dropped beyond about 64 full ones; the thumbnails, a
// hundredth of the pixels, have a larger bound. Only items in view are drawn, so only those are ever asked for.

export type PictureLevel = ImageSize;

/** How many full pictures stay decoded; the least recently drawn go first. */
export const MAX_FULL_PICTURES = 64;
export const MAX_THUMBNAILS = 512;

/**
 * Which size to draw an item at, from its box in world units, the view's zoom and the screen's pixel ratio: the stored
 * picture only when the long edge, in device pixels, passes 640. Not in view: always the thumbnail.
 */
export function levelFor(width: number, height: number, zoom: number, pixelRatio = 1, inView = true): PictureLevel {
  return inView && Math.max(width, height) * zoom * pixelRatio > THUMBNAIL_LONG_EDGE ? 'original' : 'thumbnail';
}

/** A map that keeps at most `max` entries: reading or writing an entry makes it the newest, and the oldest are dropped. */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly max: number) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }
}

interface Decoded {
  file: ProjectFile;
  thumbnails: BoundedCache<HTMLImageElement>;
  fulls: BoundedCache<HTMLImageElement>;
  loading: Map<string, Promise<Loaded>>;
}

let decoded: Decoded | null = null;
/** Counts forgettings; a load that began before one doesn't put its picture in the cache. */
let epoch = 0;

function cachesFor(file: ProjectFile): Decoded {
  // Another project: nothing of the last one's is shown in it.
  if (decoded?.file !== file) {
    decoded = { file, thumbnails: new BoundedCache(MAX_THUMBNAILS), fulls: new BoundedCache(MAX_FULL_PICTURES), loading: new Map() };
  }
  return decoded;
}

/** The picture if it is decoded already, without asking for it. */
export function decodedPicture(file: ProjectFile, sha256: string, level: PictureLevel): HTMLImageElement | undefined {
  const caches = cachesFor(file);
  return (level === 'thumbnail' ? caches.thumbnails : caches.fulls).get(sha256);
}

/** How a read came out: the picture, "gone" (the file doesn't hold it), or an error worth trying again later. */
export type Loaded = { status: 'ok'; image: HTMLImageElement } | { status: 'gone' } | { status: 'error' };

/** Reads and decodes a stored picture once. */
export function loadPicture(file: ProjectFile, sha256: string, level: PictureLevel): Promise<Loaded> {
  const caches = cachesFor(file);
  const cache = level === 'thumbnail' ? caches.thumbnails : caches.fulls;
  const have = cache.get(sha256);
  if (have) return Promise.resolve({ status: 'ok', image: have });
  const key = `${level}:${sha256}`;
  const pending = caches.loading.get(key);
  if (pending) return pending;
  const began = epoch;
  const made = (async (): Promise<Loaded> => {
    try {
      const url = await imageUrl(file, sha256, level);
      if (url === null) return { status: 'gone' };
      const image = new Image();
      image.src = url;
      await image.decode();
      if (epoch === began) cache.set(sha256, image);
      return { status: 'ok', image };
    } catch {
      return { status: 'error' };
    }
  })().finally(() => {
    caches.loading.delete(key);
  });
  caches.loading.set(key, made);
  return made;
}

/**
 * Counts every time decoded pictures were forgotten, so a view that draws one (src/features/moodboards/PictureNode.tsx)
 * reads it again: whatever was forgotten and is still stored loads anew, and what was deleted for good reads as gone.
 */
const generation = createStore<{ count: number }>()(() => ({ count: 0 }));

export const useDecodedGeneration = (): number => useStore(generation, (s) => s.count);

/**
 * Forgets decoded pictures: just these (the ones Empty Trash or Clean up deleted for good), or every one when no list is
 * given (a project opened or closed). The others stay drawn.
 */
export function forgetDecoded(sha256s?: readonly string[]): void {
  epoch += 1;
  if (decoded) {
    if (sha256s) {
      for (const sha of sha256s) {
        decoded.thumbnails.delete(sha);
        decoded.fulls.delete(sha);
        decoded.loading.delete(`thumbnail:${sha}`);
        decoded.loading.delete(`original:${sha}`);
      }
    } else decoded = null;
  }
  generation.setState((s) => ({ count: s.count + 1 }));
}

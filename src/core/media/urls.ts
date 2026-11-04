import type { ProjectFile } from '../storage/driver';
import { readOriginal, readThumbnail, type ReadFile } from './store';

// Frames show stored pictures through blob: URLs (decided Nov 2): the CSP already allows them, they never taint a
// canvas, and they work the same in the desktop app and the test driver. Each picture is read from the file once per
// open project and its URL reused; closing the project frees them all.

export type ImageSize = 'thumbnail' | 'original';

const cache = new WeakMap<ProjectFile, Map<string, Promise<string | null>>>();

function toUrl(read: ReadFile | null): string | null {
  return read ? URL.createObjectURL(new Blob([read.bytes as Uint8Array<ArrayBuffer>], { type: read.mime })) : null;
}

/** A URL for a stored picture, or null if the file doesn't hold it (the frame then says the image is missing). */
export function imageUrl(file: ProjectFile, sha256: string, size: ImageSize = 'thumbnail'): Promise<string | null> {
  let urls = cache.get(file);
  if (!urls) {
    urls = new Map();
    cache.set(file, urls);
  }
  const key = `${size}:${sha256}`;
  let url = urls.get(key);
  if (!url) {
    url = (size === 'thumbnail' ? readThumbnail(file, sha256) : readOriginal(file, sha256)).then(toUrl);
    // Neither a failed read nor a missing picture is kept, so the next look reads the file again: a picture deleted for
    // good can be added back (the same photo chosen again), and the frame then shows it.
    url.then(
      (made) => {
        if (made === null) urls.delete(key);
      },
      () => urls.delete(key),
    );
    urls.set(key, url);
  }
  return url;
}

/**
 * Frees the URLs of pictures deleted for good (Empty Trash, Clean up), so a frame that names one again (redo, a History
 * restore) reads the file and says the picture is missing, rather than showing what's gone.
 */
export async function forgetImageUrls(file: ProjectFile, sha256s: readonly string[]): Promise<void> {
  const urls = cache.get(file);
  if (!urls) return;
  const made: Promise<string | null>[] = [];
  for (const sha of sha256s) {
    for (const size of ['thumbnail', 'original'] as const) {
      const url = urls.get(`${size}:${sha}`);
      if (!url) continue;
      urls.delete(`${size}:${sha}`);
      made.push(url);
    }
  }
  for (const result of await Promise.allSettled(made)) if (result.status === 'fulfilled' && result.value) URL.revokeObjectURL(result.value);
}

/** Frees every URL made for this file. The project store calls it on close. */
export async function releaseImageUrls(file: ProjectFile): Promise<void> {
  const urls = cache.get(file);
  if (!urls) return;
  cache.delete(file);
  const made = await Promise.allSettled(urls.values());
  for (const result of made) if (result.status === 'fulfilled' && result.value) URL.revokeObjectURL(result.value);
}

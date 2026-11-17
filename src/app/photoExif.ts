import { invoke } from '@tauri-apps/api/core';
import type { PhotoExif } from '../core/model/scoutPhoto';
import { fileMode, isTauriApp } from './fileAccess';

// A scout photo's EXIF (6.27): when it was taken and where. On the desktop it is read by Rust from the bytes being
// imported (src-tauri/src/exif.rs, kamadak-exif), on this computer: nothing is requested and nothing is logged. The
// picture stored in the project is drawn again from its pixels (src/core/media/image.ts), so it carries no EXIF; what
// is kept of it is only what the photo's record says (src/core/model/scoutPhoto.ts, the one reader).
//
// A browser build has no Rust side. In a development build with projects in the page (`?files=memory`, the end-to-end
// tests) a stand-in answers instead, as the time-zone lookup has one (timeZone.ts): the test says what each file's
// EXIF reads, by the file's name, in `window.__sbdDevPhotoExif`, set once the page has loaded. Any other browser build
// reads nothing: a photo imports exactly as before 6.27.

/** The memory build's stand-in: what a file's EXIF says, by its name. Not in a release build. */
export type DevPhotoExif = Record<string, PhotoExif>;

const devPhotoExif = (): DevPhotoExif | undefined =>
  import.meta.env.DEV && fileMode === 'memory' ? (window as unknown as { __sbdDevPhotoExif?: DevPhotoExif }).__sbdDevPhotoExif : undefined;

/**
 * What a picture's EXIF says, or null for nothing (no EXIF, a build that can't read it, a reader that failed): the
 * import goes on either way. What it answers is checked by the one reader before anything is stored (takenProps).
 */
export async function readPhotoExif(picture: Blob, name: string): Promise<PhotoExif | null> {
  if (isTauriApp) {
    try {
      // The bytes as the raw request body (as a transaction's bytes go), never as JSON.
      const bytes = new Uint8Array(await picture.arrayBuffer());
      return await invoke<PhotoExif>('photo_exif', bytes);
    } catch {
      return null;
    }
  }
  return devPhotoExif()?.[name] ?? null;
}

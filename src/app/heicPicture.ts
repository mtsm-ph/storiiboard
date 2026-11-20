import { invoke } from '@tauri-apps/api/core';

// A HEIC photo turned into a PNG by Rust (6.27n, src-tauri/src/heic.rs), for Windows, whose webview can't decode HEIC:
// the photo's bytes go as the raw request body (as photoExif.ts sends its own), and the PNG's bytes come back, fitted
// inside 2560 px and tagged with the file's own colour. The page then draws it as any other picture. On the Mac, Rust
// answers with the page's own HEIC line (error.heic): WebKit reads HEIC itself.
//
// Nothing calls this yet: part 2 of 6.27n wires it into the picture import as its fallback.

/**
 * The PNG's bytes for a HEIC photo. A refusal (too large, not a HEIC, an HDR photo, too slow, unreadable, a colour
 * profile too large, the Mac) rejects with an Error carrying Rust's own text, which localizeError turns into the
 * person's language.
 */
export async function heicPicture(photo: Blob): Promise<Uint8Array> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('heic_picture', bytes));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

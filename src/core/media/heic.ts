// A HEIC the webview can't decode (6.27n): Edge WebView2 on Windows reads none, so the desktop app hands over a decoder
// that asks Rust for a tagged PNG (src/app/heicPicture.ts, set at start-up). Core never imports from src/app, so the
// decoder is handed over here: the browser build and the tests' memory build set none, and say what they said before.

/** A HEIC photo's bytes in, a PNG's bytes out; a refusal rejects with Rust's own words. */
export type HeicDecoder = (photo: Blob) => Promise<Uint8Array>;

let decoder: HeicDecoder | null = null;

/** Set once by the desktop app before any picture can be added; null takes it away (tests). */
export function setHeicDecoder(next: HeicDecoder | null): void {
  decoder = next;
}

export function heicDecoder(): HeicDecoder | null {
  return decoder;
}

// The brands a HEIF or HEIC file names in its file type box, and an AVIF's, which shares HEIF's container and its
// `mif1` brand but is not a HEIC: the same lists as src-tauri/src/exif.rs's `is_heif`, which Rust refuses by.
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
const AVIF_BRANDS = ['avif', 'avis'];
/** The most compatible brands read: a real file names a handful. */
const MAX_BRANDS = 64;

/** How many of a file's first bytes `isHeif` can look at: the box's size and type, the major brand and its version, the brands. */
export const HEIF_HEAD = 16 + 4 * MAX_BRANDS;

const brandAt = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/**
 * Whether the bytes start with a file type box (`ftyp`) that names a HEIF brand, as its major brand or a compatible
 * one, and no AVIF brand: Rust's `is_heif`, read for read. Only the first box, only as far as it says it reaches (to
 * the end for a size of 0); a 64-bit size (1) is not one a HEIC writes.
 */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || brandAt(bytes, 4) !== 'ftyp') return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size === 1) return false;
  const end = size === 0 ? bytes.length : Math.min(size, bytes.length);
  const brands: string[] = bytes.length >= 12 ? [brandAt(bytes, 8)] : [];
  for (let at = 16; at + 4 <= end && brands.length <= MAX_BRANDS; at += 4) brands.push(brandAt(bytes, at));
  if (brands.some((brand) => AVIF_BRANDS.includes(brand))) return false;
  return brands.some((brand) => HEIF_BRANDS.includes(brand));
}

// What a picture the page encodes keeps (6.27b, Kevin Nov 18): only what a reader needs to show it, plus its colour
// profile. A webview's encoder writes blocks of its own into every file (WebKit's JPEG carries an Exif block with the
// picture's size and an empty Photoshop/IPTC record), and a later one could write more, so blocks are kept by a list
// and every other one goes; nothing is removed by a list. docs/SBD_FORMAT.md, "What a stored picture carries", has the
// list. src-tauri/src/sbd.rs refuses, in its own code and with the same list, a stored picture that carries anything
// else, and src/core/storage/memoryDriver.ts does the same for the tests.
//
// Bytes this doesn't expect (not a JPEG or PNG, a block running past the end, no picture data) clean to null: the
// caller stores and exports nothing then. The parse never reads past the bytes, every step moves forward, and it
// never throws.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A JPEG by its first bytes: SOI, then a marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** A PNG by its whole 8-byte signature. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Why the clean made no picture, for the words the person sees: `unreadable`, bytes it couldn't read through as a JPEG
 * or PNG (cut short, no scan or IDAT, garbage; `error.pictureUnreadable`); `holds`, a picture holding more than it may
 * keep, a colour profile over MAX_PROFILE_BYTES as stored (`error.pictureNotSaved`).
 */
export type CleanRefusal = 'unreadable' | 'holds';

/** The picture with only its kept blocks, or null for bytes that aren't a JPEG or PNG this can read through. */
export function cleanPicture(bytes: Uint8Array): Uint8Array | null {
  const kept = cleanPictureOrWhy(bytes);
  return typeof kept === 'string' ? null : kept;
}

/** As cleanPicture, saying why when it makes no picture. */
export function cleanPictureOrWhy(bytes: Uint8Array): Uint8Array | CleanRefusal {
  if (isJpeg(bytes)) return keptJpeg(bytes, true);
  if (isPng(bytes)) return keptPng(bytes, true);
  return 'unreadable';
}

/**
 * Whether bytes would be refused as a stored picture (the door; sbd.rs's, in picture_door.rs): a JPEG or PNG by its
 * first bytes that carries any block outside the keep-list, or whose blocks can't be read through to EOI or IEND.
 * The door asks only what the bytes carry, not whether they make a whole picture (a frame and a scan, IHDR first and
 * an IDAT): that is the clean's own refusal, so a test's stand-in bytes that carry nothing else still go in. Anything
 * that isn't a JPEG or PNG (a PDF) isn't the door's and is let through as it is.
 */
export function refusedPicture(bytes: Uint8Array): boolean {
  const kept = isJpeg(bytes) ? keptJpeg(bytes, false) : isPng(bytes) ? keptPng(bytes, false) : bytes;
  // The clean only ever drops whole blocks, so the same length means nothing was dropped.
  return typeof kept === 'string' || kept.length !== bytes.length;
}

/** Whether `bytes` at `at` spell `text` (ASCII), within the bytes. */
function spells(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** The pieces kept, joined into one array. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The most a colour profile may hold as stored (Kevin, Nov 18, night 2): 64 KiB, a JPEG's ICC_PROFILE chunks' data
 * together (after each chunk's 14-byte header), a PNG's iCCP chunk data as it sits in the file. A real one is a few
 * hundred bytes to a few KB (Display P3 is 536); the profile is the one kept block the page doesn't write itself, so it
 * is bounded. Nothing is inflated: the clean never depends on DecompressionStream, which WKWebView lacks before Safari
 * 16.4. sbd.rs's door (picture_door.rs) has the same number.
 */
export const MAX_PROFILE_BYTES = 64 * 1024;
/** An APP2 ICC_PROFILE chunk's own header: `ICC_PROFILE\0`, its number and the count. */
const ICC_HEADER = 14;

/** A start-of-frame marker: C0 to CF but DHT (C4), JPG (C8) and DAC (CC). */
const isSof = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * An APP0 JFIF segment's length with no thumbnail (Kevin, Nov 19): the length field, `JFIF\0`, the version, the units,
 * the two densities and a 0 × 0 thumbnail. A longer one carries a thumbnail, which is a picture of its own.
 */
const JFIF_LENGTH = 16;
/** An APP14 Adobe segment's one length: the length field, `Adobe`, the version, two flag words and the transform. */
const ADOBE_LENGTH = 14;

/** The kept APPn blocks seen so far: JFIF and Adobe are kept once each, the first time. */
interface SeenOnce {
  jfif: boolean;
  adobe: boolean;
}

/**
 * Whether a JPEG marker segment, with its body at `body` and its length field `length`, is kept: SOI to EOI, only what
 * a decoder reads, plus the colour.
 */
function keepsJpegSegment(bytes: Uint8Array, marker: number, body: number, length: number, seen: SeenOnce): boolean {
  if (marker === 0xdb || marker === 0xc4 || marker === 0xdd || isSof(marker)) return true;
  // APP0 JFIF (not JFXX) without a thumbnail, once; APP2 ICC_PROFILE (every chunk, as they come); APP14 Adobe (it
  // changes how colour decodes) at its fixed size, once.
  if (marker === 0xe0) {
    if (seen.jfif || length !== JFIF_LENGTH || !spells(bytes, body, 'JFIF\0')) return false;
    seen.jfif = true;
    return true;
  }
  if (marker === 0xe2) return spells(bytes, body, 'ICC_PROFILE\0');
  if (marker === 0xee) {
    if (seen.adobe || length !== ADOBE_LENGTH || !spells(bytes, body, 'Adobe')) return false;
    seen.adobe = true;
    return true;
  }
  return false;
}

/**
 * A JPEG with only SOI, APP0 JFIF (no thumbnail, once), APP2 ICC_PROFILE, APP14 Adobe (its fixed size, once), DQT,
 * DHT, DRI, every SOFn, each SOS with its
 * entropy-coded data (restart markers inside it) and EOI; anything after EOI goes too. `whole` (the clean's own): null
 * too without a frame and a scan; the door (refusedPicture) asks only what the blocks are.
 */
export function cleanJpeg(bytes: Uint8Array, whole = true): Uint8Array | null {
  const kept = keptJpeg(bytes, whole);
  return typeof kept === 'string' ? null : kept;
}

function keptJpeg(bytes: Uint8Array, whole: boolean): Uint8Array | CleanRefusal {
  const unreadable = 'unreadable';
  if (!isJpeg(bytes)) return unreadable;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let frames = 0;
  let scans = 0;
  let profile = 0;
  const seen: SeenOnce = { jfif: false, adobe: false };
  for (;;) {
    if (at >= bytes.length || bytes[at] !== 0xff) return unreadable;
    // Fill bytes before a marker are allowed (B.1.1.2); they aren't kept.
    let markerAt = at;
    while (markerAt + 1 < bytes.length && bytes[markerAt + 1] === 0xff) markerAt += 1;
    if (markerAt + 1 >= bytes.length) return unreadable;
    const marker = bytes[markerAt + 1] ?? 0;
    if (marker === 0xd9) {
      if (whole && (frames === 0 || scans === 0)) return unreadable;
      parts.push(bytes.subarray(markerAt, markerAt + 2));
      return joined(parts);
    }
    // No other standalone marker belongs between segments: a second SOI, a restart outside a scan, TEM, or 0x00.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00) return unreadable;
    if (markerAt + 4 > bytes.length) return unreadable;
    const length = ((bytes[markerAt + 2] ?? 0) << 8) | (bytes[markerAt + 3] ?? 0);
    if (length < 2) return unreadable;
    const end = markerAt + 2 + length;
    if (end > bytes.length) return unreadable;
    const kept = marker === 0xda || keepsJpegSegment(bytes, marker, markerAt + 4, length, seen);
    // The colour profile, the one kept block we don't write: its chunks' data (after the 14-byte header) bounded.
    if (kept && marker === 0xe2) {
      profile += Math.max(0, length - 2 - ICC_HEADER);
      if (profile > MAX_PROFILE_BYTES) return 'holds';
    }
    if (isSof(marker)) frames += 1;
    if (kept) parts.push(bytes.subarray(markerAt, end));
    at = end;
    if (marker === 0xda) {
      if (whole && frames === 0) return unreadable;
      scans += 1;
      // The entropy-coded data runs to the next marker that isn't a stuffed byte (FF 00) or a restart (FF D0 to D7).
      let data = at;
      for (;;) {
        if (data + 1 >= bytes.length) return unreadable;
        if (bytes[data] === 0xff) {
          const next = bytes[data + 1] ?? 0;
          // The next marker, or fill (FF FF) before it, which the loop above drops.
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
          data += 2;
        } else {
          data += 1;
        }
      }
      parts.push(bytes.subarray(at, data));
      at = data;
    }
  }
}

/** The PNG chunks kept: the picture's own, and its colour. */
const PNG_KEPT: ReadonlySet<string> = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'iCCP', 'sRGB', 'cICP', 'gAMA', 'cHRM']);

/**
 * A PNG with only IHDR, PLTE, tRNS, IDAT, IEND and the colour chunks; each kept chunk copied whole, its CRC as it was.
 * `whole` (the clean's own): null too unless IHDR comes first and an IDAT follows; the door asks only what the chunks are.
 */
export function cleanPng(bytes: Uint8Array, whole = true): Uint8Array | null {
  const kept = keptPng(bytes, whole);
  return typeof kept === 'string' ? null : kept;
}

function keptPng(bytes: Uint8Array, whole: boolean): Uint8Array | CleanRefusal {
  const unreadable = 'unreadable';
  if (!isPng(bytes)) return unreadable;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let first = true;
  let data = false;
  let profile = 0;
  for (;;) {
    if (at + 12 > bytes.length) return unreadable;
    const length = (((bytes[at] ?? 0) << 24) >>> 0) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0);
    if (length > 0x7fffffff) return unreadable;
    const end = at + 12 + length;
    if (end > bytes.length) return unreadable;
    let type = '';
    for (let i = 4; i < 8; i += 1) {
      const c = bytes[at + i] ?? 0;
      // A chunk's type is four ASCII letters.
      if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return unreadable;
      type += String.fromCharCode(c);
    }
    if (whole && first !== (type === 'IHDR')) return unreadable;
    first = false;
    if (type === 'IDAT') data = true;
    if (type === 'iCCP') {
      if (!iccpIsOne(bytes.subarray(at + 8, at + 8 + length))) return unreadable;
      // Bounded by its data as it sits in the file (Kevin, Nov 18, night 2); never inflated.
      profile += length;
      if (profile > MAX_PROFILE_BYTES) return 'holds';
    }
    if (PNG_KEPT.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') return data || !whole ? joined(parts) : unreadable;
  }
}

/** Whether an iCCP chunk's data is one: the profile's name (1 to 79 bytes), its NUL and the compression method (0). */
function iccpIsOne(data: Uint8Array): boolean {
  const nul = data.subarray(0, 80).indexOf(0);
  return nul >= 1 && nul + 2 <= data.length && data[nul + 1] === 0;
}

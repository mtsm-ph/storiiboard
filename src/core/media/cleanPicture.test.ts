import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { blobDataUrl, canvasBlob, PictureNotSavedError, type AnyCanvas } from './canvas';
import { cleanJpeg, cleanPicture, cleanPng, isJpeg, isPng, MAX_PROFILE_BYTES, refusedPicture } from './cleanPicture';
import { isTaggedP3 } from './image';

// The clean (6.27b): every picture the page encodes keeps only what a reader needs to show it, plus its colour profile.
// The WebKit fixtures are generated gradients (no person, no text) carrying, byte for byte and in the same place, the
// blocks a Mac's webview wrote into what it stored in checkpoint nov17-627; the same files are read by sbd.rs's door
// (src-tauri/src/picture_door.rs), so both sides judge the same bytes.

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../src-tauri/testdata/pictures/${name}`, import.meta.url)));
const WEBKIT = [1, 2].map((n) => ({ raw: fixture(`webkit-encoded-${String(n)}.jpg`), clean: fixture(`webkit-encoded-${String(n)}.clean.jpg`) }));

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function segment(marker: number, body: readonly number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/** A small JPEG's shape: what a reader needs, with `extra` segments after the JFIF one. */
function jpeg(...extra: number[][]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra.flat(),
    ...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...ascii('Display P3')]),
    ...segment(0xdb, new Array<number>(65).fill(0)),
    ...segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...segment(0xc4, new Array<number>(17).fill(0)),
    ...segment(0xdd, [0, 4]),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    // Entropy-coded data with a stuffed FF and a restart marker inside it.
    0x12,
    0xff,
    0x00,
    0x34,
    0xff,
    0xd0,
    0x56,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, body: readonly number[]): number[] {
  const n = body.length;
  // The CRC isn't checked: four bytes of its place, copied as they are.
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...ascii(type), ...body, 1, 2, 3, 4];
}

function png(...extra: number[][]): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...extra.flat(),
    ...chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 0, 1]),
    ...chunk('IEND', []),
  ]);
}

const includes = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

/** Each JPEG marker segment's marker, in order, up to the first scan. */
function markers(bytes: Uint8Array): number[] {
  const found: number[] = [];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    found.push(marker);
    if (marker === 0xda || marker === 0xd9) break;
    at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
  }
  return found;
}

describe('the clean of a WebKit JPEG, as checkpoint nov17-627 stored it', () => {
  it('equals the committed clean copy, which has no Exif, Photoshop or other dropped block and keeps the P3 profile', () => {
    for (const { raw, clean } of WEBKIT) {
      // What was stored carried both blocks.
      expect(includes(raw, 'Exif\0\0')).toBe(true);
      expect(includes(raw, 'Photoshop 3.0')).toBe(true);
      const cleaned = cleanPicture(raw);
      expect(cleaned).toEqual(clean);
      expect(markers(clean)).not.toContain(0xe1);
      expect(markers(clean)).not.toContain(0xed);
      expect(markers(clean)).not.toContain(0xfe);
      expect(markers(clean).filter((m) => m >= 0xe0 && m <= 0xef)).toEqual([0xe0, 0xe2]);
      expect(includes(clean, 'Exif\0\0')).toBe(false);
      expect(includes(clean, 'Photoshop 3.0')).toBe(false);
      expect(includes(clean, 'ICC_PROFILE\0')).toBe(true);
      expect(isTaggedP3(clean)).toBe(true);
      // Cleaned again: the same bytes. The door lets the clean copy through and refuses the stored one.
      expect(cleanPicture(clean)).toEqual(clean);
      expect(refusedPicture(raw)).toBe(true);
      expect(refusedPicture(clean)).toBe(false);
    }
  });
});

describe('the clean of a JPEG', () => {
  it('drops Exif, XMP, a comment, IPTC and an unknown APPn, and keeps the rest byte for byte', () => {
    const plain = jpeg();
    expect(cleanJpeg(plain)).toEqual(plain);
    const dirty = jpeg(
      segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42]),
      segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta/>')]),
      segment(0xfe, ascii('a comment')),
      segment(0xed, [...ascii('Photoshop 3.0'), 0]),
      segment(0xe9, ascii('anything')),
      segment(0xe0, [...ascii('JFXX'), 0, 0x10]),
      segment(0xe2, [...ascii('MPF'), 0]),
    );
    expect(cleanJpeg(dirty)).toEqual(plain);
    expect(refusedPicture(dirty)).toBe(true);
    expect(refusedPicture(plain)).toBe(false);
  });

  it('keeps APP14 Adobe, which changes how the colour decodes', () => {
    const adobe = jpeg(segment(0xee, [...ascii('Adobe'), 0, 0x64, 0, 0, 0, 0, 1]));
    expect(cleanJpeg(adobe)).toEqual(adobe);
  });

  it('keeps JFIF only without a thumbnail and Adobe only at its fixed size, each once; the door refuses the rest (Kevin, Nov 19)', () => {
    const plain = jpeg();
    const adobe = segment(0xee, [...ascii('Adobe'), 0, 0x64, 0, 0, 0, 0, 1]);
    // The fixed sizes, as segment lengths: JFIF 16, Adobe 14.
    expect((plain[4] ?? 0) * 256 + (plain[5] ?? 0)).toBe(16);
    expect((adobe[2] ?? 0) * 256 + (adobe[3] ?? 0)).toBe(14);
    // A 1 × 1 thumbnail: the JFIF block goes, whole, and the rest stays.
    const thumbnail = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 9, 9, 9]);
    const withThumbnail = new Uint8Array([0xff, 0xd8, ...thumbnail, ...plain.subarray(2 + 18)]);
    const noJfif = new Uint8Array([0xff, 0xd8, ...plain.subarray(2 + 18)]);
    expect(cleanJpeg(withThumbnail)).toEqual(noJfif);
    expect(refusedPicture(withThumbnail)).toBe(true);
    expect(refusedPicture(noJfif)).toBe(false);
    // A second JFIF, a second Adobe, an Adobe of another size: dropped, the first of each kept.
    const secondJfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const longAdobe = segment(0xee, [...ascii('Adobe'), 0, 0x64, 0, 0, 0, 0, 1, 7]);
    const shortAdobe = segment(0xee, [...ascii('Adobe'), 0, 0x64, 0, 0, 0, 0]);
    for (const extra of [[secondJfif], [adobe, adobe], [longAdobe], [shortAdobe], [longAdobe, adobe]]) {
      const dirty = jpeg(...extra);
      const kept = extra.some((s) => s === adobe) ? jpeg(adobe) : plain;
      expect(cleanJpeg(dirty)).toEqual(kept);
      expect(refusedPicture(dirty)).toBe(true);
      expect(refusedPicture(kept)).toBe(false);
    }
  });

  it('drops anything after EOI and fill bytes between segments', () => {
    const plain = jpeg();
    expect(cleanJpeg(new Uint8Array([...plain, ...ascii('appended')]))).toEqual(plain);
    const filled = new Uint8Array([0xff, 0xd8, 0xff, ...plain.subarray(2)]);
    expect(cleanJpeg(filled)).toEqual(plain);
    expect(refusedPicture(filled)).toBe(true);
  });

  it('refuses a JPEG cut short anywhere, one with no scan, and garbage', () => {
    const plain = jpeg();
    for (let cut = 3; cut < plain.length; cut += 1) expect(cleanPicture(plain.subarray(0, cut)), `cut at ${String(cut)}`).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, ...segment(0xdb, new Array<number>(65).fill(0)), 0xff, 0xd9]))).toBeNull();
    // A segment that says it runs past the end, a length under 2, a second SOI.
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 1, 0xff, 0xd9]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd8, ...plain.subarray(2)]))).toBeNull();
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff]))).toBeNull();
    // The door asks only what the bytes carry: SOI and EOI alone carry nothing else, so they go in, though the clean
    // won't make a picture of them; a cut-short JPEG, or one with an Exif block, is refused all the same.
    expect(cleanJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(refusedPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(false);
    expect(refusedPicture(new Uint8Array([0xff, 0xd8, ...segment(0xe1, [...ascii('Exif'), 0, 0]), 0xff, 0xd9]))).toBe(true);
    for (let cut = 3; cut < plain.length; cut += 1) expect(refusedPicture(plain.subarray(0, cut)), `cut at ${String(cut)}`).toBe(true);
  });
});

describe('the clean of a PNG', () => {
  it('drops tEXt, zTXt, eXIf, iTXt, tIME, pHYs and an unknown chunk, each kept chunk copied whole', () => {
    const plain = png();
    expect(cleanPng(plain)).toEqual(plain);
    const dirty = png(
      chunk('tEXt', [...ascii('Comment'), 0, ...ascii('hi')]),
      chunk('zTXt', [...ascii('Comment'), 0, 0, 1]),
      chunk('eXIf', [...ascii('MM'), 0, 42]),
      chunk('iTXt', [...ascii('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...ascii('x')]),
      chunk('tIME', [7, 234, 11, 18, 12, 0, 0]),
      chunk('pHYs', new Array<number>(9).fill(0)),
      chunk('zzZz', ascii('unknown')),
    );
    expect(cleanPng(dirty)).toEqual(plain);
    expect(refusedPicture(dirty)).toBe(true);
    expect(refusedPicture(plain)).toBe(false);
  });

  it('keeps iCCP, and sRGB with gAMA, cHRM and cICP: the colour', () => {
    const profiled = png(chunk('iCCP', [...ascii('Display P3'), 0, 0, 0x78]));
    expect(cleanPng(profiled)).toEqual(profiled);
    expect(isTaggedP3(cleanPng(profiled) ?? new Uint8Array())).toBe(true);
    const srgb = png(chunk('sRGB', [0]), chunk('gAMA', [0, 0, 0xb1, 0x8f]), chunk('cHRM', new Array<number>(32).fill(0)), chunk('cICP', [1, 13, 0, 1]));
    expect(cleanPng(srgb)).toEqual(srgb);
    // PLTE and tRNS too.
    const paletted = png(chunk('PLTE', [0, 0, 0]), chunk('tRNS', [0]));
    expect(cleanPng(paletted)).toEqual(paletted);
  });

  it('drops anything after IEND; refuses a PNG cut short, one with no IDAT, one not starting with IHDR, and garbage', () => {
    const plain = png();
    expect(cleanPng(new Uint8Array([...plain, ...ascii('appended')]))).toEqual(plain);
    for (let cut = 8; cut < plain.length; cut += 1) expect(cleanPicture(plain.subarray(0, cut)), `cut at ${String(cut)}`).toBeNull();
    const noData = new Uint8Array([...plain.subarray(0, 8), ...chunk('IHDR', new Array<number>(13).fill(0)), ...chunk('IEND', [])]);
    expect(cleanPng(noData)).toBeNull();
    const noHeader = new Uint8Array([...plain.subarray(0, 8), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);
    expect(cleanPng(noHeader)).toBeNull();
    // Neither carries anything else, so the door lets both through; cut short, the door refuses.
    expect(refusedPicture(noData)).toBe(false);
    expect(refusedPicture(noHeader)).toBe(false);
    for (let cut = 8; cut < plain.length; cut += 1) expect(refusedPicture(plain.subarray(0, cut)), `cut at ${String(cut)}`).toBe(true);
    const long = new Uint8Array(plain);
    long.set([0xff, 0xff, 0xff, 0xff], 8);
    expect(cleanPng(long)).toBeNull();
    const badType = new Uint8Array(plain);
    // IDAT's type, after the signature (8) and IHDR (12 + 13), its length (4) first.
    badType.set([0x31, 0x32, 0x33, 0x34], 8 + 25 + 4);
    expect(cleanPng(badType)).toBeNull();
  });
});

describe('the keep-list holds for the whole file (Kevin, Nov 18, late)', () => {
  it('between a JPEG’s scans: tables stay, a comment or an Exif block goes, and the door refuses it', () => {
    const scan = [...segment(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0xff, 0x00, 0x34];
    const plain = jpeg();
    const eoi = plain.length - 2;
    const two = new Uint8Array([...plain.subarray(0, eoi), ...segment(0xc4, new Array<number>(17).fill(0)), ...scan, 0xff, 0xd9]);
    expect(cleanJpeg(two)).toEqual(two);
    expect(refusedPicture(two)).toBe(false);
    for (const between of [segment(0xfe, ascii('note')), segment(0xe1, [...ascii('Exif'), 0, 0])]) {
      const dirty = new Uint8Array([...plain.subarray(0, eoi), ...between, ...scan, 0xff, 0xd9]);
      expect(cleanJpeg(dirty)).toEqual(new Uint8Array([...plain.subarray(0, eoi), ...scan, 0xff, 0xd9]));
      expect(refusedPicture(dirty)).toBe(true);
    }
  });

  it('after the end: one byte after EOI or IEND is cut by the clean and refused by the door', () => {
    for (const picture of [jpeg(), png()]) {
      const after = new Uint8Array([...picture, 0]);
      expect(cleanPicture(after)).toEqual(picture);
      expect(refusedPicture(after)).toBe(true);
    }
  });
});

describe('the colour profile, bounded at 64 KiB as stored (Kevin, Nov 18, night 2)', () => {
  /** ICC_PROFILE chunks holding `payload` bytes of profile in all, as big as a segment holds. */
  function profileChunks(payload: number): number[][] {
    const chunks: number[][] = [];
    for (let left = payload; left > 0; ) {
      const n = Math.min(left, 65533 - 14);
      chunks.push(segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...new Array<number>(n).fill(7)]));
      left -= n;
    }
    return chunks;
  }

  it('a JPEG’s ICC_PROFILE chunks together: 64 KiB goes in, a byte more is refused by the clean and the door', () => {
    expect(MAX_PROFILE_BYTES).toBe(65536);
    // jpeg() carries a 10-byte profile of its own ("Display P3"); the rest comes in two more chunks.
    expect(profileChunks(MAX_PROFILE_BYTES - 10)).toHaveLength(2);
    const under = jpeg(...profileChunks(MAX_PROFILE_BYTES - 10));
    const over = jpeg(...profileChunks(MAX_PROFILE_BYTES - 9));
    expect(cleanJpeg(under)).toEqual(under);
    expect(refusedPicture(under)).toBe(false);
    expect(cleanJpeg(over)).toBeNull();
    expect(refusedPicture(over)).toBe(true);
  });

  it('a PNG’s iCCP chunk data as stored: 64 KiB goes in and a byte more is refused, by the clean and the door', () => {
    // The chunk's data: the name, its NUL, the method and the compressed profile, `data` bytes in all.
    const iccp = (data: number) => chunk('iCCP', [...ascii('P3'), 0, 0, ...new Array<number>(data - 4).fill(0x78)]);
    const under = png(iccp(MAX_PROFILE_BYTES));
    const over = png(iccp(MAX_PROFILE_BYTES + 1));
    expect(cleanPng(under)).toEqual(under);
    expect(refusedPicture(under)).toBe(false);
    expect(cleanPng(over)).toBeNull();
    expect(refusedPicture(over)).toBe(true);
    // No name, or no NUL in its first 80 bytes: not an iCCP.
    expect(cleanPng(png(chunk('iCCP', [0, 0, 0x78])))).toBeNull();
    expect(cleanPng(png(chunk('iCCP', new Array<number>(100).fill(0x61))))).toBeNull();
  });

  it('is never unpacked: a small profile goes in as it is, and one over the bound as stored is refused by canvasBlob', async () => {
    const asPng = (bytes: Uint8Array) =>
      ({ convertToBlob: () => Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })) }) as unknown as AnyCanvas;
    // A real-sized profile, compressed: kept byte for byte, whatever it would inflate to.
    const profiled = png(chunk('iCCP', [...ascii('P3'), 0, 0, ...deflateSync(new Uint8Array(MAX_PROFILE_BYTES * 4))]));
    const blob = await canvasBlob(asPng(profiled), 'image/png');
    expect(new Uint8Array(await (blob ?? new Blob()).arrayBuffer())).toEqual(profiled);
    const over = png(chunk('iCCP', [...ascii('P3'), 0, 0, ...new Array<number>(MAX_PROFILE_BYTES - 3).fill(0x78)]));
    const error = await canvasBlob(asPng(over), 'image/png').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PictureNotSavedError);
    expect((error as PictureNotSavedError).why).toBe('holds');
  });
});

describe('bytes that aren’t a JPEG or PNG', () => {
  it('clean to nothing, and the door leaves them alone (a PDF is kept as it is)', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array(ascii('%PDF-1.7\n')), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), new Uint8Array(ascii('RIFF0000WEBP'))]) {
      expect(cleanPicture(bytes)).toBeNull();
      expect(refusedPicture(bytes)).toBe(false);
      expect(isJpeg(bytes) || isPng(bytes)).toBe(false);
    }
  });
});

describe('canvasBlob, the page’s one encoder', () => {
  const canvasOf = (bytes: Uint8Array | null, type = 'image/jpeg') =>
    ({ convertToBlob: () => Promise.resolve(bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type }) : null) }) as unknown as AnyCanvas;

  it('hands back what the webview encoded, cleaned', async () => {
    const [first] = WEBKIT;
    if (!first) throw new Error('no fixture');
    const blob = await canvasBlob(canvasOf(first.raw), 'image/jpeg', 0.88);
    expect(blob?.type).toBe('image/jpeg');
    expect(new Uint8Array(await (blob ?? new Blob()).arrayBuffer())).toEqual(first.clean);
    // A data URL made from it (a company profile's logo) holds the same clean bytes.
    const url = await blobDataUrl(blob ?? new Blob());
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(new Uint8Array(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))).toEqual(first.clean);
  });

  it('says the picture couldn’t be saved for bytes it can’t clean, and stays null where the webview encoded nothing', async () => {
    await expect(canvasBlob(canvasOf(new Uint8Array(ascii('not a picture'))), 'image/png')).rejects.toBeInstanceOf(PictureNotSavedError);
    await expect(canvasBlob(canvasOf(jpeg().subarray(0, 40)), 'image/jpeg')).rejects.toThrow(en['error.pictureUnreadable']);
    expect(await canvasBlob(canvasOf(null), 'image/png')).toBeNull();
  });

  it('says why: one it couldn’t read as a picture, or one holding more than it keeps (round 2)', async () => {
    const refusal = (bytes: Uint8Array, type = 'image/jpeg') => canvasBlob(canvasOf(bytes, type), type).then(() => null, (error: unknown) => error);
    for (const unreadable of [new Uint8Array(ascii('not a picture')), jpeg().subarray(0, 40), png().subarray(0, 30)]) {
      const error = await refusal(unreadable);
      expect(error).toBeInstanceOf(PictureNotSavedError);
      expect((error as PictureNotSavedError).why).toBe('unreadable');
      expect((error as Error).message).toBe(en['error.pictureUnreadable']);
    }
    const profile = (n: number) => segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...new Array<number>(n).fill(7)]);
    const chunks: number[][] = [];
    for (let left = MAX_PROFILE_BYTES; left > 0; left -= 65000) chunks.push(profile(Math.min(left, 65000)));
    const error = await refusal(jpeg(...chunks));
    expect((error as PictureNotSavedError).why).toBe('holds');
    expect((error as Error).message).toBe(en['error.pictureNotSaved']);
    // The words, with a space after each key's colon (a review finding): en and es both have them.
    expect(en['error.pictureUnreadable']).toBe('The picture couldn’t be saved: it couldn’t be read as a picture.');
  });
});

describe('the clean never depends on DecompressionStream (Kevin, Nov 18, night 2)', () => {
  const canvasOf = (bytes: Uint8Array) =>
    ({ convertToBlob: () => Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })) }) as unknown as AnyCanvas;
  const profiled = png(chunk('iCCP', [...ascii('P3'), 0, 0, ...deflateSync(new Uint8Array(536))]));
  const over = png(chunk('iCCP', [...ascii('P3'), 0, 0, ...new Array<number>(MAX_PROFILE_BYTES - 3).fill(0x78)]));

  /** canvasBlob's answers for the profiled PNG and the one over the bound, with `stream` as the webview's. */
  async function answers(stream: typeof DecompressionStream | undefined) {
    const kept = globalThis.DecompressionStream;
    try {
      if (stream) globalThis.DecompressionStream = stream;
      // @ts-expect-error: removed, as WKWebView before Safari 16.4 (macOS 13.0 to 13.2) has none.
      else delete globalThis.DecompressionStream;
      const blob = await canvasBlob(canvasOf(profiled), 'image/png');
      const refused = await canvasBlob(canvasOf(over), 'image/png').then(
        () => null,
        (e: unknown) => e,
      );
      return { bytes: new Uint8Array(await (blob ?? new Blob()).arrayBuffer()), refused };
    } finally {
      globalThis.DecompressionStream = kept;
    }
  }

  it('cleans a PNG with an iCCP the same where the webview has none', async () => {
    const { bytes, refused } = await answers(undefined);
    expect(bytes).toEqual(profiled);
    expect(refused).toBeInstanceOf(PictureNotSavedError);
    expect(typeof DecompressionStream).toBe('function');
  });

  it('cleans it the same where the stream throws as it is made', async () => {
    // A constructor that throws as `new` calls it: never called.
    const throwing = function throwing() {
      throw new TypeError('no deflate here');
    } as unknown as typeof DecompressionStream;
    const { bytes, refused } = await answers(throwing);
    expect(bytes).toEqual(profiled);
    expect(refused).toBeInstanceOf(PictureNotSavedError);
  });
});

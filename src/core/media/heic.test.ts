import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { HEIF_HEAD, heicDecoder, isHeif, setHeicDecoder } from './heic';
import { decodePicture, ImageError } from './image';

// A picture the webview can't decode (6.27n): a HEIC goes to the decoder the desktop app handed over (Rust), once, and
// its PNG is decoded instead; anything else, or a build with no decoder, says what it said before.

const enc = (text: string) => [...new TextEncoder().encode(text)];

/** A file type box alone, as exif.rs's tests write one: major brand, version 0, then the compatible brands. */
function ftyp(major: string, compatible: readonly string[] = []): Uint8Array<ArrayBuffer> {
  const body = [...enc(major), 0, 0, 0, 0, ...compatible.flatMap(enc)];
  const size = 8 + body.length;
  return new Uint8Array([(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...enc('ftyp'), ...body]);
}

describe('the HEIF brand, read as exif.rs’s is_heif reads it', () => {
  it('names each HEIF brand, as the major brand or a compatible one', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(isHeif(ftyp(brand)), brand).toBe(true);
      expect(isHeif(ftyp('isom', ['mp41', brand])), brand).toBe(true);
    }
    // The container exif.rs's own HEIF sample opens with.
    expect(isHeif(ftyp('heic', ['mif1', 'heic']))).toBe(true);
  });

  it('refuses an MP4’s and an AVIF’s brands, an AVIF’s even beside mif1', () => {
    expect(isHeif(ftyp('isom', ['mp41']))).toBe(false);
    expect(isHeif(ftyp('avif', ['avis']))).toBe(false);
    expect(isHeif(ftyp('avif', ['avif', 'mif1', 'miaf']))).toBe(false);
    expect(isHeif(ftyp('mif1', ['avif', 'miaf']))).toBe(false);
  });

  it('reads only the first box, only as far as it says, and never a 64-bit size', () => {
    expect(isHeif(new Uint8Array([...ftyp('isom', ['mp41']), ...enc('heic')]))).toBe(false);
    const zero = ftyp('isom', ['mp41', 'heic']);
    zero.set([0, 0, 0, 0], 0);
    expect(isHeif(zero)).toBe(true);
    const wide = ftyp('heic');
    wide.set([0, 0, 0, 1], 0);
    expect(isHeif(wide)).toBe(false);
    // Cut anywhere, never a throw; three bytes or none are no HEIF.
    const whole = ftyp('isom', ['mp41', 'heic']);
    for (let length = 0; length <= whole.length; length += 1) expect(() => isHeif(whole.subarray(0, length))).not.toThrow();
    expect(isHeif(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isHeif(new Uint8Array())).toBe(false);
    // A JPEG's first bytes.
    expect(isHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, ...enc('Exif'), 0, 0]))).toBe(false);
  });

  it('looks at no more than its head, and a brand past the 64th compatible one is not read', () => {
    const many = ftyp('isom', [...Array.from({ length: 64 }, () => 'mp41'), 'heic']);
    expect(isHeif(many)).toBe(false);
    expect(HEIF_HEAD).toBe(16 + 4 * 64);
  });
});

const GENERIC = 'This file isn’t an image Storiiboard can read. JPEG, PNG and WebP work.';
const fakeBitmap = { width: 4, height: 3, close: () => undefined } as unknown as ImageBitmap;

describe('a picture the webview can’t decode', () => {
  const decode = vi.fn<(source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
  const decoder = vi.fn<(photo: Blob) => Promise<Uint8Array>>();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const heicBytes = ftyp('heic', ['mif1', 'heic']);

  beforeEach(() => {
    decode.mockReset();
    decoder.mockReset();
    vi.stubGlobal('createImageBitmap', decode);
    setHeicDecoder(decoder);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setHeicDecoder(null);
  });

  /** The webview reads nothing but the decoder's PNG. */
  const readsOnlyPng = () =>
    decode.mockImplementation((source) =>
      source.type === 'image/png' ? Promise.resolve(fakeBitmap) : Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError')),
    );

  it('decodes a picture the webview reads without asking the decoder', async () => {
    decode.mockResolvedValue(fakeBitmap);
    expect(await decodePicture(new File([heicBytes], 'IMG_0001.HEIC', { type: 'image/heic' }))).toBe(fakeBitmap);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0]?.[1]).toEqual({ imageOrientation: 'from-image' });
    expect(decoder).not.toHaveBeenCalled();
  });

  it('says the generic line for a file that isn’t a HEIC, and never asks the decoder', async () => {
    readsOnlyPng();
    const notes = new File([new Uint8Array(enc('INT. CABIN - NIGHT'))], 'notes.txt', { type: 'text/plain' });
    await expect(decodePicture(notes)).rejects.toThrow(new ImageError(GENERIC));
    const avif = new File([ftyp('avif', ['avif', 'mif1', 'miaf'])], 'still', { type: '' });
    await expect(decodePicture(avif)).rejects.toThrow(GENERIC);
    expect(decoder).not.toHaveBeenCalled();
  });

  it('asks the decoder exactly once for a HEIC by its type, by its name or by its brand alone, and uses its PNG', async () => {
    readsOnlyPng();
    decoder.mockResolvedValue(png);
    const files = [
      new File([new Uint8Array([9, 9, 9])], 'photo', { type: 'image/heic' }),
      new File([new Uint8Array([9, 9, 9])], 'IMG_0001.heif', { type: '' }),
      new File([heicBytes], 'download.bin', { type: '' }),
      new Blob([heicBytes]),
    ];
    for (const file of files) {
      decoder.mockClear();
      decode.mockClear();
      expect(await decodePicture(file)).toBe(fakeBitmap);
      expect(decoder).toHaveBeenCalledTimes(1);
      expect(decoder.mock.calls[0]?.[0]).toBe(file);
      // The webview's own try, then the PNG's.
      expect(decode).toHaveBeenCalledTimes(2);
      const given = decode.mock.calls[1]?.[0];
      expect(given?.type).toBe('image/png');
      // Rust's PNG is decoded with the same options as the webview's own try.
      expect(decode.mock.calls[1]?.[1]).toEqual(decode.mock.calls[0]?.[1]);
      expect(decode.mock.calls[1]?.[1]).toEqual({ imageOrientation: 'from-image' });
      expect([...new Uint8Array(await (given as Blob).arrayBuffer())]).toEqual([...png]);
    }
  });

  it('says today’s HEIC line when no decoder was handed over', async () => {
    readsOnlyPng();
    setHeicDecoder(null);
    expect(heicDecoder()).toBeNull();
    await expect(decodePicture(new File([heicBytes], 'IMG_0001.HEIC', { type: '' }))).rejects.toThrow(new ImageError(en['error.heic']));
    await expect(decodePicture(new Blob([heicBytes]))).rejects.toThrow(en['error.heic']);
  });

  it('gives the decoder’s refusal as the reason, in Rust’s own words', async () => {
    readsOnlyPng();
    decoder.mockRejectedValue(new Error(en['error.heicHdr']));
    const refused = decodePicture(new File([heicBytes], 'IMG_0002.HEIC', { type: 'image/heic' }));
    await expect(refused).rejects.toBeInstanceOf(ImageError);
    await expect(refused).rejects.toThrow(en['error.heicHdr']);
    decoder.mockRejectedValue(en['error.heicTooSlow']);
    await expect(decodePicture(new Blob([heicBytes]))).rejects.toThrow(new ImageError(en['error.heicTooSlow']));
    expect(decoder).toHaveBeenCalledTimes(2);
  });

  it('says error.heicUnread when the webview can’t decode the PNG the decoder gave', async () => {
    decode.mockRejectedValue(new DOMException('The source image could not be decoded.', 'InvalidStateError'));
    decoder.mockResolvedValue(png);
    const unread = decodePicture(new File([heicBytes], 'IMG_0003.HEIC', { type: 'image/heic' }));
    await expect(unread).rejects.toBeInstanceOf(ImageError);
    await expect(unread).rejects.toThrow(en['error.heicUnread']);
    expect(decoder).toHaveBeenCalledTimes(1);
  });
});

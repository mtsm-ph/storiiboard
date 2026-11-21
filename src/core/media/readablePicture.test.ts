import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/locales/en';
import { setHeicDecoder } from './heic';
import { ImageError, readablePicture } from './image';

// A way in that hands one picture to more than one reader (a key image's accents and its stored picture, a company's
// logo): a HEIC the webview can't decode is decoded once, here, and every reader after gets the PNG.

const enc = (text: string) => [...new TextEncoder().encode(text)];

/** A file type box alone: major brand, version 0, then the compatible brands. */
function ftyp(major: string, compatible: readonly string[] = []): Uint8Array<ArrayBuffer> {
  const body = [...enc(major), 0, 0, 0, 0, ...compatible.flatMap(enc)];
  const size = 8 + body.length;
  return new Uint8Array([(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...enc('ftyp'), ...body]);
}

const fakeBitmap = () => ({ width: 4, height: 3, close: vi.fn() }) as unknown as ImageBitmap;
const unreadable = () => Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError'));

describe('readablePicture', () => {
  const decode = vi.fn<(source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
  const decoder = vi.fn<(photo: Blob) => Promise<Uint8Array>>();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const heic = () => new File([ftyp('heic', ['mif1', 'heic'])], 'IMG_0005.HEIC', { type: 'image/heic' });

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

  /** The webview reads nothing but the decoder's PNG, as Edge WebView2 on Windows. */
  const readsOnlyPng = () => decode.mockImplementation((source) => (source.type === 'image/png' ? Promise.resolve(fakeBitmap()) : unreadable()));

  it('hands back any file as it is with no decoder (the browser build), and decodes nothing', async () => {
    setHeicDecoder(null);
    const file = heic();
    expect(await readablePicture(file)).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });

  it('hands back a file that isn’t a HEIC as it is, without decoding it or asking the decoder', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'logo.jpg', { type: 'image/jpeg' });
    expect(await readablePicture(jpeg)).toBe(jpeg);
    const avif = new File([ftyp('avif', ['avif', 'mif1', 'miaf'])], 'still', { type: '' });
    expect(await readablePicture(avif)).toBe(avif);
    expect(decode).not.toHaveBeenCalled();
    expect(decoder).not.toHaveBeenCalled();
  });

  it('hands back a HEIC the webview reads itself (the Mac) as it is, and never asks the decoder', async () => {
    const close = vi.fn();
    decode.mockResolvedValue({ width: 4, height: 3, close });
    const file = heic();
    expect(await readablePicture(file)).toBe(file);
    expect(decoder).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('gives the decoder’s PNG for a HEIC the webview can’t read, asking it exactly once', async () => {
    readsOnlyPng();
    decoder.mockResolvedValue(png);
    const file = heic();
    const readable = await readablePicture(file);
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(decoder.mock.calls[0]?.[0]).toBe(file);
    expect(readable.type).toBe('image/png');
    expect([...new Uint8Array(await readable.arrayBuffer())]).toEqual([...png]);
    // The webview's own try, then the PNG's, with the same options.
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]?.[1]).toEqual(decode.mock.calls[0]?.[1]);
  });

  it('passes the decoder’s refusal through as an ImageError, in its own words', async () => {
    readsOnlyPng();
    decoder.mockRejectedValue(new Error(en['error.heicHdr']));
    const refused = readablePicture(heic());
    await expect(refused).rejects.toBeInstanceOf(ImageError);
    await expect(refused).rejects.toThrow(en['error.heicHdr']);
    decoder.mockRejectedValue(en['error.heicTooSlow']);
    await expect(readablePicture(heic())).rejects.toThrow(new ImageError(en['error.heicTooSlow']));
    expect(decoder).toHaveBeenCalledTimes(2);
  });

  it('says error.heicUnread when the webview can’t read the decoder’s PNG either', async () => {
    decode.mockImplementation(unreadable);
    decoder.mockResolvedValue(png);
    const unread = readablePicture(heic());
    await expect(unread).rejects.toBeInstanceOf(ImageError);
    await expect(unread).rejects.toThrow(en['error.heicUnread']);
    expect(decoder).toHaveBeenCalledTimes(1);
  });
});

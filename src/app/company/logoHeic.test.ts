import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../core/i18n/locales/en';
import { setHeicDecoder } from '../../core/media/heic';
import { logoFromPicture } from './companies';

// A HEIC picked as a company profile's logo on Windows: decoded once by the same fallback the other pictures use, and
// the logo drawn from that PNG; a refusal comes back in the decoder's own words.

vi.mock('../../core/media/canvas', async (importActual) => ({
  ...(await importActual<typeof import('../../core/media/canvas')>()),
  canvasBlob: vi.fn(() => Promise.resolve(new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' }))),
  blobDataUrl: vi.fn(() => Promise.resolve('data:image/png;base64,iVA=')),
}));

const enc = (text: string) => [...new TextEncoder().encode(text)];
const heicBytes = new Uint8Array([0, 0, 0, 24, ...enc('ftyp'), ...enc('heic'), 0, 0, 0, 0, ...enc('mif1'), ...enc('heic')]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('a HEIC picked as a company’s logo, where the webview can’t read it', () => {
  const decode = vi.fn<(source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
  const decoder = vi.fn<(photo: Blob) => Promise<Uint8Array>>();
  const drawn: unknown[] = [];
  const photo = () => new Blob([heicBytes], { type: 'image/heic' });

  beforeEach(() => {
    decode.mockReset();
    decoder.mockReset();
    drawn.length = 0;
    // Edge WebView2: only the decoder's PNG decodes, each decode its own bitmap.
    decode.mockImplementation((source) =>
      source.type === 'image/png'
        ? Promise.resolve({ width: 400, height: 200, close: () => undefined, from: source } as unknown as ImageBitmap)
        : Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError')),
    );
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (bitmap: unknown) => drawn.push(bitmap) }) }),
    });
    setHeicDecoder(decoder);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setHeicDecoder(null);
  });

  it('draws the logo from the decoder’s PNG, asking the decoder once for the pick', async () => {
    decoder.mockResolvedValue(png);
    const heic = photo();
    expect(await logoFromPicture(heic)).toEqual({ logo: 'data:image/png;base64,iVA=' });
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(decoder.mock.calls[0]?.[0]).toBe(heic);
    // What was drawn is a bitmap of the PNG, never of the HEIC.
    const from = (drawn[0] as { from: Blob } | undefined)?.from;
    expect(from?.type).toBe('image/png');
    expect([...new Uint8Array(await (from as Blob).arrayBuffer())]).toEqual([...png]);
  });

  it('passes the decoder’s refusal through in its own words', async () => {
    decoder.mockRejectedValue(new Error(en['error.heicHdr']));
    expect(await logoFromPicture(photo())).toEqual({ refused: en['error.heicHdr'] });
    decoder.mockRejectedValue(new Error(en['error.heicProfileTooBig']));
    expect(await logoFromPicture(photo())).toEqual({ refused: en['error.heicProfileTooBig'] });
    expect(decoder).toHaveBeenCalledTimes(2);
    expect(drawn).toEqual([]);
  });

  it('says what it said before with no decoder (the browser build): unreadable', async () => {
    setHeicDecoder(null);
    expect(await logoFromPicture(photo())).toBe('unreadable');
    expect(decoder).not.toHaveBeenCalled();
  });
});

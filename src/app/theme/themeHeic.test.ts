import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../core/i18n/locales/en';
import { setHeicDecoder } from '../../core/media/heic';
import { ImageError, prepareImage } from '../../core/media/image';
import type { PreparedImage } from '../../core/media/store';
import { extractAccents } from '../../ui/theme/generator/extract';
import { prepareThemeImage } from './themeEdits';

// A HEIC picked as a project's key image or logo on Windows (onboarding, Settings → Theme): decoded once, and both its
// stored picture and its accents are read from that one PNG, never from bytes the webview can't decode.

vi.mock('../../ui/theme/generator/extract', () => ({ extractAccents: vi.fn() }));
vi.mock('../../core/media/image', async (importActual) => ({
  ...(await importActual<typeof import('../../core/media/image')>()),
  prepareImage: vi.fn(),
}));

const enc = (text: string) => [...new TextEncoder().encode(text)];
const heicBytes = new Uint8Array([0, 0, 0, 24, ...enc('ftyp'), ...enc('heic'), 0, 0, 0, 0, ...enc('mif1'), ...enc('heic')]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const prepared: PreparedImage = {
  original: { sha256: 'a'.repeat(64), bytes: new Uint8Array([1]), mime: 'image/jpeg', width: 4, height: 3, colorSpace: 'display-p3' },
  thumbnail: { bytes: new Uint8Array([2]), mime: 'image/jpeg', width: 4, height: 3, longEdge: 640 },
};

describe('a HEIC picked as a key image or logo, where the webview can’t read it', () => {
  const decode = vi.fn<(source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
  const decoder = vi.fn<(photo: Blob) => Promise<Uint8Array>>();
  const picked = { name: 'IMG_0005.HEIC', read: () => Promise.resolve(new Blob([heicBytes], { type: 'image/heic' })) };

  beforeEach(() => {
    decode.mockReset();
    decoder.mockReset();
    vi.mocked(prepareImage).mockReset().mockResolvedValue(prepared);
    vi.mocked(extractAccents).mockReset().mockResolvedValue(['#1E6BD6']);
    // Edge WebView2: only the decoder's PNG decodes.
    decode.mockImplementation((source) =>
      source.type === 'image/png'
        ? Promise.resolve({ width: 4, height: 3, close: () => undefined } as unknown as ImageBitmap)
        : Promise.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError')),
    );
    vi.stubGlobal('createImageBitmap', decode);
    setHeicDecoder(decoder);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setHeicDecoder(null);
  });

  it('stores and reads the accents of the decoder’s PNG, asking the decoder once for the pick', async () => {
    decoder.mockResolvedValue(png);
    const image = await prepareThemeImage(picked);
    URL.revokeObjectURL(image.previewUrl);
    expect(decoder).toHaveBeenCalledTimes(1);
    const stored = vi.mocked(prepareImage).mock.calls[0]?.[0];
    const accents = vi.mocked(extractAccents).mock.calls[0]?.[0];
    // The one PNG, to both readers: the accents' worker never gets the HEIC's bytes.
    expect(stored).toBe(accents);
    expect(stored?.type).toBe('image/png');
    expect([...new Uint8Array(await (stored as Blob).arrayBuffer())]).toEqual([...png]);
    expect(image.candidates).toEqual(['#1E6BD6']);
    // Named as the person picked it.
    expect(image.source).toEqual({ name: 'IMG_0005.HEIC' });
  });

  it('passes the decoder’s refusal through in its own words, and reads nothing after it', async () => {
    decoder.mockRejectedValue(new Error(en['error.heicTooBig']));
    const refused = prepareThemeImage(picked);
    await expect(refused).rejects.toBeInstanceOf(ImageError);
    await expect(refused).rejects.toThrow(en['error.heicTooBig']);
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(prepareImage).not.toHaveBeenCalled();
    expect(extractAccents).not.toHaveBeenCalled();
  });

  it('hands a picture the webview reads to both readers as it is, without the decoder', async () => {
    decode.mockResolvedValue({ width: 4, height: 3, close: () => undefined });
    const image = await prepareThemeImage(picked);
    URL.revokeObjectURL(image.previewUrl);
    expect(decoder).not.toHaveBeenCalled();
    expect(vi.mocked(prepareImage).mock.calls[0]?.[0].type).toBe('image/heic');
    expect(vi.mocked(extractAccents).mock.calls[0]?.[0].type).toBe('image/heic');
  });
});

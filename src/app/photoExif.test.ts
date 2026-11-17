import { beforeEach, describe, expect, it, vi } from 'vitest';

// A photo's EXIF as the page asks for it (6.27): in the desktop app the picture's bytes go to Rust as the raw request
// body (never as JSON), and whatever goes wrong the import goes on with no date or place. Nothing else is called: no
// fetch, no other command. (The browser build's stand-in is the end-to-end tests' own: e2e/scoutPhotos.spec.ts.)

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);

const { readPhotoExif } = await import('./photoExif');

const fetchSpy = vi.fn();
beforeEach(() => {
  tauri.invoke.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

describe('reading a photo’s EXIF in the desktop app', () => {
  it('sends the picture’s bytes raw to photo_exif, and hands back what Rust answers', async () => {
    const answer = { takenAt: '2026-11-03T16:42:07', takenOffset: null, latitude: 12.51, longitude: -45.25 };
    tauri.invoke.mockResolvedValue(answer);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 1, 2, 3]);
    expect(await readPhotoExif(new Blob([bytes], { type: 'image/jpeg' }), 'quay-dusk.jpg')).toEqual(answer);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    const [command, body] = tauri.invoke.mock.calls[0] as [string, unknown];
    expect(command).toBe('photo_exif');
    // A Uint8Array is what Tauri sends as the raw body; the file's name never leaves the page.
    expect(body).toBeInstanceOf(Uint8Array);
    expect([...(body as Uint8Array)]).toEqual([...bytes]);
    expect(JSON.stringify(tauri.invoke.mock.calls)).not.toContain('quay-dusk');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands back the answer’s reason too (6.27 round 3), read as one of four', async () => {
    const { exifReasonOf } = await import('../core/model/scoutPhoto');
    for (const reason of ['read', 'none', 'refused', 'heic', 'something new']) {
      tauri.invoke.mockResolvedValue({ takenAt: null, takenOffset: null, latitude: null, longitude: null, reason });
      const answer = await readPhotoExif(new Blob([new Uint8Array([1])]), 'a.heic');
      expect(exifReasonOf(answer)).toBe(reason === 'something new' ? 'none' : reason);
    }
  });

  it('reads nothing when Rust refuses or fails, and never throws', async () => {
    tauri.invoke.mockRejectedValue('Expected the picture as raw bytes.');
    expect(await readPhotoExif(new Blob([new Uint8Array([1])]), 'a.jpg')).toBeNull();
    tauri.invoke.mockRejectedValue(new Error('gone'));
    expect(await readPhotoExif(new Blob([]), 'b.jpg')).toBeNull();
  });
});

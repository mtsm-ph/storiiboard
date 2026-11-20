import { beforeEach, describe, expect, it, vi } from 'vitest';

// A HEIC photo as the page will hand it to Rust (6.27n): its bytes as the raw request body, never as JSON, and the
// PNG's bytes back. A refusal becomes an Error with Rust's own text, so the page can put it in the person's language.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);

const { heicPicture } = await import('./heicPicture');

beforeEach(() => {
  tauri.invoke.mockReset();
});

describe('turning a HEIC into a PNG in the desktop app', () => {
  it('sends the photo’s bytes raw to heic_picture and hands back the PNG’s bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    tauri.invoke.mockResolvedValue(png.buffer);
    const photo = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const answer = await heicPicture(new Blob([photo], { type: 'image/heic' }));
    expect(answer).toBeInstanceOf(Uint8Array);
    expect([...answer]).toEqual([...png]);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    const [command, body] = tauri.invoke.mock.calls[0] as [string, unknown];
    expect(command).toBe('heic_picture');
    // A Uint8Array is what Tauri sends as the raw body.
    expect(body).toBeInstanceOf(Uint8Array);
    expect([...(body as Uint8Array)]).toEqual([...photo]);
  });

  it('rejects with an Error carrying Rust’s own text', async () => {
    tauri.invoke.mockRejectedValue('That file isn\'t an HEIC photo.');
    const refused = heicPicture(new Blob([new Uint8Array([1, 2, 3])]));
    await expect(refused).rejects.toBeInstanceOf(Error);
    await expect(refused).rejects.toThrow('That file isn\'t an HEIC photo.');
    const gone = new Error('gone');
    tauri.invoke.mockRejectedValue(gone);
    await expect(heicPicture(new Blob([]))).rejects.toBe(gone);
  });
});

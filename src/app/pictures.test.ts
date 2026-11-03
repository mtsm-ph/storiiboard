import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fromPath, typeOf } from './pictures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

// The desktop app's side of a dropped or chosen file, which Playwright can't drive: Rust reads it, and its name and
// path come along for the media record's pointer.
describe('a picture from a file on disk', () => {
  it('is read through Rust by its path, labelled by its extension', async () => {
    invokeMock.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
    const file = fromPath('/Users/kevin/Films/Bey County/refs/IMG_4012.HEIC');
    expect(file.name).toBe('IMG_4012.HEIC');
    expect(file.path).toBe('/Users/kevin/Films/Bey County/refs/IMG_4012.HEIC');
    const blob = await file.read();
    expect(invokeMock).toHaveBeenCalledWith('pictures_read', { path: '/Users/kevin/Films/Bey County/refs/IMG_4012.HEIC' });
    expect(blob.type).toBe('image/heic');
    expect(blob.size).toBe(4);
  });

  it('names Windows paths too', () => {
    expect(fromPath('C:\\Users\\kevin\\Pictures\\still.JPG').name).toBe('still.JPG');
    expect(typeOf('still.JPG')).toBe('image/jpeg');
    expect(typeOf('notes.txt')).toBe('');
  });
});

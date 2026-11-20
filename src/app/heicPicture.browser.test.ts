import { describe, expect, it, vi } from 'vitest';

// A browser build has no Rust to ask (6.27n): at start-up it hands no HEIC decoder over, so a HEIC says what it said
// before. (The desktop app's side is heicPicture.test.ts.)

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

const { installHeicDecoder } = await import('./heicPicture');
const { heicDecoder } = await import('../core/media/heic');

describe('the HEIC decoder in a browser build', () => {
  it('is never set', () => {
    installHeicDecoder();
    expect(heicDecoder()).toBeNull();
  });
});

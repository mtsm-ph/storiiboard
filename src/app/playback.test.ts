import { beforeEach, describe, expect, it, vi } from 'vitest';

// The desktop playback driver (2.3b): each call reaches its command with the argument names Tauri maps onto the Rust
// parameters (src-tauri/src/playback.rs, licences.rs, video.rs), progress comes through a Channel, and Rust's message
// comes back as an Error.

const tauri = vi.hoisted(() => {
  class Channel {
    onmessage: ((message: unknown) => void) | null = null;
  }
  return { invoke: vi.fn(), isTauri: () => true, Channel };
});
vi.mock('@tauri-apps/api/core', () => tauri);

const { playbackDriver } = await import('./playback');

const video = { videoId: 'v1', path: '/Volumes/Footage/A001_C003.MOV' };

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(null);
});

describe('the desktop playback driver', () => {
  it('makes a copy by the file’s path, with the project’s handle, and passes progress on', async () => {
    tauri.invoke.mockResolvedValueOnce({ path: '/cache/copy.mp4', silent: false });
    const seen: number[] = [];
    const made = await playbackDriver.make(video, 7, (done) => seen.push(done));
    expect(made).toEqual({ path: '/cache/copy.mp4', silent: false });
    const [name, args] = tauri.invoke.mock.calls[0] as [string, { path: string; handle: number; progress: InstanceType<typeof tauri.Channel> }];
    expect(name).toBe('playback_make');
    expect(args.path).toBe(video.path);
    expect(args.handle).toBe(7);
    expect(args.progress).toBeInstanceOf(tauri.Channel);
    args.progress.onmessage?.({ done: 0.4 });
    expect(seen).toEqual([0.4]);
  });

  it('names every other command and its arguments as Rust has them', async () => {
    await playbackDriver.find(video, undefined);
    await playbackDriver.cancel(video);
    await playbackDriver.info();
    await playbackDriver.clear();
    await playbackDriver.setCap(80);
    await playbackDriver.setFloor(20);
    await playbackDriver.move();
    await playbackDriver.moveBack();
    await playbackDriver.knownCount();
    await playbackDriver.forgetKnown();
    await playbackDriver.licence('zimg-LICENSE.txt');
    expect(tauri.invoke.mock.calls).toEqual([
      ['playback_find', { path: video.path, handle: null }],
      ['playback_cancel', { path: video.path }],
      ['playback_info', undefined],
      ['playback_clear', undefined],
      ['playback_set_cap', { gb: 80 }],
      ['playback_set_floor', { gb: 20 }],
      ['playback_move', { title: 'Move the playback copies to' }],
      ['playback_move_back', undefined],
      ['known_videos_count', undefined],
      ['known_videos_forget', undefined],
      ['licence_text', { name: 'zimg-LICENSE.txt' }],
    ]);
  });

  it('turns Rust’s message into an Error', async () => {
    tauri.invoke.mockRejectedValueOnce('That video couldn’t be made into a playback copy.');
    await expect(playbackDriver.clear()).rejects.toThrow('That video couldn’t be made into a playback copy.');
  });
});

import { Channel, invoke } from '@tauri-apps/api/core';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// Playback copies (2.3): the app plays every video from a light H.264 copy Rust makes with the computer's own encoder
// (src-tauri/src/playback.rs), one at a time, in a folder of the app's own that it keeps under a cap and above a free
// floor. The browser build (dev and the end-to-end tests) has no ffmpeg, so a stand-in pretends: it "makes" a copy in a
// few steps and keeps the copies in memory, enough to test what the page shows and does, never what the desktop does.

/** The video a copy is of: its record, and its file where the project says it is (the desktop app's key). */
export interface CopySource {
  videoId: string;
  path: string;
}

/**
 * A copy made: where it is, and whether it was made without the sound: `silent` because the original's couldn't be
 * read, and `quiet` too when every one of its sound tracks is silent (2.3c).
 */
export interface MadeCopy {
  path: string;
  silent: boolean;
  quiet?: boolean;
}

/** The copies as Rust keeps them (`CacheInfo`). Sizes in bytes; the cap and the floor in whole GB (10⁹ bytes). */
export interface CopiesInfo {
  folder: string;
  bytes: number;
  copies: number;
  capGb: number;
  floorGb: number;
  /** What the drive copies go to has free; null when it can't tell. */
  freeBytes: number | null;
  /** The drive picked isn't there: copies go to this computer's cache folder until it's back. */
  fallback: boolean;
  /** The copies were moved to a folder picked, so they can go back. */
  moved: boolean;
  /** A copy is being made, or waiting its turn. */
  busy: boolean;
}

/** The licences that ship beside the app, as the bundle names them (src-tauri/src/licences.rs). */
export const LICENCES = ['ffmpeg-LICENSE.txt', 'ffmpeg-LICENSE.md', 'zimg-LICENSE.txt', 'dav1d-LICENSE.txt', 'ffmpeg-SOURCE.txt'] as const;
export type LicenceName = (typeof LICENCES)[number];

export interface PlaybackDriver {
  /** Makes the copy (or finds the one made), saying how far along it is, 0 to 1; it can step back. */
  make(video: CopySource, handle: number | undefined, onProgress: (done: number) => void): Promise<MadeCopy>;
  /** The copy made, if there is one; null while the copies are being moved. */
  find(video: CopySource, handle: number | undefined): Promise<MadeCopy | null>;
  /** Stops every copy of this video being made or waiting in Rust. */
  cancel(video: CopySource): Promise<boolean>;
  info(): Promise<CopiesInfo>;
  /** Deletes every copy; how many went. */
  clear(): Promise<number>;
  setCap(gb: number): Promise<void>;
  setFloor(gb: number): Promise<void>;
  /** Asks for a folder and moves the copies there: how many moved, or null when no folder was picked. */
  move(): Promise<number | null>;
  /** Moves them back to this computer's cache folder. */
  moveBack(): Promise<number>;
  /** Videos this computer remembers the person handed it, so reopened projects read them (2.2b). */
  knownCount(): Promise<number>;
  forgetKnown(): Promise<void>;
  licence(name: LicenceName): Promise<string>;
}

/** Rust rejects with its message as a string: an Error, so callers and notices treat it like any other. */
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

const desktop: PlaybackDriver = {
  make: (video, handle, onProgress) => {
    const progress = new Channel<{ done: number }>();
    progress.onmessage = (message) => {
      onProgress(message.done);
    };
    return call<MadeCopy>('playback_make', { path: video.path, handle: handle ?? null, progress });
  },
  find: (video, handle) => call<MadeCopy | null>('playback_find', { path: video.path, handle: handle ?? null }),
  cancel: (video) => call<boolean>('playback_cancel', { path: video.path }),
  info: () => call<CopiesInfo>('playback_info'),
  clear: () => call<number>('playback_clear'),
  setCap: (gb) => call<null>('playback_set_cap', { gb }).then(() => undefined),
  setFloor: (gb) => call<null>('playback_set_floor', { gb }).then(() => undefined),
  move: () => call<number | null>('playback_move', { title: t('dialogs.moveCopies') }),
  moveBack: () => call<number>('playback_move_back'),
  knownCount: () => call<number>('known_videos_count'),
  forgetKnown: () => call<null>('known_videos_forget').then(() => undefined),
  licence: (name) => call<string>('licence_text', { name }),
};

/** What the stand-in pretends each copy takes. */
const PRETEND_BYTES = 2_400_000;
/** Its steps, and how long each takes: 2.5 s a copy, long enough to see it made and to cancel it. */
const PRETEND_STEPS = 10;
const PRETEND_STEP_MS = 250;

/** The browser build's copies, by video record: made in memory, in a few steps. */
function standIn(): PlaybackDriver {
  const made = new Set<string>();
  const making = new Map<string, { stop: () => void }>();
  let settings = { capGb: 50, floorGb: 10, folder: 'Storiiboard Playback Copies', moved: false };
  let known = 0;
  return {
    make: (video, _handle, onProgress) =>
      new Promise((resolve, reject) => {
        if (made.has(video.videoId)) {
          resolve({ path: video.videoId, silent: false });
          return;
        }
        let step = 0;
        const timer = setInterval(() => {
          step += 1;
          onProgress(step / PRETEND_STEPS);
          if (step < PRETEND_STEPS) return;
          clearInterval(timer);
          making.delete(video.videoId);
          made.add(video.videoId);
          resolve({ path: video.videoId, silent: false });
        }, PRETEND_STEP_MS);
        making.set(video.videoId, {
          stop: () => {
            clearInterval(timer);
            making.delete(video.videoId);
            reject(new Error(t('error.copyCancelled')));
          },
        });
      }),
    find: (video) => Promise.resolve(made.has(video.videoId) ? { path: video.videoId, silent: false } : null),
    cancel: (video) => {
      const run = making.get(video.videoId);
      run?.stop();
      return Promise.resolve(run !== undefined);
    },
    info: () =>
      Promise.resolve({
        ...settings,
        bytes: made.size * PRETEND_BYTES,
        copies: made.size,
        freeBytes: null,
        fallback: false,
        busy: making.size > 0,
      }),
    clear: () => {
      const count = made.size;
      made.clear();
      return Promise.resolve(count);
    },
    setCap: (gb) => {
      settings = { ...settings, capGb: gb };
      return Promise.resolve();
    },
    setFloor: (gb) => {
      settings = { ...settings, floorGb: gb };
      return Promise.resolve();
    },
    // No folder dialog here: a folder named in a prompt, as the browser build's projects are.
    move: () => {
      const folder = window.prompt(t('dialogs.moveCopies'))?.trim();
      if (!folder) return Promise.resolve(null);
      settings = { ...settings, folder: `${folder}/Storiiboard Playback Copies`, moved: true };
      return Promise.resolve(made.size);
    },
    moveBack: () => {
      settings = { ...settings, folder: 'Storiiboard Playback Copies', moved: false };
      return Promise.resolve(made.size);
    },
    knownCount: () => Promise.resolve(known),
    forgetKnown: () => {
      known = 0;
      return Promise.resolve();
    },
    licence: () => Promise.resolve(t('licences.desktopOnly')),
  };
}

/** The playback driver for this build. */
export const playbackDriver: PlaybackDriver = isTauriApp ? desktop : standIn();

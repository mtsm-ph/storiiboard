import { invoke } from '@tauri-apps/api/core';
import { probeMp4 } from '../core/media/mp4';
import { frameSeconds, type Rational } from '../core/media/timecode';
import type { VideoProbe } from '../core/media/video';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';

// Videos from the person's files (Phase 2). In the desktop app, Rust reads them with the ffmpeg and ffprobe sidecars
// (src-tauri/src/video.rs), and only a file the person dropped or chose, or one the open project links. The browser
// build (dev and the end-to-end tests) can't run ffmpeg, so a stand-in reads an MP4's own boxes and grabs stills from
// a <video> element (decision 9): enough to test the flows, never what the desktop app uses.

export interface VideoFile {
  /** As the person saw it: `A001_C003_0101AB.MP4`. */
  name: string;
  /** Where it is on disk; desktop app only. */
  path?: string;
  /** Bytes, when known. */
  size?: number;
  /** The browser build's file, in place of a path. */
  file?: File;
}

/** Whether a linked file is where the project says. */
export interface FileStatus {
  exists: boolean;
  size: number | null;
}

export interface VideoDriver {
  /** What ffprobe reads. `handle` is the open project's (ProjectFile.nativeHandle), so a video it links may be read. */
  probe(video: VideoFile, handle?: number): Promise<VideoProbe>;
  /** Frame `frame` of the video, from the original, as a PNG. */
  still(video: VideoFile, frame: number, fps: Rational, handle?: number): Promise<Blob>;
  /** Each path's status, in order; null for one this build can't tell about. */
  status(paths: readonly string[], handle?: number): Promise<(FileStatus | null)[]>;
  /** The Open dialog for videos; empty when cancelled. */
  choose(multiple: boolean): Promise<VideoFile[]>;
}

/** A file the desktop app was handed by path (a drop or its Open dialog). */
export function videoFromPath(path: string): VideoFile {
  return { name: path.split(/[/\\]/).pop() ?? path, path };
}

const desktop: VideoDriver = {
  probe: (video, handle) => invoke<VideoProbe>('video_probe', { path: video.path ?? '', handle: handle ?? null }),
  still: async (video, frame, fps, handle) => {
    const bytes = await invoke<ArrayBuffer>('video_still', {
      path: video.path ?? '',
      handle: handle ?? null,
      frame,
      fpsNum: fps.num,
      fpsDen: fps.den,
    });
    return new Blob([bytes], { type: 'image/png' });
  },
  status: (paths, handle) => invoke<(FileStatus | null)[]>('video_status', { paths, handle: handle ?? null }),
  choose: async (multiple) => {
    const title = multiple ? t('dialogs.chooseVideos') : t('dialogs.chooseVideo');
    const paths = await invoke<string[]>('video_choose', { multiple, title, kind: t('dialogs.videosFilter') });
    return paths.map(videoFromPath);
  },
};

/** Waits for one event from a media element; fails on its error, or when it never comes. */
function once(element: HTMLMediaElement, event: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener('error', failed);
    };
    const done = () => {
      stop();
      resolve();
    };
    const failed = () => {
      stop();
      reject(new Error(t('error.notAVideo')));
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error(t('error.videoTooSlow')));
    }, timeoutMs);
    element.addEventListener(event, done);
    element.addEventListener('error', failed);
  });
}

const browser: VideoDriver = {
  probe: async (video) => {
    const probe = video.file ? probeMp4(await video.file.arrayBuffer()) : null;
    if (!probe) throw new Error(t('error.notAVideo'));
    return probe;
  },
  still: async (video, frame, fps) => {
    if (!video.file) throw new Error(t('error.fileGone'));
    const element = document.createElement('video');
    const url = URL.createObjectURL(video.file);
    try {
      element.muted = true;
      element.preload = 'auto';
      element.src = url;
      await once(element, 'loadeddata');
      // Half a frame in, so the frame shown is this one whatever the engine rounds.
      element.currentTime = frameSeconds(frame + 0.5, fps);
      await once(element, 'seeked');
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      canvas.getContext('2d')?.drawImage(element, 0, 0);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error(t('error.notAVideo')));
        }, 'image/png');
      });
    } finally {
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
    }
  },
  // The browser build links files without a path, so there's nothing on disk to look for.
  status: (paths) => Promise.resolve(paths.map(() => null)),
  choose: (multiple) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*,.mov,.mxf,.mts,.m2ts';
      input.multiple = multiple;
      input.hidden = true;
      const done = (files: VideoFile[]) => {
        input.remove();
        resolve(files);
      };
      input.addEventListener('change', () => {
        done([...(input.files ?? [])].map((file) => ({ name: file.name, size: file.size, file })));
      });
      input.addEventListener('cancel', () => {
        done([]);
      });
      document.body.append(input);
      input.click();
    }),
};

/** The video driver for this build. */
export const videoDriver: VideoDriver = isTauriApp ? desktop : browser;

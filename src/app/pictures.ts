import { invoke } from '@tauri-apps/api/core';
import { t } from '../core/i18n';
import { listen } from '@tauri-apps/api/event';
import { isTauriApp } from './fileAccess';

// Pictures from the person's files, for frames (1.11). In the desktop app the page never names a file to read: Rust
// reads only what was dropped on the window or picked in its Open dialog (src-tauri/src/pictures.rs), and the path
// comes along, so the media record can keep it as a pointer. In the browser build (the end-to-end tests) files come
// from a file input, the page's own drop events and paste, without a path.

export interface PictureFile {
  /** As the person saw it: `IMG_4012.JPG`. */
  name: string;
  /** Where the file is on disk; desktop app only. */
  path?: string;
  read(): Promise<Blob>;
}

const TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** The type a file's extension names, so bytes read through Rust reach the decoder labelled; '' when unknown. */
export function typeOf(name: string): string {
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

// Sent by src-tauri/src/pictures.rs, with points already in CSS pixels: Tauri's own drag events mix device pixels
// (Windows) and points (Mac) under one label.
const DROPPED_EVENT = 'storiiboard://pictures-dropped';
const DRAGGED_EVENT = 'storiiboard://pictures-dragged';

/** A file the person dropped or picked in the desktop app, read through Rust when it's needed. */
export function fromPath(path: string): PictureFile {
  const name = path.split(/[/\\]/).pop() ?? path;
  return {
    name,
    path,
    read: async () => new Blob([await invoke<ArrayBuffer>('pictures_read', { path })], { type: typeOf(name) }),
  };
}

/** A file from a file input, a drop in the browser build, or the clipboard. */
export function fromFile(file: File): PictureFile {
  return { name: file.name, read: () => Promise.resolve(file) };
}

/** The Open dialog for pictures; empty when it's cancelled. */
export async function choosePictures(multiple: boolean): Promise<PictureFile[]> {
  if (isTauriApp) {
    // The native dialog's words, in the app's language.
    const title = multiple ? t('dialogs.choosePictures') : t('dialogs.choosePicture');
    return (await invoke<string[]>('pictures_choose', { multiple, title, kind: t('dialogs.picturesFilter') })).map(fromPath);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.multiple = multiple;
    input.hidden = true;
    const done = (files: PictureFile[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      done([...(input.files ?? [])].map(fromFile));
    });
    input.addEventListener('cancel', () => {
      done([]);
    });
    document.body.append(input);
    input.click();
  });
}

/** A point in the page, in CSS pixels. */
export interface PagePoint {
  x: number;
  y: number;
}

/**
 * Desktop app only: files dropped on the window, and where in the page they landed. Tauri catches file drops before
 * the page sees them, so in the app this replaces the page's own drop events.
 */
export function onWindowDrop(handler: (files: PictureFile[], at: PagePoint) => void): Promise<() => void> {
  return listen<{ paths: string[]; at: PagePoint }>(DROPPED_EVENT, ({ payload }) => {
    handler(payload.paths.map(fromPath), payload.at);
  });
}

/** Desktop app only: where a drag of files is over the page, or null once it has left or dropped. */
export function onWindowDrag(handler: (at: PagePoint | null) => void): Promise<() => void> {
  return listen<PagePoint | null>(DRAGGED_EVENT, ({ payload }) => {
    handler(payload);
  });
}

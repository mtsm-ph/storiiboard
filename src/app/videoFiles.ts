import { isTauriApp } from './fileAccess';

// The browser build's footage (2.4). It makes no playback copies, so its Player plays the file the person handed over,
// kept for the page by its video record as an object URL, for as long as the page is open. The desktop app plays
// copies only (CLAUDE.md: play proxies, never originals), and keeps nothing here.

const urls = new Map<string, string>();

/** Keeps the file handed over for a video record (a link or a relink), in the browser build only. */
export function rememberVideoFile(videoId: string, file: Blob | undefined): void {
  if (isTauriApp || !file) return;
  const old = urls.get(videoId);
  if (old) URL.revokeObjectURL(old);
  urls.set(videoId, URL.createObjectURL(file));
}

/** The file kept for a video record, as a URL a `<video>` plays; null if there's none this session. */
export function videoFileUrl(videoId: string): string | null {
  return urls.get(videoId) ?? null;
}

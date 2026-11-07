import { isTauriApp } from './fileAccess';

// The browser build's footage (2.4). It makes no playback copies, so its Player plays the file the person handed over,
// kept for the page by its video record as an object URL, for as long as the page is open. The desktop app plays
// copies only (CLAUDE.md: play proxies, never originals), and keeps nothing here.

const kept = new Map<string, { url: string; file: Blob }>();

/** Keeps the file handed over for a video record (a link or a relink), in the browser build only. */
export function rememberVideoFile(videoId: string, file: Blob | undefined): void {
  if (isTauriApp || !file) return;
  const old = kept.get(videoId);
  if (old) URL.revokeObjectURL(old.url);
  kept.set(videoId, { url: URL.createObjectURL(file), file });
}

/** The file kept for a video record, as a URL a `<video>` plays; null if there's none this session. */
export function videoFileUrl(videoId: string): string | null {
  return kept.get(videoId)?.url ?? null;
}

/** The file kept for a video record itself, for a still grabbed from it (2.7); null if there's none this session. */
export function videoFileKept(videoId: string): Blob | null {
  return kept.get(videoId)?.file ?? null;
}

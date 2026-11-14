import { invoke } from '@tauri-apps/api/core';
import { readOriginal } from '../core/media/store';
import { t } from '../core/i18n';
import { fileMode, isTauriApp } from './fileAccess';
import { projectStore } from './projectStore';

// Opening outside the app (3.12; Kevin, Nov 9): a web link in the browser, a PDF attachment in the computer's PDF
// reader, and nothing else. On the desktop through Rust (src-tauri/src/open.rs): a link is checked to be http or
// https there; a PDF is named by its SHA-256 and Rust reads it from the open project itself, so the page never hands
// over a path. In a browser build, a link opens in a new tab and a PDF as the browser shows one.
//
// And one other thing (5.9; Kevin, Nov 11): a board picture's recorded original shown in its folder, selected, in Finder
// or Explorer (`originalShown`, `revealOriginal`). Named by the picture's SHA-256 only; Rust finds the path from the open
// project's own record and only reveals, never opens. A browser build has no such thing: both say no.

const isWebLink = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
};

/** Opens a web link in the browser; anything but http or https is refused. */
export async function openLink(url: string): Promise<void> {
  if (!isWebLink(url)) throw new Error(t('error.notALink'));
  if (isTauriApp) {
    await invoke('open_link', { url });
    return;
  }
  // noopener: the page opened gets no hold on this one.
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Opens a PDF the open project holds, by its SHA-256, as a read-only copy in the PDF reader. */
export async function openPdf(sha256: string, name: string): Promise<void> {
  const file = projectStore.getState().project?.file;
  if (!file) return;
  if (isTauriApp && file.nativeHandle !== undefined) {
    await invoke('open_pdf', { handle: file.nativeHandle, sha256, name });
    return;
  }
  const stored = await readOriginal(file, sha256);
  if (!stored) throw new Error(t('error.pdfGone'));
  const url = URL.createObjectURL(new Blob([new Uint8Array(stored.bytes)], { type: 'application/pdf' }));
  window.open(url, '_blank', 'noopener,noreferrer');
  // Long enough for the new tab to read it.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

/**
 * What a development build opened with `?files=memory` (no Rust there) uses to stand in for the computer's disk, so an
 * end-to-end test can say "this picture's original exists" and see which hash the reveal was asked for: set
 * `window.__sbdDevOriginals` once the page has loaded. Like Rust's, the lookup wants the picture's own `media` record to be an
 * image of that hash, but not more: memory-build pictures have no `source_path`, so the stand-in can show the action where
 * Rust wouldn't. The test opts in per hash, so no picture shows it by accident. Not in a release build.
 */
export interface DevOriginals {
  /** The hashes whose original "exists". */
  shown: string[];
  /** The hashes `originalShown` was asked about, in order: how a test learns a dropped picture's stored hash. */
  asked: string[];
  /** The hashes the reveal was asked for, in order. */
  revealed: string[];
  /** The next reveal fails, as if the file went between the two calls. */
  failing?: boolean;
}

const devOriginals = (): DevOriginals | undefined =>
  import.meta.env.DEV && fileMode === 'memory'
    ? (window as unknown as { __sbdDevOriginals?: DevOriginals }).__sbdDevOriginals
    : undefined;

/** Whether the stand-in has this record's picture, as Rust's lookup of the record would. */
const devHas = (dev: DevOriginals | undefined, recordId: string, sha256: string): boolean => {
  const props = projectStore.getState().records[recordId]?.props;
  return dev !== undefined && props?.kind === 'image' && props.file === sha256 && dev.shown.includes(sha256);
};

/**
 * Whether this picture's recorded original can be shown in its folder now (Rust looks at the disk). `recordId` is the
 * picture's own `media` record: the path comes from that record alone, never from the page.
 */
export async function originalShown(recordId: string, sha256: string): Promise<boolean> {
  const file = projectStore.getState().project?.file;
  if (!file) return false;
  if (isTauriApp && file.nativeHandle !== undefined) {
    try {
      return await invoke<boolean>('original_shown', { handle: file.nativeHandle, recordId, sha256 });
    } catch {
      return false;
    }
  }
  const dev = devOriginals();
  dev?.asked.push(sha256);
  return devHas(dev, recordId, sha256);
}

/** Shows the picture's recorded original in its folder, selected; throws when it can't (the file went, or was refused). */
export async function revealOriginal(recordId: string, sha256: string): Promise<void> {
  const file = projectStore.getState().project?.file;
  if (!file) throw new Error(t('moodboard.originalGone'));
  if (isTauriApp && file.nativeHandle !== undefined) {
    try {
      await invoke('reveal_original', { handle: file.nativeHandle, recordId, sha256 });
    } catch {
      throw new Error(t('moodboard.originalGone'));
    }
    return;
  }
  const dev = devOriginals();
  if (!dev) throw new Error(t('moodboard.originalGone'));
  dev.revealed.push(sha256);
  if (dev.failing || !devHas(dev, recordId, sha256)) {
    dev.shown = dev.shown.filter((hash) => hash !== sha256);
    throw new Error(t('moodboard.originalGone'));
  }
}

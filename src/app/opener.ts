import { invoke } from '@tauri-apps/api/core';
import { readOriginal } from '../core/media/store';
import { t } from '../core/i18n';
import { isTauriApp } from './fileAccess';
import { projectStore } from './projectStore';

// Opening outside the app (3.12; Kevin, Nov 9): a web link in the browser, a PDF attachment in the computer's PDF
// reader, and nothing else. On the desktop through Rust (src-tauri/src/open.rs): a link is checked to be http or
// https there; a PDF is named by its SHA-256 and Rust reads it from the open project itself, so the page never hands
// over a path. In a browser build, a link opens in a new tab and a PDF as the browser shows one.

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

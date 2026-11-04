import { message } from '@tauri-apps/plugin-dialog';
import { isTauriApp } from './fileAccess';

// A confirm for what can't be undone (1.21: Empty Trash, Clean up old pictures): the system's own warning dialog in
// the desktop app, the browser's in the browser build (the end-to-end tests answer it). Resolves to true only when the
// person picks the action itself.

export async function confirmForGood(title: string, text: string, action: string): Promise<boolean> {
  if (!isTauriApp) return window.confirm(`${title}\n\n${text}`);
  const answer = await message(text, { title, kind: 'warning', buttons: { ok: action, cancel: 'Cancel' } });
  // Custom buttons report either their label or the role they replace, depending on the platform.
  return answer === action || answer === 'Ok';
}

/** "12.4 MB", "640 KB": a size people read at a glance. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

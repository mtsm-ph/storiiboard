import { command } from '../../core/storage/tauriDriver';
import { fileStem } from '../../core/storage/paths';
import { loadSettings, MAX_SYNC_NOTED, saveSettings } from '../../core/storage/settings';
import { showInfo } from '../notice';

// Projects in synced folders (docs/PLAN.md, F). They work, but should be open on one computer at a time, so the app
// says so once per project. The detection is on disk, in Rust (src-tauri/src/synced.rs); nothing goes on the network.

/** The sync service a project is in (iCloud Drive, Dropbox…), or null for a folder only on this computer. */
export function syncServiceOf(path: string): Promise<string | null> {
  return command<string | null>('sync_service', { path });
}

/** Where New project's Save dialog starts: Documents, or a local folder when Documents is synced. */
export function projectsFolderForNew(): Promise<string> {
  return command<string>('projects_folder_for_new', {});
}

export function syncNote(path: string, service: string): string {
  return (
    `“${fileStem(path)}” is in ${service}. That works, but keep it open on one computer at a time: ` +
    'Storiiboard warns you when another computer has it open.'
  );
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export interface NoteOptions {
  lookup?: (path: string) => Promise<string | null>;
  show?: (message: string) => void;
  storage?: Storage;
}

/** Shows the note the first time a project in a synced folder opens. Returns whether it did. */
export async function noteIfSynced(path: string, options: NoteOptions = {}): Promise<boolean> {
  const { lookup = syncServiceOf, show = showInfo, storage } = options;
  if (loadSettings(storage).syncNoted.includes(path)) return false;
  const service = await lookup(path).catch(() => null);
  if (service === null) return false;
  show(syncNote(path, service));
  const noted = [...loadSettings(storage).syncNoted, path].slice(-MAX_SYNC_NOTED);
  saveSettings({ syncNoted: noted }, storage);
  return true;
}

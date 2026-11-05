import { isTauri } from '@tauri-apps/api/core';
import { tauriAppData, type AppDataStore } from '../core/storage/appData';
import type { SqlDriver } from '../core/storage/driver';
import { tauriDriver } from '../core/storage/tauriDriver';

// How this build reaches project files.
// - desktop: the Tauri app, through the Rust commands. Every native feature works.
// - memory: development only, with `?files=memory` in the address: projects live in the page (sql.js, saved to
//   localStorage), so the end-to-end tests can create, edit and reopen real projects in a browser. There are no
//   native dialogs; New project and Open… ask for a name in a prompt. Adding `&keep=page` keeps them in the page
//   only: localStorage holds about 5 MB and is rewritten whole after every edit, which a performance run with
//   hundreds of pictures can neither fit nor afford (e2e/perf.spec.ts).
// - none: the browser build otherwise. It shows the shell with placeholder tiles and opens no files.

export type FileMode = 'desktop' | 'memory' | 'none';

/** Development builds only: import.meta.env.DEV is false in production, so the bundler drops sql.js entirely. */
const loadMemoryDriver = import.meta.env.DEV
  ? async (): Promise<SqlDriver> => {
      const [{ createMemoryDriver }, { default: wasm }] = await Promise.all([
        import('../core/storage/memoryDriver'),
        import('sql.js/dist/sql-wasm.wasm?url'),
      ]);
      const pageOnly = new URLSearchParams(window.location.search).get('keep') === 'page';
      return createMemoryDriver(pageOnly ? { wasm } : { wasm, storage: globalThis.localStorage });
    }
  : null;

function wantsMemory(): boolean {
  return (
    loadMemoryDriver !== null &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('files') === 'memory'
  );
}

export const fileMode: FileMode = isTauri() ? 'desktop' : wantsMemory() ? 'memory' : 'none';

/** Projects can be created and opened (the desktop app, or the memory driver in tests). */
export const canOpenFiles = fileMode !== 'none';

/** Native features: dialogs, lock files, sync detection, Finder and Explorer. */
export const isTauriApp = fileMode === 'desktop';

let memory: Promise<SqlDriver> | null = null;
const resolveDriver = (): Promise<SqlDriver> => {
  if (fileMode === 'memory' && loadMemoryDriver) return (memory ??= loadMemoryDriver());
  return Promise.resolve(tauriDriver);
};

/** The driver for this build, whichever it is. */
export const appDriver: SqlDriver = {
  create: async (path) => (await resolveDriver()).create(path),
  open: async (path) => (await resolveDriver()).open(path),
  copy: async (source, dest) => (await resolveDriver()).copy(source, dest),
  keepCopy: async (draft, dest) => (await resolveDriver()).keepCopy(draft, dest),
  dropCopy: async (draft) => (await resolveDriver()).dropCopy(draft),
  lockHolder: async (path) => (await resolveDriver()).lockHolder(path),
};

/** The memory build keeps Recent in localStorage, as the desktop app keeps it in its data folder. */
const memoryAppData: AppDataStore = {
  read: (name) => Promise.resolve(globalThis.localStorage.getItem(`storiiboard.app-data.${name}`)),
  write: (name, contents) => {
    globalThis.localStorage.setItem(`storiiboard.app-data.${name}`, contents);
    return Promise.resolve();
  },
};

export const appData: AppDataStore | null =
  fileMode === 'desktop' ? tauriAppData : fileMode === 'memory' ? memoryAppData : null;

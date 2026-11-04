import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Script } from '../../core/script/script';

// The script waiting in the import preview (1.17): read and parsed, nothing written yet. Import or Cancel clears it.

export interface PendingImport {
  fileName: string;
  script: Script;
  /** The project's file it was opened for: if another opens meanwhile, the preview closes rather than move to it. */
  projectId: string;
  path: string;
}

export const importStore = createStore<{ pending: PendingImport | null }>()(() => ({ pending: null }));

export const showImport = (pending: PendingImport): void => {
  importStore.setState({ pending });
};

export const closeImport = (): void => {
  importStore.setState({ pending: null });
};

export const usePendingImport = (): PendingImport | null => useStore(importStore, (s) => s.pending);

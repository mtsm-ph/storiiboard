import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AppDataStore } from '../../core/storage/appData';
import { forgetRecent, listRecent, type RecentProject } from '../../core/storage/recent';

// The Recent list as the Projects screen and the switcher show it. The list itself lives in the app's data folder
// (src/core/storage/recent.ts); this keeps a copy for the screen and re-reads it after each open.

interface RecentState {
  entries: RecentProject[];
  /** Re-reads the list. A no-op without a store (the browser build). */
  refresh: () => Promise<void>;
  forget: (path: string) => Promise<void>;
}

export function createRecentStore(store: AppDataStore | null) {
  return createStore<RecentState>()((set) => ({
    entries: [],
    refresh: async () => {
      if (store) set({ entries: await listRecent(store) });
    },
    forget: async (path) => {
      if (store) set({ entries: await forgetRecent(store, path) });
    },
  }));
}

export type RecentStore = ReturnType<typeof createRecentStore>;

export function useRecent<T>(recent: RecentStore, select: (state: RecentState) => T): T {
  return useStore(recent, select);
}

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Whether a project is being opened or made (src/app/openFiles.ts), so the sidebar's workspaces can't be chosen until
// it is open. The sidebar grows as the project arrives (its scenes under Storyboard), moving every section below: a
// press on one before that and a release after it land on two different buttons, so the click went to neither and
// the section pressed was never shown, while it kept the focus (planLayers on WebKit, Nov 20). Kevin's rule: until
// the project is open, no section takes a click or a key. A count, as a second open can begin before the first ends.

export const openingProjectStore = createStore<{ count: number }>()(() => ({ count: 0 }));

/** Runs `open` with the project shown as opening until it is open, fails or is cancelled. */
export async function whileOpeningProject<T>(open: () => Promise<T>): Promise<T> {
  openingProjectStore.setState((s) => ({ count: s.count + 1 }));
  try {
    return await open();
  } finally {
    openingProjectStore.setState((s) => ({ count: s.count - 1 }));
  }
}

/** Whether a project is being opened now: for a key's handler, which reads it as the key comes. */
export const isOpeningProject = (): boolean => openingProjectStore.getState().count > 0;

export const useOpeningProject = (): boolean => useStore(openingProjectStore, (s) => s.count > 0);

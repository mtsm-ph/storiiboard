import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Which named version Open version is copying (1.23), so History can say so. Copying a project with gigabytes of
// pictures takes many seconds with nothing else on screen to show for it, and someone who sees nothing happen may quit
// mid-copy. One at a time: a second press while a copy is made would make two copies.

export const openingVersionStore = createStore<{ name: string | null }>()(() => ({ name: null }));

/**
 * Runs `open` as the copy of version `name`, shown as opening until it lands or fails. False, without running it, when
 * another version is already being opened.
 */
export async function whileOpening(name: string, open: () => Promise<void>): Promise<boolean> {
  if (openingVersionStore.getState().name !== null) return false;
  openingVersionStore.setState({ name });
  try {
    await open();
  } finally {
    openingVersionStore.setState({ name: null });
  }
  return true;
}

/** The name of the version being opened, or null. */
export const useOpeningVersion = (): string | null => useStore(openingVersionStore, (s) => s.name);

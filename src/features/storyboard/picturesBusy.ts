import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** How many files are being prepared now, pictures or videos, so the board can say so; a 48 MP HEIC takes a second. */
export const picturesBusy = createStore<{ count: number }>()(() => ({ count: 0 }));

export function usePicturesBusy(): number {
  return useStore(picturesBusy, (s) => s.count);
}

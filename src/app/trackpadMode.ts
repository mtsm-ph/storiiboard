import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadTrackpadMode, saveTrackpadMode, trackpadModeOf, type TrackpadModeChoice } from '../core/storage/settings';
import { platformOf } from '../features/moodboards/showOriginal';

// Trackpad mode (6.5.3, Kevin, Nov 16): one choice on this computer for every plan, board and deck, shown and changed
// from Settings → App and from each canvas's own switch, both at once. A way of reading the wheel, never an edit: no op,
// nothing in History, nothing in the project. Never chosen, it is the platform's default (on on a Mac, off elsewhere).

const store = createStore<{ choice: TrackpadModeChoice }>()(() => ({ choice: loadTrackpadMode() }));

const platform = () => platformOf(typeof navigator === 'undefined' ? '' : navigator.userAgent);

/** Whether trackpad mode is on now on this computer. */
export const useTrackpadMode = (): boolean => useStore(store, (s) => trackpadModeOf(s.choice, platform()));

/** Turns trackpad mode on or off for every canvas on this computer, and keeps the choice. */
export function setTrackpadMode(on: boolean): void {
  if (store.getState().choice === on) return;
  store.setState({ choice: saveTrackpadMode(on) });
}

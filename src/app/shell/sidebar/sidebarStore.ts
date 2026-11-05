import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { HIDE_SIDEBAR_ID, SHOW_SIDEBAR_ID } from './sidebarToggle';

// Whether the sidebar is folded to its strip (polish 2), in a store of its own so the button, the shortcut and the
// Layout menu (polish A) all hide and show the same one. The person's choice, remembered across restarts.

const sidebarStore = createStore<{ hidden: boolean }>()(() => ({ hidden: loadSettings().sidebarHidden }));

export function useSidebarHidden(): boolean {
  return useStore(sidebarStore, (s) => s.hidden);
}

/** Hides or shows the sidebar. `focusFollows`: focus moves to the button that brings it back, never to <body>. */
export function toggleSidebar(focusFollows: boolean): void {
  const next = !sidebarStore.getState().hidden;
  sidebarStore.setState({ hidden: next });
  saveSettings({ sidebarHidden: next });
  // Whichever of the two buttons is drawn now: Show sidebar in the strip, or Hide sidebar at the sidebar's foot.
  if (focusFollows) requestAnimationFrame(() => (document.getElementById(SHOW_SIDEBAR_ID) ?? document.getElementById(HIDE_SIDEBAR_ID))?.focus());
}

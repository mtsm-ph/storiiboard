import { createStore } from 'zustand/vanilla';
import { discardDrafts } from './drafts';

// Which Settings tab is open (polish B), apart from the window itself (SettingsWindow.tsx), so what a tab shows can
// open Settings at another tab without importing the window that holds it.

// Presets (6.5.8) last, after the tabs people already know their way to by arrow keys.
export const SETTINGS_TABS = ['project', 'app', 'theme', 'backups', 'storage', 'online', 'profile', 'presets'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

interface SettingsState {
  open: boolean;
  tab: SettingsTab;
  /** Counts the window's openings: one the engine closed by itself while the person keeps editing opens afresh. */
  mount: number;
}

export const settingsStore = createStore<SettingsState>()(() => ({ open: false, tab: 'project', mount: 0 }));

/** Opens Settings, at a given tab or the one last open. */
export function openSettings(tab?: SettingsTab): void {
  settingsStore.setState((s) => ({ open: true, tab: tab ?? s.tab }));
}

/** Closes Settings; a change still waiting for Apply goes with it (the close asks first: settingsClose.ts). */
export function closeSettings(): void {
  discardDrafts();
  settingsStore.setState({ open: false });
}

/** Draws the window again, still open: after the engine closed its dialog by itself (a second Escape in Chromium). */
export function remountSettings(): void {
  settingsStore.setState((s) => ({ open: true, mount: s.mount + 1 }));
}

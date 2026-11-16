import { createStore } from 'zustand/vanilla';

// Which Settings tab is open (polish B), apart from the window itself (SettingsWindow.tsx), so what a tab shows can
// open Settings at another tab without importing the window that holds it.

// Presets (6.5.8) last, after the tabs people already know their way to by arrow keys.
export const SETTINGS_TABS = ['project', 'app', 'theme', 'backups', 'storage', 'online', 'profile', 'presets'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

interface SettingsState {
  open: boolean;
  tab: SettingsTab;
}

export const settingsStore = createStore<SettingsState>()(() => ({ open: false, tab: 'project' }));

/** Opens Settings, at a given tab or the one last open. */
export function openSettings(tab?: SettingsTab): void {
  settingsStore.setState((s) => ({ open: true, tab: tab ?? s.tab }));
}

export function closeSettings(): void {
  settingsStore.setState({ open: false });
}

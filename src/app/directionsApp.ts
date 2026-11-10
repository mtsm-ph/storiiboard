import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadSettings, saveSettings, type DirectionsApp } from '../core/storage/settings';

// "Directions open in" (4.6, Settings → App): the app a call sheet's directions link and QR code open. Google Maps by
// default. Kept in this computer's settings, never in a project.

const store = createStore<{ app: DirectionsApp }>()(() => ({ app: loadSettings().directionsApp }));

export const useDirectionsApp = (): DirectionsApp => useStore(store, (s) => s.app);

export const directionsApp = (): DirectionsApp => store.getState().app;

export function setDirectionsApp(app: DirectionsApp): void {
  saveSettings({ directionsApp: app });
  store.setState({ app });
}

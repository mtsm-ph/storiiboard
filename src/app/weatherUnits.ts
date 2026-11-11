import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { unitsFor, type WeatherUnits } from '../core/net/weather';
import { loadSettings, saveSettings, type WeatherUnitsChoice } from '../core/storage/settings';
import { useRegionLocale } from './weekStart';

// The forecast's units (4.4, Kevin Nov 9): °F, mph and inches where this computer's region is the US, °C, km/h and mm
// elsewhere, unless Settings → App sets one. The region is the one the week's first day reads (weekStart.ts). Kept in
// this computer's settings, never in a project; the cache keeps MET's metric values and only the display converts.

const store = createStore<{ choice: WeatherUnitsChoice }>()(() => ({ choice: loadSettings().weatherUnits }));

export const useWeatherUnitsChoice = (): WeatherUnitsChoice => useStore(store, (s) => s.choice);

export function setWeatherUnitsChoice(choice: WeatherUnitsChoice): void {
  saveSettings({ weatherUnits: choice });
  store.setState({ choice });
}

/** The units to write the forecast in now, following Settings and the computer. */
export function useWeatherUnits(): WeatherUnits {
  return unitsFor(useWeatherUnitsChoice(), useRegionLocale());
}

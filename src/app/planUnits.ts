import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { PlanUnit } from '../core/model/length';
import { isUsLocale } from '../core/net/weather';
import { loadSettings, saveSettings, type PlanUnitsChoice } from '../core/storage/settings';
import { regionLocaleNow, useRegionLocale } from './weekStart';

// The units a plan shows (6.2a, docs/PHASE6_DECISIONS.md 7), as the forecast's are (weatherUnits.ts): feet and inches
// where this computer's region is the US, metres elsewhere, unless Settings → App sets one. Kept in this computer's
// settings, never in a project: the file always holds metres, and only the screen converts.

const store = createStore<{ choice: PlanUnitsChoice }>()(() => ({ choice: loadSettings().planUnits }));

export const usePlanUnitsChoice = (): PlanUnitsChoice => useStore(store, (s) => s.choice);

export function setPlanUnitsChoice(choice: PlanUnitsChoice): void {
  saveSettings({ planUnits: choice });
  store.setState({ choice });
}

/** The unit for a choice on a computer in this region. */
export function planUnitFor(choice: PlanUnitsChoice, regionLocale: string | null): PlanUnit {
  if (choice === 'metres' || choice === 'feet') return choice;
  return isUsLocale(regionLocale) ? 'feet' : 'metres';
}

/** The unit a plan shows, read outside a component (History's lines name a wall's length in it). */
export const planUnitNow = (): PlanUnit => planUnitFor(store.getState().choice, regionLocaleNow());

/** The unit a plan shows now, following Settings and the computer. */
export function usePlanUnit(): PlanUnit {
  return planUnitFor(usePlanUnitsChoice(), useRegionLocale());
}

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { paperFor, type Paper } from '../core/model/paper';
import { loadSettings, saveSettings, type PaperChoice } from '../core/storage/settings';
import { regionLocaleNow, useRegionLocale } from './weekStart';

// The call sheet PDF's paper (4.6): Letter where this computer's region uses it, else A4, unless the Call sheet tile's
// Paper choice says otherwise. The region is the one the week's first day and the forecast's units read. Kept in this
// computer's settings, never in a project.

const store = createStore<{ choice: PaperChoice }>()(() => ({ choice: loadSettings().callSheetPaper }));

export const usePaperChoice = (): PaperChoice => useStore(store, (s) => s.choice);

export function setPaperChoice(choice: PaperChoice): void {
  saveSettings({ callSheetPaper: choice });
  store.setState({ choice });
}

/** The paper to make the PDF for now, following the tile's choice and the computer. */
export function usePaper(): Paper {
  return paperFor(usePaperChoice(), useRegionLocale());
}

/** The same paper, read outside a component: the Treatment and Shot list decks (5.5) are made for it. */
export function paperNow(): Paper {
  return paperFor(store.getState().choice, regionLocaleNow());
}

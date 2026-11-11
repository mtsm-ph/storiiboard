import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';
import type { SwatchSource } from './swatchSet';

// Which export dialog is open (1.24): Export Project or Watermark Settings, both from the project menu.

export type ExportDialogKind = 'export' | 'watermark';

export const exportStore = createStore<{ open: ExportDialogKind | null; deckId: string | null; swatches: SwatchSource | null }>()(() => ({
  open: null,
  deckId: null,
  swatches: null,
}));

/** Opens a dialog; Export from a deck's own button (5.6a) names the deck, and then offers only what exports a deck. */
export const openExportDialog = (kind: ExportDialogKind, deckId: string | null = null): void => {
  exportStore.setState({ open: kind, deckId, swatches: null });
};

/** Export swatches (5.6b): the Export dialog for a scene's palette or the brand kit, offering the PNG strip and the .ase. */
export const openSwatchesExport = (swatches: SwatchSource): void => {
  exportStore.setState({ open: 'export', deckId: null, swatches });
};

export const closeExportDialog = (): void => {
  exportStore.setState({ open: null, deckId: null, swatches: null });
};

export const useExportDialog = (): ExportDialogKind | null => useStore(exportStore, (s) => s.open);

/** The palette or brand kit the open Export dialog is for (5.6b), or null. */
export const useExportSwatches = (): SwatchSource | null => useStore(exportStore, (s) => s.swatches);

/** The deck the open Export dialog is for, or null for Export Project's. */
export const useExportDeck = (): string | null => useStore(exportStore, (s) => s.deckId);

// A dialog belongs to the project it was opened for. Another one opened in place (a double-clicked .sbd, or the
// project closed under it) closes it, rather than bringing up the same dialog for a project nobody opened it for,
// where a Save would set that project's watermark. A running export stops as the dialog goes (ExportDialog). This
// runs inside the project store's change, before React renders, so the other project's dialog never shows at all.
projectStore.subscribe((state, before) => {
  if (state.project?.projectId !== before.project?.projectId) closeExportDialog();
});

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';
import type { PlanTarget } from './planExport';
import type { SwatchSource } from './swatchSet';

// Which export dialog is open (1.24): Export Project or Watermark Settings, both from the project menu.

export type ExportDialogKind = 'export' | 'watermark';

interface ExportDialogState {
  open: ExportDialogKind | null;
  deckId: string | null;
  swatches: SwatchSource | null;
  /** The setup, scene or day a plan export is for (6.10), and the format it was asked for. */
  plan: PlanTarget | null;
  formatId: string | null;
}

const CLOSED = { open: null, deckId: null, swatches: null, plan: null, formatId: null } as const;

export const exportStore = createStore<ExportDialogState>()(() => ({ ...CLOSED }));

/** Opens a dialog; Export from a deck's own button (5.6a) names the deck, and then offers only what exports a deck. */
export const openExportDialog = (kind: ExportDialogKind, deckId: string | null = null): void => {
  exportStore.setState({ ...CLOSED, open: kind, deckId });
};

/** Export swatches (5.6b): the Export dialog for a scene's palette or the brand kit, offering the PNG strip and the .ase. */
export const openSwatchesExport = (swatches: SwatchSource): void => {
  exportStore.setState({ ...CLOSED, open: 'export', swatches });
};

/**
 * A plan's export (6.10), from the Plan tile's Export menu or a day's Plans (PDF): the Export dialog for that setup, scene
 * or day, offering the plan formats, `formatId` picked.
 */
export const openPlanExport = (plan: PlanTarget, formatId: string): void => {
  exportStore.setState({ ...CLOSED, open: 'export', plan, formatId });
};

export const closeExportDialog = (): void => {
  exportStore.setState({ ...CLOSED });
};

export const useExportDialog = (): ExportDialogKind | null => useStore(exportStore, (s) => s.open);

/** The palette or brand kit the open Export dialog is for (5.6b), or null. */
export const useExportSwatches = (): SwatchSource | null => useStore(exportStore, (s) => s.swatches);

/** The plan target the open Export dialog is for (6.10), or null. */
export const useExportPlan = (): PlanTarget | null => useStore(exportStore, (s) => s.plan);

/** The format the open Export dialog was asked for, or null for its first. */
export const useExportFormatId = (): string | null => useStore(exportStore, (s) => s.formatId);

/** The deck the open Export dialog is for, or null for Export Project's. */
export const useExportDeck = (): string | null => useStore(exportStore, (s) => s.deckId);

// A dialog belongs to the project it was opened for. Another one opened in place (a double-clicked .sbd, or the
// project closed under it) closes it, rather than bringing up the same dialog for a project nobody opened it for,
// where a Save would set that project's watermark. A running export stops as the dialog goes (ExportDialog). This
// runs inside the project store's change, before React renders, so the other project's dialog never shows at all.
projectStore.subscribe((state, before) => {
  if (state.project?.projectId !== before.project?.projectId) closeExportDialog();
});

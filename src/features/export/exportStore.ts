import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';

// Which export dialog is open (1.24): Export Project or Watermark Settings, both from the project menu.

export type ExportDialogKind = 'export' | 'watermark';

export const exportStore = createStore<{ open: ExportDialogKind | null }>()(() => ({ open: null }));

export const openExportDialog = (kind: ExportDialogKind): void => {
  exportStore.setState({ open: kind });
};

export const closeExportDialog = (): void => {
  exportStore.setState({ open: null });
};

export const useExportDialog = (): ExportDialogKind | null => useStore(exportStore, (s) => s.open);

// A dialog belongs to the project it was opened for. Another one opened in place (a double-clicked .sbd, or the
// project closed under it) closes it, rather than bringing up the same dialog for a project nobody opened it for,
// where a Save would set that project's watermark. A running export stops as the dialog goes (ExportDialog). This
// runs inside the project store's change, before React renders, so the other project's dialog never shows at all.
projectStore.subscribe((state, before) => {
  if (state.project?.projectId !== before.project?.projectId) closeExportDialog();
});

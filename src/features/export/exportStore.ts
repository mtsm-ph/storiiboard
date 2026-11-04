import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

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

import { t } from '../../core/i18n';

/** What one of the top bar's Undo and Redo buttons says (item 8). */
export interface StepButtonName {
  /** Its accessible name: "Undo: Moved wall", or "Nothing to undo". */
  label: string;
  /** What hover and focus show: the name and the keys that do the same ("Undo: Moved wall · Ctrl+Z"). */
  tip: string;
  /** The keys, for aria-keyshortcuts. */
  keys: string;
  /** False with nothing to undo or redo: shown disabled, still focusable. */
  enabled: boolean;
}

/**
 * The name of the Undo or Redo button for the step it would take, as History words it (null: nothing to take), with
 * this platform's keys: the ones undoCommandFor (undoShortcuts.ts) answers to, ⌘Z and ⌘⇧Z on a Mac, Ctrl+Z, Ctrl+Y and
 * Ctrl+Shift+Z elsewhere.
 */
export function stepButtonName(which: 'undo' | 'redo', step: string | null, mac: boolean): StepButtonName {
  const label =
    which === 'undo'
      ? step === null
        ? t('topBar.nothingToUndo')
        : t('topBar.undoStep', { step })
      : step === null
        ? t('topBar.nothingToRedo')
        : t('topBar.redoStep', { step });
  const shown =
    which === 'undo' ? t(mac ? 'topBar.undoKeysMac' : 'topBar.undoKeys') : t(mac ? 'topBar.redoKeysMac' : 'topBar.redoKeys');
  const keys = which === 'undo' ? (mac ? 'Meta+Z' : 'Control+Z') : mac ? 'Meta+Shift+Z' : 'Control+Y Control+Shift+Z';
  return { label, tip: t('topBar.withKeys', { name: label, keys: shown }), keys, enabled: step !== null };
}

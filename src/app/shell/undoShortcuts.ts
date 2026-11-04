import { inModalDialog, isTextEntry } from './workspaces';

type KeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>;

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

/**
 * ⌘Z and ⇧⌘Z on a Mac; Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z on Windows. Read from event.key, so the shortcut follows the
 * letter on the keyboard (Z sits elsewhere on AZERTY). In a text field the field's own text undo wins. In a modal
 * dialog it does nothing, unless the dialog's work is project edits (inModalDialog): the edit it would undo is behind
 * the backdrop, out of sight.
 */
export function undoCommandFor(event: KeyEvent, mac: boolean): 'undo' | 'redo' | null {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.altKey || isTextEntry(event.target) || inModalDialog(event.target, true)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !mac && !event.shiftKey) return 'redo';
  return null;
}

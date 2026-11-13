import { inModalDialog, isTextEntry } from '../../app/shell/workspaces';

// ⌘⌥P (Ctrl+Alt+P elsewhere) starts Present (5.5). It is read by the key's place, since ⌥P types another letter on a Mac, and it
// steps aside for text entry, a modal dialog, a held key, and AltGr (which Windows reports as Ctrl+Alt: AltGr+P types a character).

export type PresentKeyEvent = Pick<KeyboardEvent, 'code' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'repeat' | 'target'> & { getModifierState: (key: string) => boolean };

export function isPresentKey(event: PresentKeyEvent, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (event.code !== 'KeyP' || !event.altKey || !command || event.shiftKey || event.repeat) return false;
  return !event.getModifierState('AltGraph') && !isTextEntry(event.target) && !inModalDialog(event.target);
}

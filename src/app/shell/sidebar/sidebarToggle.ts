import { inModalDialog } from '../workspaces';

// Hiding the sidebar (polish 2): ⌘\ on a Mac, Ctrl+\ elsewhere, the shortcut code editors and design tools use for
// their side panel. Read from event.code as well, the key where a US keyboard has its backslash: on layouts that put
// the backslash behind AltGr, that same key (# on a German one) works with Ctrl alone.

/** The ids focus moves between when the sidebar hides or shows, so it never drops to <body>. */
export const HIDE_SIDEBAR_ID = 'sidebar-hide';
export const SHOW_SIDEBAR_ID = 'sidebar-show';

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'isComposing' | 'target'>;

export function isSidebarToggle(event: KeyEvent, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // Held down, it toggles once; mid-composition, the key belongs to the input method.
  if (!command || event.shiftKey || event.altKey || event.repeat || event.isComposing || inModalDialog(event.target)) return false;
  return event.key === '\\' || event.code === 'Backslash';
}

/** The shortcut as the button's tooltip and aria-keyshortcuts give it. */
export function sidebarShortcut(mac: boolean): { label: string; aria: string } {
  return mac ? { label: '⌘\\', aria: 'Meta+\\' } : { label: 'Ctrl+\\', aria: 'Control+\\' };
}

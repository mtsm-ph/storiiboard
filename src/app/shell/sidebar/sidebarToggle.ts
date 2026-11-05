import { inModalDialog } from '../workspaces';

// Hiding the sidebar (polish 2): ⌘\ on a Mac, Ctrl+\ elsewhere, the shortcut code editors and design tools use for
// their side panel. Read from event.code as well, since a backslash sits behind AltGr or Option on some layouts.

/** The ids focus moves between when the sidebar hides or shows, so it never drops to <body>. */
export const HIDE_SIDEBAR_ID = 'sidebar-hide';
export const SHOW_SIDEBAR_ID = 'sidebar-show';

type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>;

export function isSidebarToggle(event: KeyEvent, mac: boolean): boolean {
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command || event.shiftKey || event.altKey || inModalDialog(event.target)) return false;
  return event.key === '\\' || event.code === 'Backslash';
}

/** The shortcut as the button's tooltip and aria-keyshortcuts give it. */
export function sidebarShortcut(mac: boolean): { label: string; aria: string } {
  return mac ? { label: '⌘\\', aria: 'Meta+\\' } : { label: 'Ctrl+\\', aria: 'Control+\\' };
}

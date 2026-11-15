// The keyboard's way to a context menu: the menu key, or Shift+F10. Read from the key itself, since a Mac's WebKit
// sends no contextmenu event for either (Chromium does), so a menu offered only through onContextMenu never opened
// there from the keyboard.

export function isMenuKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/**
 * For a menu or popover panel's onContextMenu: the browser's own menu (Back, Refresh, Inspect in WebView2) never opens
 * over it. Windows' Chromium sends the menu key's contextmenu on key up, after the keydown has opened the app's menu and
 * moved focus into it, so it lands on the panel's focused command. A text field keeps its own menu (cut, copy, paste).
 */
export function keepBrowserMenuOut(event: { target: EventTarget | null; preventDefault: () => void }): void {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
  if (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) return;
  event.preventDefault();
}

/**
 * A contextmenu event the keyboard sent (no right button, no Control-click, not a long press): the key's own keydown has
 * already opened the menu, so this one is ignored, and the menu opens once in browsers that send both. The native event,
 * which carries a long press's pointerType where the browser sends a PointerEvent.
 */
export function fromKeyboard(event: Pick<MouseEvent, 'button' | 'ctrlKey'> & { pointerType?: string }): boolean {
  return event.button !== 2 && !event.ctrlKey && event.pointerType !== 'touch' && event.pointerType !== 'pen';
}

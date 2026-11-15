// The keyboard's way to a context menu: the menu key, or Shift+F10. Read from the key itself, since a Mac's WebKit
// sends no contextmenu event for either (Chromium does), so a menu offered only through onContextMenu never opened
// there from the keyboard.

export function isMenuKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/**
 * A contextmenu event the keyboard sent (no right button, no Control-click, not a long press): the key's own keydown has
 * already opened the menu, so this one is ignored, and the menu opens once in browsers that send both. The native event,
 * which carries a long press's pointerType where the browser sends a PointerEvent.
 */
export function fromKeyboard(event: Pick<MouseEvent, 'button' | 'ctrlKey'> & { pointerType?: string }): boolean {
  return event.button !== 2 && !event.ctrlKey && event.pointerType !== 'touch' && event.pointerType !== 'pen';
}

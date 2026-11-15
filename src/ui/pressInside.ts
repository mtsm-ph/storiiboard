import { useEffect, useRef, type RefObject } from 'react';

// A panel or a menu that closes when focus leaves it may let focus go to what holds it only during a press that began
// inside it (6.19b's review): WebKit (Safari, the Mac app) gives a pressed button no focus and sends it to the nearest
// focusable ancestor, and a press on a panel's padding does that in every engine. Any other move to an ancestor closes
// the panel, as before 6.19b. When that press ends with focus still on an ancestor, focus goes back to the control in
// the panel that had it, so the panel's own keys (Escape, Tab) still reach it.

/** Whether focus moving to `to` leaves `root` for something that holds it. */
export function toHolder(root: HTMLElement | null, to: EventTarget | null): boolean {
  return root !== null && to instanceof Node && to !== root && to.contains(root);
}

/**
 * While `active`, tracks a press that began inside `root`. The returned ref is true from that press's pointerdown until
 * its click, pointerup or pointercancel; then, if focus is on an ancestor of `root`, it goes back to the control inside
 * that had it at the press, or to `fallback()`.
 */
export function usePressInside(root: RefObject<HTMLElement | null>, active: boolean, fallback: () => HTMLElement | null | undefined): RefObject<boolean> {
  const pressing = useRef(false);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    const node = root.current;
    if (!active || !node) return;
    let had: HTMLElement | null = null;
    let timer: number | undefined;
    const end = () => {
      if (!pressing.current) return;
      pressing.current = false;
      window.clearTimeout(timer);
      const now = document.activeElement;
      if (!(now instanceof Node) || node.contains(now) || !now.contains(node)) return;
      const back = had?.isConnected && node.contains(had) ? had : fallbackRef.current();
      back?.focus({ preventScroll: true });
    };
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !node.contains(event.target)) return;
      pressing.current = true;
      const now = document.activeElement;
      had = now instanceof HTMLElement && node.contains(now) ? now : null;
    };
    // The press's click comes right after its pointerup, in the same turn; the click's own handlers run first (the
    // window's bubble phase is last), and a press with no click ends a turn later.
    const onUp = () => {
      if (!pressing.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(end, 0);
    };
    // In the capture phase, so a handler that stops the press still lets it be seen.
    node.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('click', end);
    return () => {
      pressing.current = false;
      window.clearTimeout(timer);
      node.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('click', end);
    };
  }, [root, active]);

  return pressing;
}

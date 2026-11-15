// Focus on something in a tile just opened (6.6 review: "Open Locations", "Open Shoot days", "Place north"): a tile that
// wasn't in the layout mounts a frame or more after the layout changes, so one animation frame isn't always enough. Tried
// each frame for up to half a second; nothing happens if it never shows.
//
// Never a thief (6.6 second review): one ask at a time, so a second cancels the first; and if focus has moved
// meanwhile to anything but the page itself or where it was when asked (the person clicked or tabbed on), it stops. An
// element found but not usable yet (disabled, hidden by display:none, or no longer in the page) counts as not found.

const FRAMES = 30;

let pending: number | null = null;

/** Whether focus can land on it now. */
function usable(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled')) return false;
  for (let at: HTMLElement | null = element; at; at = at.parentElement) if (getComputedStyle(at).display === 'none') return false;
  return true;
}

/**
 * Focus on what `find` gives once it shows, trying each frame. `find` is told when it is the last try, so it can fall
 * back to something else then (openLocation's first row).
 */
export function focusWhenShown(find: (last: boolean) => HTMLElement | null, onFocus?: (element: HTMLElement) => void): void {
  if (pending !== null) cancelAnimationFrame(pending);
  const had = document.activeElement;
  let left = FRAMES;
  const attempt = () => {
    pending = null;
    const now = document.activeElement;
    if (now !== null && now !== had && now !== document.body) return;
    left -= 1;
    const element = find(left === 0);
    if (element && usable(element)) {
      element.focus();
      onFocus?.(element);
      return;
    }
    if (left > 0) pending = requestAnimationFrame(attempt);
  };
  pending = requestAnimationFrame(attempt);
}

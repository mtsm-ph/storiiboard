// Focus on something in a tile just opened (6.6 review: "Open Locations", "Open Shoot days", "Place north"): a tile that
// wasn't in the layout mounts a frame or more after the layout changes, so one animation frame isn't always enough. Tried
// each frame for up to half a second; nothing happens if it never shows.

const FRAMES = 30;

export function focusWhenShown(find: () => HTMLElement | null, onFocus?: (element: HTMLElement) => void): void {
  let left = FRAMES;
  const attempt = () => {
    const element = find();
    if (element) {
      element.focus();
      onFocus?.(element);
      return;
    }
    left -= 1;
    if (left > 0) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

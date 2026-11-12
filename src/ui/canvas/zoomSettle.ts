/**
 * The zoom the canvas draws its items for (5.7, decision 4): it follows the view's zoom `delay` ms after a wheel or pinch
 * stops, and not while a gesture is underway. Any other jump (Fit, Reset, the + and - keys) is applied at once.
 */
export function createZoomSettle(delay: number, apply: (zoom: number) => void, busy: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
  };
  return {
    cancel,
    follow(zoom: number, smooth: boolean) {
      cancel();
      if (!smooth) {
        apply(zoom);
        return;
      }
      const arm = () => {
        timer = setTimeout(() => {
          // Held while a drag, a marquee or a connector is underway; applied once it is let go.
          if (busy()) arm();
          else apply(zoom);
        }, delay);
      };
      arm();
    },
  };
}

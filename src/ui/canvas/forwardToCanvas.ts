import { useEffect, type RefObject } from 'react';

// App chrome over a canvas (the tool strip, 6.5.2; the plan's compass, 6.5.5) hands the canvas what lands on it that is
// the canvas's: a wheel zooms or scrolls the canvas as if the chrome weren't there, and a middle-button press starts the
// canvas's pan. Each is sent to the canvas as its own event at the same point, so the canvas reads it as ever. The
// canvas is the `[data-canvas]` the chrome's positioned box holds.

const canvasBeside = (chrome: HTMLElement): HTMLElement | null => chrome.parentElement?.querySelector<HTMLElement>('[data-canvas]') ?? null;

export function useForwardToCanvas(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const chrome = ref.current;
    if (!chrome) return;
    const onWheel = (event: WheelEvent) => {
      const canvas = canvasBeside(chrome);
      if (!canvas) return;
      event.preventDefault();
      const { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey } = event;
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey, bubbles: true, cancelable: true }));
    };
    const onDown = (event: PointerEvent) => {
      const canvas = canvasBeside(chrome);
      if (event.button !== 1 || !canvas) return;
      // No autoscroll from the browser: the press is the canvas's pan.
      event.preventDefault();
      const { pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey } = event;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, screenX, screenY, ctrlKey, metaKey, shiftKey, altKey, bubbles: true, cancelable: true }));
    };
    chrome.addEventListener('wheel', onWheel, { passive: false });
    chrome.addEventListener('pointerdown', onDown);
    return () => {
      chrome.removeEventListener('wheel', onWheel);
      chrome.removeEventListener('pointerdown', onDown);
    };
  }, [ref]);
}

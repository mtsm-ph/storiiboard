// A clicked button takes focus, as it does in Chromium (so WebView2) and as the app's focus rules expect: "focus
// returns to the button that opened it", a list that keeps focus on the row's button after a change. WebKit (Safari,
// so the Mac app) gives a clicked button no focus and leaves focus on nothing, so those rules had nothing to return to.
// Done once here for every button rather than by hand in each place.
//
// On the click, in the capture phase before the app's own handlers: a handler that moves focus on (to a text field it
// opens, to the next row) still has the last word. Only a pointer's click (detail > 0); the keyboard's click is on what
// already has focus. Not when the press itself chose to keep focus where it was (its pointerdown default prevented, as a
// canvas's own handles and the slash menu's options do), nor on an element focus can't reach.

const CLICKABLE = 'button, [role="button"], summary, a[href]';

// Whether the press that leads to the click kept focus where it was, on purpose. Cleared as each press starts, then
// read in the bubble phase on the window, after the app's own pointerdown handlers have run (one that stops the event
// leaves it cleared).
let pressKeptFocus = false;

function onPressStart(): void {
  pressKeptFocus = false;
}

function onPointerDown(event: PointerEvent): void {
  pressKeptFocus = event.defaultPrevented;
}

/** The element a pointer click on `target` should focus, or null. Exported for its test. */
export function clickFocusTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const clicked = target.closest<HTMLElement>(CLICKABLE);
  if (!clicked?.isConnected || clicked === document.activeElement) return null;
  if (clicked.matches(':disabled') || clicked.closest('[inert]')) return null;
  return clicked;
}

function onClick(event: MouseEvent): void {
  const kept = pressKeptFocus;
  pressKeptFocus = false;
  if (event.detail === 0 || kept) return;
  clickFocusTarget(event.target)?.focus({ preventScroll: true });
}

let installed = false;

/** Once, at start-up, beside installTabWrap. */
export function installClickFocus(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('pointerdown', onPressStart, true);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('click', onClick, true);
}

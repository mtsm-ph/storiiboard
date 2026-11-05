// Tab and Shift+Tab go round, from the last stop back to the first, in the top window of the app's or in the page
// (quality pass, Nov 5). A browser sends focus out to its own address bar there; the desktop app's webview has none,
// so focus fell to nothing, and a keyboard user lost their place. Anything that handles Tab itself (a keyboard tile
// move, the slash menu) prevents the default first and is left alone.

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

function tabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.matches(':disabled')) return false;
  if (element.closest('[inert], [hidden], dialog:not([open]), details:not([open]) > :not(summary)')) return false;
  if (element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden') return false;
  // Of a native radio group, only the checked one is a stop (or the first, with none checked).
  if (element instanceof HTMLInputElement && element.type === 'radio' && !element.checked && element.name !== '') {
    const group = [...document.getElementsByName(element.name)];
    if (group.some((other) => other instanceof HTMLInputElement && other.checked)) return false;
  }
  return true;
}

/** The stops in a window, or in the page with no window open, in order. */
export function tabStops(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(tabbable);
}

const follows = (stop: Element, from: Element) => (from.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const precedes = (stop: Element, from: Element) => (from.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;

/** Whether this keyboard reaches every control with Option+Tab (a Mac with Keyboard navigation off). */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

// Where the last click on blank space landed: with focus on the page after it, the browser carries on from there. Any
// element taking focus clears it, so it never stands in for where focus fell later for another reason.
let lastPointer: Element | null = null;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || (event.altKey && !isMac)) return;
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  const scope = dialog ?? document.body;
  const active = document.activeElement;
  const stops = tabStops(scope);
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;
  // Focus on the page itself (after a click on blank space, or a closed tile): the browser carries on from where the
  // click was, so it's left to it, unless nothing follows (or, with Shift, precedes) that point, where it would leave.
  if (!active || active === document.body) {
    const from = lastPointer?.isConnected && scope.contains(lastPointer) ? lastPointer : null;
    if (!from) return;
    if (!event.shiftKey && !stops.some((stop) => follows(stop, from))) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && !stops.some((stop) => precedes(stop, from))) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  // At the end by position, not by being the last stop: focus is often on something scripts focus that isn't a stop
  // itself (an empty list's message, a status line, a window's own box), and from there the browser would leave too.
  if (!scope.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && !stops.some((stop) => follows(stop, active))) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && !stops.some((stop) => precedes(stop, active))) {
    event.preventDefault();
    last.focus();
  }
}

/** Once, at start-up. */
export function installTabWrap(): void {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPointer = event.target instanceof Element ? event.target : null;
    },
    true,
  );
  window.addEventListener('focusin', () => {
    lastPointer = null;
  });
}

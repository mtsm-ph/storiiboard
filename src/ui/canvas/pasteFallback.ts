// How ⌘V reaches the canvas (5.1b). Most webviews fire a paste event on a focused plain element, and it carries the
// system clipboard. WebKit (the Mac app) may fire none. So the first ⌘V waits a moment for the event; and the answer is
// learned for the session: once an event has been seen the key never waits again (the event does the paste), and once the
// wait has passed with no event, the key pastes at once from then on.

export type PasteStep = 'event' | 'wait' | 'now';

let seen = false;
let silent = false;

/** What a ⌘V keydown does: leave it to the paste event, wait a moment for one, or paste the items at once. */
export function pasteStep(): PasteStep {
  return seen ? 'event' : silent ? 'now' : 'wait';
}

/** A paste event arrived on the canvas. */
export function pasteEventSeen(): void {
  seen = true;
  silent = false;
}

/** The wait ended with no event. Only meaningful while no event has ever come. */
export function waitFoundNoEvent(): void {
  if (!seen) silent = true;
}

/** For tests. */
export function resetPasteFallback(): void {
  seen = false;
  silent = false;
}

/** The wait, in milliseconds. */
export const PASTE_WAIT = 80;

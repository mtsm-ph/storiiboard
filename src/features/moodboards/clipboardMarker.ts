import { createClipboardMarker, type PasteDecision, type PasteInput } from '../../ui/canvas/clipboardMarker';
import { pastedAddress } from './links';

// The board's clipboard and the system's (5.1b). Copy and cut keep the items inside the app, and put human text on the
// system clipboard too: a sticky's or text box's words, a link's address, a picture's file name, one to a line. The
// copy event's data also carries a custom type with a token. A paste is the board's own items when its data carries
// that token, or its text is exactly the text written and it brings no files. Otherwise it is whatever the system
// clipboard carries: pictures, an address, or someone else's text (which pastes nothing). The clipboard is never read
// directly (navigator.clipboard.read asks for permission). The mechanism is shared with the plan's (6.9 review, M2:
// src/ui/canvas/clipboardMarker.ts), each with a type and token of its own.

export type { PasteDecision, PasteInput };

export const CLIP_TYPE = 'application/x-storiiboard-board';
/** The text on the system clipboard when the items have no words of their own. */
export const CLIP_FALLBACK_TEXT = 'Storiiboard items';

const marker = createClipboardMarker(CLIP_TYPE, (text) => pastedAddress(text) !== null);

/** What the system clipboard gets for these items: their words, link addresses and file names, joined by newlines. */
export function clipText(parts: readonly string[]): string {
  const lines = parts.map((part) => part.trim()).filter((part) => part !== '');
  return lines.length > 0 ? lines.join('\n') : CLIP_FALLBACK_TEXT;
}

/** The items were taken (copy or cut): they are the fresh clipboard until something else is copied. */
export const clipTaken = (text: string): void => {
  marker.clipTaken(text);
};

/**
 * Marks the system clipboard. With the copy event's data, through it. Without (the key was pressed, the event may
 * still come): only if no copy event has fired a moment later, best effort through the clipboard API, which never
 * throws here; whether it worked is remembered.
 */
export const markSystemClipboard = (data: DataTransfer | null, native: Event | null): void => {
  marker.markSystemClipboard(data, native);
};

/**
 * Whose paste this is. The items: our token, or exactly our text (line endings aside) with no files; or, when our write
 * failed or is unknown and the items are fresh, anything. The system's: files, or an address. Other plain text is
 * someone else's: nothing to paste.
 */
export const decidePaste = (input: PasteInput): PasteDecision => marker.decidePaste(input);

/** The decision for a paste event's data. */
export const decidePasteOf = (data: DataTransfer, hasClip: boolean): PasteDecision => marker.decidePasteOf(data, hasClip);

/** For tests: forget everything. */
export const resetClipboardMarker = (): void => {
  marker.reset();
};

/** For tests: a switch of window. */
export const windowBlurred = (): void => {
  marker.blurred();
};

/** For tests: the token and text of the last copy, and whether the write is known to have worked. */
export const lastCopy = () => marker.lastCopy();

/** For tests: the clipboard API refused the write. */
export const markWriteFailed = (): void => {
  marker.markWriteFailed();
};

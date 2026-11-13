import { pastedAddress } from './links';

// The board's clipboard and the system's (5.1b). Copy and cut keep the items inside the app, and put human text on the
// system clipboard too: a sticky's or text box's words, a link's address, a picture's file name, one to a line. The
// copy event's data also carries a custom type with a token. A paste is the board's own items when its data carries
// that token, or its text is exactly the text written and it brings no files. Otherwise it is whatever the system
// clipboard carries: pictures, an address, or someone else's text (which pastes nothing). The clipboard is never read
// directly (navigator.clipboard.read asks for permission).

export const CLIP_TYPE = 'application/x-storiiboard-board';
/** The text on the system clipboard when the items have no words of their own. */
export const CLIP_FALLBACK_TEXT = 'Storiiboard items';

type Write = 'unknown' | 'ok' | 'failed';

let token = '';
/** The exact text written to the system clipboard for the last copy. */
let written = '';
let write: Write = 'unknown';
let eventSeen = false;
let fresh = false;
let ours: Event | null = null;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // A switch of window: something else may be copied there.
  window.addEventListener('blur', () => {
    fresh = false;
  });
  // A copy or cut that isn't the board's own (reaches the document after the canvas has handled its own).
  const other = (event: Event) => {
    if (event !== ours) fresh = false;
  };
  document.addEventListener('copy', other);
  document.addEventListener('cut', other);
}

/** What the system clipboard gets for these items: their words, link addresses and file names, joined by newlines. */
export function clipText(parts: readonly string[]): string {
  const lines = parts.map((part) => part.trim()).filter((part) => part !== '');
  return lines.length > 0 ? lines.join('\n') : CLIP_FALLBACK_TEXT;
}

/** The items were taken (copy or cut): they are the fresh clipboard until something else is copied. */
export function clipTaken(text: string): void {
  install();
  token = crypto.randomUUID();
  written = text;
  write = 'unknown';
  eventSeen = false;
  fresh = true;
}

/**
 * Marks the system clipboard. With the copy event's data, through it. Without (the key was pressed, the event may
 * still come): only if no copy event has fired a moment later, best effort through the clipboard API, which never
 * throws here; whether it worked is remembered.
 */
export function markSystemClipboard(data: DataTransfer | null, native: Event | null): void {
  if (data) {
    if (native) ours = native;
    eventSeen = true;
    data.setData('text/plain', written);
    data.setData(CLIP_TYPE, token);
    write = 'ok';
    return;
  }
  const text = written;
  const turn = token;
  window.setTimeout(() => {
    if (eventSeen || token !== turn) return;
    const clipboard = typeof navigator === 'undefined' ? undefined : (navigator.clipboard as Clipboard | undefined);
    if (!clipboard?.writeText) return;
    clipboard.writeText(text).then(
      () => {
        if (token === turn) write = 'ok';
      },
      () => {
        if (token === turn) write = 'failed';
      },
    );
  }, 50);
}

/** What a paste event carries, as far as the decision needs it. */
export interface PasteInput {
  /** The custom type's value; '' when it isn't there. */
  token: string;
  text: string;
  files: number;
  /** Whether the app has items copied to paste. */
  hasClip: boolean;
}

/** `foreign`: someone else's plain text, which pastes nothing (and is said so). */
export type PasteDecision = 'items' | 'system' | 'nothing' | 'foreign';

const lines = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * Whose paste this is. The items: our token, or exactly our text (line endings aside) with no files; or, when our write
 * failed or is unknown and the items are fresh, anything. The system's: files, or an address. Other plain text is
 * someone else's: nothing to paste.
 */
export function decidePaste(input: PasteInput): PasteDecision {
  if (token !== '' && input.token === token) return input.hasClip ? 'items' : 'nothing';
  if (input.files === 0 && written !== '' && lines(input.text) === lines(written)) return input.hasClip ? 'items' : 'nothing';
  // Our write may not have reached the clipboard (a Mac may fire no copy event): what is there can be older than the
  // items, so while they are fresh they win over a stale picture or address.
  if (write !== 'ok' && fresh && input.hasClip) return 'items';
  if (input.files > 0) return 'system';
  if (pastedAddress(input.text) !== null) return 'system';
  return input.text !== '' ? 'foreign' : 'nothing';
}

/** The decision for a paste event's data. */
export function decidePasteOf(data: DataTransfer, hasClip: boolean): PasteDecision {
  return decidePaste({ token: data.getData(CLIP_TYPE), text: data.getData('text/plain'), files: data.files.length, hasClip });
}

/** For tests: forget everything. */
export function resetClipboardMarker(): void {
  token = '';
  written = '';
  write = 'unknown';
  eventSeen = false;
  fresh = false;
  ours = null;
}

/** For tests: a switch of window. */
export function windowBlurred(): void {
  fresh = false;
}

/** For tests: the token and text of the last copy, and whether the write is known to have worked. */
export function lastCopy(): { token: string; text: string; write: Write } {
  return { token, text: written, write };
}

/** For tests: the clipboard API refused the write. */
export function markWriteFailed(): void {
  write = 'failed';
}

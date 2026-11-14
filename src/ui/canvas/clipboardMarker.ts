// The app's own clipboard against the system's (5.1b; shared with the plan in 6.9 review, M2). Copy and cut keep the
// items inside the app, and put words on the system clipboard too, with a custom type carrying a token. A paste is the
// app's own items when its data carries that token, or its text is exactly the text written and it brings no files.
// Otherwise it is whatever the system clipboard carries: pictures, an address, or someone else's text. The clipboard
// is never read directly (navigator.clipboard.read asks for permission).
//
// One marker per surface (a board's, a plan's), each with its own type and token, so what was copied on one never
// passes for the other's: a plan's copy is "something else copied" to a board, and the other way round.

type Write = 'unknown' | 'ok' | 'failed';

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

export interface ClipboardMarker {
  /** The items were taken (copy or cut): they are the fresh clipboard until something else is copied. */
  clipTaken: (text: string) => void;
  /**
   * Marks the system clipboard. With the copy event's data, through it. Without (the key was pressed, the event may
   * still come): only if no copy event has fired a moment later, best effort through the clipboard API, which never
   * throws here; whether it worked is remembered.
   */
  markSystemClipboard: (data: DataTransfer | null, native: Event | null) => void;
  /**
   * Whose paste this is. The items: our token, or exactly our text (line endings aside) with no files; or, when our
   * write failed or is unknown and the items are fresh, anything. The system's: files, or an address. Other plain text
   * is someone else's: nothing to paste.
   */
  decidePaste: (input: PasteInput) => PasteDecision;
  /** The decision for a paste event's data. */
  decidePasteOf: (data: DataTransfer, hasClip: boolean) => PasteDecision;
  /** For tests: forget everything. */
  reset: () => void;
  /** For tests: a switch of window. */
  blurred: () => void;
  /** For tests: the token and text of the last copy, and whether the write is known to have worked. */
  lastCopy: () => { token: string; text: string; write: Write };
  /** For tests: the clipboard API refused the write. */
  markWriteFailed: () => void;
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n');

/** A marker whose token travels under `clipType`; `isAddress` says which plain text is the system's (a board's web address). */
export function createClipboardMarker(clipType: string, isAddress: (text: string) => boolean): ClipboardMarker {
  let token = '';
  /** The exact text written to the system clipboard for the last copy. */
  let written = '';
  let write: Write = 'unknown';
  let eventSeen = false;
  let fresh = false;
  let ours: Event | null = null;
  let installed = false;

  const install = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    // A switch of window: something else may be copied there.
    window.addEventListener('blur', () => {
      fresh = false;
    });
    // A copy or cut that isn't this surface's own (reaches the document after the canvas has handled its own).
    const other = (event: Event) => {
      if (event !== ours) fresh = false;
    };
    document.addEventListener('copy', other);
    document.addEventListener('cut', other);
  };

  const decidePaste = (input: PasteInput): PasteDecision => {
    if (token !== '' && input.token === token) return input.hasClip ? 'items' : 'nothing';
    if (input.files === 0 && written !== '' && lines(input.text) === lines(written)) return input.hasClip ? 'items' : 'nothing';
    // Our write may not have reached the clipboard (a Mac may fire no copy event): what is there can be older than the
    // items, so while they are fresh they win over a stale picture or address.
    if (write !== 'ok' && fresh && input.hasClip) return 'items';
    if (input.files > 0) return 'system';
    if (isAddress(input.text)) return 'system';
    return input.text !== '' ? 'foreign' : 'nothing';
  };

  return {
    clipTaken: (text) => {
      install();
      token = crypto.randomUUID();
      written = text;
      write = 'unknown';
      eventSeen = false;
      fresh = true;
    },
    markSystemClipboard: (data, native) => {
      if (data) {
        if (native) ours = native;
        eventSeen = true;
        data.setData('text/plain', written);
        data.setData(clipType, token);
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
    },
    decidePaste,
    decidePasteOf: (data, hasClip) => decidePaste({ token: data.getData(clipType), text: data.getData('text/plain'), files: data.files.length, hasClip }),
    reset: () => {
      token = '';
      written = '';
      write = 'unknown';
      eventSeen = false;
      fresh = false;
      ours = null;
    },
    blurred: () => {
      fresh = false;
    },
    lastCopy: () => ({ token, text: written, write }),
    markWriteFailed: () => {
      write = 'failed';
    },
  };
}

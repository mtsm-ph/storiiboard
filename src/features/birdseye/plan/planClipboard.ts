import { createClipboardMarker } from '../../../ui/canvas/clipboardMarker';

// The plan's clipboard against the system's (6.9 review, M2), as a board's (src/features/moodboards/clipboardMarker.ts):
// Copy and Cut on a plan mark the system clipboard with a token of the plan's own, so a paste decides from what the
// clipboard holds, never from focus history. A picture copied after the plan's items is an underlay; the plan's items
// win over an older picture still on the clipboard. Web addresses mean nothing on a plan: plain text that isn't the
// plan's own leaves the decision to the plan's items, as it always did.

export const PLAN_CLIP_TYPE = 'application/x-storiiboard-plan';

/**
 * What the system clipboard gets for copied plan items: the app's name, in no language (a stored marker, as the board's
 * fallback text is), distinct from the board's so neither reads the other's as its own.
 */
export const PLAN_CLIP_TEXT = 'Storiiboard plan items';

export const planClipMarker = createClipboardMarker(PLAN_CLIP_TYPE, () => false);

/** Whether a paste on the plan is a picture for an underlay (the system's files), rather than the plan's own items. */
export const pasteIsPicture = (data: DataTransfer, hasClip: boolean): boolean => data.files.length > 0 && planClipMarker.decidePasteOf(data, hasClip) === 'system';

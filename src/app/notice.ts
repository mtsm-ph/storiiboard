import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';
import { localizeError } from '../core/i18n';

// One message at a time about something the person asked for that didn't happen: a project that wouldn't open, a
// folder that couldn't be written. The shell shows it above the workspace until it's dismissed or the next action
// succeeds.

/** A warning is something that went wrong (Truffle); info is something worth knowing (an ink outline). */
export type NoticeKind = 'warning' | 'info';

/** A button on an info notice that does what the notice offers (7.1 round 2: Bring in the change files waiting). */
export interface NoticeAction {
  label: string;
  run: () => void;
}

interface NoticeState {
  message: string | null;
  kind: NoticeKind;
  /** Counts notices shown, so a bar drawn again for the same one (a window opened over it) knows it was said. */
  seq: number;
  /** About an edit just made ("Deleted SC 03…"): an undo or redo of something takes it away, as it no longer holds. */
  step: boolean;
  /**
   * Text the bar's Copy list button puts on the clipboard, so a notice too long to keep in mind can be kept (6.27b
   * round 4: an import's list of every place a left-out file was used); null for none.
   */
  copy: string | null;
  /** The notice's own button; null for none. */
  action: NoticeAction | null;
}

export const noticeStore = createStore<NoticeState>()(() => ({ message: null, kind: 'warning', seq: 0, step: false, copy: null, action: null }));

/**
 * `action`: a button that does what the warning offers (7.1 round 3: Bring in, beside files that couldn't be read).
 * `step`: the warning also tells of an edit just made, so an undo or redo takes it away (7.1 round 4: a pass that
 * brought files in and couldn't read others).
 */
export function showNotice(
  error: unknown,
  { action = null, step = false }: { action?: NoticeAction | null; step?: boolean } = {},
): void {
  // Errors from below the UI arrive in English; they show in the app's language where a translation has them.
  noticeStore.setState((s) => ({
    message: localizeError(error instanceof Error ? error.message : String(error)),
    kind: 'warning',
    seq: s.seq + 1,
    step,
    copy: null,
    action,
  }));
}

/**
 * `step`: the notice tells of an edit just made, so an undo or redo takes it away (1.28's low). `copy`: the text the
 * bar's Copy list button copies. `action`: a button that does what the notice offers.
 */
export function showInfo(
  message: string,
  { step = false, copy = null, action = null }: { step?: boolean; copy?: string | null; action?: NoticeAction | null } = {},
): void {
  noticeStore.setState((s) => ({ message, kind: 'info', seq: s.seq + 1, step, copy, action }));
}

/** After an undo or a redo that changed something: a notice about a step no longer describes the project. */
export function clearStepNotice(): void {
  if (noticeStore.getState().step) noticeStore.setState({ message: null, step: false, action: null });
}

export function clearNotice(): void {
  noticeStore.setState({ message: null, action: null });
}

/** How many notices have been shown so far, for `clearNoticeFrom`. */
export const noticeCount = (): number => noticeStore.getState().seq;

/**
 * After an action that worked: the notice from before it goes, but not one the action itself showed (#244 round 4:
 * "the backup of … is still being made", or a backup that failed at that project's last close).
 */
export function clearNoticeFrom(count: number): void {
  if (noticeStore.getState().seq === count) clearNotice();
}

export function useNotice(): { message: string | null; kind: NoticeKind; seq: number; copy: string | null; action: NoticeAction | null } {
  return useStore(noticeStore, useShallow((s) => ({ message: s.message, kind: s.kind, seq: s.seq, copy: s.copy, action: s.action })));
}

// The last notice a bar has put on screen. A screen reader reads a live region each time one appears, and the bar
// moves into a window of the app's and back as windows open and close (polish B): drawn again for the same notice,
// it shows without being read out a second time (PB's low).
let shownSeq = -1;

/** Whether this notice has been on screen already. */
export function noticeShownBefore(seq: number): boolean {
  return shownSeq === seq;
}

/** Called once a bar has drawn the notice. */
export function markNoticeShown(seq: number): void {
  shownSeq = seq;
}

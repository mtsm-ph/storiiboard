import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';
import { localizeError } from '../core/i18n';

// One message at a time about something the person asked for that didn't happen: a project that wouldn't open, a
// folder that couldn't be written. The shell shows it above the workspace until it's dismissed or the next action
// succeeds.

/** A warning is something that went wrong (Truffle); info is something worth knowing (an ink outline). */
export type NoticeKind = 'warning' | 'info';

interface NoticeState {
  message: string | null;
  kind: NoticeKind;
  /** Counts notices shown, so a bar drawn again for the same one (a window opened over it) knows it was said. */
  seq: number;
}

export const noticeStore = createStore<NoticeState>()(() => ({ message: null, kind: 'warning', seq: 0 }));

export function showNotice(error: unknown): void {
  // Errors from below the UI arrive in English; they show in the app's language where a translation has them.
  noticeStore.setState((s) => ({ message: localizeError(error instanceof Error ? error.message : String(error)), kind: 'warning', seq: s.seq + 1 }));
}

export function showInfo(message: string): void {
  noticeStore.setState((s) => ({ message, kind: 'info', seq: s.seq + 1 }));
}

export function clearNotice(): void {
  noticeStore.setState({ message: null });
}

export function useNotice(): { message: string | null; kind: NoticeKind; seq: number } {
  return useStore(noticeStore, useShallow((s) => ({ message: s.message, kind: s.kind, seq: s.seq })));
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

import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';

// One message at a time about something the person asked for that didn't happen: a project that wouldn't open, a
// folder that couldn't be written. The shell shows it above the workspace until it's dismissed or the next action
// succeeds.

/** A warning is something that went wrong (Truffle); info is something worth knowing (an ink outline). */
export type NoticeKind = 'warning' | 'info';

interface NoticeState {
  message: string | null;
  kind: NoticeKind;
}

export const noticeStore = createStore<NoticeState>()(() => ({ message: null, kind: 'warning' }));

export function showNotice(error: unknown): void {
  noticeStore.setState({ message: error instanceof Error ? error.message : String(error), kind: 'warning' });
}

export function showInfo(message: string): void {
  noticeStore.setState({ message, kind: 'info' });
}

export function clearNotice(): void {
  noticeStore.setState({ message: null });
}

export function useNotice(): { message: string | null; kind: NoticeKind } {
  return useStore(noticeStore, useShallow((s) => ({ message: s.message, kind: s.kind })));
}

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// One message at a time about something the person asked for that didn't happen: a project that wouldn't open, a
// folder that couldn't be written. The shell shows it above the workspace until it's dismissed or the next action
// succeeds.

interface NoticeState {
  message: string | null;
}

export const noticeStore = createStore<NoticeState>()(() => ({ message: null }));

export function showNotice(error: unknown): void {
  noticeStore.setState({ message: error instanceof Error ? error.message : String(error) });
}

export function clearNotice(): void {
  noticeStore.setState({ message: null });
}

export function useNotice(): string | null {
  return useStore(noticeStore, (s) => s.message);
}

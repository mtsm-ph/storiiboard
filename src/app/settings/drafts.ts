import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// Settings wait for Apply (Kevin, Nov 17): what is changed in the Settings window is a draft here until Apply changes
// this computer's settings, each through its own setter, or Discard drops it. A draft is kept by its setting's name with
// the value shown and the setter that applies it; a draft set back to what is applied goes, so "changes waiting" means
// something would change. What still applies at once (the project's own fields, which are edits through ops; the
// buttons that act, such as Back up now; a canvas's own switches) never comes here.

interface Draft {
  value: unknown;
  write: (value: unknown) => void;
}

export const draftStore = createStore<{ drafts: Readonly<Record<string, Draft>> }>()(() => ({ drafts: {} }));

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Keeps `value` as the draft of `key`, applied later by `write`; the same as `applied`, the draft goes. */
export function setDraft<T>(key: string, value: T, applied: T, write: (value: T) => void): void {
  draftStore.setState((s) => {
    const rest = Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== key));
    return { drafts: same(value, applied) ? rest : { ...rest, [key]: { value, write: write as (value: unknown) => void } } };
  });
}

/** The value Settings shows for `key`: its draft, else what is applied. */
export function draftOf<T>(key: string, applied: T): T {
  const draft = draftStore.getState().drafts[key];
  return draft ? (draft.value as T) : applied;
}

/** A setting as the Settings window shows and changes it: the draft or what is applied, and a setter that drafts. */
export function useDraft<T>(key: string, applied: T, write: (value: T) => void): [T, (value: T) => void] {
  const draft = useStore(draftStore, (s) => s.drafts[key]);
  const shown = draft ? (draft.value as T) : applied;
  return [
    shown,
    (value) => {
      setDraft(key, value, applied, write);
    },
  ];
}

/** A setting's value as Settings shows it, read where another tab draws it (the usual role in Your role). */
export function useDraftValue<T>(key: string, applied: T): T {
  const draft = useStore(draftStore, (s) => s.drafts[key]);
  return draft ? (draft.value as T) : applied;
}

export const hasDrafts = (): boolean => Object.keys(draftStore.getState().drafts).length > 0;

/** Whether anything waits for Apply: what Apply changes and Discard drops are shown active only then. */
export const useHasDrafts = (): boolean => useStore(draftStore, (s) => Object.keys(s.drafts).length > 0);

/** Applies every draft through its own setter, in the order they were made, and clears them. */
export function applyDrafts(): void {
  const drafts = Object.values(draftStore.getState().drafts);
  // Cleared first: a setter that re-renders Settings shows the applied value, never a draft that's being applied.
  draftStore.setState({ drafts: {} });
  for (const draft of drafts) draft.write(draft.value);
}

/** Drops every draft: Settings shows what is applied again, and nothing on this computer changed. */
export function discardDrafts(): void {
  if (hasDrafts()) draftStore.setState({ drafts: {} });
}

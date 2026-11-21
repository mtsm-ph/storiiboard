import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { localizeError, t } from '../../core/i18n';
import { showNotice } from '../notice';

// Settings wait for Apply (Kevin, Nov 17): what is changed in the Settings window is a draft here until Apply changes
// this computer's settings, each through its own setter, or Discard drops it. A draft is kept by its setting's name with
// the value shown and the setter that applies it; a draft set back to what is applied goes, so "changes waiting" means
// something would change.
//
// What still applies at once, and why (Kevin asked "say which… and why"; this list names every one):
// - Settings → Project and Theme: the project's own fields. They are edits through ops, saved in the file at once and
//   undone with ⌘Z like any edit, not this computer's settings. (Your role on this project, in the Project tab, is this
//   computer's and waits like the rest.)
// - Buttons that act: Back up now, Show backups, Open a backup; Move, Move back and Clear the playback copies; Forget
//   videos; the licences. They do something, they set nothing.
// - Settings → Presets: applying a preset is one action with its "Before [name]" copy; it discards any draft first.
// - Settings → Online services, the tile server: it keeps its own Save, since saving a new host has the system ask the
//   person to confirm it; a draft would ask at an Apply far from where it was typed.
// - Settings → Storage, the playback copies' cap and floor: Rust holds and checks them (a cap lowered removes copies
//   there and then), and each save is said in its own notice, from the field it was typed in, on Enter or on leaving.
// - Settings → App, Company profiles: each is a list of its own (Add, Remove, a logo read from a picture, a brand
//   kit), and each save can be refused (too many logos, a picture that can't be read), said beside the field that was
//   typed in; a project attaches a profile from Settings → Project at once.
// - A canvas's own switches (the Dark view, the dot grid, m | ft by a plan's scale bar): views of the canvas, outside
//   the Settings window.
// What drops drafts without asking:
// - Applying a preset (it says so first), and opening another project in place (Open backup, a project switch, a
//   reopen after a sync): drafts of the project left (Your role on this project) go, the computer's own stay.
// - The app quitting: the page has no quit hook today, so drafts waiting then go, unasked.

/** A setter: may be async (none is today; one written elsewhere would be). It throws, or rejects, when it didn't apply. */
type Write = (value: unknown) => unknown;

interface Draft {
  value: unknown;
  write: Write;
  /** The project a setting belongs to (Your role on this project), so a switch to another project drops it. */
  project?: string;
}

export const draftStore = createStore<{ drafts: Readonly<Record<string, Draft>> }>()(() => ({ drafts: {} }));

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const without = (drafts: Readonly<Record<string, Draft>>, drop: (key: string, draft: Draft) => boolean): Record<string, Draft> =>
  Object.fromEntries(Object.entries(drafts).filter(([key, draft]) => !drop(key, draft)));

/**
 * Keeps `value` as the draft of `key`, applied later by `write`; the same as `applied`, the draft goes. `project` ties
 * it to the project open, for a setting kept per project.
 */
export function setDraft<T>(key: string, value: T, applied: T, write: (value: T) => unknown, project?: string): void {
  draftStore.setState((s) => {
    const rest = without(s.drafts, (k) => k === key);
    if (same(value, applied)) return { drafts: rest };
    const draft: Draft = { value, write: write as Write };
    if (project !== undefined) draft.project = project;
    return { drafts: { ...rest, [key]: draft } };
  });
}

/** The value Settings shows for `key`: its draft, else what is applied. */
export function draftOf<T>(key: string, applied: T): T {
  const draft = draftStore.getState().drafts[key];
  return draft ? (draft.value as T) : applied;
}

/** A setting as the Settings window shows and changes it: the draft or what is applied, and a setter that drafts. */
export function useDraft<T>(
  key: string,
  applied: T,
  write: (value: T) => unknown,
  project?: string,
): [T, (value: T) => void] {
  const draft = useStore(draftStore, (s) => s.drafts[key]);
  const shown = draft ? (draft.value as T) : applied;
  return [
    shown,
    (value) => {
      setDraft(key, value, applied, write, project);
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

/** Clears `key`'s draft once written, unless it was changed again meanwhile (an async setter): that one still waits. */
function written(key: string, draft: Draft): void {
  draftStore.setState((s) => ({ drafts: without(s.drafts, (k, d) => k === key && d === draft) }));
}

/** One that didn't apply stays waiting, and the notice says so with why. */
function failed(error: unknown): void {
  showNotice(t('settings.notApplied', { reason: localizeError(error instanceof Error ? error.message : String(error)) }));
}

/**
 * Applies every draft through its own setter, in the order they were made. Each is cleared only once it is written: a
 * setter that throws (or rejects) leaves its draft waiting, says so, and the rest apply. Resolves to whether all did.
 * A setter that doesn't wait (every one today) is written and cleared before this returns.
 */
export async function applyDrafts(): Promise<boolean> {
  const pending: Promise<boolean>[] = [];
  for (const [key, draft] of Object.entries(draftStore.getState().drafts)) {
    let result: unknown;
    try {
      result = draft.write(draft.value);
    } catch (error) {
      failed(error);
      pending.push(Promise.resolve(false));
      continue;
    }
    if (result instanceof Promise) {
      pending.push(
        result.then(
          () => {
            written(key, draft);
            return true;
          },
          (error: unknown) => {
            failed(error);
            return false;
          },
        ),
      );
    } else {
      written(key, draft);
    }
  }
  return (await Promise.all(pending)).every(Boolean);
}

/** Drops every draft: Settings shows what is applied again, and nothing on this computer changed. */
export function discardDrafts(): void {
  if (hasDrafts()) draftStore.setState({ drafts: {} });
}

/** Drops the drafts kept for a project (Your role on this project); this computer's own stay. */
export function discardProjectDrafts(): void {
  const drafts = draftStore.getState().drafts;
  if (Object.values(drafts).some((d) => d.project !== undefined)) draftStore.setState({ drafts: without(drafts, (_, d) => d.project !== undefined) });
}

/**
 * Another project opened in place (Open backup, a switch, a reopen after a sync) or the project closed: the drafts of
 * the project left go, so Apply never writes a setting of a project that's no longer shown. Returns the unsubscribe.
 */
export function dropProjectDraftsOnSwitch<S extends { project: unknown }>(store: Pick<StoreApi<S>, 'subscribe'>): () => void {
  return store.subscribe((state, previous) => {
    if (state.project !== previous.project) discardProjectDrafts();
  });
}

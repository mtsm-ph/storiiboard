import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { focusWhenShown } from '../../app/focusWhenShown';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import { workspaceStore } from '../../app/shell/workspaceStore';

// A request to show the Suggestions tile on one import (7.2): from the status line's Review after a bring-in, and from
// the import's notification. As the Trash tile's (trashFocus.ts), the tile takes it once and the store forgets it; one
// for another project is dropped. Where the person is looking, never saved.

export interface SuggestionsAsk {
  /** The change file's id: the group to show. */
  groupId: string;
  projectId: string;
}

interface FocusState {
  asked: SuggestionsAsk | null;
  ask: (groupId: string, projectId: string) => void;
  take: (projectId: string | null) => SuggestionsAsk | null;
}

export const suggestionsFocus = createStore<FocusState>()((set, get) => ({
  asked: null,
  ask: (groupId, projectId) => {
    set({ asked: { groupId, projectId } });
  },
  take: (projectId) => {
    const asked = get().asked;
    if (asked) set({ asked: null });
    return asked && asked.projectId === projectId ? asked : null;
  },
}));

export const useSuggestionsAsk = (): SuggestionsAsk | null => useStore(suggestionsFocus, (s) => s.asked);

/**
 * The Suggestions tile, in front in the workspace shown, on this import, with focus on its first suggestion (or, with
 * none left to review, on its rows in the log).
 */
export function openSuggestions(groupId: string, projectId: string): void {
  suggestionsFocus.getState().ask(groupId, projectId);
  const workspaceId = workspaceStore.getState().active;
  const { layouts, change } = layoutStore.getState();
  change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'suggestions'));
  focusWhenShown(
    (last) =>
      document.querySelector<HTMLElement>(`[data-suggestion-group="${CSS.escape(groupId)}"] [data-suggestion-item]`) ??
      // An import with nothing left to review: its rows in the log.
      document.querySelector<HTMLElement>(`[data-suggestions-tile] [data-review-log-group="${CSS.escape(groupId)}"]`) ??
      (last ? document.querySelector<HTMLElement>('[data-suggestions-tile] [data-suggestion-item]') : null),
  );
}

import { useEffect, useRef, type RefObject } from 'react';
import { openingProjectStore } from '../../openingProject';

// While a project opens, the sidebar's entries are disabled (src/app/openingProject.ts), and a focused button that
// becomes disabled drops its focus to the page's body. When the open began with no click in the sidebar (the reopen
// after a sync, a file handed over by the system) and focus was on a section or a row, it is given back once the
// open ends: to that same entry if it is still in the page, else to the section now current. Only from the body:
// anything that took focus meanwhile keeps it.
//
// The store and React see an open at different times: the store's count changes at once, React draws the entries
// disabled and enabled later. An open can begin and end before React draws it (a fast failing open), and a second
// one can begin before React draws the end of the first. So the entry is noted only while none is held (the second
// open would note the body), handed back only when React's `opening` goes from true to false, and dropped when an
// open ends that React never drew, as focus never left the entry then.

/** What the hook holds between an open's start and its end. */
export interface FocusBackState<T> {
  /** The sidebar entry that had focus as the open began. */
  held: T | null;
  /** Whether React has drawn the entries disabled since the entry was noted. */
  drawn: boolean;
}

export type FocusBackEvent<T> =
  /** The store's count went from 0 to more: an open began, with this entry focused (or none). */
  | { kind: 'began'; focused: T | null }
  /** The store's count went back to 0. */
  | { kind: 'ended' }
  /** React drew `opening` with this value; `was` is the value it drew before. */
  | { kind: 'drawn'; opening: boolean; was: boolean };

export const FOCUS_BACK_START: FocusBackState<never> = { held: null, drawn: false };

/** The rules, apart from the page: the next state, and the entry to give focus back to now, if any. */
export function stepFocusBack<T>(
  state: FocusBackState<T>,
  event: FocusBackEvent<T>,
): { state: FocusBackState<T>; restore: T | null } {
  switch (event.kind) {
    case 'began':
      return { state: state.held === null ? { held: event.focused, drawn: false } : state, restore: null };
    case 'ended':
      // React never drew this open, so focus never left the entry: nothing to give back.
      return { state: state.drawn ? state : { held: null, drawn: false }, restore: null };
    case 'drawn':
      if (event.opening) return { state: { ...state, drawn: true }, restore: null };
      if (!event.was) return { state, restore: null };
      return { state: { held: null, drawn: false }, restore: state.held };
  }
}

/** Gives focus back to the sidebar entry that had it when a project began to open. */
export function useFocusBackAfterOpening(nav: RefObject<HTMLElement | null>, opening: boolean, currentSectionId: string) {
  const state = useRef<FocusBackState<HTMLElement>>(FOCUS_BACK_START);
  const was = useRef(opening);

  // Read as the open begins, from the store itself: by the time React draws the entries disabled, focus has gone.
  useEffect(
    () =>
      openingProjectStore.subscribe((now, before) => {
        if (before.count === 0 && now.count > 0) {
          const focused = document.activeElement;
          const entry = focused instanceof HTMLElement && focused.matches('[data-nav-item]') && nav.current?.contains(focused) ? focused : null;
          state.current = stepFocusBack(state.current, { kind: 'began', focused: entry }).state;
        } else if (before.count > 0 && now.count === 0) {
          state.current = stepFocusBack(state.current, { kind: 'ended' }).state;
        }
      }),
    [nav],
  );

  // Runs as React draws the entries disabled and enabled again; a change of section alone gives nothing back.
  useEffect(() => {
    const step = stepFocusBack(state.current, { kind: 'drawn', opening, was: was.current });
    was.current = opening;
    state.current = step.state;
    const entry = step.restore;
    if (entry === null) return;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    const back = entry.isConnected && !entry.matches(':disabled') ? entry : document.getElementById(currentSectionId);
    back?.focus();
  }, [opening, currentSectionId]);
}

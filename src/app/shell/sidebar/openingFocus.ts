import { useEffect, useRef, type RefObject } from 'react';
import { openingProjectStore } from '../../openingProject';

// While a project opens, the sidebar's entries are disabled (src/app/openingProject.ts), and a focused button that
// becomes disabled drops its focus to the page's body. When the open began with no click in the sidebar (the reopen
// after a sync, a file handed over by the system) and focus was on a section or a row, it is given back once the
// open ends: to that same entry if it is still in the page, else to the section now current. Only from the body:
// anything that took focus meanwhile keeps it.

/** Gives focus back to the sidebar entry that had it when a project began to open. */
export function useFocusBackAfterOpening(nav: RefObject<HTMLElement | null>, opening: boolean, currentSectionId: string) {
  const held = useRef<HTMLElement | null>(null);

  // Read as the open begins, from the store itself: by the time React draws the entries disabled, focus has gone.
  useEffect(
    () =>
      openingProjectStore.subscribe((state, before) => {
        if (before.count > 0 || state.count === 0) return;
        const focused = document.activeElement;
        held.current = focused instanceof HTMLElement && focused.matches('[data-nav-item]') && nav.current?.contains(focused) ? focused : null;
      }),
    [nav],
  );

  // Runs once the entries are drawn enabled again.
  useEffect(() => {
    if (opening) return;
    const entry = held.current;
    held.current = null;
    if (entry === null) return;
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    const back = entry.isConnected && !entry.matches(':disabled') ? entry : document.getElementById(currentSectionId);
    back?.focus();
  }, [opening, currentSectionId]);
}

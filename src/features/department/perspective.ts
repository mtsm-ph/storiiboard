import { createContext, useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useMyPart } from '../../app/settings/projectRole';
import { DEPARTMENTS, type Department } from '../../core/model/department';
import type { MyPart } from '../../core/model/person';

// Perspective views (3.6c, Kevin Nov 9): the director, the DP and anyone given Full view see every department as
// before; everyone else sees their own departments first, on a frame and on a scene, with the rest folded under Rest
// of crew. Who you are is "This is me" in Cast and crew, else your role on this project (src/core/model/person.ts,
// myPart). A focus view, not security: anyone with the .sbd can open everything. Real limits come with the web
// companion (Phase 9), where the server sends each person only what they may see.

/** The departments to put first, or null for the full view. */
export type Focus = readonly Department[] | null;

/**
 * The departments to put first for your part, or null for the full view: with Full view on, with no department to put
 * first, or with every one of them yours (nothing to fold). The card, the Inspector and the shot list all read this.
 */
export function focusOf(part: Pick<MyPart, 'fullView' | 'departments'>): Focus {
  const { fullView, departments } = part;
  return fullView || departments.length === 0 || DEPARTMENTS.every((d) => departments.includes(d)) ? null : departments;
}

/** Your focus on the open project, the same array while it's the same departments, so the board doesn't redraw. */
export function usePerspective(projectId: string | undefined): Focus {
  const focus = focusOf(useMyPart(projectId));
  const key = focus ? focus.join(',') : '';
  // Keyed by the departments' ids, not the array: a new array with the same ids is the same focus.
  return useMemo(() => (key === '' ? null : DEPARTMENTS.filter((d) => key.split(',').includes(d))), [key]);
}

/** The focus for the board's cards and shot list, given once by the tile rather than read by every card. */
export const FocusContext = createContext<Focus>(null);

/** Which Rest of crew folds are open: the frame's and the scene's, for this session, so the next frame keeps it. */
const restOfCrew = createStore<{ frame: boolean; scene: boolean }>()(() => ({ frame: false, scene: false }));

export type Fold = 'frame' | 'scene';

export const useRestOfCrewOpen = (fold: Fold): boolean => useStore(restOfCrew, (s) => s[fold]);

export function setRestOfCrewOpen(fold: Fold, open: boolean): void {
  restOfCrew.setState({ [fold]: open });
}

/** Your departments first and the rest after, each in the order given, when the focus splits them; else null. */
export function splitByFocus(all: readonly Department[], focus: Focus): { mine: Department[]; rest: Department[] } | null {
  if (!focus) return null;
  const mine = all.filter((d) => focus.includes(d));
  const rest = all.filter((d) => !focus.includes(d));
  return mine.length > 0 && rest.length > 0 ? { mine, rest } : null;
}

import type { Props } from './record';
import { labels } from '../i18n';

// A project's state (CLAUDE.md, Data model). Archived is a state of the whole project, set with Archive Project, and
// never to be mixed with the Trash, which holds deleted items. An archived project isn't read-only: it only leaves
// the switcher and Recent, and archiving is an op, so it undoes.

export type ProjectState = 'draft' | 'active' | 'archived';

export const PROJECT_STATES: readonly ProjectState[] = ['draft', 'active', 'archived'];

export const PROJECT_STATE_LABEL: Readonly<Record<ProjectState, string>> = labels({
  draft: 'projectState.draft',
  active: 'projectState.active',
  archived: 'projectState.archived',
});

export function isProjectState(value: unknown): value is ProjectState {
  return value === 'draft' || value === 'active' || value === 'archived';
}

/** A project record's state. New projects start as drafts; a file without one reads as active (SBD_FORMAT.md). */
export function projectStateOf(props: Props | undefined): ProjectState {
  const state = props?.state;
  return isProjectState(state) ? state : 'active';
}

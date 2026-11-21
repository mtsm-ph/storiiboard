import { projectStore } from '../../app/projectStore';
import { editAuthor, profileStore } from '../../app/settings/profileStore';
import type { SbdRecord } from '../../core/model/record';
import type { SlateNumbers } from '../../core/model/shotNumbers';
import { reviewSuggestion } from '../../core/model/suggestion';
import type { Change } from '../../core/ops/ops';
import { applySuggestionChanges, rejectSuggestionChanges } from '../../core/ops/suggestions';

// Apply and Reject in the app (7.2, Phase 7 decision 5): each runs 7.0's change-list functions inside the project
// store's queue (`applyWith`), so it works from the records as its turn comes and writes behind every edit queued before
// it; never the file-level ones (src/core/ops/suggestions.ts says why). Every decision is its own op group, so each
// undoes on its own: "Apply the rest" and "Reject the rest" are runs of single decisions, one group each, in the file's
// order, so a new scene is applied before its frames.

type Records = Readonly<Record<string, SbdRecord>>;

/** The store's queue, as the tile uses it; tests hand one of their own. */
export interface DecisionQueue {
  applyWith: (build: (records: Records, slate: SlateNumbers) => { changes: Change[] }) => Promise<boolean>;
  projectId: () => string | null;
  by: () => string;
}

const appQueue: DecisionQueue = {
  applyWith: (build) => projectStore.getState().applyWith(build),
  projectId: () => projectStore.getState().project?.projectId ?? null,
  by: () => editAuthor(profileStore.getState()),
};

/** Applies one suggestion as one op group. Resolves to whether it was written. `strict`: only with no flag at all (the rest's rule). */
export async function applyOne(id: string, { strict = false, queue = appQueue }: { strict?: boolean; queue?: DecisionQueue } = {}): Promise<boolean> {
  const projectId = queue.projectId();
  if (projectId === null) return false;
  let made = false;
  const written = await queue.applyWith((records, slate) => {
    // A project switched to meanwhile has another id: nothing goes into it.
    if (queue.projectId() !== projectId) return { changes: [] };
    if (strict && (reviewSuggestion(records, projectId, id, slate)?.flags.length ?? 1) > 0) return { changes: [] };
    const { changes } = applySuggestionChanges(records, projectId, id, { by: queue.by(), slate });
    made = changes !== null;
    return { changes: changes ?? [] };
  });
  return written && made;
}

/** Rejects one suggestion as one op group that writes only the suggestion. Resolves to whether it was written. */
export async function rejectOne(id: string, { queue = appQueue }: { queue?: DecisionQueue } = {}): Promise<boolean> {
  if (queue.projectId() === null) return false;
  let made = false;
  const written = await queue.applyWith((records) => {
    const changes = rejectSuggestionChanges(records, id, { by: queue.by() });
    made = changes !== null;
    return { changes: changes ?? [] };
  });
  return written && made;
}

/** What a run of decisions did: how many were written, and how many no longer could be when their turn came. */
export interface RunResult {
  done: number;
  skipped: number;
}

/**
 * Apply the rest: each in turn, its own op group, in the order given (the file's). Each is checked again at its turn and
 * applied only with no flag at all, so one whose place changed meanwhile is left for a person, never applied over.
 */
export async function applyRest(ids: readonly string[], queue: DecisionQueue = appQueue): Promise<RunResult> {
  const projectId = queue.projectId();
  let done = 0;
  for (const id of ids) {
    // A switch stops the run: nothing more goes into another project.
    if (queue.projectId() !== projectId) break;
    if (await applyOne(id, { strict: true, queue })) done += 1;
  }
  return { done, skipped: ids.length - done };
}

/** Reject the rest: each in turn, its own op group. */
export async function rejectRest(ids: readonly string[], queue: DecisionQueue = appQueue): Promise<RunResult> {
  const projectId = queue.projectId();
  let done = 0;
  for (const id of ids) {
    if (queue.projectId() !== projectId) break;
    if (await rejectOne(id, { queue })) done += 1;
  }
  return { done, skipped: ids.length - done };
}

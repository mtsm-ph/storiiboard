import { projectStore } from '../../app/projectStore';
import { editAuthor, profileStore } from '../../app/settings/profileStore';
import { t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { SlateNumbers } from '../../core/model/shotNumbers';
import { flagAllowsApply, reviewFlagWords, reviewSuggestion, type SuggestionFlag, type SuggestionReview } from '../../core/model/suggestion';
import type { Change } from '../../core/ops/ops';
import { applySuggestionChanges, rejectSuggestionChanges } from '../../core/ops/suggestions';

// Apply and Reject in the app (7.2, Phase 7 decision 5): each runs 7.0's change-list functions inside the project
// store's queue (`applyWith`), so it works from the records as its turn comes and writes behind every edit queued before
// it; never the file-level ones (src/core/ops/suggestions.ts says why). Every decision is its own op group, so each
// undoes on its own: "Apply the rest" and "Reject the rest" are runs of single decisions, one group each, in the file's
// order, so a new scene is applied before its frames.
//
// A decision belongs to the open project it was asked in: the project object, by identity, as 7.1's Review does
// (reviewAction in src/app/changeFiles.ts). Its id is no test: a backup, an opened version or a copy keeps the
// project's id, so a run that went on into one of those would write another file's decisions into it.

type Records = Readonly<Record<string, SbdRecord>>;

/** The store's queue, as the tile uses it; tests hand one of their own. */
export interface DecisionQueue {
  applyWith: (build: (records: Records, slate: SlateNumbers) => { changes: Change[] }) => Promise<boolean>;
  /** The open project (its object: compared by identity), or null. */
  project: () => object | null;
  projectId: () => string | null;
  by: () => string;
}

const appQueue: DecisionQueue = {
  applyWith: (build) => projectStore.getState().applyWith(build),
  project: () => projectStore.getState().project,
  projectId: () => projectStore.getState().project?.projectId ?? null,
  by: () => editAuthor(profileStore.getState()),
};

/**
 * What became of one Apply: written; not written because the project changed under it meanwhile (`changed`: its target,
 * its place or its decision); not written because of the suggestion itself (`as_is`: a value, a field or a kind it can
 * never be applied with); built but refused by the store at its write (`failed`: the store has said why already, as
 * "Not saved" or a file a sync replaced); or not asked at all (`elsewhere`: another file is open now).
 */
export type ApplyOutcome = { kind: 'done' } | { kind: 'changed' | 'as_is'; flag: SuggestionFlag | null } | { kind: 'failed' } | { kind: 'elsewhere' };

/** With no review to compare with (one Apply): flags that come from the project changing since; any other is its own. */
const CHANGED_FLAGS: ReadonlySet<SuggestionFlag['kind']> = new Set(['changed_since', 'gone', 'trashed', 'locked', 'decided', 'waiting', 'waiting_after']);

/** Whether a flag stops Apply here: any flag in a run (the rest's rule), else only one Apply can't go over. */
const stops = (flag: SuggestionFlag, strict: boolean): boolean => strict || !flagAllowsApply(flag);

/** The same flag: flags are plain data made by one function, so their text is their identity. */
const sameFlag = (a: SuggestionFlag, b: SuggestionFlag): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies one suggestion as one op group, for the project `opened` (the one open when it was asked, by default).
 * `strict`: only with no flag at all (the rest's rule). `before`: the flags it had in the review a run started from; a
 * flag it had then is its own ("couldn't be applied as it is"), one it didn't came meanwhile ("changed meanwhile").
 */
export async function applyOutcome(
  id: string,
  {
    strict = false,
    queue = appQueue,
    opened = queue.project(),
    before,
  }: { strict?: boolean; queue?: DecisionQueue; opened?: object | null; before?: readonly SuggestionFlag[] } = {},
): Promise<ApplyOutcome> {
  const projectId = queue.projectId();
  if (opened === null || projectId === null || queue.project() !== opened) return { kind: 'elsewhere' };
  // Set inside the build, at its turn (cast, so the compiler doesn't narrow it to this first value).
  let outcome = { kind: 'elsewhere' } as ApplyOutcome;
  const written = await queue.applyWith((records, slate) => {
    // Another file opened meanwhile (a copy keeps the id): nothing goes into it.
    if (queue.project() !== opened) return { changes: [] };
    const review = reviewSuggestion(records, projectId, id, slate);
    const flag = review?.flags.find((f) => stops(f, strict)) ?? null;
    if (!review || flag !== null || (strict && review.flags.length > 0)) {
      if (before) {
        // Any flag it didn't have then came meanwhile, and is the one said.
        const fresh = review?.flags.find((now) => !before.some((had) => sameFlag(had, now))) ?? null;
        outcome = review && flag !== null && fresh === null ? { kind: 'as_is', flag } : { kind: 'changed', flag: fresh ?? flag };
      } else outcome = { kind: flag !== null && !CHANGED_FLAGS.has(flag.kind) ? 'as_is' : 'changed', flag };
      return { changes: [] };
    }
    const { changes } = applySuggestionChanges(records, projectId, id, { by: queue.by(), slate });
    outcome = changes === null ? { kind: 'changed', flag: null } : { kind: 'done' };
    return { changes: changes ?? [] };
  });
  if (written || outcome.kind !== 'done') return outcome;
  // Built, yet not written: dropped because another file opened during the build, or refused at its write.
  return queue.project() !== opened ? { kind: 'elsewhere' } : { kind: 'failed' };
}

/** Applies one suggestion as one op group. Resolves to whether it was written. */
export async function applyOne(id: string, options: { strict?: boolean; queue?: DecisionQueue; opened?: object | null } = {}): Promise<boolean> {
  return (await applyOutcome(id, options)).kind === 'done';
}

/** What became of one Reject: written; decided meanwhile or gone (`changed`); refused at its write; or another file. */
type RejectOutcome = 'done' | 'changed' | 'failed' | 'elsewhere';

async function rejectOutcome(id: string, queue: DecisionQueue, opened: object | null): Promise<RejectOutcome> {
  if (opened === null || queue.project() !== opened) return 'elsewhere';
  // A holder, since the build sets it inside a callback.
  const made = { value: false };
  const written = await queue.applyWith((records) => {
    if (queue.project() !== opened) return { changes: [] };
    const changes = rejectSuggestionChanges(records, id, { by: queue.by() });
    made.value = changes !== null;
    return { changes: changes ?? [] };
  });
  if (written && made.value) return 'done';
  if (queue.project() !== opened) return 'elsewhere';
  return made.value ? 'failed' : 'changed';
}

/** Rejects one suggestion as one op group that writes only the suggestion. Resolves to whether it was written. */
export async function rejectOne(id: string, { queue = appQueue, opened = queue.project() }: { queue?: DecisionQueue; opened?: object | null } = {}): Promise<boolean> {
  return (await rejectOutcome(id, queue, opened)) === 'done';
}

/**
 * What a run of decisions did: how many were written; of the rest, how many changed meanwhile and how many couldn't be
 * applied as they are; whether it stopped because another file was opened; and, only when so, that it stopped at an
 * item the store refused to write (`failed`: the store's own warning says why, and the run says nothing more).
 */
export interface RunResult {
  done: number;
  changed: number;
  asIs: number;
  stopped: boolean;
  failed?: true;
}

/**
 * Told after each item of a run: how many have had their turn. The run waits for what it returns before the next item,
 * so the tile can let the page draw between them (an edit that never leaves the page, as the memory build's, would
 * otherwise run the whole of it without a frame).
 */
export type RunProgress = (passed: number) => void | Promise<void>;

/**
 * Apply the rest: each in turn, its own op group, in the order given (the file's). Each is checked again at its turn and
 * applied only with no flag at all, so one whose place changed meanwhile is left for a person, never applied over.
 * `startedFrom`: the reviews the run was picked from (its confirmation's), so a flag is said as one it had then or one
 * that came meanwhile. One the store refuses to write stops the run.
 */
export async function applyRest(
  ids: readonly string[],
  queue: DecisionQueue = appQueue,
  onProgress?: RunProgress,
  startedFrom?: ReadonlyMap<string, Pick<SuggestionReview, 'flags'>>,
): Promise<RunResult> {
  const opened = queue.project();
  const result: RunResult = { done: 0, changed: 0, asIs: 0, stopped: false };
  for (const [at, id] of ids.entries()) {
    // Another file stops the run: nothing more goes into it, and what's left is no one's skip.
    if (queue.project() !== opened) {
      result.stopped = true;
      break;
    }
    const before = startedFrom ? (startedFrom.get(id)?.flags ?? []) : undefined;
    const outcome = await applyOutcome(id, { strict: true, queue, opened, ...(before ? { before } : {}) });
    if (outcome.kind === 'elsewhere') {
      result.stopped = true;
      break;
    }
    if (outcome.kind === 'failed') {
      result.failed = true;
      break;
    }
    if (outcome.kind === 'done') result.done += 1;
    else if (outcome.kind === 'as_is') result.asIs += 1;
    else result.changed += 1;
    await onProgress?.(at + 1);
  }
  return result;
}

/** Reject the rest: each in turn, its own op group. One not written was decided meanwhile or is gone (`changed`). */
export async function rejectRest(ids: readonly string[], queue: DecisionQueue = appQueue, onProgress?: RunProgress): Promise<RunResult> {
  const opened = queue.project();
  const result: RunResult = { done: 0, changed: 0, asIs: 0, stopped: false };
  for (const [at, id] of ids.entries()) {
    if (queue.project() !== opened) {
      result.stopped = true;
      break;
    }
    const outcome = await rejectOutcome(id, queue, opened);
    if (outcome === 'elsewhere') {
      result.stopped = true;
      break;
    }
    if (outcome === 'failed') {
      result.failed = true;
      break;
    }
    if (outcome === 'done') result.done += 1;
    else result.changed += 1;
    await onProgress?.(at + 1);
  }
  return result;
}

/** What one Apply says when it isn't written: why, in its flag's words; nothing for another file or a refused write. */
export function applyNotice(outcome: ApplyOutcome, targetType: string): string | null {
  if (outcome.kind === 'done') return t('review.appliedOne');
  if (outcome.kind === 'elsewhere' || outcome.kind === 'failed') return null;
  const why = outcome.flag ? reviewFlagWords(outcome.flag, targetType) : '';
  return t('review.notApplied', { why: why || t('review.notAppliedAny') });
}

/**
 * What a run says when it ends: what it wrote and what it left, in their own words. Nothing when it stopped (the words
 * would be about a file no longer shown, or the tile shows where it stopped) or when the store refused a write (the
 * store's own warning stands).
 */
export function runNotice(how: 'apply' | 'reject', result: RunResult): string | null {
  if (result.stopped || result.failed) return null;
  const said = [tn(how === 'apply' ? 'review.appliedRest' : 'review.rejectedRest', result.done)];
  if (how === 'apply' && result.changed > 0) said.push(tn('review.skipped', result.changed));
  if (how === 'reject' && result.changed > 0) said.push(tn('review.rejectSkipped', result.changed));
  if (result.asIs > 0) said.push(tn('review.asIs', result.asIs));
  return said.join(' ');
}

import type { JsonValue, SbdRecord } from '../model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../model/shotNumbers';
import { readSuggestion, reviewSuggestion, type SuggestionReview } from '../model/suggestion';
import type { ProjectFile } from '../storage/driver';
import { loadSlateNumbers } from '../storage/slateNumbers';
import { apply, loadRecords, type Change, type OpOptions } from './ops';

// The two decisions a person makes on a suggestion (7.0, Phase 7 decision 5): Apply and Reject, each its own op group,
// so each undoes on its own and "Apply the rest" (7.2) is a loop of single applies. Apply writes what the suggestion
// would do (src/core/model/suggestion.ts, made by the UI's own edits) and the suggestion's decision in one group; Reject
// writes only the decision. Undo of either brings the suggestion back to pending and the project to as it was. The
// stored status stays `approved` (docs/SBD_FORMAT.md); only words people see say Apply.

type Records = Readonly<Record<string, SbdRecord>>;

/** Who decides, and when: `by` is the author the op log records. */
export interface SuggestionDecision {
  by: string;
  at: string;
  /** The project's slate numbers (1.26), as the board passes them to its edits. */
  slate?: SlateNumbers;
}

/**
 * Apply's change list: what the suggestion writes, then its own update (`status: approved`, who and when, and for a
 * `create` the id of what it made). Null when it can't be applied: decided already, flagged so it can't be, or not a
 * suggestion. A flag a person may apply over (changed since) doesn't stop it: the suggested value is written.
 */
export function applySuggestionChanges(
  records: Records,
  projectId: string,
  suggestionId: string,
  decision: SuggestionDecision,
): { changes: Change[] | null; review: SuggestionReview | null } {
  const review = reviewSuggestion(records, projectId, suggestionId, decision.slate ?? NO_SLATE_NUMBERS);
  if (!review?.canApply) return { changes: null, review };
  const set: Record<string, JsonValue> = { status: 'approved', decided_by: decision.by, decided_at: decision.at };
  if (review.createdId !== null) set.created_id = review.createdId;
  return { changes: [...review.writes, { kind: 'update', id: suggestionId, set }], review };
}

/** Reject's change list: only the suggestion's own update. Null for one that isn't pending, or isn't a suggestion. */
export function rejectSuggestionChanges(records: Records, suggestionId: string, decision: Pick<SuggestionDecision, 'by' | 'at'>): Change[] | null {
  const record = Object.hasOwn(records, suggestionId) ? records[suggestionId] : undefined;
  if (record?.type !== 'suggestion' || readSuggestion(record).status !== 'pending') return null;
  return [{ kind: 'update', id: suggestionId, set: { status: 'rejected', decided_by: decision.by, decided_at: decision.at } }];
}

async function recordsOf(file: ProjectFile): Promise<Records> {
  return Object.fromEntries((await loadRecords(file)).map((record) => [record.id, record]));
}

/**
 * Applies one suggestion to an open file as one op group, reading the project as it is now. Resolves to whether it
 * was written, with the review it was written from (its flags say why not).
 */
export async function applySuggestion(
  file: ProjectFile,
  projectId: string,
  suggestionId: string,
  options: OpOptions = {},
): Promise<{ applied: boolean; review: SuggestionReview | null }> {
  const records = await recordsOf(file);
  const at = (options.now ?? (() => new Date()))().toISOString();
  const { changes, review } = applySuggestionChanges(records, projectId, suggestionId, { by: options.author ?? 'local', at, slate: await loadSlateNumbers(file) });
  if (!changes) return { applied: false, review };
  await apply(file, changes, options);
  return { applied: true, review };
}

/** Rejects one suggestion in an open file as one op group that writes only the suggestion. Resolves to whether it was written. */
export async function rejectSuggestion(file: ProjectFile, suggestionId: string, options: OpOptions = {}): Promise<boolean> {
  const records = await recordsOf(file);
  const at = (options.now ?? (() => new Date()))().toISOString();
  const changes = rejectSuggestionChanges(records, suggestionId, { by: options.author ?? 'local', at });
  if (!changes) return false;
  await apply(file, changes, options);
  return true;
}

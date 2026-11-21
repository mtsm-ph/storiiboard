import type { JsonValue, SbdRecord } from '../model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../model/shotNumbers';
import { readSuggestion, reviewSuggestion, sharedAuthor, type SuggestionReview } from '../model/suggestion';
import { readChangeFile, type ChangeFile, type ChangeFileRefusal } from '../storage/changeFile';
import type { ProjectFile } from '../storage/driver';
import { loadSlateNumbers } from '../storage/slateNumbers';
import { apply, loadRecords, type Change, type OpOptions } from './ops';
import { keyAfter, keyAfterKeys } from './order';

// The two decisions a person makes on a suggestion (7.0, Phase 7 decision 5): Apply and Reject, each its own op group,
// so each undoes on its own and "Apply the rest" (7.2) is a loop of single applies. Apply writes what the suggestion
// would do (src/core/model/suggestion.ts, made by the UI's own edits) and the suggestion's decision in one group; Reject
// writes only the decision. Undo of either brings the suggestion back to pending and the project to as it was. The
// stored status stays `approved` (docs/SBD_FORMAT.md); only words people see say Apply. `decided_at` is the group's own
// time (stepTime, through the update's `stamp`), never a clock read before the group is written.

type Records = Readonly<Record<string, SbdRecord>>;

/** Who decides: `by` is the author the op log records. */
export interface SuggestionDecision {
  by: string;
  /** The project's slate numbers (1.26), as the board passes them to its edits. */
  slate?: SlateNumbers;
}

/**
 * Apply's change list: what the suggestion writes, then its own update (`status: approved`, who, `decided_at` stamped
 * with the group's time, and for a `create` the id of what it made). Null when it can't be applied: decided already,
 * flagged so it can't be, or not a suggestion. A flag a person may apply over (changed since) doesn't stop it: the
 * suggested value is written.
 */
export function applySuggestionChanges(
  records: Records,
  projectId: string,
  suggestionId: string,
  decision: SuggestionDecision,
): { changes: Change[] | null; review: SuggestionReview | null } {
  const review = reviewSuggestion(records, projectId, suggestionId, decision.slate ?? NO_SLATE_NUMBERS);
  if (!review?.canApply) return { changes: null, review };
  const set: Record<string, JsonValue> = { status: 'approved', decided_by: decision.by };
  if (review.createdId !== null) set.created_id = review.createdId;
  return { changes: [...review.writes, { kind: 'update', id: suggestionId, set, stamp: ['decided_at'] }], review };
}

/** Reject's change list: only the suggestion's own update. Null for one that isn't pending, or isn't a suggestion. */
export function rejectSuggestionChanges(records: Records, suggestionId: string, decision: Pick<SuggestionDecision, 'by'>): Change[] | null {
  const record = Object.hasOwn(records, suggestionId) ? records[suggestionId] : undefined;
  if (record?.type !== 'suggestion' || readSuggestion(record).status !== 'pending') return null;
  return [{ kind: 'update', id: suggestionId, set: { status: 'rejected', decided_by: decision.by }, stamp: ['decided_at'] }];
}

async function recordsOf(file: ProjectFile): Promise<Records> {
  return Object.fromEntries((await loadRecords(file)).map((record) => [record.id, record]));
}

// The app (7.2) runs applySuggestionChanges and rejectSuggestionChanges inside the store's queue (`applyWith`), so each
// works from the records as its turn comes and writes behind every edit queued before it. The two below read and write
// an open file directly: for tests, and for 7.5's server.

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
  const { changes, review } = applySuggestionChanges(records, projectId, suggestionId, { by: options.author ?? 'local', slate: await loadSlateNumbers(file) });
  if (!changes) return { applied: false, review };
  await apply(file, changes, options);
  return { applied: true, review };
}

/** Rejects one suggestion in an open file as one op group that writes only the suggestion. Resolves to whether it was written. */
export async function rejectSuggestion(file: ProjectFile, suggestionId: string, options: OpOptions = {}): Promise<boolean> {
  const records = await recordsOf(file);
  const changes = rejectSuggestionChanges(records, suggestionId, { by: options.author ?? 'local' });
  if (!changes) return false;
  await apply(file, changes, options);
  return true;
}

// Bringing a change file in (7.1, docs/SBD_FORMAT.md "Importing"): one op group of creates, one `suggestion` record per
// suggestion the project doesn't have yet, under the project, so one undo removes them all. Nothing else is written:
// the file's suggestions become records only, and no other record is touched.

/** What bringing a file in would write, and what it found. */
export interface BroughtIn {
  /** The creates; [] when the file adds nothing, so no op is written. */
  changes: Change[];
  /** Suggestions it adds. */
  added: number;
  /** Suggestions already in the project (brought in before): they add nothing. */
  already: number;
  /** Suggestions whose id is another record's (not a suggestion): left out, never written over it. */
  taken: number;
  /** The authors' name when every one added shares one, as text; null for none or several. */
  authorName: string | null;
}

/**
 * Bring-in's change list for a file already read (readChangeFile): a create for each suggestion whose id no record has,
 * placed after the project's suggestions. An id that is already a suggestion is the same file (or one sharing it)
 * brought in before; an id that is any other record's is left out, so a file can never write over a frame by naming it.
 */
export function bringInChanges(records: Readonly<Record<string, SbdRecord>>, projectId: string, file: ChangeFile): BroughtIn {
  return bringInManyChanges(records, projectId, [file]).each[0] ?? { changes: [], added: 0, already: 0, taken: 0, authorName: null };
}

/** Several files brought in as one op group (the folder's pass, 7.1 round 2): each file's part, and every create. */
export interface BroughtInMany {
  each: BroughtIn[];
  changes: Change[];
}

/**
 * Bring-in's change list for several files read already, in order, as one op group: what bringInChanges does for each,
 * an id an earlier file of the same pass adds counting as already in for a later one. `skip` holds suggestion ids
 * brought in before whose records are gone (an undone bring-in, everBroughtIn): they count as already in, so the folder
 * never brings back what a person undid.
 */
export function bringInManyChanges(
  records: Readonly<Record<string, SbdRecord>>,
  projectId: string,
  files: readonly ChangeFile[],
  skip: ReadonlySet<string> = new Set(),
): BroughtInMany {
  const keys = Object.values(records)
    .filter((record) => record.parentId === projectId && record.type === 'suggestion')
    .map((record) => record.sortKey);
  let key: string | null = null;
  const changes: Change[] = [];
  const each: BroughtIn[] = [];
  const added = new Set<string>();
  for (const file of files) {
    const own: Change[] = [];
    const made: SbdRecord[] = [];
    let already = 0;
    let taken = 0;
    for (const suggestion of file.suggestions) {
      const existing = Object.hasOwn(records, suggestion.id) ? records[suggestion.id] : undefined;
      if (existing) {
        if (existing.type === 'suggestion') already += 1;
        else taken += 1;
        continue;
      }
      if (added.has(suggestion.id) || skip.has(suggestion.id)) {
        already += 1;
        continue;
      }
      added.add(suggestion.id);
      key = (key === null ? null : keyAfter(key)) ?? keyAfterKeys(key === null ? keys : [...keys, key]);
      own.push({ kind: 'create', record: { id: suggestion.id, type: 'suggestion', parentId: projectId, sortKey: key, props: suggestion.props } });
      made.push({ id: suggestion.id, type: 'suggestion', parentId: projectId, sortKey: key, props: suggestion.props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' });
    }
    changes.push(...own);
    each.push({ changes: own, added: own.length, already, taken, authorName: sharedAuthor(made) });
  }
  return { each, changes };
}

/** What the log says was ever brought in: every suggestion id and change file id a create of a suggestion named. */
export interface EverBroughtIn {
  suggestions: ReadonlySet<string>;
  files: ReadonlySet<string>;
}

/**
 * Every suggestion the log ever created, undone ones included, with the change files they came from (7.1 round 2): the
 * folder skips a file or a suggestion id named here, so an undone bring-in stays undone. An undo's op keeps the kind it
 * reverses with its sides swapped, so both sides are read. Import changes… by hand doesn't ask: a person who chose a
 * file again wants it.
 */
export async function everBroughtIn(file: ProjectFile): Promise<EverBroughtIn> {
  const rows = await file.query(
    `SELECT record_id AS id, coalesce(json_extract(after, '$.props.change_file_id'), json_extract(before, '$.props.change_file_id')) AS file
      FROM ops WHERE kind = 'create' AND (json_extract(after, '$.type') = 'suggestion' OR json_extract(before, '$.type') = 'suggestion')`,
  );
  const suggestions = new Set<string>();
  const files = new Set<string>();
  for (const row of rows) {
    suggestions.add(String(row.id));
    if (typeof row.file === 'string') files.add(row.file);
  }
  return { suggestions, files };
}

/** Bringing a file into an open file: what it did, or why the file was refused (nothing written). */
export type BringInResult = { ok: true; broughtIn: BroughtIn } | { ok: false; refusal: ChangeFileRefusal };

/**
 * Brings a change file into an open project file as one op group, reading the project as it is now. For tests and 7.5's
 * server: the app runs bringInChanges inside the store's queue (`applyWith`), so no edit lands between its read and its
 * write. A file that adds nothing writes no op.
 */
export async function bringInChangeFile(file: ProjectFile, projectId: string, bytes: Uint8Array, options: OpOptions = {}): Promise<BringInResult> {
  const read = readChangeFile(bytes, projectId);
  if (!read.ok) return read;
  const broughtIn = bringInChanges(await recordsOf(file), projectId, read.file);
  if (broughtIn.changes.length > 0) await apply(file, broughtIn.changes, options);
  return { ok: true, broughtIn };
}

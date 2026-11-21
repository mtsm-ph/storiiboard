import { tn, t } from '../../core/i18n';
import { dayCallsheet } from '../../core/model/callsheet';
import { DEPARTMENT_LABELS, isDepartment } from '../../core/model/department';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import { keptFor, recordsOfType } from '../../core/model/recordIndex';
import { dayDateLabel, shootDayFields } from '../../core/model/shootDay';
import type { SlateNumbers } from '../../core/model/shotNumbers';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import { cleanText, keptSuggestion, reviewSuggestion, type Suggestion, type SuggestionReview } from '../../core/model/suggestion';
import { ASSISTANT_SCOPE, scopeField, scopeType } from '../../core/model/suggestionScope';
import { boardScene } from '../../core/ops/storyboardEdits';
import { line, valueText, type Line, type Part } from '../history/summary';

// The review screen's readers (7.2, Phase 7 decision 5): the project's suggestions grouped by the change file that
// brought them in, newest import first, each group's suggestions in the file's order (the order bring-in gave them);
// each pending one reviewed against the records as they are now (7.0's reviewSuggestion); which of a group "Apply the
// rest" takes; and the words a suggestion is shown in. Pure, no page: the tile (SuggestionsTile.tsx) draws them.
//
// Cost (7.0's comment on loopsBack): reviewing N chained creates costs about N²/2 reads. A group's reviews are kept per
// records object and slate numbers (as recordIndex.ts keeps its readers), so a group is reviewed once per change of
// records, never on every render, and only the group a person is looking at is reviewed at all.

type Records = Readonly<Record<string, SbdRecord>>;

/** One import: the suggestions one change file brought in. */
export interface SuggestionGroup {
  /** The change file's id; '' for suggestions that name none. */
  id: string;
  /** `source` as text: `mcp` for the assistant's, `change_file` otherwise. */
  source: string;
  /** The authors' names from the file, each once, as text, in the file's order. */
  authors: string[];
  /** When the first of them was brought in (its record's created_at). */
  broughtInAt: string;
  /** Every suggestion of the import, in the file's order. */
  ids: string[];
  /** The ones still waiting for a person, in the file's order. */
  pending: string[];
}

const bySortKey = (a: SbdRecord, b: SbdRecord): number => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A suggestion read once per record object (7.0's reader, kept). */
export const suggestionOf = keptSuggestion;

/** The project's live suggestion records, in the order they were brought in. */
function projectSuggestions(records: Records, projectId: string): SbdRecord[] {
  return recordsOfType(records, 'suggestion')
    .filter((record) => record.parentId === projectId && record.trashedAt === null)
    .sort(bySortKey);
}

/** Every import, newest first: one pass over the suggestions, kept per records object. */
export function suggestionGroups(records: Records, projectId: string): readonly SuggestionGroup[] {
  return keptFor(records, `suggestions.groups:${projectId}`, () => {
    const groups = new Map<string, SuggestionGroup>();
    const last = new Map<string, string>();
    for (const record of projectSuggestions(records, projectId)) {
      const suggestion = suggestionOf(record);
      const id = suggestion.changeFileId ?? '';
      let group = groups.get(id);
      if (!group) {
        group = { id, source: suggestion.source, authors: [], broughtInAt: record.createdAt, ids: [], pending: [] };
        groups.set(id, group);
      }
      group.ids.push(record.id);
      if (suggestion.status === 'pending') group.pending.push(record.id);
      if (suggestion.author.name !== '' && !group.authors.includes(suggestion.author.name)) group.authors.push(suggestion.author.name);
      if (record.createdAt !== '' && (group.broughtInAt === '' || record.createdAt < group.broughtInAt)) group.broughtInAt = record.createdAt;
      if (record.sortKey > (last.get(id) ?? '')) last.set(id, record.sortKey);
    }
    // Newest import first: a later bring-in places its suggestions after every earlier one's.
    const lastOf = (group: SuggestionGroup) => last.get(group.id) ?? '';
    return [...groups.values()].sort((a, b) => (lastOf(a) < lastOf(b) ? 1 : lastOf(a) > lastOf(b) ? -1 : 0));
  });
}

/** The import a suggestion belongs to, by its id; null when it's no suggestion of the project. */
export function groupOf(records: Records, projectId: string, suggestionId: string): SuggestionGroup | null {
  return suggestionGroups(records, projectId).find((group) => group.ids.includes(suggestionId)) ?? null;
}

/** Decided suggestions, newest decision first: the review log. */
export function decidedSuggestions(records: Records, projectId: string): readonly Suggestion[] {
  return keptFor(records, `suggestions.decided:${projectId}`, () =>
    projectSuggestions(records, projectId)
      .map(suggestionOf)
      .filter((suggestion) => suggestion.status === 'approved' || suggestion.status === 'rejected')
      .sort((a, b) => ((a.decidedAt ?? '') < (b.decidedAt ?? '') ? 1 : (a.decidedAt ?? '') > (b.decidedAt ?? '') ? -1 : 0)),
  );
}

// A group's reviews, kept per records object, and by the slate numbers they were made with.
const reviewed = new WeakMap<Records, Map<string, { slate: SlateNumbers; reviews: ReadonlyMap<string, SuggestionReview> }>>();
let groupReviewRuns = 0;

/** How many times a group has been reviewed: for tests, which check it is once per records object. */
export const groupReviewsRun = (): number => groupReviewRuns;

/** Each pending suggestion of a group, reviewed against the records as they are: once per records object and slate. */
export function groupReviews(records: Records, projectId: string, group: SuggestionGroup, slate: SlateNumbers): ReadonlyMap<string, SuggestionReview> {
  let byGroup = reviewed.get(records);
  if (!byGroup) {
    byGroup = new Map();
    reviewed.set(records, byGroup);
  }
  const key = `${projectId}\u0000${group.id}`;
  const known = byGroup.get(key);
  if (known && known.slate === slate) return known.reviews;
  groupReviewRuns += 1;
  const reviews = new Map<string, SuggestionReview>();
  for (const id of group.pending) {
    const review = reviewSuggestion(records, projectId, id, slate);
    if (review) reviews.set(id, review);
  }
  byGroup.set(key, { slate, reviews });
  return reviews;
}

/**
 * What "Apply the rest" takes (decision 5): the group's pending creates, in the file's order, that carry no flag at all,
 * but for waiting on another create the rest takes before it (a new scene's frames follow it). Never a deletion, a move
 * or an update, and never anything else flagged: changed since, can't be applied, gone, and every other flag.
 */
export function restToApply(group: SuggestionGroup, reviews: ReadonlyMap<string, SuggestionReview>): string[] {
  const taken: string[] = [];
  for (const id of group.pending) {
    const review = reviews.get(id);
    if (review?.suggestion.kind !== 'create' || review.suggestion.status !== 'pending') continue;
    const clean = review.flags.length === 0 ? review.canApply : review.flags.every((flag) => (flag.kind === 'waiting' || flag.kind === 'waiting_after') && taken.includes(flag.on));
    if (clean) taken.push(id);
  }
  return taken;
}

/** What "Reject the rest" takes: every pending suggestion of the group, any kind, in the file's order. */
export const restToReject = (group: SuggestionGroup): string[] => [...group.pending];

// Words. Every word from a suggestion is shown as text; numbers and values in mono (DESIGN.md).

const mono = (text: string): Part => ({ mono: text });
const recordOf = (records: Records, id: string | null): SbdRecord | null => (id !== null && Object.hasOwn(records, id) ? (records[id] ?? null) : null);
const live = (record: SbdRecord | null, type: SbdRecord['type']): SbdRecord | null => (record?.type === type && record.trashedAt === null ? record : null);

/** "SC 04", as the slate reads it. */
const sceneSlate = (scene: SbdRecord): string => sceneLabel(sceneFields(scene.props).number);

/** "SC 04 · 4B": a frame as the slate reads it. */
function frameSlate(records: Records, shot: SbdRecord): string {
  const scene = recordOf(records, shot.parentId);
  const number = shotFields(shot.props).number;
  return scene ? t('review.frameSlate', { scene: sceneSlate(scene), shot: number }) : number;
}

/** A day by its date, else as a shoot day. */
const dayName = (day: SbdRecord): string => dayDateLabel(shootDayFields(day.props).date) || t('history.undatedDay');

/** The record a suggestion acts on, as it reads now; by the label the suggester saw (as text) once it's gone. */
export function targetLine(records: Records, suggestion: Suggestion): Line {
  const target = recordOf(records, suggestion.targetId);
  const fallback: Line = [suggestion.targetLabel || t('history.suggestion.anItem')];
  if (!target || suggestion.kind === 'create') return fallback;
  if (suggestion.targetType === 'callsheet') return target.type === 'shoot_day' ? line('review.target.callsheet', { day: mono(dayName(target)) }) : fallback;
  if (target.type !== suggestion.targetType) return fallback;
  if (target.type === 'shot') return [mono(frameSlate(records, target))];
  if (target.type === 'scene') {
    const name = sceneFields(target.props).name;
    return name === '' ? [mono(sceneSlate(target))] : [mono(sceneSlate(target)), ` ${name}`];
  }
  if (target.type === 'note') {
    const scene = recordOf(records, target.parentId);
    return scene ? line('review.target.note', { scene: mono(sceneSlate(scene)) }) : [t('review.aNote')];
  }
  if (target.type === 'shoot_day') return line('review.target.day', { day: mono(dayName(target)) });
  return fallback;
}

/** A frame or note as a place names it: "4B", or "a note". */
function itemName(record: SbdRecord): Part {
  return record.type === 'shot' ? mono(shotFields(record.props).number || '?') : t('review.aNote');
}

/** The scene a place is in: by its slate, or "the new scene" another suggestion adds. */
function sceneName(records: Records, sceneId: string | null, suggestion: Suggestion): Part {
  const scene = live(recordOf(records, sceneId), 'scene');
  if (scene) return mono(sceneSlate(scene));
  // A parent named by another suggestion of the file: that one's scene, once it has made one.
  const by = suggestion.afterSuggestion === null ? null : recordOf(records, suggestion.afterSuggestion);
  const made = by?.type === 'suggestion' ? live(recordOf(records, suggestionOf(by).createdId), 'scene') : null;
  return made ? mono(sceneSlate(made)) : t('review.newScene');
}

/**
 * Where a frame or note goes in a scene: after a live item, at the start (after_id null), after one another suggestion
 * adds, or at the end when what it went after is gone.
 */
function wherePlace(records: Records, suggestion: Suggestion, sceneId: string | null, afterId: string | null): Line {
  const scene = sceneName(records, sceneId, suggestion);
  if (afterId === null) return line('review.where.start', { scene });
  const after = recordOf(records, afterId);
  if (after?.type === 'suggestion') {
    const made = recordOf(records, suggestionOf(after).createdId);
    if (made && made.trashedAt === null) return line('review.where.after', { item: itemName(made), scene });
    return line('review.where.afterNew', { scene });
  }
  if (after && after.trashedAt === null && (after.type === 'shot' || after.type === 'note')) return line('review.where.after', { item: itemName(after), scene });
  return line('review.where.end', { scene });
}

/** Where a scene goes on the board: after a live scene, else at the end. */
function sceneWhere(records: Records, afterId: string | null): Line {
  const after = live(recordOf(records, afterId), 'scene');
  return after ? line('review.where.afterScene', { scene: mono(sceneSlate(after)) }) : [t('review.where.boardEnd')];
}

/** Where a frame or note is now: after the live item before it in its scene, or at its start. */
export function whereNow(records: Records, target: SbdRecord): Line {
  const scene = recordOf(records, target.parentId);
  if (!scene) return [t('history.suggestion.anItem')];
  const items = boardScene(records, scene).items.map((item) => (item.kind === 'shot' ? item.shot.record : item.note.record));
  const before = items[items.findIndex((record) => record.id === target.id) - 1];
  const name = mono(sceneSlate(scene));
  return before ? line('review.where.after', { item: itemName(before), scene: name }) : line('review.where.start', { scene: name });
}

const CREATE_WORD: Readonly<Record<string, 'review.what.createShot' | 'review.what.createNote' | 'review.what.createScene'>> = {
  shot: 'review.what.createShot',
  note: 'review.what.createNote',
  scene: 'review.what.createScene',
};

/** What a suggestion does, in one line: "Move SC 04 · 4B to the Trash", "Add a frame after 4B in SC 04". */
export function headline(records: Records, suggestion: Suggestion): Line {
  const item = targetLine(records, suggestion);
  const { data } = suggestion;
  const join = (parts: Line): Part => lineOfParts(parts);
  if (suggestion.kind === null) return [t('history.suggestion.unknown')];
  if (suggestion.kind === 'trash') return line('review.what.trash', { item: join(item) });
  if (suggestion.kind === 'update') return line('review.what.update', { item: join(item) });
  if (suggestion.kind === 'reorder') return line('review.what.reorder', { item: join(item) });
  if (data?.kind !== 'create') return line('review.what.createItem', { label: suggestion.targetLabel || t('history.suggestion.anItem') });
  const key = Object.hasOwn(CREATE_WORD, data.type) ? CREATE_WORD[data.type] : undefined;
  if (!key) return line('review.what.createItem', { label: cleanText(data.type, 40) || t('history.suggestion.anItem') });
  const where = data.type === 'scene' ? sceneWhere(records, data.afterId) : wherePlace(records, suggestion, data.parentId, data.afterId);
  return line(key, { where: join(where) });
}

// A part holding a whole line, for a placeholder: its text, mono when the line is all one technical value.
function lineOfParts(parts: Line): Part {
  if (parts.length === 1 && parts[0] !== undefined) return parts[0];
  return parts.map((part) => (typeof part === 'string' ? part : part.mono)).join('');
}

/** A line as plain text, for the confirmation's list and for labels. */
export const plain = (parts: Line): string => parts.map((part) => (typeof part === 'string' ? part : part.mono)).join('');

/** Fields whose values are technical, set in mono. */
const MONO_FIELDS: ReadonlySet<string> = new Set(['lens_mm', 't_stop', 'call_time', 'wrap_time', 'department_calls', 'person_times', 'page_eighths']);

const PERSON_TIME_WORD = { call: 'callSheet.call', hmu_ready: 'callSheet.hmuReady', on_set: 'callSheet.onSet' } as const;

const isObject = (value: JsonValue | undefined): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);
const timeOr = (value: JsonValue | undefined): string => (typeof value === 'string' && value !== '' ? value : '—');

/** Text past this is cut in the review: what's stored is never changed. */
const MAX_SHOWN = 2000;
const cut = (text: string): string => (text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text);

/** A field's value in the board's words: ids by their records' names, a call sheet's calls and times by whose. */
export function fieldValue(records: Records, field: string, value: JsonValue | undefined): Part {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (field === 'location_id' && typeof value === 'string') {
    const location = live(recordOf(records, value), 'location');
    return location ? cleanText(location.props.name, 200) || t('history.aLocation') : t('history.aLocation');
  }
  if (field === 'shoot_day_id' && typeof value === 'string') {
    const day = live(recordOf(records, value), 'shoot_day');
    return day ? mono(dayName(day)) : t('history.aShootDay');
  }
  if (field === 'gear_ids' && Array.isArray(value)) {
    const names = value.map((id) => (typeof id === 'string' ? cleanText(recordOf(records, id)?.props.name, 200) : '') || t('history.aGearItem'));
    return cut(names.join(', '));
  }
  if (field === 'department_calls' && isObject(value)) {
    return mono(
      cut(
        Object.entries(value)
          .map(([department, time]) => `${isDepartment(department) ? DEPARTMENT_LABELS[department] : cleanText(department, 40)} ${timeOr(time)}`)
          .join(', '),
      ),
    );
  }
  if (field === 'person_times' && isObject(value)) {
    return mono(
      cut(
        Object.entries(value)
          .map(([personId, times]) => {
            const name = cleanText(recordOf(records, personId)?.props.name, 100) || t('history.aPerson');
            const parts = isObject(times)
              ? Object.entries(times).map(([key, time]) => `${Object.hasOwn(PERSON_TIME_WORD, key) ? t(PERSON_TIME_WORD[key as keyof typeof PERSON_TIME_WORD]) : cleanText(key, 40)} ${timeOr(time)}`)
              : ['—'];
            return `${name}: ${parts.join(', ')}`;
          })
          .join('; '),
      ),
    );
  }
  const text = cut(valueText(field, value));
  return MONO_FIELDS.has(field) && text !== '—' ? mono(text) : text;
}

/** A field's name as a heading: the scope row's (History's words, which run in a sentence), with a capital; else as text. */
export function fieldLabel(targetType: string, field: string): string {
  const entry = scopeType(ASSISTANT_SCOPE, targetType);
  const rule = entry ? scopeField(entry, field) : null;
  if (!rule) return cleanText(field, 40) || '?';
  const name = t(rule.label);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One field of an update: its value now and the suggested one; then too when it changed since. */
export interface FieldRow {
  field: string;
  label: string;
  now: Part;
  suggested: Part;
  /** Set when the field changed since it was suggested: what the suggester saw. */
  then: Part | null;
}

/** An update's fields, each with now and suggested, and with then where it changed since (the flag's three values). */
export function updateRows(records: Records, review: SuggestionReview): FieldRow[] {
  const { suggestion } = review;
  if (suggestion.data?.kind !== 'update') return [];
  const isSheet = suggestion.targetType === 'callsheet';
  const target = recordOf(records, suggestion.targetId);
  const record = isSheet && target ? dayCallsheet(records, target.id) : target;
  const changed = new Map<string, { then: JsonValue; now: JsonValue }>();
  for (const flag of review.flags) if (flag.kind === 'changed_since') for (const field of flag.fields) changed.set(field.field, { then: field.then, now: field.now });
  return [...suggestion.data.props].map(([field, value]): FieldRow => {
    const was = changed.get(field);
    const stored = record?.props[field];
    // A call sheet's calls and times are edited key by key: only the keys named are shown.
    const now = was ? was.now : isObject(value) && isObject(stored) ? Object.fromEntries(Object.keys(value).map((key) => [key, Object.hasOwn(stored, key) ? (stored[key] ?? null) : null])) : (stored ?? null);
    return { field, label: fieldLabel(suggestion.targetType, field), now: fieldValue(records, field, now), suggested: fieldValue(records, field, value), then: was ? fieldValue(records, field, was.then) : null };
  });
}

/** A create's fields, each with its value. */
export function createRows(records: Records, suggestion: Suggestion): { field: string; label: string; value: Part }[] {
  if (suggestion.data?.kind !== 'create') return [];
  const type = suggestion.data.type;
  return [...suggestion.data.props].map(([field, value]) => ({ field, label: fieldLabel(type, field), value: fieldValue(records, field, value) }));
}

/** What a trash takes with it: a scene's live frames, notes and setups, counted; null when nothing goes with it. */
export function trashTakes(records: Records, suggestion: Suggestion): string | null {
  const scene = live(recordOf(records, suggestion.targetId), 'scene');
  if (suggestion.kind !== 'trash' || !scene || suggestion.targetType !== 'scene') return null;
  const count = (type: SbdRecord['type']) => recordsOfType(records, type).filter((record) => record.parentId === scene.id && record.trashedAt === null).length;
  const parts = [
    ['count.frames', count('shot')],
    ['count.notes', count('note')],
    ['count.setups', count('setup')],
  ] as const;
  const said = parts.filter(([, n]) => n > 0).map(([key, n]) => tn(key, n));
  return said.length === 0 ? null : t('review.goesWith', { items: said.join(', ') });
}

/** A reorder's place now and the place it asks for. */
export function reorderPlaces(records: Records, suggestion: Suggestion): { from: Line; to: Line } | null {
  const target = recordOf(records, suggestion.targetId);
  if (suggestion.data?.kind !== 'reorder' || !target) return null;
  return { from: whereNow(records, target), to: wherePlace(records, suggestion, suggestion.data.parentId, suggestion.data.afterId) };
}

/** Who suggested it, as text: the author's name, else the source's word. */
export function authorName(suggestion: Suggestion): string {
  return suggestion.author.name || sourceWord(suggestion.source);
}

/** The source's word: the assistant's, or a change file's. */
export const sourceWord = (source: string): string => t(source === 'mcp' ? 'review.source.assistant' : 'review.source.changeFile');

/** Where the item lives, to show it: a frame, a scene (for a note, or a create's scene), or a day; null for none. */
export type ShowTarget = { kind: 'shot'; shotId: string; sceneId: string; label: Line } | { kind: 'scene'; sceneId: string; label: Line } | { kind: 'day'; dayId: string; label: Line };

export function showTarget(records: Records, suggestion: Suggestion): ShowTarget | null {
  // An applied create shows what it made.
  const made = suggestion.createdId === null ? null : recordOf(records, suggestion.createdId);
  const target = made && made.trashedAt === null ? made : recordOf(records, suggestion.targetId);
  const asShot = live(target, 'shot');
  const sceneOfShot = asShot ? live(recordOf(records, asShot.parentId), 'scene') : null;
  if (asShot && sceneOfShot) return { kind: 'shot', shotId: asShot.id, sceneId: sceneOfShot.id, label: [mono(shotFields(asShot.props).number || '?')] };
  const asScene = live(target, 'scene');
  if (asScene) return { kind: 'scene', sceneId: asScene.id, label: [mono(sceneSlate(asScene))] };
  const asNote = live(target, 'note');
  const noteScene = asNote ? live(recordOf(records, asNote.parentId), 'scene') : null;
  if (noteScene) return { kind: 'scene', sceneId: noteScene.id, label: [mono(sceneSlate(noteScene))] };
  const day = live(target, 'shoot_day');
  if (day) return { kind: 'day', dayId: day.id, label: [mono(dayName(day))] };
  // A pending create: the scene it goes in.
  if (suggestion.data?.kind === 'create' && suggestion.data.type !== 'scene') {
    const scene = live(recordOf(records, suggestion.data.parentId), 'scene');
    if (scene) return { kind: 'scene', sceneId: scene.id, label: [mono(sceneSlate(scene))] };
  }
  return null;
}

import { useEffect, useId, useRef, useState } from 'react';
import { ask } from '../../app/ask';
import { localDateTime } from '../../app/format';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { workspaceStore } from '../../app/shell/workspaceStore';
import { formatNumber, list, pluralKey, t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import type { SlateNumbers } from '../../core/model/shotNumbers';
import { reviewFlagWords, type Suggestion, type SuggestionReview } from '../../core/model/suggestion';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useLocale } from '../../ui/useLocale';
import { LineText } from '../history/LineText';
import { line, type Line, type Part } from '../history/summary';
import { markImportRead } from '../notifications/notificationsStore';
import { openShootDay } from '../schedule/shownDay';
import { selectionStore } from '../storyboard/selection';
import { applyNotice, applyOutcome, applyRest, rejectOne, rejectRest, runNotice } from './decide';
import {
  authorName,
  createRows,
  decidedSuggestions,
  fromWords,
  groupReviews,
  headline,
  plain,
  reorderPlaces,
  restLines,
  restToApply,
  restToReject,
  showTarget,
  sourceWord,
  suggestionGroups,
  trashTakes,
  updateRows,
  type ShowTarget,
  type SuggestionGroup,
} from './review';
import { suggestionsFocus, useSuggestionsAsk } from './suggestionsFocus';

// The Suggestions tile (7.2, Phase 7 decision 5; departments answer 7 for the words): Changes to review, each import a
// group with its source, when it came in and its count, newest first; one suggestion at a time with what it does, its
// flags in words, Apply and Reject; Apply the rest (only unflagged adds) and Reject the rest, each behind a confirmation
// that lists what will change; and Changes applied, the review log. Any workspace opens it from the Layout menu; it's in
// no default layout, as Trash and Notifications. Opened also from the status line's Review and from a notification.

type Records = Readonly<Record<string, SbdRecord>>;
type LogFilter = 'all' | 'approved' | 'rejected';

/** At most this many lines in a confirmation's list; the rest are counted. */
const LISTED = 30;

/** Rows shown at a time, in the pending list and in the log; more on asking (Show more), as Notifications pages. */
export const WINDOW = 100;

/** Resolves in a task of its own (a message, never a timer's clamped wait): the page may draw and take input first. */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

/** A run of Apply the rest or Reject the rest as it goes: how many have had their turn. */
interface Running {
  how: 'apply' | 'reject';
  passed: number;
  total: number;
}

/** A run's count is heard at least this often (a slow run), besides each tenth of the way. */
const ANNOUNCE_EVERY_MS = 5000;

/** A run's progress as it goes: the frame asked for, how many passed, the tenth last heard and when. */
const runProgress = (): { frame: number | null; passed: number; tenth: number; saidAt: number } => ({ frame: null, passed: 0, tenth: 0, saidAt: performance.now() });

/** "Stopped at 340 of 2,000." */
const stoppedWords = (at: Running): string => t('review.stoppedAt', { done: formatNumber(at.passed, 0), total: formatNumber(at.total, 0) });

const PartText =({ part }: { part: Part }) => (typeof part === 'string' ? <span className="whitespace-pre-wrap wrap-anywhere">{part}</span> : <span className="font-mono">{part.mono}</span>);

function show(target: ShowTarget): void {
  if (target.kind === 'shot') selectionStore.getState().selectShot(target.shotId, target.sceneId);
  else if (target.kind === 'scene') selectionStore.getState().selectScene(target.sceneId);
  else openShootDay(workspaceStore.getState().active, target.dayId);
}

/** Who a group is from, as text: its authors' names, else its source. */
const groupFrom = (group: SuggestionGroup): string => fromWords(group.authors, group.source);

/** The group's heading: its authors and its source both, or the source alone when the file names no one. */
const groupHeading = (group: SuggestionGroup): string =>
  group.authors.length > 0 ? t('review.groupFromVia', { from: list(group.authors), source: sourceWord(group.source) }) : t('review.groupFrom', { from: sourceWord(group.source) });

/** The import a decided suggestion came in with: its change file, else itself (suggestionGroups's ids). */
const importOf = (suggestion: Suggestion): string => suggestion.changeFileId ?? suggestion.id;

export function SuggestionsTile() {
  const project = useProject((s) => s.project);
  // Keyed by the open file: another file's suggestions never show while this one's are read.
  return project ? <Review key={project.file.path} /> : <p className="sb-label p-3 text-text-muted">{t('review.noProject')}</p>;
}

function Review() {
  const project = useProject((s) => s.project);
  const liveRecords = useProject((s) => s.records);
  const liveSlate = useProject((s) => s.slateNumbers);
  useLocale();
  // While a run goes, the tile holds the records it was started from: 2,000 decisions are 2,000 edits, and reviewing
  // the group after each would cost the run more than the run. It is reviewed once more when the run ends.
  const [held, setHeld] = useState<{ records: Records; slate: SlateNumbers } | null>(null);
  const records = held?.records ?? liveRecords;
  const slate = held?.slate ?? liveSlate;
  const projectId = project?.projectId ?? '';
  const groups = suggestionGroups(records, projectId);
  const waiting = groups.filter((group) => group.pending.length > 0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>('all');
  // The log narrowed to one import: a notification for an import with nothing left to review opens its rows here.
  const [logGroup, setLogGroup] = useState<string | null>(null);
  const [pendingShown, setPendingShown] = useState(WINDOW);
  const [logShown, setLogShown] = useState(WINDOW);
  // One decision or run at a time: a double press never decides twice.
  const busy = useRef(false);
  const isBusy = () => busy.current;
  const [deciding, setDeciding] = useState(false);
  const [run, setRun] = useState<Running | null>(null);
  const running = deciding || run !== null;
  // Where focus goes once React has drawn what a decision changed: set here, moved in the effect below.
  const [focusAsk, setFocusAsk] = useState<number | null>(null);
  // Where a run that stopped in this same file (a reopen after a sync) got to: shown until the next action.
  const [stoppedAt, setStoppedAt] = useState<Running | null>(null);
  // What the live region says: a run's count only every tenth of the way (or every 5 s), never each frame.
  const [announced, setAnnounced] = useState('');
  const tileRef = useRef<HTMLDivElement>(null);
  const reviewHeading = useId();
  const logHeading = useId();

  // A request from Review or a notification: its group's first pending suggestion, or its rows in the log, once.
  const asked = useSuggestionsAsk();
  const [appliedAsk, setAppliedAsk] = useState<typeof asked>(null);
  const askedGroup = asked && asked.projectId === projectId ? (groups.find((g) => g.id === asked.groupId) ?? null) : null;
  if (asked && asked !== appliedAsk) {
    setAppliedAsk(asked);
    if (askedGroup && askedGroup.pending.length > 0) {
      setChosen(askedGroup.pending[0] ?? null);
      setLogGroup(null);
    } else if (askedGroup) {
      setLogGroup(askedGroup.id);
      setFilter('all');
    }
  }
  const askedFirst = askedGroup?.ids[0];
  useEffect(() => {
    if (!asked) return;
    suggestionsFocus.getState().take(projectId);
    if (askedFirst !== undefined) void markImportRead(askedFirst);
  }, [asked, projectId, askedFirst]);

  useEffect(() => {
    if (focusAsk === null) return;
    const root = tileRef.current;
    (root?.querySelector<HTMLElement>('[data-suggestion-detail] [data-review-apply]') ?? root?.querySelector<HTMLElement>('[data-review-empty]'))?.focus();
  }, [focusAsk]);
  const focusAfter = () => {
    setFocusAsk((last) => (last ?? 0) + 1);
  };

  // The suggestion shown: the one chosen while it waits, else the first that does.
  const selectedId = chosen !== null && waiting.some((g) => g.pending.includes(chosen)) ? chosen : (waiting[0]?.pending[0] ?? null);
  const openGroup = waiting.find((g) => selectedId !== null && g.pending.includes(selectedId)) ?? null;
  // Only the open group is reviewed, once per records object (review.ts).
  const reviews = openGroup ? groupReviews(records, projectId, openGroup, slate) : new Map<string, SuggestionReview>();
  const selected = selectedId === null ? null : (reviews.get(selectedId) ?? null);

  /** The next action: where a stopped run got to is no longer news. */
  const acted = () => {
    setStoppedAt(null);
    setAnnounced('');
  };

  /** A group opened from the tile: its notification read too. */
  const choose = (id: string, group: SuggestionGroup) => {
    acted();
    setChosen(id);
    const first = group.ids[0];
    if (first !== undefined) void markImportRead(first);
  };

  /** After a decision: the next pending one after `id` in the file's order (else the one before), focus on its Apply. */
  const moveOn = (id: string, group: SuggestionGroup) => {
    const at = group.pending.indexOf(id);
    const next = group.pending[at + 1] ?? group.pending[at - 1] ?? null;
    setChosen(next);
    focusAfter();
  };

  const decide = async (id: string, how: 'apply' | 'reject', group: SuggestionGroup, targetType: string) => {
    if (busy.current) return;
    busy.current = true;
    acted();
    setDeciding(true);
    try {
      if (how === 'apply') {
        const outcome = await applyOutcome(id);
        // Not written at its turn: said why, in the flag's words; a refused write says nothing over the store's warning.
        const said = applyNotice(outcome, targetType);
        if (said !== null) showInfo(said, outcome.kind === 'done' ? { step: true } : undefined);
        if (outcome.kind === 'done') moveOn(id, group);
      } else if (await rejectOne(id)) {
        showInfo(t('review.rejectedOne'), { step: true });
        moveOn(id, group);
      }
    } finally {
      busy.current = false;
      setDeciding(false);
    }
  };

  const runRest = async (group: SuggestionGroup, how: 'apply' | 'reject') => {
    if (busy.current) return;
    acted();
    // The reviews the run is picked from and confirmed on: at each item's turn, a flag it had here is its own, one it
    // didn't came meanwhile.
    const startedFrom = groupReviews(records, projectId, group, slate);
    const ids = how === 'apply' ? restToApply(group, startedFrom) : restToReject(group);
    if (ids.length === 0) return;
    const lines = restLines(records, ids, startedFrom, LISTED);
    const action = how === 'apply' ? t('review.applyRest') : t('review.rejectRest');
    const answer = await ask({
      title: action,
      text: `${tn(how === 'apply' ? 'review.applyRestText' : 'review.rejectRestText', ids.length)}\n${lines.join('\n')}`,
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'go', label: action, variant: how === 'apply' ? 'primary' : 'warning' },
      ],
      cancel: 'cancel',
    });
    // A decision may have begun while the confirmation was open.
    if (answer !== 'go' || isBusy()) return;
    busy.current = true;
    // Held from the records as they are now, when the answer comes: an edit made while the confirmation was open shows.
    const now = projectStore.getState();
    const startedIn = now.project;
    setHeld({ records: now.records, slate: now.slateNumbers });
    setRun({ how, passed: 0, total: ids.length });
    const runWords = (passed: number) => t(how === 'apply' ? 'review.applying' : 'review.rejecting', { done: formatNumber(passed, 0), total: formatNumber(ids.length, 0) });
    // The visible count moves at most once a frame: a run's thousands of steps never draw the tile thousands of times.
    // What a screen reader hears moves far less: each tenth of the way, or every 5 s, so it is never read over itself.
    const progress = runProgress();
    setAnnounced(runWords(0));
    const onProgress = (n: number) => {
      progress.passed = n;
      progress.frame ??= requestAnimationFrame(() => {
        progress.frame = null;
        setRun((was) => (was ? { ...was, passed: progress.passed } : was));
      });
      const tenth = Math.floor((n * 10) / ids.length);
      const at = performance.now();
      if (tenth > progress.tenth || at - progress.saidAt >= ANNOUNCE_EVERY_MS) {
        progress.tenth = tenth;
        progress.saidAt = at;
        setAnnounced(runWords(n));
      }
      return nextTask();
    };
    let stopped = false;
    try {
      const result = how === 'apply' ? await applyRest(ids, undefined, onProgress, startedFrom) : await rejectRest(ids, undefined, onProgress);
      const said = runNotice(how, result);
      if (said !== null) showInfo(said, { step: result.done > 0 });
      // Stopped, yet this same file is open again (a reopen after a sync keeps the tile): where the run got to stays.
      const open = projectStore.getState().project;
      stopped = result.stopped && open !== null && startedIn !== null && open.file.path === startedIn.file.path;
    } finally {
      if (progress.frame !== null) cancelAnimationFrame(progress.frame);
      busy.current = false;
      setRun(null);
      setHeld(null);
      if (stopped) {
        const at: Running = { how, passed: progress.passed, total: ids.length };
        setStoppedAt(at);
        setAnnounced(stoppedWords(at));
      } else setAnnounced('');
      focusAfter();
    }
  };

  const decided = decidedSuggestions(records, projectId).filter((s) => (filter === 'all' || s.status === filter) && (logGroup === null || importOf(s) === logGroup));
  const logOf = logGroup === null ? null : (groups.find((g) => g.id === logGroup) ?? null);

  return (
    <div ref={tileRef} data-suggestions-tile="" className="flex min-h-full flex-col">
      <section aria-labelledby={reviewHeading} className="flex flex-col border-b border-border">
        <h2 id={reviewHeading} className="sb-label border-b border-border px-3 py-2">
          {t('review.toReview')}
        </h2>
        {/* Mounted while the tile is, empty between runs, so its first words are heard; the line under it is what's seen. */}
        <p role="status" data-review-announced="" className="sr-only">
          {announced}
        </p>
        {(run ?? stoppedAt) && (
          <p aria-hidden="true" data-review-progress="" className="border-b border-border px-3 py-2 text-[13px]">
            {run ? t(run.how === 'apply' ? 'review.applying' : 'review.rejecting', { done: formatNumber(run.passed, 0), total: formatNumber(run.total, 0) }) : stoppedAt ? stoppedWords(stoppedAt) : null}
          </p>
        )}
        {waiting.length === 0 ? (
          <p data-review-empty="" tabIndex={-1} className="p-3 text-[13px] text-text-muted">
            {t('review.nothingToReview')}
          </p>
        ) : (
          waiting.map((group) => (
            <GroupView
              key={group.id}
              group={group}
              records={records}
              open={group === openGroup}
              reviews={group === openGroup ? reviews : null}
              selected={group === openGroup ? selected : null}
              running={running}
              shown={pendingShown}
              onShowMore={() => {
                setPendingShown((n) => n + WINDOW);
              }}
              onChoose={(id, keyboard) => {
                choose(id, group);
                if (keyboard) focusAfter();
              }}
              onDecide={(id, how, targetType) => void decide(id, how, group, targetType)}
              onRest={(how) => void runRest(group, how)}
            />
          ))
        )}
      </section>
      <section aria-labelledby={logHeading} className="flex flex-col">
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
          <h2 id={logHeading} className="sb-label pb-1">
            {t('review.applied')}
          </h2>
          <SegmentedControl<LogFilter>
            label={t('review.logShow')}
            options={[
              { value: 'all', label: t('review.logAll') },
              { value: 'approved', label: t('review.logApplied') },
              { value: 'rejected', label: t('review.logRejected') },
            ]}
            value={filter}
            onChange={setFilter}
          />
          {logOf && (
            <div className="flex w-full flex-wrap items-center gap-2">
              <p data-review-log-group={logOf.id} tabIndex={-1} className="min-w-0 flex-1 text-[13px]">
                <bdi className="wrap-anywhere">{t('review.logOfGroup', { from: groupFrom(logOf) })}</bdi>
              </p>
              <Button
                onClick={() => {
                  setLogGroup(null);
                }}
              >
                {t('review.logEvery')}
              </Button>
            </div>
          )}
        </div>
        {decided.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('review.logNone')}</p>
        ) : (
          <ol aria-label={t('review.logList')} className="flex flex-col">
            {decided.slice(0, logShown).map((suggestion) => (
              <LogRow key={suggestion.id} suggestion={suggestion} records={records} />
            ))}
          </ol>
        )}
        {decided.length > logShown && (
          <div className="p-3">
            <Button
              onClick={() => {
                setLogShown((n) => n + WINDOW);
              }}
            >
              {t('review.showMore')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

interface GroupViewProps {
  group: SuggestionGroup;
  records: Records;
  open: boolean;
  reviews: ReadonlyMap<string, SuggestionReview> | null;
  selected: SuggestionReview | null;
  running: boolean;
  /** How many of its pending rows are drawn (a window: Show more draws the next). */
  shown: number;
  onShowMore: () => void;
  /** `keyboard`: chosen with Enter, so focus goes on to its Apply. */
  onChoose: (id: string, keyboard: boolean) => void;
  onDecide: (id: string, how: 'apply' | 'reject', targetType: string) => void;
  onRest: (how: 'apply' | 'reject') => void;
}

/** "Brought in 21 Nov, 10:02 · 6 of 6 to review": the time and the numbers in mono, the words not. */
function groupLine(group: SuggestionGroup): Line {
  const when = localDateTime(new Date(group.broughtInAt));
  const count = line(pluralKey('review.groupCount', group.pending.length), {
    count: { mono: formatNumber(group.pending.length, 0) },
    total: { mono: formatNumber(group.ids.length, 0) },
  });
  return when === '' ? count : [...line('review.broughtIn', { when: { mono: when } }), ' · ', ...count];
}

/** A closed import's Review, named by who it's from and when it came in: two imports from one person read apart. */
function openGroupName(group: SuggestionGroup, from: string): string {
  const when = localDateTime(new Date(group.broughtInAt));
  return when === '' ? t('review.openGroup', { from }) : t('review.openGroupAt', { from, when });
}

function GroupView({ group, records, open, reviews, selected, running, shown, onShowMore, onChoose, onDecide, onRest }: GroupViewProps) {
  const headingId = useId();
  const restHintId = useId();
  const from = groupFrom(group);
  const rest = reviews ? restToApply(group, reviews) : [];
  // The window, stretched to the one shown when a decision moved past it.
  const selectedAt = selected ? group.pending.indexOf(selected.suggestion.id) : -1;
  const drawn = Math.max(shown, selectedAt + 1);
  return (
    <section data-suggestion-group={group.id} aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <h3 id={headingId} className="min-w-0 flex-1 text-[13px] font-bold">
          <bdi className="wrap-anywhere">{groupHeading(group)}</bdi>
          <span className="block text-[11px] font-normal">
            <LineText line={groupLine(group)} />
          </span>
        </h3>
        {open ? (
          <>
            {/* aria-disabled, never disabled: focus stays on the button pressed while its run goes. */}
            <Button
              aria-disabled={running || rest.length === 0 ? 'true' : undefined}
              aria-describedby={rest.length === 0 ? restHintId : undefined}
              onClick={() => {
                if (!running && rest.length > 0) onRest('apply');
              }}
            >
              {t('review.applyRest')}
            </Button>
            <Button
              variant="warning"
              aria-disabled={running ? 'true' : undefined}
              onClick={() => {
                if (!running) onRest('reject');
              }}
            >
              {t('review.rejectRest')}
            </Button>
            {rest.length === 0 && (
              <p id={restHintId} className="w-full text-[12px] text-text-muted">
                {t('review.applyRestNone')}
              </p>
            )}
          </>
        ) : (
          <Button
            data-suggestion-item=""
            aria-label={openGroupName(group, from)}
            onClick={() => {
              const first = group.pending[0];
              if (first !== undefined) onChoose(first, false);
            }}
          >
            {t('review.open')}
          </Button>
        )}
      </div>
      {open && reviews && (
        <>
          <ol aria-label={t('review.listOf', { from })} className="flex flex-col">
            {group.pending.slice(0, drawn).map((id) => {
              const review = reviews.get(id);
              if (!review) return null;
              const isSelected = selected?.suggestion.id === id;
              const changed = review.flags.some((flag) => flag.kind === 'changed_since');
              const mark = !review.canApply ? t('review.markHeld') : changed ? t('review.markChanged') : null;
              const what = headline(records, review.suggestion);
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-suggestion-item={id}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => {
                      onChoose(id, false);
                    }}
                    onKeyDown={(event) => {
                      // Enter goes on to the suggestion's Apply; a click or Space only shows it.
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      onChoose(id, true);
                    }}
                    className={cx(
                      'flex w-full items-start gap-2 border-t border-border px-3 py-1.5 text-left text-[13px] focus-visible:-outline-offset-2',
                      isSelected ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <LineText line={what} />
                      {/* The mark said apart from the line: "Change SC 01 · 1A, Changed". Inline and unseen, never hidden from
                          speech: an sr-only box (absolute, so a block) would be read "1A , Changed", and a label of its
                          own would no longer hold the row's visible words. */}
                      {mark !== null && <span className="opacity-0">{t('list.separator')}</span>}
                    </span>
                    {mark !== null && <span className="sb-label shrink-0 pt-0.5">{mark}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          {group.pending.length > drawn && (
            <div className="border-t border-border p-3">
              <Button onClick={onShowMore}>{t('review.showMore')}</Button>
            </div>
          )}
          {selected && <Detail key={selected.suggestion.id} review={selected} records={records} running={running} onDecide={onDecide} />}
        </>
      )}
    </section>
  );
}

function Values({ rows }: { rows: readonly { label: string; parts: readonly { head: string; value: Part }[] }[] }) {
  return (
    <dl className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="sb-label">{row.label}</dt>
          {row.parts.map((part, j) => (
            <dd key={j} className="flex gap-2 text-[13px]">
              <span className="w-24 shrink-0 text-text-muted">{part.head}</span>
              <span className="min-w-0 flex-1">
                <PartText part={part.value} />
              </span>
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

function Detail({ review, records, running, onDecide }: { review: SuggestionReview; records: Records; running: boolean; onDecide: (id: string, how: 'apply' | 'reject', targetType: string) => void }) {
  const { suggestion } = review;
  const reasonId = useId();
  const target = showTarget(records, suggestion);
  const flags = review.flags.map((flag) => reviewFlagWords(flag, suggestion.targetType)).filter((words) => words !== '');
  const blocked = !review.canApply;
  const suggestedAt = suggestion.suggestedAt ? localDateTime(new Date(suggestion.suggestedAt)) : '';
  const places = reorderPlaces(records, suggestion);
  const takes = trashTakes(records, suggestion);
  return (
    <div data-suggestion-detail={suggestion.id} className="flex flex-col gap-3 border-t border-border p-3">
      <h4 className="text-[14px] font-bold">
        <LineText line={headline(records, suggestion)} />
      </h4>
      <p className="font-mono text-[11px]">
        <bdi className="font-sans wrap-anywhere">{t('review.suggestedBy', { name: authorName(suggestion) })}</bdi>
        {suggestedAt !== '' && ` · ${suggestedAt}`}
      </p>
      {suggestion.note !== '' && (
        <blockquote className="border-l-[1.5px] border-text pl-2 text-[13px] whitespace-pre-wrap wrap-anywhere">
          <span className="sr-only">{t('review.note')} </span>
          {suggestion.note}
        </blockquote>
      )}
      {suggestion.data?.kind === 'update' && (
        <Values
          rows={updateRows(records, review).map((row) => ({
            label: row.label,
            parts: row.then
              ? [
                  { head: t('review.then'), value: row.then },
                  { head: t('review.suggested'), value: row.suggested },
                  { head: t('review.now'), value: row.now },
                ]
              : [
                  { head: t('review.now'), value: row.now },
                  { head: t('review.suggested'), value: row.suggested },
                ],
          }))}
        />
      )}
      {suggestion.data?.kind === 'create' && createRows(records, suggestion).length > 0 && (
        <Values rows={createRows(records, suggestion).map((row) => ({ label: row.label, parts: [{ head: t('review.suggested'), value: row.value }] }))} />
      )}
      {places && (
        <Values
          rows={[
            {
              label: t('review.place'),
              parts: [
                { head: t('review.from'), value: plainPart(places.from) },
                { head: t('review.to'), value: plainPart(places.to) },
              ],
            },
          ]}
        />
      )}
      {takes !== null && <p className="text-[13px]">{takes}</p>}
      {flags.length > 0 && (
        <ul aria-label={t('review.flags')} className="flex flex-col gap-1">
          {flags.map((words, i) => (
            <li key={i} className="flex gap-2 text-[13px]">
              <span aria-hidden="true">■</span>
              <span>{words}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-review-apply=""
          variant="primary"
          aria-disabled={blocked || running ? 'true' : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => {
            if (!blocked && !running) onDecide(suggestion.id, 'apply', suggestion.targetType);
          }}
        >
          {t('review.apply')}
        </Button>
        <Button
          aria-disabled={running ? 'true' : undefined}
          onClick={() => {
            if (!running) onDecide(suggestion.id, 'reject', suggestion.targetType);
          }}
        >
          {t('review.reject')}
        </Button>
        {target && (
          <Button
            variant="ghost"
            onClick={() => {
              show(target);
            }}
          >
            <LineText line={showLine(target.label)} />
          </Button>
        )}
      </div>
      {blocked && (
        <p id={reasonId} className="text-[12px] text-text-muted">
          {t('review.cantApplyWhy', { why: flags[0] ?? t('review.cantApplyAny') })}
        </p>
      )}
    </div>
  );
}

/** "Show 4B". */
function showLine(label: Line): Line {
  const words = t('review.show', { item: '\u0000' }).split('\u0000');
  return [words[0] ?? '', ...label, words[1] ?? ''].filter((part) => part !== '');
}

const plainPart = (parts: Line): Part => (parts.length === 1 && parts[0] !== undefined ? parts[0] : plain(parts));

function LogRow({ suggestion, records }: { suggestion: Suggestion; records: Records }) {
  const target = showTarget(records, suggestion);
  const when = suggestion.decidedAt ? localDateTime(new Date(suggestion.decidedAt)) : '';
  return (
    <li className="flex flex-wrap items-start gap-2 border-b border-border px-3 py-2 text-[13px]">
      <span className="sb-label shrink-0 pt-0.5">{suggestion.status === 'approved' ? t('review.statusApplied') : t('review.statusRejected')}</span>
      <span className="min-w-0 flex-1">
        <span className="block">
          <LineText line={headline(records, suggestion)} />
        </span>
        <span className="block font-mono text-[11px]">
          {suggestion.decidedBy !== '' && (
            <>
              <bdi className="font-sans wrap-anywhere">{suggestion.decidedBy}</bdi>
              {' · '}
            </>
          )}
          {when}
        </span>
      </span>
      {target && (
        <Button
          variant="ghost"
          onClick={() => {
            show(target);
          }}
        >
          <LineText line={showLine(target.label)} />
        </Button>
      )}
    </li>
  );
}

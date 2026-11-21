import { useEffect, useId, useRef, useState } from 'react';
import { ask } from '../../app/ask';
import { localDateTime } from '../../app/format';
import { showInfo } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { workspaceStore } from '../../app/shell/workspaceStore';
import { list, t, tn } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { reviewFlagWords, type Suggestion, type SuggestionReview } from '../../core/model/suggestion';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useLocale } from '../../ui/useLocale';
import { LineText } from '../history/LineText';
import type { Line, Part } from '../history/summary';
import { openShootDay } from '../schedule/shownDay';
import { selectionStore } from '../storyboard/selection';
import { applyOne, applyRest, rejectOne, rejectRest } from './decide';
import {
  authorName,
  createRows,
  decidedSuggestions,
  groupReviews,
  headline,
  plain,
  reorderPlaces,
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

const PartText = ({ part }: { part: Part }) => (typeof part === 'string' ? <span className="whitespace-pre-wrap wrap-anywhere">{part}</span> : <span className="font-mono">{part.mono}</span>);

function show(target: ShowTarget): void {
  if (target.kind === 'shot') selectionStore.getState().selectShot(target.shotId, target.sceneId);
  else if (target.kind === 'scene') selectionStore.getState().selectScene(target.sceneId);
  else openShootDay(workspaceStore.getState().active, target.dayId);
}

/** The group's heading: who it's from (the authors' names, else the source), as text. */
const groupFrom = (group: SuggestionGroup): string => (group.authors.length > 0 ? list(group.authors) : sourceWord(group.source));

export function SuggestionsTile() {
  const project = useProject((s) => s.project);
  // Keyed by the open file: another file's suggestions never show while this one's are read.
  return project ? <Review key={project.file.path} /> : <p className="sb-label p-3 text-text-muted">{t('review.noProject')}</p>;
}

function Review() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const slate = useProject((s) => s.slateNumbers);
  useLocale();
  const projectId = project?.projectId ?? '';
  const groups = suggestionGroups(records, projectId);
  const waiting = groups.filter((group) => group.pending.length > 0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>('all');
  // One decision or run at a time: a double press never decides twice.
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);
  const reviewHeading = useId();
  const logHeading = useId();

  // A request from Review or a notification: its group's first pending suggestion, once.
  const asked = useSuggestionsAsk();
  const [appliedAsk, setAppliedAsk] = useState<typeof asked>(null);
  if (asked && asked !== appliedAsk) {
    setAppliedAsk(asked);
    const group = asked.projectId === projectId ? groups.find((g) => g.id === asked.groupId) : undefined;
    if (group) setChosen(group.pending[0] ?? null);
  }
  useEffect(() => {
    if (asked) suggestionsFocus.getState().take(projectId);
  }, [asked, projectId]);

  // The suggestion shown: the one chosen while it waits, else the first that does.
  const selectedId = chosen !== null && waiting.some((g) => g.pending.includes(chosen)) ? chosen : (waiting[0]?.pending[0] ?? null);
  const openGroup = waiting.find((g) => selectedId !== null && g.pending.includes(selectedId)) ?? null;
  // Only the open group is reviewed, once per records object (review.ts).
  const reviews = openGroup ? groupReviews(records, projectId, openGroup, slate) : new Map<string, SuggestionReview>();
  const selected = selectedId === null ? null : (reviews.get(selectedId) ?? null);

  /** After a decision: the next pending one after `id` in the file's order (else the one before), with focus on its Apply. */
  const moveOn = (id: string, group: SuggestionGroup) => {
    const at = group.pending.indexOf(id);
    const next = group.pending[at + 1] ?? group.pending[at - 1] ?? null;
    setChosen(next);
    requestAnimationFrame(() => {
      const root = tileRef.current;
      (root?.querySelector<HTMLElement>('[data-review-apply]') ?? root?.querySelector<HTMLElement>('[data-review-empty]'))?.focus();
    });
  };

  const decide = async (id: string, how: 'apply' | 'reject', group: SuggestionGroup) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    try {
      const done = how === 'apply' ? await applyOne(id) : await rejectOne(id);
      if (done) {
        showInfo(t(how === 'apply' ? 'review.appliedOne' : 'review.rejectedOne'), { step: true });
        moveOn(id, group);
      }
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const runRest = async (group: SuggestionGroup, how: 'apply' | 'reject') => {
    if (busy.current) return;
    const ids = how === 'apply' ? restToApply(group, groupReviews(records, projectId, group, slate)) : restToReject(group);
    if (ids.length === 0) return;
    const lines = ids.slice(0, LISTED).map((id) => {
      const review = reviews.get(id);
      return `• ${review ? plain(headline(records, review.suggestion)) : ''}`;
    });
    if (ids.length > LISTED) lines.push(tn('review.andMore', ids.length - LISTED));
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
    if (answer !== 'go') return;
    busy.current = true;
    setRunning(true);
    try {
      const result = how === 'apply' ? await applyRest(ids) : await rejectRest(ids);
      const said = tn(how === 'apply' ? 'review.appliedRest' : 'review.rejectedRest', result.done);
      showInfo(result.skipped > 0 ? `${said} ${tn('review.skipped', result.skipped)}` : said, { step: result.done > 0 });
      requestAnimationFrame(() => {
        const root = tileRef.current;
        (root?.querySelector<HTMLElement>('[data-review-apply]') ?? root?.querySelector<HTMLElement>('[data-review-empty]'))?.focus();
      });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const decided = decidedSuggestions(records, projectId).filter((s) => filter === 'all' || s.status === filter);

  return (
    <div ref={tileRef} data-suggestions-tile="" className="flex min-h-full flex-col">
      <section aria-labelledby={reviewHeading} className="flex flex-col border-b border-border">
        <h2 id={reviewHeading} className="sb-label border-b border-border px-3 py-2">
          {t('review.toReview')}
        </h2>
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
              onChoose={setChosen}
              onDecide={(id, how) => void decide(id, how, group)}
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
        </div>
        {decided.length === 0 ? (
          <p className="p-3 text-[13px] text-text-muted">{t('review.logNone')}</p>
        ) : (
          <ol aria-label={t('review.logList')} className="flex flex-col">
            {decided.map((suggestion) => (
              <LogRow key={suggestion.id} suggestion={suggestion} records={records} />
            ))}
          </ol>
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
  onChoose: (id: string) => void;
  onDecide: (id: string, how: 'apply' | 'reject') => void;
  onRest: (how: 'apply' | 'reject') => void;
}

function GroupView({ group, records, open, reviews, selected, running, onChoose, onDecide, onRest }: GroupViewProps) {
  const headingId = useId();
  const restHintId = useId();
  const from = groupFrom(group);
  const rest = reviews ? restToApply(group, reviews) : [];
  const when = localDateTime(new Date(group.broughtInAt));
  return (
    <section data-suggestion-group={group.id} aria-labelledby={headingId} className="border-b border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <h3 id={headingId} className="min-w-0 flex-1 text-[13px] font-bold">
          <bdi className="wrap-anywhere">{t('review.groupFrom', { from })}</bdi>
          <span className="block font-mono text-[11px] font-normal">
            {when !== '' && `${t('review.broughtIn', { when })} · `}
            {tn('review.groupCount', group.pending.length, { total: group.ids.length })}
          </span>
        </h3>
        {open ? (
          <>
            <Button
              disabled={running || rest.length === 0}
              aria-describedby={rest.length === 0 ? restHintId : undefined}
              onClick={() => {
                onRest('apply');
              }}
            >
              {t('review.applyRest')}
            </Button>
            <Button
              variant="warning"
              disabled={running}
              onClick={() => {
                onRest('reject');
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
            onClick={() => {
              const first = group.pending[0];
              if (first !== undefined) onChoose(first);
            }}
          >
            {t('review.open')}
          </Button>
        )}
      </div>
      {open && reviews && (
        <>
          <ol aria-label={t('review.listOf', { from })} className="flex flex-col">
            {group.pending.map((id) => {
              const review = reviews.get(id);
              if (!review) return null;
              const isSelected = selected?.suggestion.id === id;
              const changed = review.flags.some((flag) => flag.kind === 'changed_since');
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-suggestion-item={id}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => {
                      onChoose(id);
                    }}
                    className={cx(
                      'flex w-full items-start gap-2 border-t border-border px-3 py-1.5 text-left text-[13px] focus-visible:-outline-offset-2',
                      isSelected ? 'bg-text text-text-inverse' : 'hover:bg-surface-raised',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <LineText line={headline(records, review.suggestion)} />
                    </span>
                    {(!review.canApply || changed) && (
                      <span className="sb-label shrink-0 pt-0.5">{!review.canApply ? t('review.markHeld') : t('review.markChanged')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
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

function Detail({ review, records, running, onDecide }: { review: SuggestionReview; records: Records; running: boolean; onDecide: (id: string, how: 'apply' | 'reject') => void }) {
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
            if (!blocked && !running) onDecide(suggestion.id, 'apply');
          }}
        >
          {t('review.apply')}
        </Button>
        <Button
          aria-disabled={running ? 'true' : undefined}
          onClick={() => {
            if (!running) onDecide(suggestion.id, 'reject');
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

import { useContext } from 'react';
import { labels, list, t, tn, type PluralBase } from '../../core/i18n';
import {
  DEPARTMENT_STATE_LABELS,
  departmentName,
  departmentStates,
  stateCounts,
  type FrameState,
  type DepartmentStatuses,
} from '../../core/model/departmentStatus';
import { DepartmentStateGlyph } from '../../ui/glyphs';
import { FocusContext, type Focus } from '../department/perspective';

// Department status at a glance (polish 6b): on a frame card, how many departments are in each state; in the shot
// list, each department with its shapes. The shapes are hidden from screen readers, which hear the same in words.

/** A state as a sentence names it: "2 working on it". */
const IN_SENTENCE: Readonly<Record<FrameState, string>> = labels({
  priority: 'departmentState.inSentence.priority',
  seen: 'departmentState.inSentence.seen',
  working: 'departmentState.inSentence.working',
  done: 'departmentState.inSentence.done',
});

/** "2 priority", "1 seen": counted, so a language can agree the word with the number. */
const COUNTED: Readonly<Record<FrameState, PluralBase>> = {
  priority: 'departmentSummary.priority',
  seen: 'departmentSummary.seen',
  working: 'departmentSummary.working',
  done: 'departmentSummary.done',
};

/**
 * "Departments: 2 priority, 1 seen and 1 done", or null with nothing set. In a focus view (3.6c), your departments'
 * alone: "Your departments: 1 done".
 */
export function summaryText(statuses: DepartmentStatuses, seen: readonly string[], focus: Focus = null): string | null {
  const counts = stateCounts(statuses, seen, focus ?? undefined);
  if (counts.length === 0) return null;
  const states = list(counts.map(({ state, count }) => tn(COUNTED[state], count)));
  return focus ? t('departmentSummary.labelYours', { states }) : t('departmentSummary.label', { states });
}

/**
 * A frame card's line: a shape and a count per state, in a line of its own height whether or not there's anything
 * to show, so a card never grows when Seen lands and the board never moves under the pointer. The words are the
 * card's description (`descriptionId`), not part of its name, so a screen reader doesn't read the card again then.
 */
export function DepartmentCounts({ statuses, seen, descriptionId }: { statuses: DepartmentStatuses; seen: readonly string[]; descriptionId: string }) {
  const focus = useContext(FocusContext);
  const text = summaryText(statuses, seen, focus);
  return (
    <span className="flex h-4 items-center gap-2 px-2 pb-1.5 box-content">
      {text !== null && (
        <>
          <span aria-hidden="true" className="flex items-center gap-2">
            {stateCounts(statuses, seen, focus ?? undefined).map(({ state, count }) => (
              <span key={state} title={DEPARTMENT_STATE_LABELS[state]} className="flex items-center gap-0.5 font-mono text-[10px]">
                <DepartmentStateGlyph state={state} size={10} />
                {count}
              </span>
            ))}
          </span>
          <span id={descriptionId} hidden>
            {text}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The shot list's Departments cell: each department with anything set or seen, Priority first, with its shapes. In a
 * focus view (3.6c), your departments, and how many of the rest have anything, as Rest of crew.
 */
export function DepartmentStates({ statuses, seen, selected = false }: { statuses: DepartmentStatuses; seen: readonly string[]; selected?: boolean }) {
  const focus = useContext(FocusContext);
  const rows = departmentStates(statuses, seen, focus ?? undefined);
  const rest = focus ? departmentStates(statuses, seen).length - rows.length : 0;
  if (rows.length === 0 && rest === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {rows.length === 0 && <span>—</span>}
      {rows.map(({ department, states }) => (
        <span key={department} className="flex items-center gap-1 whitespace-nowrap">
          {departmentName(department)}
          <span aria-hidden="true" className="flex items-center gap-0.5">
            {states.map((state) => (
              <DepartmentStateGlyph key={state} state={state} size={10} />
            ))}
          </span>
          <span className="sr-only">{t('departmentSummary.states', { states: list(states.map((state) => IN_SENTENCE[state])) })}</span>
        </span>
      ))}
      {/* Muted never sits on the selected row's fill (DESIGN.md): ink there. */}
      {rest > 0 && <span className={selected ? 'whitespace-nowrap' : 'whitespace-nowrap text-text-muted'}>{tn('restOfCrew.inList', rest)}</span>}
    </span>
  );
}

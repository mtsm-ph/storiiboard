import { useId, type ReactNode } from 'react';
import { t, tn } from '../../core/i18n';
import type { Department } from '../../core/model/department';
import { setRestOfCrewOpen, splitByFocus, useRestOfCrewOpen, type Focus, type Fold } from './perspective';

// A department list in the focus view (3.6c): your departments, then Rest of crew, folded, one click (or Enter) to
// open. In the full view, or when there's nothing to fold, the list as it always was. The fold stays open for the
// session, so moving to the next frame keeps what you chose.

interface RestOfCrewProps {
  fold: Fold;
  /** Every department to show, in order. */
  departments: readonly Department[];
  focus: Focus;
  /** One part of the list: `rest` is under Rest of crew; `last` is the part shown last, for a legend or a note. */
  render: (departments: readonly Department[], part: 'all' | 'mine' | 'rest', last: boolean) => ReactNode;
}

export function RestOfCrew({ fold, departments, focus, render }: RestOfCrewProps) {
  const open = useRestOfCrewOpen(fold);
  const id = useId();
  const split = splitByFocus(departments, focus);
  if (!split) return <>{render(departments, 'all', true)}</>;
  return (
    <div className="flex flex-col gap-2">
      {render(split.mine, 'mine', !open)}
      <button
        type="button"
        aria-expanded={open}
        // Pointing at the rest only while it's there: closed, it isn't drawn at all. Focus stays on the button either
        // way, and the next Tab goes into the grid it opened.
        aria-controls={open ? id : undefined}
        data-rest-of-crew={fold}
        onClick={() => {
          setRestOfCrewOpen(fold, !open);
        }}
        className="flex items-center gap-2 self-start border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold hover:bg-surface-raised"
      >
        <span aria-hidden="true" className="font-mono">
          {open ? '−' : '+'}
        </span>
        {t('restOfCrew.title')}
        <span className="font-mono font-normal">{tn('restOfCrew.count', split.rest.length)}</span>
      </button>
      <div id={id} hidden={!open}>
        {open && render(split.rest, 'rest', true)}
      </div>
    </div>
  );
}

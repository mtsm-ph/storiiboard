import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { LineText } from '../../features/history/LineText';
import { lineText, type Line } from '../../features/history/summary';
import { TOP_BAR_ICONS } from '../../ui/topBarIcons/topBarIcons';
import { cx } from '../../ui/cx';
import { Trans } from '../../ui/Trans';
import { useLocale } from '../../ui/useLocale';
import { usePlanUnit } from '../planUnits';
import { useProject } from '../projectStore';
import { stepButtonName, stepKeys } from './undoRedoNames';
import { commitTyping, takeStep } from './undoRedoPress';
import { readStepLines, shownLines, type ReadFor, type StepLinesRead } from './undoRedoRead';
import { t } from '../../core/i18n';

// The top bar's Undo and Redo (item 8, Kevin Nov 17 and 18): exactly ⌘Z and ⌘⇧Z, so project edits only (a layout
// change stays in the Layout menu), each named by the step it would take, in History's own words. Read again after
// every edit, undo, redo and switch (each changes the records or the project), never on a timer; a read names only
// the state it was read for (undoRedoRead.ts).

export function UndoRedoButtons({ mac }: { mac: boolean }) {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  const canRedo = useProject((s) => s.canRedo);
  // Empty Trash and Clean up change no record, but a step's line may then read "(picture removed)".
  const deletedForGood = useProject((s) => s.deletedForGood);
  // The lines are worked out in the words and the plan unit of the moment.
  const locale = useLocale();
  const unit = usePlanUnit();
  const [read, setRead] = useState<StepLinesRead | null>(null);
  const file = project?.file ?? null;

  useEffect(() => {
    if (!file) return;
    let live = true;
    void readStepLines({ file, records, deletedForGood, locale, unit }).then((done) => {
      if (live && done) setRead(done);
    });
    return () => {
      live = false;
    };
  }, [file, records, deletedForGood, locale, unit]);

  if (!file) return null;
  const now: ReadFor = { file, records, deletedForGood, locale, unit };
  const lines = shownLines(read, now, { canUndo, canRedo });
  return (
    <>
      <StepButton which="undo" line={lines.undo} mac={mac} />
      <StepButton which="redo" line={lines.redo} mac={mac} />
    </>
  );
}

/** "Undo: Moved 4A to after 3C" with the numbers in mono, as History draws the line; or "Nothing to undo". */
function StepName({ which, line }: { which: 'undo' | 'redo'; line: Line | null }) {
  if (line === null) return <>{t(which === 'undo' ? 'topBar.nothingToUndo' : 'topBar.nothingToRedo')}</>;
  return <Trans k={which === 'undo' ? 'topBar.undoStep' : 'topBar.redoStep'} parts={{ step: <LineText line={line} /> }} />;
}

function StepButton({ which, line, mac }: { which: 'undo' | 'redo'; line: Line | null; mac: boolean }) {
  const name = stepButtonName(which, line === null ? null : lineText(line), mac);
  const [tip, setTip] = useState(false);
  // The press began by committing a field being typed in: its edit is then the newest step, so the click takes it even
  // where the button said there was nothing to take a moment ago (undoRedoPress.ts).
  const committed = useRef(false);
  // Escape hides the tip wherever the focus is (a tip opened by hover has the focus elsewhere), as the Saved sign's and
  // the tool strip's do (WCAG 1.4.13); the key keeps its own meaning there.
  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [tip]);
  return (
    <div className="relative h-full shrink-0">
      <button
        type="button"
        data-step-button={which}
        aria-label={name.label}
        aria-keyshortcuts={name.keys}
        // aria-disabled, never disabled: focus can still land on it and read "Nothing to undo".
        aria-disabled={name.enabled ? undefined : true}
        onPointerDown={() => {
          committed.current = commitTyping();
        }}
        onClick={() => {
          const typed = committed.current;
          committed.current = false;
          takeStep(which, name.enabled || typed);
        }}
        onPointerEnter={() => {
          setTip(true);
        }}
        onPointerLeave={() => {
          // A press that ended elsewhere made no click: its commit is not this button's to act on later.
          committed.current = false;
          setTip(false);
        }}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          // Keyboard focus only: a click's focus already has the pointer over it.
          if (event.currentTarget.matches(':focus-visible')) setTip(true);
        }}
        onBlur={() => {
          setTip(false);
        }}
        onKeyDown={(event) => {
          // With the focus here, Escape puts the tip away and goes no further.
          if (event.key === 'Escape' && tip) {
            event.stopPropagation();
            setTip(false);
          }
        }}
        className={cx(
          'flex h-full w-topbar items-center justify-center border-l border-border-top focus-visible:-outline-offset-4',
          name.enabled ? 'text-text hover:bg-surface-raised' : 'text-text-muted',
        )}
      >
        {/* The app's own SVG, bundled at build time (topBarIcons.ts), never anything a person typed or opened. */}
        <span aria-hidden="true" className="pointer-events-none block size-5 [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: TOP_BAR_ICONS[which] ?? '' }} />
      </button>
      {tip && (
        <span
          aria-hidden="true"
          data-step-tip={which}
          className="pointer-events-none absolute top-full right-0 z-50 mt-1 border-[1.5px] border-text bg-surface px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-text"
        >
          <Trans k="topBar.withKeys" parts={{ name: <StepName which={which} line={line} />, keys: <span className="font-mono">{stepKeys(which, mac)}</span> }} />
        </span>
      )}
    </div>
  );
}

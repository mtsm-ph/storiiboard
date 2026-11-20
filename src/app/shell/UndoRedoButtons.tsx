import { useEffect, useState, type FocusEvent } from 'react';
import { undoRedoLines, type UndoRedoLines } from '../../features/history/steps';
import { lineText } from '../../features/history/summary';
import type { ProjectFile } from '../../core/storage/driver';
import { cx } from '../../ui/cx';
import { TOP_BAR_ICONS } from '../../ui/topBarIcons/topBarIcons';
import { useLocale } from '../../ui/useLocale';
import { showNotice } from '../notice';
import { usePlanUnit } from '../planUnits';
import { projectStore, useProject } from '../projectStore';
import { stepButtonName } from './undoRedoNames';
import { t } from '../../core/i18n';

// The top bar's Undo and Redo (item 8, Kevin Nov 17 and 18): exactly ⌘Z and ⌘⇧Z, so project edits only (a layout
// change stays in the Layout menu), each named by the step it would take, in History's own words. Read again after
// every edit, undo, redo and switch (each changes the records or the project), never on a timer.

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
  // Kept with the file they were read from: another project's lines never name this one's steps.
  const [read, setRead] = useState<{ file: ProjectFile; lines: UndoRedoLines } | null>(null);

  useEffect(() => {
    if (!project) return;
    let live = true;
    const file = project.file;
    undoRedoLines(file, unit)
      .then((lines) => {
        if (live) setRead({ file, lines });
      })
      .catch((error: unknown) => {
        if (live) showNotice(error);
      });
    return () => {
      live = false;
    };
  }, [project, records, canUndo, canRedo, deletedForGood, locale, unit]);

  if (!project) return null;
  const lines = read?.file === project.file ? read.lines : null;
  // The store says at once whether there's a step to take; its line follows when read (until then, "a step").
  const step = (can: boolean, line: UndoRedoLines['undo'] | undefined) => (can ? (line ? lineText(line) : t('history.aStep')) : null);
  return (
    <>
      <StepButton icon="undo" name={stepButtonName('undo', step(canUndo, lines?.undo), mac)} run={() => projectStore.getState().undo()} />
      <StepButton icon="redo" name={stepButtonName('redo', step(canRedo, lines?.redo), mac)} run={() => projectStore.getState().redo()} />
    </>
  );
}

function StepButton({ icon, name, run }: { icon: string; name: ReturnType<typeof stepButtonName>; run: () => Promise<void> }) {
  const [tip, setTip] = useState(false);
  return (
    <div className="relative h-full shrink-0">
      <button
        type="button"
        data-step-button={icon}
        aria-label={name.label}
        aria-keyshortcuts={name.keys}
        // aria-disabled, never disabled: focus can still land on it and read "Nothing to undo".
        aria-disabled={name.enabled ? undefined : true}
        onClick={() => {
          if (name.enabled) void run();
        }}
        onPointerEnter={() => {
          setTip(true);
        }}
        onPointerLeave={() => {
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
          // A tip shown on focus can be put away without moving focus (WCAG 1.4.13).
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
        <span aria-hidden="true" className="pointer-events-none block size-5 [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: TOP_BAR_ICONS[icon] ?? '' }} />
      </button>
      {tip && (
        <span
          aria-hidden="true"
          data-step-tip={icon}
          className="pointer-events-none absolute top-full right-0 z-50 mt-1 border-[1.5px] border-text bg-surface px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-text"
        >
          {name.tip}
        </span>
      )}
    </div>
  );
}

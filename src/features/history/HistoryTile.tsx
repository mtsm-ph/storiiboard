import { useEffect, useId, useRef, useState } from 'react';
import { confirmForGood } from '../../app/confirm';
import { localDateTime } from '../../app/format';
import { useOpeningVersion } from '../../app/openingVersion';
import { openVersion } from '../../app/projects/actions';
import { showInfo, showNotice } from '../../app/notice';
import { isMac } from '../../app/shell/undoShortcuts';
import { projectStore, useProject } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { LoggedOp, OpGroup } from '../../core/ops/ops';
import { versionName, type NamedVersion } from '../../core/storage/versions';
import { Button } from '../../ui/Button';
import { TextField, Toggle } from '../../ui/fields';
import { useSelection } from '../storyboard/selection';
import { dayDateLabel, shootDayFields } from '../../core/model/shootDay';
import { DayHistory } from './DayHistory';
import { useHistoryDay } from './historyDay';
import { ItemHistory } from './ItemHistory';
import { LineText } from './LineText';
import { putBackProblem, putBackStep } from './putBack';
import { broughtBackNotice, loadSteps, moreItemLog, PAGE, readItemLog, restoreNotice, type ItemLog, type Steps } from './steps';
import { lineText, namedById, who, type FieldChange } from './summary';
import { nameThisPoint, removeNamedVersion } from './versionWrites';
import { createWriteGate } from './writeGate';
import { t, type MessageKey } from '../../core/i18n';
import { Trans } from '../../ui/Trans';
import { useLocale } from '../../ui/useLocale';
import { usePlanUnit } from '../../app/planUnits';
import { settledThrough, useUndoSettle } from '../../app/undoSettle';
import { shownRun } from './undone';
import { cx } from '../../ui/cx';

// The History tile (1.22, CLAUDE.md: History): every step, undos and redos included, newest first, each with what it
// did, who and when, and Restore to here. Named versions (1.23) are named here and opened as separate projects.
// Filtered to the selected item (a frame, else a note, else the active scene), every change to it, field by field,
// with its old value to put back. A restore and an old value are each a new op group, so ⌘Z takes them back.

// A step's line, its technical values in mono: kept in LineText.tsx, so the top bar's Undo and Redo draw it too.
export { LineText };

/**
 * Says a Restore to here is running: on a long project it rewrites thousands of records, which takes seconds. Or that
 * Open version is copying the project (1.23): with gigabytes of pictures that takes many seconds, and without a word
 * someone may quit mid-copy. One line for the tile, so a screen reader hears one at a time.
 */
export function RestoreStatus({ restoring, opening = null }: { restoring: boolean; opening?: string | null }) {
  // Always there, empty when idle, so a screen reader hears it start.
  return (
    <p role="status" className="text-[13px]">
      {restoring ? t('history.restoring') : opening !== null ? t('history.copying', { name: opening }) : ''}
    </p>
  );
}

export function HistoryTile() {
  const project = useProject((s) => s.project);
  const locale = useLocale();
  // A plan's lengths (6.2a) in the unit the setting says now, read so a change of it reads the lines again.
  const unit = usePlanUnit();
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  // Clean up old pictures changes neither the records nor undo, but older steps then read "(picture removed)".
  const deletedForGood = useProject((s) => s.deletedForGood);
  const restoring = useProject((s) => s.restoring);
  const opening = useOpeningVersion();
  const shotId = useSelection((s) => s.shotId);
  const noteId = useSelection((s) => s.noteId);
  const sceneId = useSelection((s) => s.sceneId);
  // Ctrl+S or an open moves where History's undo outline has settled (item 7): read so the tile draws again.
  useUndoSettle();
  const historyDayId = useHistoryDay((s) => s.dayId);
  const onlyDay = useHistoryDay((s) => s.only);
  const [count, setCount] = useState(PAGE);
  const [onlyItem, setOnlyItem] = useState(false);
  // Each read keeps the records it was read for, so a restore can tell when the rows show what it did.
  const [loaded, setLoaded] = useState<(Steps & { readFor: number }) | null>(null);
  // Kept with the item they were read for: a new selection shows nothing until its own are read, so a Put back
  // can never land on the item selected before.
  const [itemOps, setItemOps] = useState<{ id: string; ops: LoggedOp[]; readFor: number } | null>(null);
  const [naming, setNaming] = useState('');
  // Set at once, not on the next render: a second Enter or click while the name is written would name it twice.
  const savingVersion = useRef(false);
  const [saving, setSaving] = useState(false);
  const versionsId = useId();
  const versionsHeading = useRef<HTMLHeadingElement>(null);
  const versionsList = useRef<HTMLUListElement>(null);
  // After Delete…, where focus goes once its row is gone, so a keyboard user stays in the tile: the version that took
  // its place in the list, else the one before it, else the Named versions heading.
  const focusAfterDelete = useRef<{ gone: string; next: string | null } | null>(null);
  // Bumped after naming or deleting a version, which changes no record, so History is read again.
  const [generation, setGeneration] = useState(0);
  // What the selection is on, most particular first: a frame or a note is picked inside the active scene.
  const liveRecord = (id: string | null, type: SbdRecord['type']) => {
    const record = id ? records[id] : undefined;
    return record?.type === type && record.trashedAt === null ? record : undefined;
  };
  const item = liveRecord(shotId, 'shot') ?? liveRecord(noteId, 'note') ?? liveRecord(sceneId, 'scene');
  // A shoot day's own history (Kevin, Nov 18), asked from the day in Shoot days or the Calendar: the tile's item until
  // a frame, a note or a scene is picked (historyDay.ts).
  const day = liveRecord(historyDayId, 'shoot_day');
  // Its switch is kept with the day (historyDay.ts), so the day's History button can turn it on from another tile.
  const filteredDay = onlyDay && day !== undefined;
  const filtered = onlyItem && day === undefined && item !== undefined;
  const list = useRef<HTMLOListElement>(null);
  const olderAsked = useRef(false);
  // One restore or Put back at a time (writeGate.ts): a click on a row that just moved under the pointer is dropped.
  const [gate] = useState(() => createWriteGate());
  // The item's history as last read, for the next read to take only the new writes: finding a frame's strokes afresh
  // looks through the whole log. With what it was read in, since Empty Trash and Clean up take data from older
  // writes, and another project's file is another log.
  const itemRead = useRef<{ file: object; deletedForGood: number; log: ItemLog } | null>(null);

  // Read again after every edit, undo and restore (each is a new step), and after anything is deleted for good.
  useEffect(() => {
    if (!project) return;
    let live = true;
    const readFor = gate.versionOf(records);
    loadSteps(project.file, count, unit)
      .then((next) => {
        if (live) setLoaded({ ...next, readFor });
      })
      .catch((error: unknown) => {
        // No new rows are coming: a restore waiting for them lets go, so the next click isn't dropped for good.
        if (live) gate.gone('steps');
        showNotice(error);
      });
    return () => {
      live = false;
    };
    // The language too: each step's line is worked out here, in the words of the moment.
  }, [gate, project, records, canUndo, deletedForGood, count, generation, locale, unit]);

  useEffect(() => {
    if (loaded) gate.read('steps', loaded.readFor);
  }, [gate, loaded]);
  useEffect(() => {
    if (itemOps) gate.read('item', itemOps.readFor);
  }, [gate, itemOps]);

  // Show older steps goes once the last page is in: focus stays in the list rather than falling out of the window.
  useEffect(() => {
    if (!olderAsked.current || loaded?.more !== false) return;
    olderAsked.current = false;
    if (document.activeElement === document.body || document.activeElement === null) list.current?.focus();
  }, [loaded]);

  useEffect(() => {
    const pending = focusAfterDelete.current;
    if (!pending || !loaded || loaded.versions.some((v) => v.id === pending.gone)) return;
    focusAfterDelete.current = null;
    // Only when focus fell out with the row: a click elsewhere since then keeps its focus.
    if (document.activeElement !== document.body && document.activeElement !== null) return;
    const next = pending.next === null ? null : versionsList.current?.querySelector<HTMLElement>(`[data-delete-version="${pending.next}"]`);
    (next ?? versionsHeading.current)?.focus();
  }, [loaded]);

  useEffect(() => {
    if (!project || !filtered) return;
    let live = true;
    const id = item.id;
    const readFor = gate.versionOf(records);
    const file = project.file;
    const known = itemRead.current;
    // A frame's strokes and picture too, from the log: sketching writes only the stroke, never the frame, and an
    // undone sketch has no record left to find them by.
    const reading =
      known && known.file === file && known.deletedForGood === deletedForGood && known.log.itemId === id
        ? moreItemLog(file, item, known.log)
        : readItemLog(file, item);
    reading
      .then((next) => {
        if (!live) return;
        itemRead.current = { file, deletedForGood, log: next };
        setItemOps({ id, ops: next.ops, readFor });
      })
      .catch((error: unknown) => {
        if (live) gate.gone('item');
        showNotice(error);
      });
    return () => {
      live = false;
    };
  }, [gate, project, filtered, item, records, deletedForGood]);
  // The item's rows are off screen (the filter turned off, the item deselected or trashed): a Put back waiting for
  // them to be read again lets go.
  useEffect(() => {
    if (!filtered) gate.gone('item');
  }, [gate, filtered]);

  if (!project) return <p className="sb-label p-3 text-text-muted">{t('historyTile.noProjectOpen')}</p>;
  const undoKey = isMac() ? '⌘Z' : 'Ctrl+Z';

  const restore = (group: OpGroup) => {
    // A restore still running (from this tile, or from before it was closed and opened again) takes no more clicks.
    if (projectStore.getState().restoring || !gate.take('steps', projectStore.getState().records)) return;
    // The list as clicked: the notice names the step that was pressed, not what moved into its place.
    const shown = loaded?.steps ?? [];
    void projectStore
      .getState()
      .restoreTo(group.id)
      .then(
        (changed) => {
          gate.written(changed);
          // A restore that failed has said why (the store's error); only one that found nothing to do says so here.
          const { error, changedOnDisk } = projectStore.getState();
          if (changed || (error === null && !changedOnDisk)) showInfo(restoreNotice(shown, group.id, changed, undoKey), { step: true });
        },
        () => {
          gate.written(false);
        },
      );
  };

  const putBack = async (recordId: string, field: FieldChange): Promise<boolean> => {
    if (projectStore.getState().restoring || !gate.take('item', projectStore.getState().records)) return false;
    let changed = false;
    try {
      // A value the item can't take now (a focal length outside its lens's range) is refused, never saved.
      const step = await putBackStep(projectStore.getState().applyWith, recordId, field);
      if (step.problem !== null) showInfo(step.problem);
      changed = step.changed;
      return step.done;
    } finally {
      gate.written(changed);
    }
  };

  // Bring back what was undone (item 7): one write at a time with Restore to here, through the same gate, since it
  // adds a step at the top too.
  const bringBack = (target: string) => {
    if (projectStore.getState().restoring || !gate.take('steps', projectStore.getState().records)) return;
    void projectStore
      .getState()
      .bringBack(target)
      .then(
        (done) => {
          gate.written(done !== null && done.written > 0);
          if (done) showInfo(broughtBackNotice(done, unit), { step: true });
        },
        () => {
          gate.written(false);
        },
      );
  };
  // The newest undo run or restore while it hasn't settled, and the rows its outline goes round on this page: from the
  // newest step it undid to the oldest, as one box.
  const run = loaded ? shownRun(loaded.undone, settledThrough(project.file)) : null;
  const outlined = (loaded?.steps ?? []).flatMap((step, i) => (run?.undone.has(step.group.id) ? [i] : []));
  const boxFrom = outlined[0] ?? -1;
  const boxTo = outlined.at(-1) ?? -1;

  const named = item ? itemName(item) : null;
  // Named by its date, as History's lines name a day.
  const dayName = day ? dayDateLabel(shootDayFields(day.props).date) || t('history.undatedDay') : null;
  const label = dayName !== null ? (
    <Trans k="history.only.day" parts={{ name: <span className="font-mono">{dayName}</span> }} />
  ) : named ? (
    named.mono === '' ? (
      t(named.only === 'history.only.shot' ? 'history.only.unnumbered' : named.only)
    ) : (
      <Trans k={named.only} parts={{ name: <span className="font-mono">{named.mono}</span> }} />
    )
  ) : (
    t('history.onlySelected')
  );
  const places = (id: string): string | null => namedById(records[id]);
  const versionNamed = versionName(naming);
  const saveVersion = () => {
    if (!versionNamed || !loaded?.newest || savingVersion.current) return;
    savingVersion.current = true;
    setSaving(true);
    void nameThisPoint(projectStore, versionNamed, loaded.newest)
      .then((named) => {
        if (!named) return;
        setNaming('');
        setGeneration((n) => n + 1);
        showInfo(t('history.named', { name: versionNamed }));
      })
      .finally(() => {
        savingVersion.current = false;
        setSaving(false);
      });
  };
  const removeVersion = async (version: NamedVersion) => {
    const sure = await confirmForGood(
      t('history.deleteVersionTitle'),
      t('history.deleteVersionText', { name: version.name }),
      t('history.deleteVersionAction'),
    );
    if (!sure) return;
    // Worked out as pressed: the row below takes this one's place, so the next Delete… is where focus already was.
    const shown = loaded?.versions ?? [];
    const at = shown.findIndex((v) => v.id === version.id);
    const next = shown[at + 1] ?? (at > 0 ? shown[at - 1] : undefined);
    if (await removeNamedVersion(projectStore, version.id)) focusAfterDelete.current = { gone: version.id, next: next?.id ?? null };
    setGeneration((n) => n + 1);
  };
  // Two versions can share a name, so each is told apart by its id.
  const versionsAt = new Map<string, NamedVersion[]>();
  for (const v of loaded?.versions ?? []) versionsAt.set(v.opGroupId, [...(versionsAt.get(v.opGroupId) ?? []), v]);

  return (
    // Busy is on the list and the table, not round the status line, which a screen reader may hold back while busy.
    <div className="flex min-h-full flex-col">
      <section aria-labelledby={versionsId} aria-busy={opening !== null} className="flex flex-col gap-2 border-b border-border p-3">
        <h3 ref={versionsHeading} id={versionsId} tabIndex={-1} className="sb-label">
          {t('historyTile.namedVersions')}
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={t('historyTile.nameThisPoint')}
              value={naming}
              placeholder={t('historyTile.boardSentToClient')}
              maxLength={80}
              onChange={(event) => {
                setNaming(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                // Not the Enter that ends an IME composition (Japanese or Chinese input): that one confirms the text.
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveVersion();
              }}
            />
          </div>
          <Button disabled={!versionNamed || !loaded?.newest || saving} onClick={saveVersion}>
            {t('historyTile.nameVersion')}
          </Button>
        </div>
        {(loaded?.versions.length ?? 0) > 0 && (
          <ul ref={versionsList} aria-label={t('historyTile.namedVersions')} className="flex flex-col">
            {loaded?.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-3 border-t border-border py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{version.name}</p>
                  <p className="text-[11px] text-text-muted">
                    <Trans
                      k="history.versionAfter"
                      parts={{
                        step: <LineText line={loaded.versionLines.get(version.id) ?? []} />,
                        when: <span className="font-mono">{localDateTime(new Date(version.createdAt))}</span>,
                      }}
                    />
                  </p>
                </div>
                <Button
                  aria-label={t('history.openVersionLabel', { name: version.name })}
                  // Not disabled, which would drop focus from the button pressed: it stays, and takes no clicks.
                  aria-disabled={opening !== null || undefined}
                  onClick={() => {
                    void openVersion(version);
                  }}
                >
                  {t('historyTile.openVersion')}
                </Button>
                <Button
                  variant="warning"
                  aria-label={t('history.deleteVersionLabel', { name: version.name })}
                  data-delete-version={version.id}
                  onClick={() => void removeVersion(version)}
                >
                  {t('historyTile.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <div data-history-only="" className="contents">
          <Toggle
            label={label}
            checked={day ? filteredDay : filtered}
            disabled={!item && !day}
            onChange={(on) => {
              if (day) useHistoryDay.setState({ only: on });
              else setOnlyItem(on);
            }}
          />
        </div>
        <RestoreStatus restoring={restoring} opening={opening} />
      </div>
      {filteredDay && dayName !== null ? (
        <DayHistory dayId={day.id} title={t('history.item.day', { name: dayName })} />
      ) : filtered && named ? (
        itemOps?.id === item.id ? (
          <ItemHistory
            item={item}
            title={named.title}
            ops={itemOps.ops}
            places={places}
            unit={unit}
            busy={restoring}
            problem={(recordId, field) => putBackProblem(records, recordId, field)}
            onPutBack={putBack}
          />
        ) : (
          <p className="p-3 text-[13px] text-text-muted">{t('historyTile.readingHistory')}</p>
        )
      ) : (
        <>
          {run !== null && (
            <div className="border-b border-border p-3">
              {/* Pulses slowly (theme.css: sb-pulse), still and solid under reduced motion. */}
              <Button
                className="sb-pulse"
                data-bring-back=""
                // Not disabled, which would drop focus from the button pressed: it stays, and takes no clicks.
                aria-disabled={restoring || undefined}
                onClick={() => {
                  bringBack(run.target);
                }}
              >
                {t('history.bringBack')}
              </Button>
            </div>
          )}
          {loaded === null ? (
            <p className="p-3 text-[13px] text-text-muted">{t('historyTile.readingHistory')}</p>
          ) : loaded.steps.length === 0 ? (
            <p className="p-3 text-[13px] text-text-muted">{t('historyTile.noStepsYetEveryChange')}</p>
          ) : (
            <ol ref={list} tabIndex={-1} aria-label={t('historyTile.stepsNewestFirst')} aria-busy={restoring} className="flex flex-col">
              {loaded.steps.map(({ group, line }, index) => {
                const undone = run?.undone.has(group.id) === true;
                const boxed = index >= boxFrom && index <= boxTo && boxFrom >= 0;
                // The restore this step was current just before: its mark stays for good; its link waits while that
                // restore's own outline and button show, the button being the way back then.
                const markOf = loaded.undone.marks.get(group.id);
                const goBack = markOf !== undefined && run?.restore !== markOf && group.kind !== 'empty_trash';
                return (
                  <li
                    key={group.id}
                    data-undone={undone ? '' : undefined}
                    data-before-restoring={markOf !== undefined ? '' : undefined}
                    className={cx(
                      'flex items-center gap-3 px-3 py-2',
                      // One Truffle outline round the run (DESIGN.md: a rule, never a fill): its sides on every row in
                      // it, its top on the first, its bottom on the last.
                      boxed ? 'border-x-[1.5px] border-x-warning' : '',
                      boxed && index === boxFrom ? 'border-t-[1.5px] border-t-warning' : '',
                      boxed && index === boxTo ? 'border-b-[1.5px] border-b-warning' : 'border-b border-border',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        <LineText line={line} />
                        {(versionsAt.get(group.id) ?? []).map((version) => (
                          <span key={version.id} className="sb-label ml-2 border border-text px-1">
                            {version.name}
                          </span>
                        ))}
                      </p>
                      <p className="font-mono text-[11px] text-text-muted">
                        {/* Who, in the UI's type (a name isn't a technical value), then when; an edit from before names were
                            kept says only when. */}
                        {/* bdi: a right-to-left name keeps to itself, so the time after it still reads in order. */}
                        {who(group.author) !== '' && (
                          <>
                            <bdi className="font-sans wrap-anywhere">{who(group.author)}</bdi>
                            {' · '}
                          </>
                        )}
                        {localDateTime(new Date(group.timestamp))}
                        {undone && <span className="sb-label ml-2 text-warning dark:text-text">{t('history.undone')}</span>}
                      </p>
                      {markOf !== undefined && (
                        <p className="flex flex-wrap items-baseline gap-2 text-[11px]">
                          <span className="sb-label border border-text px-1">{t('history.beforeRestoring')}</span>
                          {goBack && (
                            <button
                              type="button"
                              className="font-semibold underline underline-offset-2"
                              aria-label={t('history.goBackHereLabel', { step: lineText(line) })}
                              // Not disabled, which would drop focus from the button pressed: it stays, and takes no clicks.
                              aria-disabled={restoring || undefined}
                              onClick={() => {
                                restore(group);
                              }}
                            >
                              {t('history.goBackHere')}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                    {/* The newest step is how the project is now: nothing to go back to. */}
                    {index > 0 && group.kind !== 'empty_trash' && (
                      <Button
                        aria-label={t('history.restoreToLabel', { step: lineText(line) })}
                        // Not disabled, which would drop focus from the button pressed: it stays, and takes no clicks.
                        aria-disabled={restoring || undefined}
                        onClick={() => {
                          restore(group);
                        }}
                      >
                        {t('historyTile.restoreToHere')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {loaded?.more && (
            <div className="p-3">
              <Button
                onClick={() => {
                  olderAsked.current = true;
                  setCount((n) => n + PAGE);
                }}
              >
                {t('historyTile.showOlderSteps')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** How the filter and the table name an item: "frame 4A", "scene SC 05", "this note". */
function itemName(item: SbdRecord): { only: MessageKey; mono: string; title: string } {
  if (item.type === 'shot') {
    const number = shotFields(item.props).number;
    return { only: 'history.only.shot', mono: number, title: t('history.item.shot', { name: number }) };
  }
  if (item.type === 'scene') {
    const label = sceneLabel(sceneFields(item.props).number);
    return { only: 'history.only.scene', mono: label, title: t('history.item.scene', { name: label }) };
  }
  return { only: 'history.only.note', mono: '', title: t('history.item.note') };
}

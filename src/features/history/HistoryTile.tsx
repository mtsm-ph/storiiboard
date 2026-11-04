import { useEffect, useRef, useState } from 'react';
import { localDateTime } from '../../app/format';
import { showInfo, showNotice } from '../../app/notice';
import { isMac } from '../../app/shell/undoShortcuts';
import { projectStore, useProject } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { LoggedOp, OpGroup } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/fields';
import { useSelection } from '../storyboard/selection';
import { ItemHistory } from './ItemHistory';
import { putBackChange } from './putBack';
import { loadSteps, moreItemLog, PAGE, readItemLog, restoreNotice, type ItemLog, type Steps } from './steps';
import { lineText, who, type FieldChange, type Line } from './summary';
import { createWriteGate } from './writeGate';

// The History tile (1.22, CLAUDE.md: History): every step, undos and redos included, newest first, each with what it
// did, who and when, and Restore to here. Filtered to the selected item (a frame, else a note, else the active scene),
// every change to it, field by field, with its old value to put back. A restore and an old value are each a new op
// group, so ⌘Z takes them back.

/** A step's line, its technical values in mono. */
function LineText({ line }: { line: Line }) {
  return (
    <>
      {line.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-mono">
            {part.mono}
          </span>
        ),
      )}
    </>
  );
}

/** Says a Restore to here is running: on a long project it rewrites thousands of records, which takes seconds. */
export function RestoreStatus({ restoring }: { restoring: boolean }) {
  // Always there, empty when idle, so a screen reader hears it start.
  return (
    <p role="status" className="text-[13px]">
      {restoring ? 'Restoring the project…' : ''}
    </p>
  );
}

export function HistoryTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  // Clean up old pictures changes neither the records nor undo, but older steps then read "(picture removed)".
  const deletedForGood = useProject((s) => s.deletedForGood);
  const restoring = useProject((s) => s.restoring);
  const shotId = useSelection((s) => s.shotId);
  const noteId = useSelection((s) => s.noteId);
  const sceneId = useSelection((s) => s.sceneId);
  const [count, setCount] = useState(PAGE);
  const [onlyItem, setOnlyItem] = useState(false);
  // Each read keeps the records it was read for, so a restore can tell when the rows show what it did.
  const [loaded, setLoaded] = useState<(Steps & { readFor: number }) | null>(null);
  // Kept with the item they were read for: a new selection shows nothing until its own are read, so a Put back
  // can never land on the item selected before.
  const [itemOps, setItemOps] = useState<{ id: string; ops: LoggedOp[]; readFor: number } | null>(null);
  // What the selection is on, most particular first: a frame or a note is picked inside the active scene.
  const liveRecord = (id: string | null, type: SbdRecord['type']) => {
    const record = id ? records[id] : undefined;
    return record?.type === type && record.trashedAt === null ? record : undefined;
  };
  const item = liveRecord(shotId, 'shot') ?? liveRecord(noteId, 'note') ?? liveRecord(sceneId, 'scene');
  const filtered = onlyItem && item !== undefined;
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
    loadSteps(project.file, count)
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
  }, [gate, project, records, canUndo, deletedForGood, count]);

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

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
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
          if (changed || (error === null && !changedOnDisk)) showInfo(restoreNotice(shown, group.id, changed, undoKey));
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
      // Worked out from the item as it is when the edit's turn comes, so an edit queued just before isn't undone by it.
      const done = await projectStore.getState().applyWith((now) => {
        const change = putBackChange(now[recordId], field);
        changed = change !== null;
        return { changes: change ? [change] : [] };
      });
      changed &&= done;
      return done;
    } finally {
      gate.written(changed);
    }
  };

  const named = item ? itemName(item) : null;
  const label = named ? (
    <>
      Only {named.noun}
      {named.mono !== '' && (
        <>
          {' '}
          <span className="font-mono">{named.mono}</span>
        </>
      )}
    </>
  ) : (
    'Only the selected item'
  );
  const places = (id: string): string | null => {
    const place = records[id];
    return place?.type === 'location' && typeof place.props.name === 'string' && place.props.name !== '' ? place.props.name : null;
  };
  return (
    // Busy is on the list and the table, not round the status line, which a screen reader may hold back while busy.
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Toggle label={label} checked={filtered} disabled={!item} onChange={setOnlyItem} />
        <RestoreStatus restoring={restoring} />
      </div>
      {filtered && named ? (
        itemOps?.id === item.id ? (
          <ItemHistory item={item} title={named.title} ops={itemOps.ops} places={places} busy={restoring} onPutBack={putBack} />
        ) : (
          <p className="p-3 text-[13px] text-text-muted">Reading History…</p>
        )
      ) : (
        <>
          {loaded === null ? (
            <p className="p-3 text-[13px] text-text-muted">Reading History…</p>
          ) : loaded.steps.length === 0 ? (
            <p className="p-3 text-[13px] text-text-muted">No steps yet. Every change you make shows here.</p>
          ) : (
            <ol ref={list} tabIndex={-1} aria-label="Steps, newest first" aria-busy={restoring} className="flex flex-col">
              {loaded.steps.map(({ group, line }, index) => (
                <li key={group.id} className="flex items-center gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">
                      <LineText line={line} />
                    </p>
                    <p className="font-mono text-[11px] text-text-muted">
                      {who(group.author)} · {localDateTime(new Date(group.timestamp))}
                    </p>
                  </div>
                  {/* The newest step is how the project is now: nothing to go back to. */}
                  {index > 0 && group.kind !== 'empty_trash' && (
                    <Button
                      aria-label={`Restore to here: after “${lineText(line)}”`}
                      // Not disabled, which would drop focus from the button pressed: it stays, and takes no clicks.
                      aria-disabled={restoring || undefined}
                      onClick={() => {
                        restore(group);
                      }}
                    >
                      Restore to here
                    </Button>
                  )}
                </li>
              ))}
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
                Show older steps
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** How the filter and the table name an item: "frame 4A", "scene SC 05", "this note". */
function itemName(item: SbdRecord): { noun: string; mono: string; title: string } {
  if (item.type === 'shot') {
    const number = shotFields(item.props).number;
    return { noun: 'frame', mono: number, title: `frame ${number}` };
  }
  if (item.type === 'scene') {
    const label = sceneLabel(sceneFields(item.props).number);
    return { noun: 'scene', mono: label, title: `scene ${label}` };
  }
  return { noun: 'this note', mono: '', title: 'this note' };
}

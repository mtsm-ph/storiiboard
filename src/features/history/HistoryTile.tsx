import { useEffect, useId, useRef, useState } from 'react';
import { confirmForGood } from '../../app/confirm';
import { localDateTime } from '../../app/format';
import { openVersion } from '../../app/projects/actions';
import { showInfo, showNotice } from '../../app/notice';
import { isMac } from '../../app/shell/undoShortcuts';
import { projectStore, useProject } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { LoggedOp, OpGroup } from '../../core/ops/ops';
import { deleteVersion, nameVersion, versionName, type NamedVersion } from '../../core/storage/versions';
import { Button } from '../../ui/Button';
import { TextField, Toggle } from '../../ui/fields';
import { useSelection } from '../storyboard/selection';
import { ItemHistory } from './ItemHistory';
import { putBackChange } from './putBack';
import { itemOps as readItemOps, loadSteps, PAGE, restoreNotice, type Steps } from './steps';
import { lineText, who, type FieldChange, type Line } from './summary';
import { createWriteGate } from './writeGate';

// The History tile (1.22, CLAUDE.md: History): every step, undos and redos included, newest first, each with what it
// did, who and when, and Restore to here. Named versions (1.23) are named here and opened as separate projects.
// Filtered to the selected item (a frame, else a note, else the active scene), every change to it, field by field,
// with its old value to put back. A restore and an old value are each a new op group, so ⌘Z takes them back.

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

export function HistoryTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  // Clean up old pictures changes neither the records nor undo, but older steps then read "(picture removed)".
  const deletedForGood = useProject((s) => s.deletedForGood);
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
  const [naming, setNaming] = useState('');
  const versionsId = useId();
  // Bumped after naming or deleting a version, which changes no record, so History is read again.
  const [generation, setGeneration] = useState(0);
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
  }, [gate, project, records, canUndo, deletedForGood, count, generation]);

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
    // A frame's strokes and picture too, from the log: sketching writes only the stroke, never the frame, and an
    // undone sketch has no record left to find them by.
    readItemOps(project.file, item)
      .then((ops) => {
        if (live) setItemOps({ id, ops, readFor });
      })
      .catch((error: unknown) => {
        if (live) gate.gone('item');
        showNotice(error);
      });
    return () => {
      live = false;
    };
  }, [gate, project, filtered, item, records]);
  // The item's rows are off screen (the filter turned off, the item deselected or trashed): a Put back waiting for
  // them to be read again lets go.
  useEffect(() => {
    if (!filtered) gate.gone('item');
  }, [gate, filtered]);

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const undoKey = isMac() ? '⌘Z' : 'Ctrl+Z';

  const restore = (group: OpGroup) => {
    if (!gate.take('steps', projectStore.getState().records)) return;
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
    if (!gate.take('item', projectStore.getState().records)) return false;
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
  const versionNamed = versionName(naming);
  const saveVersion = () => {
    if (!versionNamed || !loaded?.newest) return;
    void nameVersion(project.file, { name: versionNamed, opGroupId: loaded.newest })
      .then(() => {
        setNaming('');
        setGeneration((n) => n + 1);
        showInfo(`Named this point “${versionNamed}”.`);
      })
      .catch(showNotice);
  };
  const removeVersion = async (version: NamedVersion) => {
    const sure = await confirmForGood(
      'Delete version?',
      `The name “${version.name}” will be deleted. The steps stay in History; only the name goes, and it can’t be undone.`,
      'Delete version',
    );
    if (!sure) return;
    await deleteVersion(project.file, version.id).catch(showNotice);
    setGeneration((n) => n + 1);
  };
  const versionsAt = new Map<string, string[]>();
  for (const v of loaded?.versions ?? []) versionsAt.set(v.opGroupId, [...(versionsAt.get(v.opGroupId) ?? []), v.name]);

  return (
    <div className="flex min-h-full flex-col">
      <section aria-labelledby={versionsId} className="flex flex-col gap-2 border-b border-border p-3">
        <h3 id={versionsId} className="sb-label">
          Named versions
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label="Name this point"
              value={naming}
              placeholder="Board sent to client"
              maxLength={80}
              onChange={(event) => {
                setNaming(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveVersion();
              }}
            />
          </div>
          <Button disabled={!versionNamed || !loaded?.newest} onClick={saveVersion}>
            Name version
          </Button>
        </div>
        {(loaded?.versions.length ?? 0) > 0 && (
          <ul aria-label="Named versions" className="flex flex-col">
            {loaded?.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-3 border-t border-border py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{version.name}</p>
                  <p className="text-[11px] text-text-muted">
                    After “<LineText line={loaded.versionLines.get(version.id) ?? []} />” · <span className="font-mono">{localDateTime(new Date(version.createdAt))}</span>
                  </p>
                </div>
                <Button
                  aria-label={`Open version ${version.name}`}
                  onClick={() => {
                    void openVersion(version);
                  }}
                >
                  Open version
                </Button>
                <Button variant="warning" aria-label={`Delete version ${version.name}`} onClick={() => void removeVersion(version)}>
                  Delete…
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Toggle label={label} checked={filtered} disabled={!item} onChange={setOnlyItem} />
      </div>
      {filtered && named ? (
        itemOps?.id === item.id ? (
          <ItemHistory item={item} title={named.title} ops={itemOps.ops} places={places} onPutBack={putBack} />
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
            <ol ref={list} tabIndex={-1} aria-label="Steps, newest first" className="flex flex-col">
              {loaded.steps.map(({ group, line }, index) => (
                <li key={group.id} className="flex items-center gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">
                      <LineText line={line} />
                      {(versionsAt.get(group.id) ?? []).map((name) => (
                        <span key={name} className="sb-label ml-2 border border-text px-1">
                          {name}
                        </span>
                      ))}
                    </p>
                    <p className="font-mono text-[11px] text-text-muted">
                      {who(group.author)} · {localDateTime(new Date(group.timestamp))}
                    </p>
                  </div>
                  {/* The newest step is how the project is now: nothing to go back to. */}
                  {index > 0 && group.kind !== 'empty_trash' && (
                    <Button
                      aria-label={`Restore to here: after “${lineText(line)}”`}
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

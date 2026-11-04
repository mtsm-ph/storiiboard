import { useEffect, useId, useRef, useState } from 'react';
import { confirmForGood } from '../../app/confirm';
import { localDateTime } from '../../app/format';
import { openVersion } from '../../app/projects/actions';
import { showInfo, showNotice } from '../../app/notice';
import { isMac } from '../../app/shell/undoShortcuts';
import { projectStore, useProject } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { shotFields } from '../../core/model/storyboard';
import type { LoggedOp, OpGroup } from '../../core/ops/ops';
import { deleteVersion, nameVersion, versionName, type NamedVersion } from '../../core/storage/versions';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { TextField, Toggle } from '../../ui/fields';
import { useSelection } from '../storyboard/selection';
import { canPutBack, putBackChange } from './putBack';
import { frameOps as readFrameOps, loadSteps, PAGE, restoreNotice, type Steps } from './steps';
import { changeLabel, changeValue, frameRows, isMono, lineText, who, type FieldChange, type Line } from './summary';
import { createWriteGate } from './writeGate';

// The History tile (1.22, CLAUDE.md: History): every step, undos and redos included, newest first, each with what it
// did, who and when, and Restore to here. Named versions (1.23) are named here and opened as separate projects.
// Filtered to the selected frame, every change to it, field by field, with its old value to put back. A restore and an
// old value are each a new op group, so ⌘Z takes them back.

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
  const shotId = useSelection((s) => s.shotId);
  const [count, setCount] = useState(PAGE);
  const [onlyFrame, setOnlyFrame] = useState(false);
  // Each read keeps the records it was read for, so a restore can tell when the rows show what it did.
  const [loaded, setLoaded] = useState<(Steps & { readFor: number }) | null>(null);
  // Kept with the frame they were read for: a new selection shows nothing until its own are read, so a Put back
  // can never land on the frame selected before.
  const [frameOps, setFrameOps] = useState<{ id: string; ops: LoggedOp[]; readFor: number } | null>(null);
  const [naming, setNaming] = useState('');
  const versionsId = useId();
  // Bumped after naming or deleting a version, which changes no record, so History is read again.
  const [generation, setGeneration] = useState(0);
  const shot = shotId ? records[shotId] : undefined;
  const frame = shot?.type === 'shot' && shot.trashedAt === null ? shot : undefined;
  const filtered = onlyFrame && frame !== undefined;
  const list = useRef<HTMLOListElement>(null);
  const olderAsked = useRef(false);
  // One restore or Put back at a time (writeGate.ts): a click on a row that just moved under the pointer is dropped.
  const [gate] = useState(() => createWriteGate());

  // Read again after every edit, undo and restore: each is a new step.
  useEffect(() => {
    if (!project) return;
    let live = true;
    const readFor = gate.versionOf(records);
    loadSteps(project.file, count)
      .then((next) => {
        if (live) setLoaded({ ...next, readFor });
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [gate, project, records, canUndo, count, generation]);

  useEffect(() => {
    if (loaded) gate.read('steps', loaded.readFor);
  }, [gate, loaded]);
  useEffect(() => {
    if (frameOps) gate.read('frame', frameOps.readFor);
  }, [gate, frameOps]);

  // Show older steps goes once the last page is in: focus stays in the list rather than falling out of the window.
  useEffect(() => {
    if (!olderAsked.current || loaded?.more !== false) return;
    olderAsked.current = false;
    if (document.activeElement === document.body || document.activeElement === null) list.current?.focus();
  }, [loaded]);

  useEffect(() => {
    if (!project || !filtered) return;
    let live = true;
    const id = frame.id;
    const readFor = gate.versionOf(records);
    // Its strokes and picture too, from the log: sketching writes only the stroke, never the frame, and an undone
    // sketch has no record left to find them by.
    readFrameOps(project.file, id)
      .then((ops) => {
        if (live) setFrameOps({ id, ops, readFor });
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [gate, project, filtered, frame, records]);

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
    if (!gate.take('frame', projectStore.getState().records)) return false;
    let changed = false;
    try {
      // Worked out from the frame as it is when the edit's turn comes, so an edit queued just before isn't undone by it.
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

  const frameName = frame ? shotFields(frame.props).number : '';
  const label = frame ? (
    <>
      Only frame <span className="font-mono">{frameName}</span>
    </>
  ) : (
    'Only the selected frame'
  );
  const named = versionName(naming);
  const saveVersion = () => {
    if (!named || !loaded?.newest) return;
    void nameVersion(project.file, { name: named, opGroupId: loaded.newest })
      .then(() => {
        setNaming('');
        setGeneration((n) => n + 1);
        showInfo(`Named this point “${named}”.`);
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
          <Button disabled={!named || !loaded?.newest} onClick={saveVersion}>
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
        <Toggle label={label} checked={filtered} disabled={!frame} onChange={setOnlyFrame} />
      </div>
      {filtered ? (
        frameOps?.id === frame.id ? (
          <FrameHistory frame={frame} name={frameName} ops={frameOps.ops} onPutBack={putBack} />
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

/** Every change to one frame, newest first, field by field, each with its old value to put back. */
function FrameHistory({
  frame,
  name,
  ops,
  onPutBack,
}: {
  frame: SbdRecord;
  name: string;
  ops: readonly LoggedOp[];
  onPutBack: (recordId: string, field: FieldChange) => Promise<boolean>;
}) {
  const table = useRef<HTMLTableElement>(null);
  const rows = frameRows(ops, frame.id);
  if (rows.length === 0) return <p className="p-3 text-[13px] text-text-muted">No changes to {name} yet.</p>;
  const putBack = (recordId: string, field: FieldChange) => {
    void onPutBack(recordId, field).then(() => {
      // The pressed button goes once its value is back: focus stays on the table rather than falling out of the
      // window, so the next Tab reaches the rows again.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === null) table.current?.focus();
      });
    });
  };
  return (
    <table ref={table} tabIndex={-1} className="w-full border-collapse text-[12px]">
      <caption className="sr-only">Changes to frame {name}, newest first</caption>
      <thead>
        <tr className="border-b border-border">
          {['Change', 'Before', 'After', 'Who', 'When', ''].map((head) => (
            <th key={head} scope="col" className="sb-label px-2 py-1.5 text-left font-normal text-text-muted">
              {head === '' ? <span className="sr-only">Put back</span> : head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, op, change, field }) => {
          const mono = field !== null && field.key === undefined && isMono(field.prop);
          // Offered only where it would change something: the value already there is no step to take.
          const offered = field !== null && canPutBack(field) && putBackChange(frame, field) !== null;
          return (
            <tr key={key} className="border-b border-border">
              <td className="px-2 py-1.5">{change}</td>
              <td className={cx('px-2 py-1.5', mono && 'font-mono')}>{field ? changeValue(field, field.before) : ''}</td>
              <td className={cx('px-2 py-1.5', mono && 'font-mono')}>{field ? changeValue(field, field.after) : ''}</td>
              <td className="px-2 py-1.5">{who(op.author)}</td>
              <td className="px-2 py-1.5 font-mono whitespace-nowrap">{localDateTime(new Date(op.timestamp))}</td>
              <td className="px-2 py-1 text-right">
                {offered && (
                  <Button
                    aria-label={`Put back ${changeLabel(field)} ${changeValue(field, field.before)}`}
                    onClick={() => {
                      putBack(op.recordId, field);
                    }}
                  >
                    Put back
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import { useEffect, useState } from 'react';
import { localDateTime } from '../../app/format';
import { showInfo, showNotice } from '../../app/notice';
import { isMac } from '../../app/shell/undoShortcuts';
import { projectStore, useProject } from '../../app/projectStore';
import type { JsonValue } from '../../core/model/record';
import { shotFields } from '../../core/model/storyboard';
import { log, opsOfGroups, opsOfRecord, storedPictures, type LoggedOp, type OpGroup } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/fields';
import { useSelection } from '../storyboard/selection';
import { changedProps, describeGroup, fieldLabel, valueLabel } from './summary';

// The History tile (1.22, CLAUDE.md: History): every step, undos and redos included, newest first, each with what it
// did, who and when, and Restore to here. Filtered to the selected frame, every change to it, field by field, with
// its old value to put back. A restore and an old value are each a new op group, so ⌘Z takes them back.

/** Steps shown at a time; older ones load on asking, so a long project opens its History at once. */
const PAGE = 100;

interface Loaded {
  steps: { group: OpGroup; line: string }[];
  /** More steps before the oldest shown. */
  more: boolean;
}

const who = (author: string) => (author === 'local' ? 'You' : author);

async function loadSteps(file: Parameters<typeof log>[0], count: number): Promise<Loaded> {
  const groups = await log(file);
  const shown = groups.slice(-count);
  // Undo, redo and restore name the step they point at, which may be older than the page.
  const wanted = new Set(shown.map((g) => g.id));
  for (const g of shown) for (const id of [g.targetGroupId, g.restoreTo]) if (id) wanted.add(id);
  const [ops, stored] = await Promise.all([opsOfGroups(file, [...wanted]), storedPictures(file)]);
  const byGroup = new Map<string, LoggedOp[]>();
  for (const op of ops) byGroup.set(op.groupId, [...(byGroup.get(op.groupId) ?? []), op]);
  // Oldest first, so the step an undo, redo or restore names already has its line.
  const titles = new Map<string, string>();
  for (const group of groups) if (wanted.has(group.id)) titles.set(group.id, describeGroup(group, byGroup.get(group.id) ?? [], titles, stored));
  return { steps: shown.reverse().map((group) => ({ group, line: titles.get(group.id) ?? 'a step' })), more: groups.length > count };
}

export function HistoryTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  const shotId = useSelection((s) => s.shotId);
  const [count, setCount] = useState(PAGE);
  const [onlyFrame, setOnlyFrame] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [frameOps, setFrameOps] = useState<LoggedOp[] | null>(null);
  const shot = shotId ? records[shotId] : undefined;
  const frame = shot?.type === 'shot' && shot.trashedAt === null ? shot : undefined;
  const filtered = onlyFrame && frame !== undefined;

  // Read again after every edit, undo and restore: each is a new step.
  useEffect(() => {
    if (!project) return;
    let live = true;
    loadSteps(project.file, count)
      .then((next) => {
        if (live) setLoaded(next);
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, records, canUndo, count]);

  useEffect(() => {
    if (!project || !filtered) return;
    let live = true;
    opsOfRecord(project.file, frame.id)
      .then((ops) => {
        if (live) setFrameOps(ops);
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, filtered, frame, records]);

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const undoKey = isMac() ? '⌘Z' : 'Ctrl+Z';

  const restore = (group: OpGroup, line: string) => {
    void projectStore
      .getState()
      .restoreTo(group.id)
      .then((changed) => {
        if (changed) showInfo(`Restored the project to after “${line}”. ${undoKey} takes it back.`);
      });
  };

  const putBack = (recordId: string, prop: string, value: JsonValue | undefined) => {
    void projectStore
      .getState()
      .apply([{ kind: 'update', id: recordId, ...(value === undefined ? { unset: [prop] } : { set: { [prop]: value } }) }]);
  };

  const frameName = frame ? shotFields(frame.props).number : '';
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Toggle label={frame ? `Only frame ${frameName}` : 'Only the selected frame'} checked={filtered} disabled={!frame} onChange={setOnlyFrame} />
      </div>
      {filtered ? (
        <FrameHistory name={frameName} ops={frameOps ?? []} onPutBack={putBack} />
      ) : (
        <>
          {loaded === null ? (
            <p className="p-3 text-[13px] text-text-muted">Reading History…</p>
          ) : loaded.steps.length === 0 ? (
            <p className="p-3 text-[13px] text-text-muted">No steps yet. Every change you make shows here.</p>
          ) : (
            <ol aria-label="Steps, newest first" className="flex flex-col">
              {loaded.steps.map(({ group, line }, index) => (
                <li key={group.id} className="flex items-center gap-3 border-b border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">{line}</p>
                    <p className="font-mono text-[11px] text-text-muted">
                      {who(group.author)} · {localDateTime(new Date(group.timestamp))}
                    </p>
                  </div>
                  {/* The newest step is how the project is now: nothing to go back to. */}
                  {index > 0 && group.kind !== 'empty_trash' && (
                    <Button
                      aria-label={`Restore to here: after “${line}”`}
                      onClick={() => {
                        restore(group, line);
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

/** One line of a frame's own history: a field's change, or a whole step (added, moved, deleted). */
interface ChangeRow {
  key: string;
  op: LoggedOp;
  prop: string | null;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

/** Every change to one frame, newest first, field by field, each with its old value to put back. */
function FrameHistory({
  name,
  ops,
  onPutBack,
}: {
  name: string;
  ops: readonly LoggedOp[];
  onPutBack: (recordId: string, prop: string, value: JsonValue | undefined) => void;
}) {
  const rows = [...ops].reverse().flatMap((op, opIndex): ChangeRow[] => {
    if (op.kind === 'update' && op.before && op.after) {
      const { before, after } = op;
      return changedProps(before, after)
        // The board keeps a frame's number and media in step itself; those aren't values to put back by hand.
        .filter((prop) => prop !== 'number')
        .map((prop) => ({ key: `${String(opIndex)}:${prop}`, op, prop, before: before.props[prop], after: after.props[prop] }));
    }
    return [{ key: String(opIndex), op, prop: null, before: undefined, after: undefined }];
  });
  if (rows.length === 0) return <p className="p-3 text-[13px] text-text-muted">No changes to {name} yet.</p>;
  return (
    <table className="w-full border-collapse text-[12px]">
      <caption className="sr-only">Changes to frame {name}, newest first</caption>
      <thead>
        <tr className="border-b border-border">
          {['Change', 'Before', 'After', 'When', ''].map((head) => (
            <th key={head} scope="col" className="sb-label px-2 py-1.5 text-left font-normal text-text-muted">
              {head === '' ? <span className="sr-only">Put back</span> : head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border">
            <td className="px-2 py-1.5">{row.prop ? fieldLabel(row.prop) : KIND_LINE[row.op.kind]}</td>
            <td className="px-2 py-1.5 font-mono">{row.prop ? valueLabel(row.prop, row.before) : ''}</td>
            <td className="px-2 py-1.5 font-mono">{row.prop ? valueLabel(row.prop, row.after) : ''}</td>
            <td className="px-2 py-1.5 font-mono whitespace-nowrap">{localDateTime(new Date(row.op.timestamp))}</td>
            <td className="px-2 py-1 text-right">
              {row.prop && PUTTABLE.has(row.prop) && (
                <Button
                  aria-label={`Put back ${fieldLabel(row.prop)} ${valueLabel(row.prop, row.before)}`}
                  onClick={() => {
                    onPutBack(row.op.recordId, row.prop ?? '', row.before);
                  }}
                >
                  Put back
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Fields a person sets by hand, so an old value can go back on its own without leaving the board inconsistent. */
const PUTTABLE = new Set(['size', 'lens_mm', 't_stop', 'support', 'height', 'move', 'status', 'action', 'dialogue', 'departments', 'custom']);

const KIND_LINE: Readonly<Record<LoggedOp['kind'], string>> = {
  create: 'Added',
  update: 'Changed',
  move: 'Moved',
  retype: 'Changed type',
  trash: 'Deleted',
  restore: 'Restored',
  revert: 'Restored from History',
  purge: 'Deleted for good',
};

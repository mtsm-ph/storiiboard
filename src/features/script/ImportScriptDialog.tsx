import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isMac } from '../../app/shell/undoShortcuts';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { pageLabel } from '../../core/model/storyboard';
import { Button } from '../../ui/Button';
import { headingOf } from '../storyboard/ScenesView';
import { selectionStore } from '../storyboard/selection';
import { closeImport, usePendingImport, type PendingImport } from './importStore';
import { importChanges, planImport, type PlannedStatus } from './importScript';

// The script import preview (1.17): every scene the script has, with its number, heading, length and speaking
// characters, and what the import will create. Nothing is written until Import, which is one op group: one undo takes
// the whole import back. Scenes the board already has (by number) are listed and left as they are.

export function ImportScriptHost() {
  const pending = usePendingImport();
  const project = useProject((s) => s.project);
  const mine = pending !== null && project?.projectId === pending.projectId && project.file.path === pending.path;
  // For the project it was opened in only: another opened meanwhile (from Finder, say) closes it.
  useEffect(() => {
    if (pending && !mine) closeImport();
  }, [pending, mine]);
  if (!pending || !mine) return null;
  return <ImportScriptDialog key={`${pending.path}:${pending.fileName}`} pending={pending} projectId={pending.projectId} />;
}

/** What a row says when its scene isn't imported. */
const LEFT_OUT: Readonly<Record<Exclude<PlannedStatus, 'new'>, string>> = {
  same: 'On the board',
  taken: 'Number taken on the board',
  trashed: 'Number in the Trash',
};

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

function ImportScriptDialog({ pending, projectId }: { pending: PendingImport; projectId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const records = useProject((s) => s.records);
  const [importing, setImporting] = useState(false);
  const plan = useMemo(() => planImport(records, projectId, pending.script), [records, projectId, pending.script]);
  const fresh = plan.scenes.filter((s) => s.status === 'new');
  const undoKey = isMac() ? '⌘Z' : 'Ctrl+Z';

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  const run = () => {
    setImporting(true);
    let made: string[] = [];
    void projectStore
      .getState()
      // Planned again from the records as they are when it lands, so an edit made meanwhile is never undone by it.
      .applyWith((now) => {
        const changes = importChanges(now, projectId, planImport(now, projectId, pending.script));
        made = changes.flatMap((c) => (c.kind === 'create' && c.record.type === 'scene' && c.record.id ? [c.record.id] : []));
        return { changes };
      })
      .then((written) => {
        closeImport();
        if (!written || made.length === 0) return;
        selectionStore.getState().selectScene(made[0] ?? null);
        showInfo(`Imported ${plural(made.length, 'scene')} from “${pending.fileName}”. ${undoKey} takes the import back.`);
      })
      .finally(() => {
        setImporting(false);
      });
  };

  const counts = [
    plural(fresh.length, 'new scene'),
    plan.locations.created.length > 0 ? plural(plan.locations.created.length, 'new location') : null,
    plan.locations.linked.length > 0 ? `${plural(plan.locations.linked.length, 'location')} already in the project` : null,
    plan.characters.created.length > 0 ? plural(plan.characters.created.length, 'new character') : null,
    plan.characters.linked.length > 0 ? `${plural(plan.characters.linked.length, 'character')} already in the project` : null,
  ].filter((part) => part !== null);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        // While it's being written, it finishes: closing then would leave it half said.
        if (!importing) closeImport();
      }}
      className="m-auto max-h-[calc(100vh-48px)] w-[760px] max-w-[calc(100vw-32px)] border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-text/40"
    >
      <div className="flex max-h-[calc(100vh-52px)] flex-col gap-3 p-4">
        <h2 id={titleId} className="text-[20px] font-bold">
          Import {pending.script.title ?? pending.fileName}
        </h2>
        <p className="text-[13px]">{counts.join(' · ')}</p>
        {fresh.length === 0 && <p className="text-[13px]">Every scene in this script is on the board already, or its number is taken there.</p>}
        <div className="min-h-0 overflow-auto border border-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">Scenes in the script</caption>
            <thead>
              <tr className="sb-label border-b border-border">
                <th scope="col" className="px-2 py-1.5 font-normal">
                  SC
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  Heading
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  Length
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  Speaking
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.scenes.map(({ scene, number, status, note }, index) => (
                // Scenes have no id until they're made; the script's order is their identity here.
                <tr key={index} className="border-b border-border align-top last:border-b-0">
                  <td className="px-2 py-1.5 font-mono font-bold whitespace-nowrap">{number}</td>
                  <td className="px-2 py-1.5">
                    {headingOf({
                      number,
                      name: scene.otherTime ? `${scene.location} — ${scene.otherTime}` : scene.location,
                      intExt: scene.intExt,
                      dayNight: scene.dayNight,
                      locationId: null,
                      pageEighths: scene.eighths,
                      numbersLocked: false,
                      characters: scene.characters,
                    })}
                    {status !== 'new' && <span className="sb-label ml-2 border border-text px-1">{LEFT_OUT[status]}</span>}
                    {note && <span className="block text-[12px]">{note}; numbered {number}.</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{pageLabel(scene.eighths)}</td>
                  <td className="px-2 py-1.5">{scene.characters.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-text-muted">
          Headings are read by rule: INT or EXT, the place, then the time of day. Lengths are estimated in eighths of a
          page{pending.fileName.toLowerCase().endsWith('.fdx') ? ', or taken from Final Draft where it has them' : ''}.
        </p>
        <div className="flex justify-end gap-2">
          <Button disabled={importing} onClick={closeImport}>
            Cancel
          </Button>
          <Button variant="primary" disabled={fresh.length === 0 || importing} onClick={run}>
            {fresh.length === 0 ? 'Nothing to import' : `Import ${plural(fresh.length, 'scene')}`}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

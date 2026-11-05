import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../../ui/useLocale';
import { isMac } from '../../app/shell/undoShortcuts';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { pageLabel } from '../../core/model/storyboard';
import { Button } from '../../ui/Button';
import { headingOf } from '../storyboard/ScenesView';
import { selectionStore } from '../storyboard/selection';
import { closeImport, usePendingImport, type PendingImport } from './importStore';
import { importChanges, planImport, type PlannedStatus } from './importScript';
import { labels, t, tn } from '../../core/i18n';

// The script import preview (1.17): every scene the script has, with its number, heading, length and speaking
// characters, and what the import will create. Nothing is written until Import, which is one op group: one undo takes
// the whole import back. Scenes the board already has (by number) are listed and left as they are.

export function ImportScriptHost() {
  const pending = usePendingImport();
  const locale = useLocale();
  const project = useProject((s) => s.project);
  const mine = pending !== null && project?.projectId === pending.projectId && project.file.path === pending.path;
  // For the project it was opened in only: another opened meanwhile (from Finder, say) closes it.
  useEffect(() => {
    if (pending && !mine) closeImport();
  }, [pending, mine]);
  if (!pending || !mine) return null;
  // Keyed by the language too: the plan's notes are in words, worked out once per dialog.
  return <ImportScriptDialog key={`${locale}:${pending.path}:${pending.fileName}`} pending={pending} projectId={pending.projectId} />;
}

/** What a row says when its scene isn't imported. */
const LEFT_OUT: Readonly<Record<Exclude<PlannedStatus, 'new'>, string>> = labels({
  same: 'script.onBoard',
  taken: 'script.numberTaken',
  trashed: 'script.numberInTrash',
});

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
        showInfo(t('script.imported', { scenes: tn('count.scenes', made.length), name: pending.fileName, undo: undoKey }), { step: true });
      })
      .finally(() => {
        setImporting(false);
      });
  };

  const counts = [
    tn('script.newScenes', fresh.length),
    plan.locations.created.length > 0 ? tn('script.newLocations', plan.locations.created.length) : null,
    plan.locations.linked.length > 0 ? tn('script.locationsInProject', plan.locations.linked.length) : null,
    plan.characters.created.length > 0 ? tn('script.newCharacters', plan.characters.created.length) : null,
    plan.characters.linked.length > 0 ? tn('script.charactersInProject', plan.characters.linked.length) : null,
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
          {t('script.importTitle', { name: pending.script.title ?? pending.fileName })}
        </h2>
        <p className="text-[13px]">{counts.join(' · ')}</p>
        {fresh.length === 0 && <p className="text-[13px]">{t('importScriptDialog.everySceneInThisScript')}</p>}
        <div className="min-h-0 overflow-auto border border-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">{t('importScriptDialog.scenesInTheScript')}</caption>
            <thead>
              <tr className="sb-label border-b border-border">
                <th scope="col" className="px-2 py-1.5 font-normal">
                  {t('importScriptDialog.sc')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  {t('importScriptDialog.heading')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  {t('importScriptDialog.length')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-normal">
                  {t('importScriptDialog.speaking')}
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
                      name: scene.otherTime ? t('script.placeAndTime', { place: scene.location, time: scene.otherTime }) : scene.location,
                      intExt: scene.intExt,
                      dayNight: scene.dayNight,
                      locationId: null,
                      pageEighths: scene.eighths,
                      numbersLocked: false,
                      characters: scene.characters,
                    })}
                    {status !== 'new' && <span className="sb-label ml-2 border border-text px-1">{LEFT_OUT[status]}</span>}
                    {note && <span className="block text-[12px]">{t('script.noteNumbered', { note, number })}</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{pageLabel(scene.eighths)}</td>
                  <td className="px-2 py-1.5">{scene.characters.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-text-muted">
          {pending.fileName.toLowerCase().endsWith('.fdx') ? t('script.rulesFdx') : t('script.rules')}
        </p>
        <div className="flex justify-end gap-2">
          <Button disabled={importing} onClick={closeImport}>
            {t('importScriptDialog.cancel')}
          </Button>
          <Button variant="primary" disabled={fresh.length === 0 || importing} onClick={run}>
            {fresh.length === 0 ? t('script.nothingToImport') : t('script.importCount', { scenes: tn('count.scenes', fresh.length) })}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

import { useEffect, useRef, useState, type RefObject } from 'react';
import { historyOnlyPictures } from '../../core/ops/ops';
import { fileSpace } from '../../core/storage/compact';
import { trashItems } from '../../features/trash/trash';
import { Button } from '../../ui/Button';
import { confirmForGood, sizeLabel } from '../confirm';
import { cleanUpConfirmed, emptyTrashConfirmed } from '../deleteForGood';
import { switchedMessage, type ForGood } from '../forGood';
import { showInfo, showNotice } from '../notice';
import { projectStore, useProject } from '../projectStore';
import { pluralKey, t } from '../../core/i18n';
import { Trans } from '../../ui/Trans';

// Settings → Storage (1.21): what the project's pictures take, and the two ways to give space back, each after a
// confirm that says it can't be undone. Empty Trash deletes the Trash for good. Clean up old pictures deletes pictures
// only History still uses (one added and then undone, say), never one a named version shows; the steps that used them
// then show "picture removed". Compact project (1.27) then shrinks the file itself, after a backup; it deletes
// nothing, so it asks nothing.

export function StorageTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  // Bumped by deletes that change no record (Clean up, a named version deleted), so the count is read again.
  const deletedForGood = useProject((s) => s.deletedForGood);
  const [old, setOld] = useState<{ count: number; bytes: number; shas: ReadonlySet<string> } | null>(null);
  // One run at a time, held in a ref so the buttons stay enabled (and focused) while the confirm is up.
  const running = useRef(false);
  // Bumped after Clean up, which changes no record, so the count is read again.
  const [generation, setGeneration] = useState(0);
  const pictureStatus = useRef<HTMLParagraphElement>(null);
  const trashStatus = useRef<HTMLParagraphElement>(null);
  const fileStatus = useRef<HTMLParagraphElement>(null);
  const [space, setSpace] = useState<{ bytes: number; free: number } | null>(null);
  const compacting = useProject((s) => s.compacting);

  // Read again after every edit: an undo can leave a picture to History alone.
  useEffect(() => {
    if (!project) return;
    let live = true;
    historyOnlyPictures(project.file)
      .then((pictures) => {
        if (live) {
          const bytes = pictures.reduce((sum, p) => sum + p.bytes, 0);
          setOld({ count: pictures.length, bytes, shas: new Set(pictures.map((p) => p.sha256)) });
        }
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, records, generation, deletedForGood]);

  // The file's size and free space, read again after every edit and delete.
  useEffect(() => {
    if (!project) return;
    let live = true;
    fileSpace(project.file)
      .then((measured) => {
        if (live) setSpace(measured);
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, records, generation, deletedForGood]);

  if (!project) return <p className="sb-label p-3 text-text-muted">{t('storageTile.noProjectOpen')}</p>;
  // As the Trash tile counts them: a scene's frames deleted with it are part of its row.
  const inTrash = trashItems(records, project.projectId).length;

  const run = async (
    act: () => Promise<ForGood<{ freed: number } | null>>,
    doneMessage: string,
    status: RefObject<HTMLParagraphElement | null>,
  ) => {
    try {
      const done = await act();
      if (!done.ran) {
        if (done.why === 'switched') showInfo(switchedMessage());
        return;
      }
      const result = done.result;
      if (result) showInfo(result.freed > 0 ? t('storage.doneFreed', { done: doneMessage, size: sizeLabel(result.freed) }) : t('storage.done', { done: doneMessage }));
      // The button turns off with nothing left to do; focus goes to the line that says what's left.
      requestAnimationFrame(() => {
        status.current?.focus();
      });
    } finally {
      setGeneration((n) => n + 1);
    }
  };

  const compact = async () => {
    if (compacting) return;
    const madeIn = project;
    try {
      const done = await projectStore.getState().compact();
      const state = projectStore.getState();
      if (done) {
        showInfo(t('storage.compacted', { before: sizeLabel(done.before), after: sizeLabel(done.after), backup: done.backup }));
        // The line it focuses says the new size: measured here, before focus moves to it.
        setSpace(await fileSpace(state.project?.file ?? madeIn.file));
        requestAnimationFrame(() => {
          fileStatus.current?.focus();
        });
      } else if (state.project !== madeIn) {
        showInfo(t('storage.compactSwitched'));
      } else if (!state.changedOnDisk && state.error === null) {
        // Focus stays on the button, to try again. A failed write has its notice from the store already; this words
        // only a failure it didn't, so nothing is said twice.
        showNotice(new Error(t('storage.compactFailed')));
      }
    } finally {
      setGeneration((n) => n + 1);
    }
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-5 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="sb-label">{t('storageTile.picturesOnlyHistoryUses')}</h3>
        <p ref={pictureStatus} tabIndex={-1} className="text-[13px]">
          {old === null
            ? t('storage.counting')
            : old.count === 0
              ? t('storage.noOldPictures')
              : <Trans k={pluralKey('storage.oldPictures', old.count)} parts={{ count: old.count, size: <span className="font-mono">{sizeLabel(old.bytes)}</span> }} />}
        </p>
        <p className="text-[12px] text-text-muted">
          {t('storageTile.picturesThatNoFrameShows')}
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={old === null || old.count === 0}
          onClick={() =>
            void run(
              // Only the pictures counted here.
              () => cleanUpConfirmed(projectStore, running, old?.shas ?? new Set(), (text) => confirmForGood(t('storage.cleanUpTitle'), text, t('storage.cleanUpAction'))),
              t('storage.cleanedUp'),
              pictureStatus,
            )
          }
        >
          {t('storageTile.cleanUpOldPictures')}
        </Button>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">{t('storageTile.trash')}</h3>
        <p ref={trashStatus} tabIndex={-1} className="text-[13px]">
          <Trans k={pluralKey('storage.inTrash', inTrash)} parts={{ count: <span className="font-mono">{String(inTrash)}</span> }} />
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={inTrash === 0}
          onClick={() =>
            void run(
              () => emptyTrashConfirmed(projectStore, running, (text) => confirmForGood(t('trash.emptyTitle'), text, t('trash.emptyAction'))),
              t('trash.emptied'),
              trashStatus,
            )
          }
        >
          {t('storageTile.emptyTrash')}
        </Button>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">{t('storageTile.projectFile')}</h3>
        <p ref={fileStatus} tabIndex={-1} className="text-[13px]">
          {space === null ? (
            t('storage.measuring')
          ) : (
            <Trans
              k={space.free > 0 ? 'storage.fileWithFree' : 'storage.fileNoFree'}
              parts={{ size: <span className="font-mono">{sizeLabel(space.bytes)}</span>, free: <span className="font-mono">{sizeLabel(space.free)}</span> }}
            />
          )}
        </p>
        <p className="text-[12px] text-text-muted">
          {t('storageTile.spaceFreedInsideTheProject')}
        </p>
        {/* aria-disabled while it runs, so focus stays on the button; the handler ignores a second click. */}
        <Button
          className="self-start"
          disabled={space === null}
          aria-disabled={compacting}
          aria-busy={compacting}
          onClick={() => void compact()}
        >
          {compacting ? t('storage.compacting') : t('storage.compact')}
        </Button>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState, type RefObject } from 'react';
import { historyOnlyPictures } from '../../core/ops/ops';
import { trashItems } from '../../features/trash/trash';
import { Button } from '../../ui/Button';
import { confirmForGood, sizeLabel } from '../confirm';
import { cleanUpConfirmed, emptyTrashConfirmed } from '../deleteForGood';
import { SWITCHED_MESSAGE, type ForGood } from '../forGood';
import { showInfo, showNotice } from '../notice';
import { projectStore, useProject } from '../projectStore';

// Settings → Storage (1.21): what the project's pictures take, and the two ways to give space back, each after a
// confirm that says it can't be undone. Empty Trash deletes the Trash for good. Clean up old pictures deletes pictures
// only History still uses (one added and then undone, say), never one a named version shows; the steps that used them
// then show "picture removed".

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

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
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
        if (done.why === 'switched') showInfo(SWITCHED_MESSAGE);
        return;
      }
      const result = done.result;
      if (result) showInfo(`${doneMessage}${result.freed > 0 ? `: ${sizeLabel(result.freed)} of pictures deleted for good` : ''}.`);
      // The button turns off with nothing left to do; focus goes to the line that says what's left.
      requestAnimationFrame(() => {
        status.current?.focus();
      });
    } finally {
      setGeneration((n) => n + 1);
    }
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-5 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="sb-label">Pictures only History uses</h3>
        <p ref={pictureStatus} tabIndex={-1} className="text-[13px]">
          {old === null
            ? 'Counting…'
            : old.count === 0
              ? 'None. Every stored picture is on the board, in the Trash or in a named version.'
              : `${String(old.count)} ${old.count === 1 ? 'picture' : 'pictures'}, `}
          {old !== null && old.count > 0 && <span className="font-mono">{sizeLabel(old.bytes)}</span>}
        </p>
        <p className="text-[12px] text-text-muted">
          Pictures that no frame shows, even from the Trash or a named version, but an older step in History does: one
          added and then undone, for example. Once deleted, the space they took inside the project is used for new pictures; the file itself
          doesn’t get smaller.
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={old === null || old.count === 0}
          onClick={() =>
            void run(
              // Only the pictures counted here.
              () => cleanUpConfirmed(projectStore, running, old?.shas ?? new Set(), (text) => confirmForGood('Clean up old pictures?', text, 'Clean up')),
              'Cleaned up old pictures',
              pictureStatus,
            )
          }
        >
          Clean up old pictures…
        </Button>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">Trash</h3>
        <p ref={trashStatus} tabIndex={-1} className="text-[13px]">
          <span className="font-mono">{String(inTrash)}</span> {inTrash === 1 ? 'item' : 'items'} in the Trash.
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={inTrash === 0}
          onClick={() =>
            void run(
              () => emptyTrashConfirmed(projectStore, running, (text) => confirmForGood('Empty Trash?', text, 'Empty Trash')),
              'Emptied the Trash',
              trashStatus,
            )
          }
        >
          Empty Trash…
        </Button>
      </section>
    </div>
  );
}

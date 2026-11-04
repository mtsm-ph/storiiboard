import { useEffect, useState } from 'react';
import { historyOnlyPictures } from '../../core/ops/ops';
import { trashItems } from '../../features/trash/trash';
import { Button } from '../../ui/Button';
import { confirmForGood, sizeLabel } from '../confirm';
import { showInfo, showNotice } from '../notice';
import { projectStore, useProject } from '../projectStore';

// Settings → Storage (1.21): what the project's pictures take, and the two ways to give space back, each after a
// confirm that says it can't be undone. Empty Trash deletes the Trash for good. Clean up old pictures deletes pictures
// only History still uses (one added and then undone, say); the steps that used them then show "picture removed".

export function StorageTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [old, setOld] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after Clean up, which changes no record, so the count is read again.
  const [generation, setGeneration] = useState(0);

  // Read again after every edit: an undo can leave a picture to History alone.
  useEffect(() => {
    if (!project) return;
    let live = true;
    historyOnlyPictures(project.file)
      .then((pictures) => {
        if (live) setOld({ count: pictures.length, bytes: pictures.reduce((sum, p) => sum + p.bytes, 0) });
      })
      .catch(showNotice);
    return () => {
      live = false;
    };
  }, [project, records, generation]);

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  // As the Trash tile counts them: a scene's frames deleted with it are part of its row.
  const inTrash = trashItems(records, project.projectId).length;

  const run = async (title: string, text: string, action: string, work: () => Promise<{ removed: number; freed: number } | null>, done: string) => {
    if (!(await confirmForGood(title, text, action))) return;
    setBusy(true);
    try {
      const result = await work();
      if (result) showInfo(`${done}${result.freed > 0 ? `, ${sizeLabel(result.freed)} freed` : ''}.`);
    } finally {
      setBusy(false);
      setGeneration((n) => n + 1);
    }
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-5 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="sb-label">Pictures only History uses</h3>
        <p className="text-[13px]">
          {old === null
            ? 'Counting…'
            : old.count === 0
              ? 'None. Every stored picture is on the board or in the Trash.'
              : `${String(old.count)} ${old.count === 1 ? 'picture' : 'pictures'}, `}
          {old !== null && old.count > 0 && <span className="font-mono">{sizeLabel(old.bytes)}</span>}
        </p>
        <p className="text-[12px] text-text-muted">
          Pictures that no frame shows, even from the Trash, but an older step in History does: one added and then undone,
          for example.
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={busy || old === null || old.count === 0}
          onClick={() =>
            void run(
              'Clean up old pictures?',
              `${String(old?.count ?? 0)} pictures only History uses will be deleted for good. This can’t be undone; those steps in History will show “picture removed”.`,
              'Clean up',
              () => projectStore.getState().cleanUpPictures(),
              'Cleaned up old pictures',
            )
          }
        >
          Clean up old pictures…
        </Button>
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">Trash</h3>
        <p className="text-[13px]">
          <span className="font-mono">{String(inTrash)}</span> {inTrash === 1 ? 'item' : 'items'} in the Trash.
        </p>
        <Button
          variant="warning"
          className="self-start"
          disabled={busy || inTrash === 0}
          onClick={() =>
            void run(
              'Empty Trash?',
              `${String(inTrash)} ${inTrash === 1 ? 'item' : 'items'} will be deleted for good, with their pictures. This can’t be undone, and History can’t bring them back.`,
              'Empty Trash',
              () => projectStore.getState().emptyTrash(),
              'Emptied the Trash',
            )
          }
        >
          Empty Trash…
        </Button>
      </section>
    </div>
  );
}

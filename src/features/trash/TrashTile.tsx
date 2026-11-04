import { useId, useRef, useState } from 'react';
import { confirmForGood, sizeLabel } from '../../app/confirm';
import { emptyTrashConfirmed } from '../../app/deleteForGood';
import { SWITCHED_MESSAGE } from '../../app/forGood';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { restoreChanges, restoredName, TRASH_KIND_LABEL, trashItems, type TrashKind } from './trash';

// The Trash tile (1.20): what's been deleted, newest first, filtered by type and scene, each brought back with one
// click as one undoable edit. Empty Trash (1.21) deletes it all for good, after a confirm that says it can't be
// undone. Any workspace can open it from the Layout menu; it's in no default layout (CLAUDE.md).

const KINDS: readonly TrashKind[] = ['scene', 'frame', 'note', 'picture'];

/** "Today 14:05", "Yesterday 09:12", or "Nov 2 14:05", in the person's own time. */
function when(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function TrashTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const [kind, setKind] = useState<TrashKind | ''>('');
  const [chosenScene, setSceneId] = useState('');
  const list = useRef<HTMLTableSectionElement>(null);
  const empty = useRef<HTMLParagraphElement>(null);
  // One restore at a time: a double click, or a click on the row that slid under the pointer, never restores a second.
  const restoring = useRef(false);
  // One Empty Trash at a time, held in a ref so the button stays enabled (and focused) while the confirm is up.
  const emptying = useRef(false);
  const captionId = useId();

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const all = trashItems(records, project.projectId);
  const scenes = [...new Map(all.filter((i) => i.sceneId !== null).map((i) => [i.sceneId ?? '', i.sceneName ?? ''])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], undefined, { numeric: true }),
  );
  // A scene whose last item was restored leaves the filter: it shows every scene again rather than nothing.
  const sceneId = scenes.some(([id]) => id === chosenScene) ? chosenScene : '';
  // And lets go of it (React redraws at once), so a later delete in that scene doesn't bring the filter back by itself.
  if (chosenScene !== '' && sceneId === '') setSceneId('');
  const shown = all.filter((i) => (kind === '' || i.kind === kind) && (sceneId === '' || i.sceneId === sceneId));

  const emptyAll = async (hidden: number) => {
    const done = await emptyTrashConfirmed(projectStore, emptying, (text) => confirmForGood('Empty Trash?', text, 'Empty Trash'), hidden);
    if (!done.ran) {
      if (done.why === 'switched') showInfo(SWITCHED_MESSAGE);
      return;
    }
    if (!done.result) return;
    const { items, freed } = done.result;
    showInfo(
      `Emptied the Trash: ${String(items)} ${items === 1 ? 'item' : 'items'} deleted for good${freed > 0 ? `, with ${sizeLabel(freed)} of pictures` : ''}.`,
    );
    // The button turns off with nothing left; focus goes to the message that says so.
    requestAnimationFrame(() => {
      empty.current?.focus();
    });
  };

  const restore = (id: string, name: string, index: number) => {
    if (restoring.current) return;
    restoring.current = true;
    let restored = false;
    void projectStore
      .getState()
      .applyWith((now) => {
        const changes = restoreChanges(now, project.projectId, id);
        restored = changes.length > 0;
        return { changes };
      })
      .then((written) => {
        if (!written || !restored) return;
        // As it's numbered now: a restore can give a frame or a scene a new number.
        showInfo(`Restored ${restoredName(projectStore.getState().records, id) ?? name}.`);
        // Focus stays in the list: on the row that took this one's place, or the one before at the end, or on the
        // message that the list is empty now.
        requestAnimationFrame(() => {
          const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-restore]');
          const next = buttons?.[Math.min(index, (buttons.length || 1) - 1)];
          (next ?? empty.current)?.focus();
        });
      })
      .finally(() => {
        restoring.current = false;
      });
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <Select
          label="Type"
          value={kind}
          onChange={(event) => {
            setKind(event.currentTarget.value as TrashKind | '');
          }}
        >
          <option value="">Everything</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {TRASH_KIND_LABEL[k]}s
            </option>
          ))}
        </Select>
        <Select
          label="Scene"
          mono
          value={sceneId}
          onChange={(event) => {
            setSceneId(event.currentTarget.value);
          }}
        >
          <option value="">All scenes</option>
          {scenes.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <p className="sb-label ml-auto font-mono">{`${String(all.length)} in the Trash`}</p>
        <Button variant="warning" disabled={all.length === 0} onClick={() => void emptyAll(all.length - shown.length)}>
          Empty Trash…
        </Button>
      </div>
      {all.length === 0 ? (
        <p ref={empty} tabIndex={-1} className="p-3 text-[13px] text-text-muted">
          The Trash is empty. Frames, notes and pictures you delete wait here until it’s emptied.
        </p>
      ) : shown.length === 0 ? (
        <p ref={empty} tabIndex={-1} className="p-3 text-[13px] text-text-muted">
          Nothing in the Trash matches these filters.
        </p>
      ) : (
        <table className="w-full border-collapse text-[12px]" aria-describedby={captionId}>
          <caption id={captionId} className="sr-only">
            Deleted items, newest first
          </caption>
          <thead>
            <tr className="border-b border-border">
              {['Type', 'Item', 'Scene', 'Deleted', ''].map((head) => (
                <th key={head} scope="col" className="sb-label px-2 py-1.5 text-left font-normal whitespace-nowrap text-text-muted">
                  {head === '' ? <span className="sr-only">Restore</span> : head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={list}>
            {shown.map((item, index) => (
              <tr key={item.id} className="border-b border-border">
                <td className="sb-label px-2 py-1.5 whitespace-nowrap">{TRASH_KIND_LABEL[item.kind]}</td>
                <td className="px-2 py-1.5">
                  {item.parts.map((part, i) =>
                    part.mono ? (
                      <span key={i} className="font-mono font-bold">
                        {part.text}
                      </span>
                    ) : (
                      <span key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </span>
                    ),
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap">{item.sceneName ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap">{when(item.trashedAt)}</td>
                <td className="px-2 py-1 text-right">
                  <Button
                    data-restore=""
                    aria-label={`Restore ${TRASH_KIND_LABEL[item.kind].toLowerCase()} ${item.name}`}
                    onClick={(event) => {
                      // The second click of a double click lands on the row that took this one's place.
                      if (event.detail > 1) return;
                      restore(item.id, item.name, index);
                    }}
                  >
                    Restore
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

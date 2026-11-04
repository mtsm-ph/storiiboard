import { useId, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/fields';
import { restoreChanges, TRASH_KIND_LABEL, trashItems, type TrashKind } from './trash';

// The Trash tile (1.20): what's been deleted, newest first, filtered by type and scene, each brought back with one
// click as one undoable edit. Empty Trash, which deletes for good after a confirm, comes in 1.21. Any workspace can
// open it from the Layout menu; it's in no default layout (CLAUDE.md).

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
  const [sceneId, setSceneId] = useState('');
  const list = useRef<HTMLTableSectionElement>(null);
  const captionId = useId();

  if (!project) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const all = trashItems(records, project.projectId);
  const scenes = [...new Map(all.filter((i) => i.sceneId !== null).map((i) => [i.sceneId ?? '', i.sceneName ?? ''])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], undefined, { numeric: true }),
  );
  const shown = all.filter((i) => (kind === '' || i.kind === kind) && (sceneId === '' || i.sceneId === sceneId));

  const restore = (id: string, name: string, index: number) => {
    void projectStore
      .getState()
      .applyWith((now) => ({ changes: restoreChanges(now, project.projectId, id) }))
      .then((written) => {
        if (!written) return;
        showInfo(`Restored ${name}.`);
        // Focus stays in the list: on the row that took this one's place, or the one before at the end.
        requestAnimationFrame(() => {
          const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-restore]');
          const next = buttons?.[Math.min(index, (buttons.length || 1) - 1)];
          if (next) next.focus();
        });
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
      </div>
      {all.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">The Trash is empty. Frames, notes and pictures you delete wait here until it’s emptied.</p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">Nothing in the Trash matches these filters.</p>
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
                <td className={item.mono ? 'px-2 py-1.5 font-mono font-bold' : 'px-2 py-1.5'}>{item.name}</td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap">{item.sceneName ?? '—'}</td>
                <td className="px-2 py-1.5 font-mono whitespace-nowrap">{when(item.trashedAt)}</td>
                <td className="px-2 py-1 text-right">
                  <Button
                    data-restore=""
                    aria-label={`Restore ${TRASH_KIND_LABEL[item.kind].toLowerCase()} ${item.name}`}
                    onClick={() => {
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

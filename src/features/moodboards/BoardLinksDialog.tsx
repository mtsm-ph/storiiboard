import { useState } from 'react';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { projectCharacters } from '../../core/model/person';
import { Button } from '../../ui/Button';
import { InAppWindow } from '../../ui/InAppWindow';
import { board, locations } from '../storyboard/board';
import { headingOf } from '../storyboard/ScenesView';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import { boardLinks, linkName } from './boards';
import { setBoardLinks } from './liveActions';

// Edit on a board's "Linked to" line (5.4): a picker of the project's scenes, characters and locations. Saving is one op group.

const CHECK = 'size-4 shrink-0 accent-text';

export function BoardLinksDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const records = useProject((s) => s.records);
  const projectId = useProject((s) => s.project?.projectId ?? null);
  const record = records[boardId];
  const now = record ? boardLinks(record.props) : { sceneIds: [], characterIds: [], locationIds: [] };
  const [scenes, setScenes] = useState<readonly string[]>(now.sceneIds);
  const [characters, setCharacters] = useState<readonly string[]>(now.characterIds);
  const [places, setPlaces] = useState<readonly string[]>(now.locationIds);
  if (!projectId) return null;
  const toggle = (list: readonly string[], set: (next: readonly string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };
  const group = (title: string, empty: string, rows: readonly { id: string; label: string }[], list: readonly string[], set: (next: readonly string[]) => void, kind: string) => (
    <fieldset className="flex flex-col gap-0.5" data-link-group={kind}>
      <legend className="sb-label mb-1">{title}</legend>
      {rows.length === 0 && <p className="text-[13px] text-text-muted">{empty}</p>}
      {rows.map((row) => (
        <label key={row.id} className="flex items-center gap-2 py-0.5 text-[13px]">
          <input type="checkbox" className={CHECK} checked={list.includes(row.id)} data-link-pick={`${kind}:${row.id}`} onChange={() => { toggle(list, set, row.id); }} />
          <span data-user-text="">{row.label}</span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <InAppWindow title={t('moodboard.links.dialogTitle')} onClose={onClose} width={480}>
      <form
        data-board-links-dialog=""
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void setBoardLinks(boardId, { sceneIds: [...scenes], characterIds: [...characters], locationIds: [...places] });
        }}
      >
        <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto border border-border p-2">
          {group(
            t('moodboard.links.scenes'),
            t('moodboard.links.noScenes'),
            board(records, projectId).map((s) => ({ id: s.record.id, label: `${sceneLabel(sceneFields(s.record.props).number)} ${headingOf(s.fields)}` })),
            scenes,
            setScenes,
            'scene',
          )}
          {group(
            t('moodboard.links.characters'),
            t('moodboard.links.noCharacters'),
            projectCharacters(records, projectId).map((c) => ({ id: c.id, label: linkName('character', c) })),
            characters,
            setCharacters,
            'character',
          )}
          {group(t('moodboard.links.locations'), t('moodboard.links.noLocations'), locations(records, projectId).map((l) => ({ id: l.id, label: l.name })), places, setPlaces, 'location')}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t('moodboard.cancel')}
          </Button>
          <Button type="submit" variant="primary" data-links-save="">
            {t('moodboard.links.save')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}

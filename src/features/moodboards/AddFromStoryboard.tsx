import { useId, useMemo, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { InAppWindow } from '../../ui/InAppWindow';
import { board } from '../storyboard/board';
import { addLiveCards } from './liveActions';
import type { CardTarget } from './liveAdd';
import { pickScenes } from './liveCards';

// "Add from storyboard" (5.4): the scenes in order, each with its frames, searchable by scene number, heading or shot number.
// Tick scenes (a scene card), their palettes (a palette card) and frames (a shot card), and the brand kit; they land together
// as a tidied row at the middle of the view, one op group.

const CHECK = 'size-4 shrink-0 accent-text';

export function AddFromStoryboard({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const records = useProject((s) => s.records);
  const projectId = useProject((s) => s.project?.projectId ?? null);
  const [query, setQuery] = useState('');
  // What is ticked, by card: "shot:<id>", "scene:<id>", "palette:<id>", "brand".
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const listId = useId();
  const scenes = useMemo(() => (projectId ? board(records, projectId) : []), [records, projectId]);
  const shown = useMemo(() => pickScenes(scenes, query), [scenes, query]);
  const toggle = (key: string) => {
    setTicked((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));
  };
  const submit = () => {
    // Scenes in the order of the storyboard, whatever order they were ticked in; a scene's card, its palette, then its frames.
    const targets: CardTarget[] = [];
    if (ticked.includes('brand')) targets.push({ kind: 'brand_card' });
    for (const scene of scenes) {
      if (ticked.includes(`scene:${scene.record.id}`)) targets.push({ kind: 'scene_card', sceneId: scene.record.id });
      if (ticked.includes(`palette:${scene.record.id}`)) targets.push({ kind: 'palette_card', sceneId: scene.record.id });
      for (const shot of scene.shots) if (ticked.includes(`shot:${shot.record.id}`)) targets.push({ kind: 'shot_card', shotId: shot.record.id });
    }
    onClose();
    void addLiveCards(boardId, targets);
  };
  const box = (key: string, label: string, mono = false) => (
    <label key={key} className="flex items-center gap-2 py-0.5 text-[13px]">
      <input type="checkbox" className={CHECK} checked={ticked.includes(key)} data-pick={key} onChange={() => { toggle(key); }} />
      <span className={mono ? 'font-mono' : undefined}>{label}</span>
    </label>
  );
  return (
    <InAppWindow title={t('moodboard.live.addTitle')} onClose={onClose} width={520}>
      <form
        data-add-from-storyboard=""
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ticked.length > 0) submit();
        }}
      >
        <TextField
          label={t('moodboard.live.search')}
          value={query}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the window exists to pick from this list
          autoFocus
          aria-controls={listId}
          data-pick-search=""
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
        <div id={listId} className="flex max-h-[320px] flex-col gap-2 overflow-y-auto border border-border p-2">
          {(query.trim() === '' || ticked.includes('brand')) && <div className="border-b border-border pb-1">{box('brand', t('moodboard.live.brandKit'))}</div>}
          {shown.length === 0 && <p className="text-[13px] text-text-muted">{scenes.length === 0 ? t('moodboard.live.noScenes') : t('moodboard.live.nothingFound')}</p>}
          {shown.map((scene) => (
            <fieldset key={scene.id} className="flex flex-col" data-pick-scene={scene.id}>
              <legend className="sr-only">{`${scene.label} ${scene.heading}`}</legend>
              <div className="flex flex-wrap items-center gap-x-4">
                {box(`scene:${scene.id}`, `${scene.label} ${scene.heading}`)}
                {box(`palette:${scene.id}`, t('moodboard.live.paletteOf'))}
              </div>
              <div className="flex flex-wrap gap-x-4 pl-6">{scene.frames.map((frame) => box(`shot:${frame.id}`, frame.number || t('moodboard.live.frameAt', { scene: scene.label, n: frame.position }), true))}</div>
            </fieldset>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <span role="status" className="sb-label mr-auto font-mono">
            {tn('moodboard.live.picked', ticked.length)}
          </span>
          <Button type="button" onClick={onClose}>
            {t('moodboard.cancel')}
          </Button>
          <Button type="submit" variant="primary" data-pick-add="" disabled={ticked.length === 0}>
            {t('moodboard.live.add')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}

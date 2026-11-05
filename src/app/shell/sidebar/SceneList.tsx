import { cx } from '../../../ui/cx';
import { sceneLabel, type SceneEntry } from './scenes';
import { onNavKeyDown } from './navKeys';
import { t } from '../../../core/i18n';

interface SceneListProps {
  scenes: readonly SceneEntry[];
  activeSceneId: string | null;
  /** False with no project open: there's nowhere to add a scene. */
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

/** Storyboard's scenes inline in the sidebar, "SC 04  Scene Name", then "+ Add Scene" (DESIGN.md, Navigation). */
export function SceneList({ scenes, activeSceneId, canAdd, onSelect, onAdd }: SceneListProps) {
  return (
    <ul aria-label={t('sceneList.scenes')} className="pb-1">
      {scenes.map((scene) => {
        const current = scene.id === activeSceneId;
        return (
          <li key={scene.id}>
            <button
              type="button"
              data-nav-item=""
              onKeyDown={onNavKeyDown}
              aria-current={current ? 'true' : undefined}
              tabIndex={-1}
              onClick={() => {
                onSelect(scene.id);
              }}
              className="flex h-7 w-full items-center gap-2 px-4 text-left text-[12px] hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              {/* The active scene's marker is orange; its bold name is the second cue. */}
              <span aria-hidden="true" className={cx('size-1.5 shrink-0', current ? 'bg-accent' : 'border border-text')} />
              <span className="font-mono text-[11px]">{sceneLabel(scene.number)}</span>
              <span className={cx('truncate', current && 'font-bold')}>{scene.name || t('scene.untitled')}</span>
            </button>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          data-nav-item=""
          onKeyDown={onNavKeyDown}
          tabIndex={-1}
          disabled={!canAdd}
          onClick={onAdd}
          className="sb-label flex h-7 w-full items-center pl-[30px] text-left enabled:hover:bg-surface-raised disabled:text-text-muted focus-visible:-outline-offset-4"
        >
          {t('sceneList.addScene')}
        </button>
      </li>
    </ul>
  );
}

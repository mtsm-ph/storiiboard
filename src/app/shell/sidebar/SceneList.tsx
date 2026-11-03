import { cx } from '../../../ui/cx';
import { sceneLabel, type SceneEntry } from './scenes';
import { onNavKeyDown } from './navKeys';

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
    <ul aria-label="Scenes" className="pb-1">
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
              className="flex h-7 w-full items-center gap-2 px-4 text-left text-[12px] hover:bg-oatmeal focus-visible:-outline-offset-4"
            >
              {/* The active scene's marker is orange; its bold name is the second cue. */}
              <span aria-hidden="true" className={cx('size-1.5 shrink-0', current ? 'bg-accent' : 'border border-ink')} />
              <span className="font-mono text-[11px]">{sceneLabel(scene.number)}</span>
              <span className={cx('truncate', current && 'font-bold')}>{scene.name || 'Untitled'}</span>
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
          className="sb-label flex h-7 w-full items-center pl-[30px] text-left enabled:hover:bg-oatmeal disabled:text-muted focus-visible:-outline-offset-4"
        >
          + Add Scene
        </button>
      </li>
    </ul>
  );
}

import { useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { paletteOf } from '../../../core/model/palette';
import { sceneLabel } from '../../../core/model/storyboard';
import { cx } from '../../../ui/cx';
import { board } from '../board';
import { headingOf } from '../ScenesView';
import { useSelection } from '../selection';

// The Color script (polish PP): every scene's palette in script order, so the film's colour arc reads at a glance.
// A scene's row opens it (the inspector then edits its palette). Scenes in the Trash are left out, as everywhere.

export function ColorScriptTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const activeSceneId = useSelection((s) => s.sceneId);
  const selectScene = useSelection((s) => s.selectScene);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('colorScript.noProject')}</p>;
  const scenes = board(records, project.projectId);
  if (scenes.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('colorScript.noScenes')}</p>;

  return (
    <ol aria-label={t('colorScript.list')} className="flex flex-col">
      {scenes.map((scene) => {
        const colors = paletteOf(scene.record.props)?.colors ?? [];
        const active = scene.record.id === activeSceneId;
        return (
          <li key={scene.record.id} className="border-b border-border">
            <button
              type="button"
              data-color-script-scene={scene.record.id}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                selectScene(scene.record.id);
              }}
              className="grid w-full grid-cols-[minmax(0,160px)_1fr] items-center gap-3 px-3 py-1.5 text-left hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={cx('font-mono text-[12px] font-bold', active && 'bg-text px-1 text-text-inverse')}>
                  {sceneLabel(scene.fields.number)}
                </span>
                <span data-user-text="" className="truncate text-[12px]">{headingOf(scene.fields)}</span>
              </span>
              {colors.length > 0 ? (
                <>
                  {/* The colours are the person's data: drawn as they are, each its own cell. */}
                  <span aria-hidden="true" className="flex h-5 border border-text">
                    {colors.map((color, i) => (
                      // Each cell ruled from the next, so two close colours, or a pale one, still read as two.
                      <span key={color.hex} title={color.hex} className={cx('flex-1', i > 0 && 'border-l border-text')} style={{ backgroundColor: color.hex }} />
                    ))}
                  </span>
                  <span className="sr-only">
                    {t('colorScript.colours', { count: tn('count.colours', colors.length), hexes: colors.map((c) => c.hex).join(', ') })}
                  </span>
                </>
              ) : (
                // Text, not muted: the row's hover fill is oatmeal, where muted text falls below AA.
                <span className="text-[12px]">{t('colorScript.noPalette')}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

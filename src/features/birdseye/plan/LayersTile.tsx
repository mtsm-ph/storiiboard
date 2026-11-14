import { useMemo } from 'react';
import { useProject } from '../../../app/projectStore';
import { labels, t, tn } from '../../../core/i18n';
import { shownItems, type PlanLayer } from '../../../core/model/plan';
import { LAYER_DEPARTMENT, LAYER_ORDER, LAYER_SHOWS, layerCounts, type LayerShow, type LayerState } from '../../../core/model/planLayers';
import { cx } from '../../../ui/cx';
import { SegmentedControl } from '../../../ui/SegmentedControl';
import { DepartmentTag } from '../../../ui/tags';
import { myDepartmentLayers, setLayerLocked, setLayerShow, showAllLayers, soloLayer, usePlanLayerStates, useSoloLayer } from './layersStore';
import { groupName } from './library';
import { useLiveView } from './PlanTile';

// The Layers tile (6.8), in the Setup workspace: one row per department layer in call-sheet order, each with its
// department's colour as a tag (a tag, never state), how many of the shown plan's items are on it, Shown / Dimmed /
// Hidden, Lock and Solo; Show all and My department above. A focus view on this computer, never the project's: no edit,
// nothing in History. The Plan tile reads the same state (layersStore.ts).

const SHOW_WORDS = labels<LayerShow>({ shown: 'layers.show.shown', dimmed: 'layers.show.dimmed', hidden: 'layers.show.hidden' });

const SMALL = 'sb-label h-[18px] shrink-0 border border-text px-2 focus-visible:-outline-offset-4';

export function LayersTile() {
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  const states = usePlanLayerStates();
  const solo = useSoloLayer();
  const sceneId = live?.view.sceneId ?? null;
  const setupId = live?.view.setupId ?? null;
  // The shown plan's items per layer; none when no plan is shown.
  const counts = useMemo(() => (sceneId === null ? null : layerCounts(records, shownItems(records, sceneId, setupId))), [records, sceneId, setupId]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-layers-tile="" aria-label={t('layers.label')}>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={cx(SMALL, 'h-6')} data-layers-all="" onClick={showAllLayers}>
          {t('layers.showAll')}
        </button>
        <button type="button" className={cx(SMALL, 'h-6')} data-layers-mine="" title={t('layers.myDepartmentHint')} onClick={myDepartmentLayers}>
          {t('layers.myDepartment')}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {LAYER_ORDER.map((layer) => (
          <LayerRow key={layer} layer={layer} state={states[layer]} count={counts?.[layer] ?? 0} soloed={solo === layer} />
        ))}
      </ul>
      <p className="text-[12px] text-text-muted">{t('layers.keys')}</p>
    </section>
  );
}

function LayerRow({ layer, state, count, soloed }: { layer: PlanLayer; state: LayerState; count: number; soloed: boolean }) {
  const name = groupName(layer);
  // Read each time, so a change of language reads them again.
  const options = LAYER_SHOWS.map((value) => ({ value, label: SHOW_WORDS[value] }));
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      data-layer={layer}
      data-layer-show={state.show}
      data-layer-locked={state.locked ? 'true' : undefined}
      data-layer-empty={count === 0 ? 'true' : undefined}
    >
      <span className="flex w-36 min-w-0 items-center gap-1.5">
        <DepartmentTag department={LAYER_DEPARTMENT[layer]} label={name} />
        <span className={cx('font-mono text-[12px]', count === 0 && 'text-text-muted')} data-layer-count={count}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{tn('layers.items', count)}</span>
        </span>
      </span>
      {/* At its words' own width, never squeezed (Spanish's "Atenuada" spilled out of a shared cell): the row wraps instead. */}
      <div className="w-max shrink-0">
        <SegmentedControl<LayerShow>
          label={t('layers.showOf', { layer: name })}
          hideLabel
          size="sm"
          options={options}
          value={state.show}
          onChange={(show) => {
            setLayerShow(layer, show);
          }}
        />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={state.locked}
        aria-label={t('layers.lockOf', { layer: name })}
        data-layer-lock={layer}
        className={cx(SMALL, state.locked ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'text-text')}
        onClick={() => {
          setLayerLocked(layer, !state.locked);
        }}
      >
        {t('layers.lock')}
      </button>
      <button
        type="button"
        aria-pressed={soloed}
        aria-label={t('layers.soloOf', { layer: name })}
        data-layer-solo={layer}
        className={cx(SMALL, soloed ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'text-text')}
        onClick={() => {
          soloLayer(layer);
        }}
      >
        {t('layers.solo')}
      </button>
    </li>
  );
}

import { useMemo } from 'react';
import { useProject } from '../../../app/projectStore';
import { labels, t, tn } from '../../../core/i18n';
import { shownItems, type PlanLayer } from '../../../core/model/plan';
import { LAYER_DEPARTMENT, LAYER_ORDER, LAYER_SHOWS, layerCounts, type LayerShow, type LayerState } from '../../../core/model/planLayers';
import { cx } from '../../../ui/cx';
import { LayerShowGlyph, LockGlyph } from '../../../ui/glyphs';
import { roveFocus } from '../../../ui/roving';
import { DepartmentSwatch } from '../../../ui/tags';
import { myDepartmentLayers, setLayerLocked, setLayerShow, showAllLayers, soloLayer, usePlanLayerStates, useSoloLayer } from './layersStore';
import { groupName } from './library';
import { useLiveView } from './PlanTile';

// The Layers tile (6.8), in the Setup workspace: one row per department layer in call-sheet order, each with its
// department's colour as a tag (a tag, never state), its name, how many of the shown plan's items are on it, Shown /
// Dimmed / Hidden, Lock and Solo; Show all and My department above. A focus view on this computer, never the
// project's: no edit, nothing in History. The Plan tile reads the same state (layersStore.ts). Each row is one line
// that fits a 200 px tile (6.8 review): the choices are small icon buttons, named in words for screen readers and in
// their titles; a name too long for the row ends in an ellipsis, whole in its title.

const SHOW_WORDS = labels<LayerShow>({ shown: 'layers.show.shown', dimmed: 'layers.show.dimmed', hidden: 'layers.show.hidden' });
/** Each choice's name for screen readers, with its layer's: "Lighting: hidden". */
const SHOW_NAMES = { shown: 'layers.showIn.shown', dimmed: 'layers.showIn.dimmed', hidden: 'layers.showIn.hidden' } as const satisfies Record<LayerShow, string>;

const SMALL = 'sb-label h-6 shrink-0 border border-text px-1.5 focus-visible:-outline-offset-4';
/** One small square cell: an icon choice or the lock. Selection and a pressed lock are an ink fill. */
const CELL = 'flex h-[18px] w-[15px] shrink-0 items-center justify-center focus-visible:-outline-offset-2';
const inked = (on: boolean) => (on ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'text-text');

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
      {/* One row above the list; only where both can't fit whole (Spanish in a tile under 200 px) does it wrap. */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={SMALL} data-layers-all="" onClick={showAllLayers}>
          {t('layers.showAll')}
        </button>
        <button type="button" className={SMALL} data-layers-mine="" title={t('layers.myDepartmentHint')} onClick={myDepartmentLayers}>
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
  return (
    <li
      className="flex h-[18px] items-center gap-[3px] whitespace-nowrap"
      data-layer={layer}
      data-layer-show={state.show}
      data-layer-locked={state.locked ? 'true' : undefined}
      data-layer-empty={count === 0 ? 'true' : undefined}
    >
      <DepartmentSwatch department={LAYER_DEPARTMENT[layer]} />
      <span className="min-w-0 flex-1 truncate text-[12px] leading-[18px]" title={name} data-layer-name="">
        {name}
      </span>
      <span className={cx('min-w-[1ch] shrink-0 text-right font-mono text-[12px] leading-[18px]', count === 0 && 'text-text-muted')} data-layer-count={count}>
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{tn('layers.items', count)}</span>
      </span>
      <ShowChoice layer={layer} name={name} show={state.show} />
      <button
        type="button"
        aria-pressed={state.locked}
        aria-label={t('layers.lockOf', { layer: name })}
        title={t('layers.lockOf', { layer: name })}
        data-layer-lock={layer}
        className={cx(CELL, 'border border-text', inked(state.locked))}
        onClick={() => {
          setLayerLocked(layer, !state.locked);
        }}
      >
        <LockGlyph open={!state.locked} inherit />
      </button>
      <button
        type="button"
        aria-pressed={soloed}
        aria-label={t('layers.soloOf', { layer: name })}
        title={t('layers.soloOf', { layer: name })}
        data-layer-solo={layer}
        className={cx('sb-label h-[18px] shrink-0 border border-text px-[2px] tracking-normal focus-visible:-outline-offset-2', inked(soloed))}
        onClick={() => {
          soloLayer(layer);
        }}
      >
        {t('layers.solo')}
      </button>
    </li>
  );
}

/**
 * Shown, Dimmed or Hidden, as three icon cells (a radio group, one Tab stop, the arrows picking as native radios do):
 * each named "Lighting: hidden", the current one an ink fill.
 */
function ShowChoice({ layer, name, show }: { layer: PlanLayer; name: string; show: LayerShow }) {
  return (
    <div role="radiogroup" aria-label={t('layers.showOf', { layer: name })} className="flex shrink-0 border border-text">
      {LAYER_SHOWS.map((value, i) => {
        const selected = value === show;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(SHOW_NAMES[value], { layer: name })}
            title={SHOW_WORDS[value]}
            tabIndex={selected ? 0 : -1}
            className={cx(CELL, i > 0 && 'border-l border-text', inked(selected))}
            onClick={() => {
              setLayerShow(layer, value);
            }}
            onKeyDown={(event) => {
              const next = roveFocus(event, i, LAYER_SHOWS.length, '[role="radio"]');
              const picked = next === null ? undefined : LAYER_SHOWS[next];
              if (picked) setLayerShow(layer, picked);
            }}
          >
            <LayerShowGlyph show={value} />
          </button>
        );
      })}
    </div>
  );
}

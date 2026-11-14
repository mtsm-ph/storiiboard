import { useId, useMemo } from 'react';
import { useProject } from '../../../app/projectStore';
import { labels, t, tn } from '../../../core/i18n';
import { shownItems, type PlanLayer } from '../../../core/model/plan';
import { LAYER_DEPARTMENT, LAYER_ORDER, LAYER_SHOWS, layerCounts, type LayerShow, type LayerState } from '../../../core/model/planLayers';
import { cx } from '../../../ui/cx';
import { LayerShowGlyph, LockGlyph } from '../../../ui/glyphs';
import { roveFocus } from '../../../ui/roving';
import { DepartmentSwatch } from '../../../ui/tags';
import { myDepartmentLayers, setLayerLocked, setLayerShow, showAllLayers, soloLayer, useLayersSaid, usePlanLayerStates, useSoloLayer } from './layersStore';
import { groupName } from './library';
import { useLiveView } from './PlanTile';

// The Layers tile (6.8), in the Setup workspace: one row per department layer in call-sheet order, each with its
// department's colour as a tag (a tag, never state), its name, how many of the shown plan's items are on it, Shown /
// Dimmed / Hidden, Lock and Solo; Show all and My department above. A focus view on this computer, never the
// project's: no edit, nothing in History. The Plan tile reads the same state (layersStore.ts). The choices are small
// icon buttons, named in words for screen readers and in their titles, so a row is one line wherever its name fits
// beside them; where it doesn't, in any language, the name goes onto a second line of its own (the row grows, the
// controls stay on its first line at the right), never cut short (6.8 second review). A layer with nothing on it is muted as a whole, still usable.

const SHOW_WORDS = labels<LayerShow>({ shown: 'layers.show.shown', dimmed: 'layers.show.dimmed', hidden: 'layers.show.hidden' });
/** Each choice's name for screen readers, with its layer's: "Lighting: hidden". */
const SHOW_NAMES = { shown: 'layers.showIn.shown', dimmed: 'layers.showIn.dimmed', hidden: 'layers.showIn.hidden' } as const satisfies Record<LayerShow, string>;

const SMALL = 'sb-label h-6 shrink-0 border border-text px-1.5 focus-visible:-outline-offset-4';
/** One small square cell: an icon choice or the lock. Selection and a pressed lock are an ink fill. */
const CELL = 'flex h-[18px] w-[15px] shrink-0 items-center justify-center focus-visible:-outline-offset-2';
/**
 * Room either side of the lock, a lone 15 px target: its centre 24 px from the nearest choice cell's and 12 px from Solo's
 * edge, so it meets WCAG 2.2's target spacing (axe's target-size) beside them.
 */
const LOCK_ROOM = 'ml-[7px] mr-[3px]';
/** A cell's ink: selection and a pressed lock are an ink fill; otherwise ink, or muted in a row with nothing on it. */
const inked = (on: boolean, muted = false) => (on ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : muted ? 'text-text-muted' : 'text-text');
/** A control's outline: ink, or muted in a row with nothing on it. */
const edge = (muted: boolean) => (muted ? 'border-text-muted' : 'border-text');

export function LayersTile() {
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  const states = usePlanLayerStates();
  const solo = useSoloLayer();
  const said = useLayersSaid('tile');
  const sceneId = live?.view.sceneId ?? null;
  const setupId = live?.view.setupId ?? null;
  // The shown plan's items per layer; none when no plan is shown.
  const counts = useMemo(() => (sceneId === null ? null : layerCounts(records, shownItems(records, sceneId, setupId))), [records, sceneId, setupId]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2" data-layers-tile="" aria-label={t('layers.label')}>
      {/* One row above the list; only where both can't fit whole (Spanish in a tile under 200 px) does it wrap. */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={SMALL}
          data-layers-all=""
          onClick={() => {
            showAllLayers();
          }}
        >
          {t('layers.showAll')}
        </button>
        <button
          type="button"
          className={SMALL}
          data-layers-mine=""
          title={t('layers.myDepartmentHint')}
          onClick={() => {
            myDepartmentLayers();
          }}
        >
          {t('layers.myDepartment')}
        </button>
      </div>
      {/* 6 px between 18 px rows: each row's small targets 24 px from the next row's, as WCAG 2.2's spacing asks. */}
      <ul className="flex flex-col gap-1.5">
        {LAYER_ORDER.map((layer) => (
          <LayerRow key={layer} layer={layer} state={states[layer]} count={counts?.[layer] ?? 0} solo={solo} />
        ))}
      </ul>
      <p className="text-[12px] text-text-muted">{t('layers.keys')}</p>
      {/* What the last change here did, read out (L3); the plan's keys are read by the canvas's own line. */}
      <p role="status" className="sr-only" data-layers-said="">
        {said}
      </p>
    </section>
  );
}

function LayerRow({ layer, state, count, solo }: { layer: PlanLayer; state: LayerState; count: number; solo: PlanLayer | null }) {
  const name = groupName(layer);
  const empty = count === 0;
  const soloed = solo === layer;
  // During another layer's solo this one's lock is the solo's: shown on, not changed here, and said why (6.8 review, M3).
  const heldBy = solo !== null && !soloed ? groupName(solo) : null;
  const lockHeld = heldBy !== null;
  const heldId = useId();
  // Wrapping in reverse: where the name doesn't fit beside the controls, the controls' line goes on top (right-aligned)
  // and the name takes the whole line under it, whole; only a name wider than the tile breaks, by its words.
  return (
    <li
      className={cx('flex min-h-[18px] flex-wrap-reverse items-start gap-x-[2px]', empty && 'text-text-muted')}
      data-layer={layer}
      data-layer-show={state.show}
      data-layer-locked={state.locked ? 'true' : undefined}
      data-layer-empty={empty ? 'true' : undefined}
    >
      <span className="flex min-w-0 max-w-full shrink-0 items-start gap-[2px]">
        <span className="flex h-[18px] shrink-0 items-center">
          {empty ? <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 bg-text-muted" /> : <DepartmentSwatch department={LAYER_DEPARTMENT[layer]} />}
        </span>
        <span className="min-w-0 break-words text-[12px] leading-[18px]" data-layer-name="">
          {name}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-start gap-[2px]" data-layer-controls="">
        <span className="min-w-[1ch] shrink-0 text-right font-mono text-[12px] leading-[18px]" data-layer-count={count}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{tn('layers.items', count)}</span>
        </span>
        <ShowChoice layer={layer} name={name} show={state.show} muted={empty} />
        <button
          type="button"
          aria-pressed={state.locked}
          aria-disabled={lockHeld || undefined}
          aria-label={t('layers.lockOf', { layer: name })}
          aria-describedby={lockHeld ? heldId : undefined}
          title={heldBy !== null ? t('layers.lockedBySolo', { layer: heldBy }) : t('layers.lockOf', { layer: name })}
          data-layer-lock={layer}
          className={cx(CELL, LOCK_ROOM, 'border', lockHeld ? 'cursor-default border-dashed' : '', edge(empty || lockHeld), inked(state.locked && !lockHeld, empty || lockHeld))}
          onClick={() => {
            if (!lockHeld) setLayerLocked(layer, !state.locked);
          }}
        >
          <LockGlyph open={!state.locked} inherit />
        </button>
        {heldBy !== null && (
          <span id={heldId} className="sr-only">
            {t('layers.lockedBySolo', { layer: heldBy })}
          </span>
        )}
        <button
          type="button"
          aria-pressed={soloed}
          aria-label={t('layers.soloOf', { layer: name })}
          title={t('layers.soloOf', { layer: name })}
          data-layer-solo={layer}
          className={cx('sb-label h-[18px] shrink-0 border px-px tracking-normal focus-visible:-outline-offset-2', edge(empty), inked(soloed, empty))}
          onClick={() => {
            soloLayer(layer);
          }}
        >
          {t('layers.solo')}
        </button>
      </span>
    </li>
  );
}

/**
 * Shown, Dimmed or Hidden, as three icon cells (a radio group, one Tab stop, the arrows picking as native radios do):
 * each named "Lighting: hidden", the current one an ink fill.
 */
function ShowChoice({ layer, name, show, muted }: { layer: PlanLayer; name: string; show: LayerShow; muted: boolean }) {
  return (
    // Its outline sits a pixel above and below the row's 18 px (-my-px), its cells level with the lock and Solo, so a
    // one-line row stays 18 px and the seven rows fit the Setup workspace's default layout as before.
    <div role="radiogroup" aria-label={t('layers.showOf', { layer: name })} className={cx('-my-px flex shrink-0 border', edge(muted))}>
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
            className={cx(CELL, i > 0 && cx('border-l', edge(muted)), inked(selected, muted))}
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

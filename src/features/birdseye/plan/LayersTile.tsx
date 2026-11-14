import { useId, useMemo } from 'react';
import { useProject } from '../../../app/projectStore';
import { labels, t, tn } from '../../../core/i18n';
import { sceneRoomId, shownItems, type PlanLayer } from '../../../core/model/plan';
import { LAYER_DEPARTMENT, LAYER_ORDER, LAYER_SHOWS, layerCounts, rowState, UNDERLAY_ROW, type LayerRow, type LayerShow, type LayerState } from '../../../core/model/planLayers';
import { cx } from '../../../ui/cx';
import { LayerShowGlyph, LockGlyph } from '../../../ui/glyphs';
import { roveFocus, rovingIndex } from '../../../ui/roving';
import { DepartmentSwatch } from '../../../ui/tags';
import { myDepartmentLayers, rowName, setLayerLocked, setLayerShow, showAllLayers, soloLayer, startUnderlayScale, useLayersSaid, usePlanLayerStates, useSoloLayer } from './layersStore';
import { groupName } from './library';
import { useLiveView } from './PlanTile';
import { usePlan } from './planStore';
import { scaleTarget } from './underlayEdits';
import { viewKey } from './planItems';

// The Layers tile (6.8), in the Setup workspace: one row per department layer in call-sheet order, each with its
// department's colour as a tag (a tag, never state), its name, how many of the shown plan's items are on it, Shown /
// Dimmed / Hidden, Lock and Solo; Show all and My department above. A focus view on this computer, never the
// project's: no edit, nothing in History. The Plan tile reads the same state (layersStore.ts). The choices are icon
// buttons, named in words for screen readers and in their titles, each a 24 px square (WCAG 2.2's least target, 2.5.8,
// met by the target's own size, so no spacing is needed beside it), so a row is one 24 px line wherever its name fits
// beside them; where it doesn't, in any language, the name keeps the first line and the controls go onto the line below,
// at the right (L7: a row reads top to bottom), never cut short. A layer with nothing on it is muted as a whole, still
// usable. During a solo every other row's choice and lock are the solo's: shown as they are, held and saying why (M-a).

const SHOW_WORDS = labels<LayerShow>({ shown: 'layers.show.shown', dimmed: 'layers.show.dimmed', hidden: 'layers.show.hidden' });
/** Each choice's name for screen readers, with its layer's: "Lighting: hidden". */
const SHOW_NAMES = { shown: 'layers.showIn.shown', dimmed: 'layers.showIn.dimmed', hidden: 'layers.showIn.hidden' } as const satisfies Record<LayerShow, string>;

const SMALL = 'sb-label h-6 shrink-0 border border-text px-1.5 focus-visible:-outline-offset-4';
/** One 24 × 24 px cell (WCAG 2.2's least target, by its own size): an icon choice or the lock. */
const CELL = 'flex h-6 w-6 shrink-0 items-center justify-center focus-visible:-outline-offset-2';
/** A word button on a row (Solo, Scale): 24 px high and at least as wide. */
const WORD = 'sb-label h-6 min-w-6 shrink-0 border px-0.5 tracking-normal focus-visible:-outline-offset-2';
/** A row: its name first, its controls at the right, on the line below where they don't fit beside it (L7). */
const ROW = 'flex min-h-6 flex-wrap items-center gap-x-1';
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
      {/* Each target is 24 px square on its own, so the rows need no spacing for it: 4 px keeps the eight in view. */}
      <ul className="flex flex-col gap-1">
        {LAYER_ORDER.map((layer) => (
          <LayerRow key={layer} layer={layer} state={states[layer]} count={counts?.[layer] ?? 0} solo={solo} />
        ))}
        <UnderlayRow state={rowState(states, UNDERLAY_ROW)} count={counts?.[UNDERLAY_ROW] ?? 0} solo={solo} roomId={sceneId === null ? null : sceneRoomId(records, records[sceneId])} viewKeyNow={sceneId === null ? null : viewKey(sceneId, setupId)} />
      </ul>
      <p className="text-[12px] text-text-muted">{t('layers.keys')}</p>
      {/* What the last change here that touched several rows did (a solo, its end, Show all, My department), read out
          (L3); a single control speaks its own new state, and the plan's keys are read by the canvas's own line. */}
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
  // During another layer's solo this one's choice and lock are the solo's: shown as they are, not changed here, and
  // said why (6.8 review, M3; second review, M-a).
  const heldBy = solo !== null && !soloed ? groupName(solo) : null;
  const lockHeld = heldBy !== null;
  const heldId = useId();
  // Where the name doesn't fit beside the controls, it keeps the first line, whole, and the controls go onto the line
  // below at the right; only a name wider than the tile breaks, by its words.
  return (
    <li
      className={cx(ROW, empty && 'text-text-muted')}
      data-layer={layer}
      data-layer-show={state.show}
      data-layer-locked={state.locked ? 'true' : undefined}
      data-layer-empty={empty ? 'true' : undefined}
    >
      <span className="flex min-w-0 max-w-full shrink-0 items-start gap-[2px]">
        <span className="flex h-4 shrink-0 items-center">
          {empty ? <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 bg-text-muted" /> : <DepartmentSwatch department={LAYER_DEPARTMENT[layer]} />}
        </span>
        <span className="min-w-0 break-words text-[12px] leading-4" data-layer-name="">
          {name}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5" data-layer-controls="">
        <span className="min-w-[1ch] shrink-0 text-right font-mono text-[12px] leading-6" data-layer-count={count}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{tn('layers.items', count)}</span>
        </span>
        <ShowChoice layer={layer} name={name} show={state.show} muted={empty} heldBy={heldBy} heldId={heldId} />
        <button
          type="button"
          aria-pressed={state.locked}
          aria-disabled={lockHeld || undefined}
          aria-label={t('layers.lockOf', { layer: name })}
          aria-describedby={lockHeld ? heldId : undefined}
          title={heldBy !== null ? t('layers.lockedBySolo', { layer: heldBy }) : t('layers.lockOf', { layer: name })}
          data-layer-lock={layer}
          className={cx(CELL, 'border', lockHeld ? 'cursor-default border-dashed' : '', edge(empty || lockHeld), inked(state.locked && !lockHeld, empty || lockHeld))}
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
          className={cx(WORD, edge(empty), inked(soloed, empty))}
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
 * The underlay's own row (6.9, decision 12): Shown, Dimmed or Hidden and Locked, as a department's, dimmed and locked
 * until changed; no Solo and no key (it is no department's), and Set scale while the room has an underlay. Unlocked
 * here, an underlay can be selected, moved, resized, turned and deleted. During a solo its choice and lock are the
 * solo's, held as every other row's are (M-a); Set scale stays.
 */
function UnderlayRow({ state, count, solo, roomId, viewKeyNow }: { state: LayerState; count: number; solo: PlanLayer | null; roomId: string | null; viewKeyNow: string | null }) {
  const name = rowName(UNDERLAY_ROW);
  const empty = count === 0;
  const heldBy = solo !== null ? groupName(solo) : null;
  const heldId = useId();
  const selection = usePlan((s) => (viewKeyNow === null ? undefined : s.selections[viewKeyNow]));
  const records = useProject((s) => s.records);
  return (
    <li
      className={cx(ROW, 'border-t border-border pt-1', empty && 'text-text-muted')}
      data-underlay-layer=""
      data-layer-show={state.show}
      data-layer-locked={state.locked ? 'true' : undefined}
      data-layer-empty={empty ? 'true' : undefined}
    >
      <span className="flex min-w-0 max-w-full shrink-0 items-start gap-[2px]">
        <span className="flex h-4 shrink-0 items-center">
          <span aria-hidden="true" className={cx('inline-block h-2.5 w-2.5 shrink-0 border', empty ? 'border-text-muted' : 'border-text')} />
        </span>
        <span className="min-w-0 break-words text-[12px] leading-4" data-layer-name="">
          {name}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5" data-layer-controls="">
        <span className="min-w-[1ch] shrink-0 text-right font-mono text-[12px] leading-6" data-layer-count={count}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{tn('layers.items', count)}</span>
        </span>
        <ShowChoice layer={UNDERLAY_ROW} name={name} show={state.show} muted={empty} heldBy={heldBy} heldId={heldId} />
        <button
          type="button"
          aria-pressed={state.locked}
          aria-disabled={heldBy !== null || undefined}
          aria-label={t('layers.lockOf', { layer: name })}
          aria-describedby={heldBy !== null ? heldId : undefined}
          title={heldBy !== null ? t('layers.lockedBySolo', { layer: heldBy }) : t('layers.lockOf', { layer: name })}
          data-layer-lock={UNDERLAY_ROW}
          className={cx(CELL, 'border', heldBy !== null ? 'cursor-default border-dashed' : '', edge(empty || heldBy !== null), inked(state.locked && heldBy === null, empty || heldBy !== null))}
          onClick={() => {
            if (heldBy === null) setLayerLocked(UNDERLAY_ROW, !state.locked);
          }}
        >
          <LockGlyph open={!state.locked} inherit />
        </button>
        {heldBy !== null && (
          <span id={heldId} className="sr-only">
            {t('layers.lockedBySolo', { layer: heldBy })}
          </span>
        )}
        {!empty && (
          <button
            type="button"
            data-layer-set-scale=""
            aria-label={t('layers.scaleOf')}
            title={t('layers.scaleOf')}
            className={cx(WORD, edge(false), inked(false))}
            onClick={() => {
              const target = scaleTarget(records, roomId, selection ?? []);
              if (target === null) return;
              startUnderlayScale(target);
              document.querySelector<HTMLElement>('[data-plan-tile] [data-canvas]')?.focus();
            }}
          >
            {t('layers.scale')}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Shown, Dimmed or Hidden, as three icon cells (a radio group, one Tab stop, the arrows picking as native radios do):
 * each named "Lighting: hidden", the current one an ink fill. Held by another row's solo (`heldBy`, M-a): shown as it
 * is, `aria-disabled` and described by the row's words (`heldId`), and nothing a press or an arrow does changes it.
 */
function ShowChoice({ layer, name, show, muted, heldBy, heldId }: { layer: LayerRow; name: string; show: LayerShow; muted: boolean; heldBy: string | null; heldId: string }) {
  const held = heldBy !== null;
  return (
    // Its outline sits a pixel above and below the row's 24 px (-my-px), its cells level with the lock and Solo, so a
    // one-line row stays 24 px.
    <div role="radiogroup" aria-label={t('layers.showOf', { layer: name })} className={cx('-my-px flex shrink-0 border', held && 'border-dashed', edge(muted || held))}>
      {LAYER_SHOWS.map((value, i) => {
        const selected = value === show;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(SHOW_NAMES[value], { layer: name })}
            aria-disabled={held || undefined}
            aria-describedby={held ? heldId : undefined}
            title={heldBy !== null ? t('layers.dimmedBySolo', { layer: heldBy }) : SHOW_WORDS[value]}
            tabIndex={selected ? 0 : -1}
            className={cx(CELL, i > 0 && cx('border-l', edge(muted || held)), held && 'cursor-default', inked(selected, muted || held))}
            onClick={() => {
              if (!held) setLayerShow(layer, value);
            }}
            onKeyDown={(event) => {
              if (held) {
                // Held: the arrows neither move the choice nor scroll the tile.
                if (rovingIndex(event.key, i, LAYER_SHOWS.length) !== null) event.preventDefault();
                return;
              }
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

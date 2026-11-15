import { t, tn } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { parseDegrees, wallEnds, type MeasureFields, type UnderlayFields } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { Button } from '../../../ui/Button';
import { changeIcons, changeMeasures } from './planActions';
import { iconCentre, iconPatchRefused, measurePatchRefused, type IconPatch, type MeasurePatch } from './planItems';
import { startUnderlayScale } from './layersStore';
import { degreesText, lengthCommit, shared, TypedField } from './selectionFields';

// The Selection tile's fields for a room's underlay and its measures (6.9). An underlay (selected once its row is
// unlocked in the Layers tile): its width or depth (the other follows, the picture's shape kept), rotation and middle, and Set
// scale; a quiet note until a scale is set. A measure: its length (typed, its start stays), rotation and start, as a
// wall's.

type Records = Readonly<Record<string, SbdRecord>>;

/** The canvas of the plan, for Set scale's clicks to start on. */
const planCanvas = () => document.querySelector<HTMLElement>('[data-plan-tile] [data-canvas]');

export function UnderlayFieldsView({ ids, underlays, unit, records }: { ids: readonly string[]; underlays: readonly UnderlayFields[]; unit: PlanUnit; records: Records }) {
  const text = (values: readonly number[]) => shared(values.map((v) => formatLength(v, unit)));
  const write = (patch: IconPatch): boolean => {
    if (iconPatchRefused(records, ids, patch)) return false;
    void changeIcons(ids, patch);
    return true;
  };
  const refused = t('selection.lengthRefused');
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  const centres = underlays.map((u) => iconCentre(u));
  const widthText = text(underlays.map((u) => u.width));
  const depthText = text(underlays.map((u) => u.height));
  const rotations = shared(underlays.map((u) => degreesText(u.rotation)));
  const xText = text(centres.map((c) => c.x));
  const yText = text(centres.map((c) => c.y));
  const [onlyId] = ids;
  // Its width or depth typed: the other follows, each underlay by its own proportions (6.9 review, L3), so no picture is
  // ever stretched, however many are selected.
  const width = (m: number): IconPatch => ({ width: m, keepRatio: true });
  const depth = (m: number): IconPatch => ({ depth: m, keepRatio: true });
  return (
    <>
      <p className="sb-label" data-selection-kind="">
        {ids.length === 1 ? t('plan.item.underlay') : tn('selection.items', ids.length)}
      </p>
      {underlays.some((u) => !u.scaled) && (
        <p className="text-[12px] text-text-muted" data-underlay-unscaled-note="">
          {t('plan.underlay.unscaled')}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('width')} label={t('selection.width')} text={widthText ?? ''} mixed={widthText === null} onCommit={lengthCommit(unit, write, width)} refused={refused} />
        <TypedField key={keyed('depth')} label={t('selection.depth')} text={depthText ?? ''} mixed={depthText === null} onCommit={lengthCommit(unit, write, depth)} refused={refused} />
        <TypedField
          key={keyed('rotation')}
          label={t('selection.rotation')}
          text={rotations ?? ''}
          mixed={rotations === null}
          onCommit={(typed) => {
            const degrees = parseDegrees(typed);
            if (degrees === null) return false;
            return write({ rotation: degrees });
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={xText ?? ''} mixed={xText === null} onCommit={lengthCommit(unit, write, (m) => ({ centreX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={yText ?? ''} mixed={yText === null} onCommit={lengthCommit(unit, write, (m) => ({ centreY: m }), { signed: true })} refused={refused} />
      </div>
      {ids.length === 1 && onlyId !== undefined && (
        <div>
          <Button
            variant="secondary"
            data-selection-set-scale=""
            onClick={() => {
              startUnderlayScale(onlyId);
              planCanvas()?.focus();
            }}
          >
            {t('plan.underlay.setScale')}
          </Button>
        </div>
      )}
      <p className="text-[12px] text-text-muted">{t('selection.underlayNote')}</p>
    </>
  );
}

export function MeasureFieldsView({ ids, measures, unit, records }: { ids: readonly string[]; measures: readonly MeasureFields[]; unit: PlanUnit; records: Records }) {
  const text = (values: readonly number[]) => shared(values.map((v) => formatLength(v, unit)));
  const write = (patch: MeasurePatch): boolean => {
    if (measurePatchRefused(records, ids, patch)) return false;
    void changeMeasures(ids, patch);
    return true;
  };
  const refused = t('selection.lengthRefused');
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  const starts = measures.map((m) => wallEnds(m)[0]);
  const lengthText = text(measures.map((m) => m.width));
  const rotations = shared(measures.map((m) => degreesText(m.rotation)));
  const names = shared(measures.map((m) => m.name));
  const xText = text(starts.map((p) => p.x));
  const yText = text(starts.map((p) => p.y));
  return (
    <>
      <p className="sb-label" data-selection-kind="">
        {ids.length === 1 ? t('plan.item.measure') : tn('selection.measures', ids.length)}
      </p>
      <TypedField key={keyed('name')} label={t('selection.name')} mono={false} text={names ?? ''} mixed={names === null} onCommit={(typed) => write({ name: typed.trim() })} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('length')} label={t('selection.length')} text={lengthText ?? ''} mixed={lengthText === null} onCommit={lengthCommit(unit, write, (m) => ({ length: m }))} refused={refused} />
        <TypedField
          key={keyed('rotation')}
          label={t('selection.rotation')}
          text={rotations ?? ''}
          mixed={rotations === null}
          onCommit={(typed) => {
            const degrees = parseDegrees(typed);
            if (degrees === null) return false;
            return write({ rotation: degrees });
          }}
          refused={t('selection.rotationRefused')}
        />
        <TypedField key={keyed('x')} label={t('selection.x')} text={xText ?? ''} mixed={xText === null} onCommit={lengthCommit(unit, write, (m) => ({ startX: m }), { signed: true })} refused={refused} />
        <TypedField key={keyed('y')} label={t('selection.y')} text={yText ?? ''} mixed={yText === null} onCommit={lengthCommit(unit, write, (m) => ({ startY: m }), { signed: true })} refused={refused} />
      </div>
      <p className="text-[12px] text-text-muted">{t('selection.measureNote')}</p>
    </>
  );
}

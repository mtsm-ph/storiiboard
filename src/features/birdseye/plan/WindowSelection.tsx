import { useState } from 'react';
import { useSunZonesAt } from '../../../app/timeZone';
import { t, type MessageKey } from '../../../core/i18n';
import { formatLength, hasGroupingComma, parseLength, type PlanUnit } from '../../../core/model/length';
import {
  ceilingHeightChanges,
  ceilingOver,
  openingHeights,
  roomHeights,
  storedCeilingRefusal,
  storedHeightsRefusal,
  windowHeightsChanges,
  type HeightRefusal,
  type WindowHeightsPatch,
} from '../../../core/model/planHeights';
import type { SbdRecord } from '../../../core/model/record';
import { dayDateLabel } from '../../../core/model/shootDay';
import { viewSunZonePoint, windowSunOf, windowSunsOf, type CompassPointName, type DirectSun, type WindowSunOf } from '../../../core/model/windowSun';
import { Trans } from '../../../ui/Trans';
import { setCeilingHeight, setWindowHeights, type PlanView } from './planActions';
import { shared, TypedField } from './selectionFields';
import { MISSING_WORDS } from './sunLooks';

// Heights for the 3D set and sun through the windows (6.5.6), in the Selection tile. A room's ceiling and a window's sill
// and top, typed as lengths in either unit (one edit each, emptied takes it off), checked as planHeights.ts checks them:
// a refusal is said in a line under the fields, and nothing is saved. They draw nothing on the plan and print nothing.
// A window's sun: which way it faces, and the hours direct sun can come through it on the sun path's date (windowSun.ts),
// always with the line that what stands outside isn't known. With north and the sun path selected together (as the
// compass opens them), the hours of every window in an outside wall.

type Records = Readonly<Record<string, SbdRecord>>;

const REFUSED: Readonly<Record<HeightRefusal, MessageKey>> = {
  notPositive: 'selection.heightRefused.notPositive',
  topNotAboveSill: 'selection.heightRefused.topNotAboveSill',
  aboveCeiling: 'selection.heightRefused.aboveCeiling',
  ceilingBelowWindow: 'selection.heightRefused.ceilingBelowWindow',
  ceilingBelowDoor: 'selection.heightRefused.ceilingBelowDoor',
};

/** What is wrong with the heights as stored (an undo or a Put back can leave them so): the first selected one's, or null. */
const storedWords = (records: Records, ids: readonly string[], unit: PlanUnit): string | null => {
  for (const id of ids) {
    const wrong = storedHeightsRefusal(records, id);
    if (wrong) return refusalWords(wrong, ceilingOver(records, id), unit);
  }
  return null;
};

/** What a typed height reads as: metres, null for an emptied field, or 'refused' when it isn't a length above 0. */
function typedHeight(typed: string, unit: PlanUnit): number | null | 'notLength' | 'grouping' {
  if (typed.trim() === '') return null;
  if (hasGroupingComma(typed)) return 'grouping';
  const m = parseLength(typed, unit);
  return m === null ? 'notLength' : m;
}

/** The line under height fields that says why the last value typed was refused, or what's wrong with what's stored. */
export function RefusedLine({ words }: { words: string | null }) {
  return (
    <p className={words === null ? 'sr-only' : 'text-[12px] font-bold'} aria-live="polite" data-height-refused={words === null ? undefined : ''}>
      {words ?? ''}
    </p>
  );
}

/** The words for a refusal: the ceiling it would pass, in the unit shown, where that's why. */
export function refusalWords(refused: HeightRefusal, ceilingM: number | null, unit: PlanUnit): string {
  if (refused === 'aboveCeiling' && ceilingM !== null) return t('selection.heightRefused.aboveCeilingOf', { ceiling: formatLength(ceilingM, unit) });
  return t(REFUSED[refused]);
}

/** The selected windows' sill and top (6.5.6): each typed, one edit for all of them; refused, said, nothing saved. */
export function WindowHeightFields({ ids, records, unit }: { ids: readonly string[]; records: Records; unit: PlanUnit }) {
  const [refused, setRefused] = useState<string | null>(null);
  const heights = ids.flatMap((id) => {
    const h = openingHeights(records[id]?.props ?? {});
    return h?.kind === 'window' ? [h] : [];
  });
  const text = (values: readonly (number | null)[]) => shared(values.map((v) => (v === null ? '' : formatLength(v, unit))));
  const sill = text(heights.map((h) => h.sillM));
  const top = text(heights.map((h) => h.topM));
  const commit = (apply: (m: number | null) => WindowHeightsPatch) => (typed: string) => {
    const m = typedHeight(typed, unit);
    if (m === 'notLength' || m === 'grouping') {
      setRefused(t(m === 'grouping' ? 'plan.groupingComma' : 'selection.lengthRefused'));
      return false;
    }
    if (m !== null && !(m > 0)) {
      setRefused(t(REFUSED.notPositive));
      return false;
    }
    const outcome = windowHeightsChanges(records, ids, apply(m));
    if ('refused' in outcome) {
      // The ceiling of the window refused, which may be another room's than the first selected one's.
      setRefused(refusalWords(outcome.refused, ceilingOver(records, outcome.id), unit));
      return false;
    }
    setRefused(null);
    void setWindowHeights(ids, apply(m));
    return true;
  };
  const keyed = (field: string) => `${ids.join(' ')}:${field}`;
  return (
    <div className="flex flex-col gap-1" data-window-heights="">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
        <TypedField key={keyed('sill')} label={t('selection.sillHeight')} text={sill ?? ''} mixed={sill === null} onCommit={commit((m) => ({ sillM: m }))} />
        <TypedField key={keyed('top')} label={t('selection.topHeight')} text={top ?? ''} mixed={top === null} onCommit={commit((m) => ({ topM: m }))} />
      </div>
      <RefusedLine words={refused ?? storedWords(records, ids, unit)} />
      <p className="text-[12px] text-text-muted">{t('selection.heightsNote')}</p>
    </div>
  );
}

/** A room's ceiling height (6.5.6), in the Selection tile's room view. */
export function CeilingField({ roomId, records, unit }: { roomId: string; records: Records; unit: PlanUnit }) {
  const [refused, setRefused] = useState<string | null>(null);
  const room = records[roomId];
  const ceiling = room ? roomHeights(room.props).ceilingM : null;
  return (
    <div className="flex flex-col gap-1" data-ceiling="">
      <TypedField
        key={`${roomId}:ceiling`}
        label={t('selection.ceilingHeight')}
        text={ceiling === null ? '' : formatLength(ceiling, unit)}
        onCommit={(typed) => {
          const m = typedHeight(typed, unit);
          if (m === 'notLength' || m === 'grouping') {
            setRefused(t(m === 'grouping' ? 'plan.groupingComma' : 'selection.lengthRefused'));
            return false;
          }
          const outcome = ceilingHeightChanges(records, roomId, m);
          if ('refused' in outcome) {
            setRefused(refusalWords(outcome.refused, null, unit));
            return false;
          }
          setRefused(null);
          void setCeilingHeight(roomId, m);
          return true;
        }}
      />
      <RefusedLine words={refused ?? (storedCeilingRefusal(records, roomId) ? t('selection.heightRefused.storedCeilingLow') : null)} />
      <p className="text-[12px] text-text-muted">{t('selection.heightsNote')}</p>
    </div>
  );
}

const POINT_WORDS: Readonly<Record<CompassPointName, MessageKey>> = {
  N: 'windowSun.point.N',
  NE: 'windowSun.point.NE',
  E: 'windowSun.point.E',
  SE: 'windowSun.point.SE',
  S: 'windowSun.point.S',
  SW: 'windowSun.point.SW',
  W: 'windowSun.point.W',
  NW: 'windowSun.point.NW',
};

/** "07:40 to 11:15", or two stretches joined: "05:30 to 08:55 and 17:05 to 20:30". */
const hoursText = (hours: readonly DirectSun[]): string => hours.map((h) => t('windowSun.range', { from: h.from, to: h.to })).join(t('windowSun.and'));

/** The view's sun zone, as the sun path's own settings look it up. */
function useViewZones(records: Records, view: PlanView): ReadonlyMap<string, string | null> {
  const point = viewSunZonePoint(records, view);
  return useSunZonesAt(point ? [point] : []);
}

/** What a window's sun says in place of hours: its wall, north, or what the sun path lacks. */
function missingWords(sun: WindowSunOf): string | null {
  const { missing } = sun;
  if (missing === null) return null;
  if (missing === 'insideWall') return t('windowSun.inside');
  if (missing === 'unclosed') return t('windowSun.unclosed');
  if (missing === 'unknownSide') return t('windowSun.unknownSide');
  if (missing === 'noSetup') return t('compass.noSetup');
  if (missing === 'noSunPath') return t('windowSun.noSunPath');
  return t(missing === 'noNorth' ? 'windowSun.noNorth' : MISSING_WORDS[missing]);
}

/** A selected window's sun (6.5.6): its facing, its hours on the sun path's date, and what isn't known. */
export function WindowSunView({ windowId, records, view }: { windowId: string; records: Records; view: PlanView }) {
  const zones = useViewZones(records, view);
  const sun = windowSunOf(records, view, windowId, zones);
  if (!sun) return null;
  const missing = missingWords(sun);
  return (
    <section className="flex flex-col gap-1 border-t border-border pt-3" data-window-sun={sun.wall} data-window-sun-missing={sun.missing ?? undefined}>
      <h3 className="sb-label">{t('windowSun.title')}</h3>
      {sun.facing && (
        <p className="text-[13px]" data-window-facing={sun.facing.point}>
          <Trans k="windowSun.facing" parts={{ point: t(POINT_WORDS[sun.facing.point]), bearing: <span className="font-mono">{t('plan.degrees', { value: String(Math.round(sun.facing.bearing) % 360) })}</span> }} />
        </p>
      )}
      {missing !== null ? (
        <p className="text-[13px] font-bold">{missing}</p>
      ) : sun.hours === null ? null : sun.hours.length === 0 ? (
        <p className="text-[13px]" data-window-hours="">
          {t('windowSun.none', { date: dayDateLabel(sun.date?.date ?? '') })}
        </p>
      ) : (
        <p className="text-[13px]" data-window-hours={hoursText(sun.hours)}>
          <Trans k="windowSun.hours" parts={{ hours: <span className="font-mono">{hoursText(sun.hours)}</span> }} />
        </p>
      )}
      {sun.zone !== null && sun.date !== null && (
        <p className="text-[12px] text-text-muted" data-window-sun-for="">
          {t('windowSun.forDay', { date: dayDateLabel(sun.date.date), zone: sun.zone })}
        </p>
      )}
      {sun.wall === 'outside' && (
        <p className="text-[12px]" data-window-unknown="">
          {t('windowSun.unknownOutside')}
        </p>
      )}
    </section>
  );
}

/** Every window in an outside wall the view shows, each by its facing with its hours (6.5.6): where the compass opens. */
export function WindowSunList({ records, view }: { records: Records; view: PlanView }) {
  const zones = useViewZones(records, view);
  const outside = windowSunsOf(records, view, zones).filter((w) => w.wall === 'outside');
  return (
    <section className="flex flex-col gap-1 border-t-[1.5px] border-text pt-3" data-window-sun-list="">
      <h3 className="sb-label">{t('windowSun.listTitle')}</h3>
      {outside.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('windowSun.listEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {outside.map((w) => {
            const point = w.facing ? t(POINT_WORDS[w.facing.point]) : null;
            const missing = missingWords(w);
            const said =
              w.hours === null ? null : w.hours.length === 0 ? t('windowSun.noneShort') : <span className="font-mono">{hoursText(w.hours)}</span>;
            return (
              <li key={w.windowId} className="text-[13px]" data-window-sun-item={w.windowId} data-window-facing={w.facing?.point}>
                {point === null ? t('plan.item.window') : <Trans k="windowSun.listFacing" parts={{ point }} />}
                {said !== null ? <Trans k="windowSun.listHours" parts={{ hours: said }} /> : missing !== null ? <Trans k="windowSun.listHours" parts={{ hours: missing }} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {outside.length > 0 && <p className="text-[12px]">{t('windowSun.unknownOutside')}</p>}
    </section>
  );
}

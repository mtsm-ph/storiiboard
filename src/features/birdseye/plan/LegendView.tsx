import { useId, useMemo } from 'react';
import { t, tn, type MessageKey } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { planLegend, type LegendHeight, type RoomLine } from '../../../core/model/planLegend';
import type { SbdRecord } from '../../../core/model/record';
import { choiceLabel, HEIGHT_LABEL } from '../../../core/model/storyboard';
import { useLocale } from '../../../ui/useLocale';
import { frameItemLabel, iconLabel } from './iconWords';
import { groupName } from './library';
import { wattsLabel } from './lightLooks';
import type { PlanView } from './planActions';

// The plan's legend in the Selection tile while nothing is selected (6.5): planLegend's reading (src/core/model), by
// department, numbers in mono, and the setup's total watts with the lights whose wattage is unknown.

type Records = Readonly<Record<string, SbdRecord>>;

const ROOM_WORDS: Readonly<Record<RoomLine['kind'], MessageKey>> = { wall: 'legend.walls', door: 'legend.doors', window: 'legend.windows' };

const heightText = (height: LegendHeight, unit: PlanUnit): string => ('metres' in height ? formatLength(height.metres, unit) : choiceLabel(HEIGHT_LABEL, height.frame));

/** "4,200 W", or "4,200 W + 2 unknown". */
export const totalWatts = (watts: { known: number; unknown: number }): string =>
  watts.unknown === 0 ? wattsLabel(watts.known) : tn('legend.wattsUnknown', watts.unknown, { watts: wattsLabel(watts.known) });

export function LegendView({ records, view, unit }: { records: Records; view: PlanView; unit: PlanUnit }) {
  const locale = useLocale();
  const headingId = useId();
  // Its words are the app's language's, read through t(): a change of language reads them again.
  const legend = useMemo(
    () => planLegend(records, view.sceneId, view.setupId, iconLabel, (fields) => frameItemLabel(fields, unit)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t()
    [records, view.sceneId, view.setupId, unit, locale],
  );
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3" aria-labelledby={headingId} data-plan-legend="">
      <h3 id={headingId} className="sb-label">
        {t('legend.title')}
      </h3>
      {legend.room.length > 0 && (
        // The room first (6.5 review, decision 11): its walls', doors' and windows' set heights, one line per height.
        <div className="flex flex-col gap-0.5" data-legend-group="room">
          <h4 className="sb-label">{t('legend.room')}</h4>
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {legend.room.map((line) => (
              <li key={`${line.kind}:${String(line.metres)}`} data-legend-line="">
                {t(ROOM_WORDS[line.kind])}
                <span className="font-mono"> · {formatLength(line.metres, unit)}</span>
                {line.count > 1 && <span className="font-mono"> {t('legend.count', { count: line.count })}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {legend.groups.length === 0 && legend.room.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('legend.empty')}</p>
      ) : (
        legend.groups.map((group) => (
          <div key={group.layer} className="flex flex-col gap-0.5" data-legend-group={group.layer}>
            <h4 className="sb-label">{groupName(group.layer)}</h4>
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {group.lines.map((line, i) => (
                <li key={`${line.label}:${String(i)}`} data-legend-line="">
                  <span data-user-text="">{line.label}</span>
                  {line.count > 1 && <span className="font-mono"> {t('legend.count', { count: line.count })}</span>}
                  {line.height && <span className="font-mono"> · {heightText(line.height, unit)}</span>}
                  {line.watts !== undefined && <span className="font-mono"> · {line.watts === null ? t('legend.wattsNone') : wattsLabel(line.watts)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {legend.watts.lights > 0 && (
        <p className="flex flex-wrap items-baseline gap-2 text-[13px]" data-legend-total="">
          <span className="sb-label">{t('legend.total')}</span>
          <span className="font-mono">{totalWatts(legend.watts)}</span>
        </p>
      )}
    </section>
  );
}

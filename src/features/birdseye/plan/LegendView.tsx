import { useId, useMemo } from 'react';
import { t, tn, type PluralBase } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { PLAN_LAYERS } from '../../../core/model/plan';
import { planLegend, type LegendGroup, type LegendHeight, type RoomLine } from '../../../core/model/planLegend';
import type { SbdRecord } from '../../../core/model/record';
import { choiceLabel, HEIGHT_LABEL } from '../../../core/model/storyboard';
import { useLocale } from '../../../ui/useLocale';
import { frameItemLabel, iconLabel } from './iconWords';
import { groupName } from './library';
import { characterTitle } from './markLooks';
import { wattsLabel } from './lightLooks';
import type { PlanView } from './planActions';
import { degreesText } from './selectionFields';

// The plan's legend in the Selection tile while nothing is selected (6.5): planLegend's reading (src/core/model), by
// department, numbers in mono, and the setup's total watts with the lights whose wattage is unknown.

type Records = Readonly<Record<string, SbdRecord>>;

// Singular for one, plural for more (6.5 second review): "Wall · 3.00 m", "Walls · 2.40 m ×4".
const ROOM_WORDS: Readonly<Record<RoomLine['kind'], PluralBase>> = { wall: 'legend.walls', door: 'legend.doors', window: 'legend.windows' };

/** A room's line as printed: its kind, its height in the unit shown, and how many. */
export interface PrintedRoomLine {
  kind: RoomLine['kind'];
  height: string;
  count: number;
}

/**
 * The room's lines as the legend prints them. The model keys them by exact metres (planLegend), so 2.43 m and 2.44 m are
 * two lines; in feet both print 8' 0", and two lines reading the same would look like a mistake, so lines whose printed
 * text is the same are one, their counts added.
 */
export function printedRoomLines(room: readonly RoomLine[], unit: PlanUnit): PrintedRoomLine[] {
  const lines = new Map<string, PrintedRoomLine>();
  for (const line of room) {
    const height = formatLength(line.metres, unit);
    const key = `${line.kind}\u0000${height}`;
    const had = lines.get(key);
    if (had) had.count += line.count;
    else lines.set(key, { kind: line.kind, height, count: line.count });
  }
  return [...lines.values()];
}

// Stand-ins for the numbers while the line is filled, so they can be set in mono where the language puts them.
// Private-use characters: no translation or height ever holds one.
const HEIGHT_MARK = '';
const COUNT_MARK = '';

/**
 * A room line as its parts, the numbers in mono: "Wall · 3.00 m" for one, "Walls · 2.40 m ×4" for more, each language
 * placing the height and the count where it says them.
 */
export function roomLineParts(line: PrintedRoomLine): { text: string; mono: boolean }[] {
  const filled = tn(ROOM_WORDS[line.kind], line.count, { height: HEIGHT_MARK, count: COUNT_MARK });
  return filled
    .split(/([])/)
    .filter((part) => part !== '')
    .map((part) => (part === HEIGHT_MARK ? { text: line.height, mono: true } : part === COUNT_MARK ? { text: String(line.count), mono: true } : { text: part, mono: false }));
}

/** A room line as it reads: "Wall · 3.00 m", "Walls · 2.40 m ×4". */
export const roomLineText = (line: PrintedRoomLine): string =>
  roomLineParts(line)
    .map((part) => part.text)
    .join('');

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
      {(legend.room.length > 0 || legend.north !== undefined) && (
        // The room first (6.5 review, decision 11): its walls', doors' and windows' set heights, one line per height.
        <div className="flex flex-col gap-0.5" data-legend-group="room">
          <h4 className="sb-label">{t('legend.room')}</h4>
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {legend.north !== undefined && (
              // The room's north (6.6): "North · 35°".
              <li data-legend-line="" data-legend-north="">
                {t('legend.north')}
                <span className="font-mono"> · {degreesText(legend.north)}</span>
              </li>
            )}
            {printedRoomLines(legend.room, unit).map((line) => (
              <li key={`${line.kind}:${line.height}`} data-legend-line="">
                {roomLineParts(line).map((part, i) => (part.mono ? <span key={i} className="font-mono">{part.text}</span> : part.text))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {legend.groups.length === 0 && legend.room.length === 0 && legend.north === undefined && legend.cast.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('legend.empty')}</p>
      ) : (
        // The cast section (6.7) heads the cast group: each character with how many positions it has, then the rest.
        PLAN_LAYERS.flatMap((layer): LegendGroup[] => {
          const group = legend.groups.find((g) => g.layer === layer);
          if (group) return [group];
          return layer === 'cast' && legend.cast.length > 0 ? [{ layer, lines: [] }] : [];
        }).map((group) => (
          <div key={group.layer} className="flex flex-col gap-0.5" data-legend-group={group.layer}>
            <h4 className="sb-label">{groupName(group.layer)}</h4>
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {group.layer === 'cast' &&
                legend.cast.map((line) => (
                  <li key={line.characterId} data-legend-line="" data-legend-cast={line.characterId}>
                    <span data-user-text="">{characterTitle(records, line.characterId)}</span>
                    <span className="font-mono"> · {tn('legend.positions', line.positions)}</span>
                  </li>
                ))}
              {group.lines.map((line, i) => (
                <li key={`${line.label}:${String(i)}`} data-legend-line="">
                  <span data-user-text="">{line.label}</span>
                  {line.count > 1 && <span className="font-mono"> {t('legend.count', { count: line.count })}</span>}
                  {line.height && <span className="font-mono"> · {heightText(line.height, unit)}</span>}
                  {line.watts !== undefined && <span className="font-mono"> · {line.watts === null ? t('legend.wattsNone') : wattsLabel(line.watts)}</span>}
                  {line.move !== undefined && <span className="font-mono"> · {t('legend.moves', { length: formatLength(line.move, unit) })}</span>}
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

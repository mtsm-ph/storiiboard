import { useEffect, useRef, useState } from 'react';
import { localDateTime } from '../../app/format';
import { showNotice } from '../../app/notice';
import { useProject } from '../../app/projectStore';
import { usePlanUnit } from '../../app/planUnits';
import { t } from '../../core/i18n';
import { useLocale } from '../../ui/useLocale';
import { LineText } from './LineText';
import { moreDayLog, readDayLog, type DayLog } from './steps';
import { who } from './summary';

// A shoot day's own history (Kevin, Nov 18 and 21): only a view, nothing stored. What happened to the day: every step
// that wrote the day, its call sheet (and what's under it), a frame arriving on it or leaving it, or a frame (its
// strokes and picture too) while it was on the day; never a frame's life before it arrived or after it left (readDayLog).
// Each line as History words it, with who and when as the main feed shows them. No Put back and no Restore to here:
// each frame keeps its own History for that.

/** The day's steps, newest first; `title` names it in a sentence ("shoot day Mon, Nov 16"). */
export function DayHistory({ dayId, title }: { dayId: string; title: string }) {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  const deletedForGood = useProject((s) => s.deletedForGood);
  const locale = useLocale();
  const unit = usePlanUnit();
  // Kept with the day it was read for: another day shows nothing until its own steps are read.
  const [shown, setShown] = useState<DayLog | null>(null);
  // The day's history as last read, for the next read to take only the new writes. Read afresh in another file, after
  // anything is deleted for good, or in another language or unit (each line is worded in the words of the moment).
  const read = useRef<{ file: object; deletedForGood: number; locale: string; unit: string; log: DayLog } | null>(null);

  useEffect(() => {
    if (!project) return;
    let live = true;
    const file = project.file;
    const known = read.current;
    const reading =
      known && known.file === file && known.deletedForGood === deletedForGood && known.locale === locale && known.unit === unit && known.log.dayId === dayId
        ? moreDayLog(file, dayId, known.log, unit)
        : readDayLog(file, dayId, unit);
    reading
      .then((next) => {
        if (!live) return;
        read.current = { file, deletedForGood, locale, unit, log: next };
        setShown(next);
      })
      .catch((error: unknown) => {
        showNotice(error);
      });
    return () => {
      live = false;
    };
  }, [project, dayId, records, canUndo, deletedForGood, locale, unit]);

  if (shown?.dayId !== dayId) return <p className="p-3 text-[13px] text-text-muted">{t('historyTile.readingHistory')}</p>;
  if (shown.steps.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('history.noChangesTo', { title })}</p>;
  return (
    <ol tabIndex={-1} aria-label={t('history.dayStepsOf', { title })} className="flex flex-col">
      {shown.steps.map(({ group, line }) => (
        <li key={group.id} className="flex items-center gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">
              <LineText line={line} />
            </p>
            <p className="font-mono text-[11px] text-text-muted">
              {/* Who, in the UI's type, then when, as the main feed shows them. */}
              {who(group.author) !== '' && (
                <>
                  <bdi className="font-sans wrap-anywhere">{who(group.author)}</bdi>
                  {' · '}
                </>
              )}
              {localDateTime(new Date(group.timestamp))}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

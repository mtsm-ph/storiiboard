import { useZonesAt } from '../../app/timeZone';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { callSheetChecks } from '../../core/checks';
import { t, tn } from '../../core/i18n';
import { mapPlace, projectLocations } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { Button } from '../../ui/Button';
import { showSheetDay } from './sheetDay';
import { useHeldForecasts } from './useHeldForecasts';

// "3 checks" for a day in the Shoot days tile (4.8), beside the gear check: how many problems the call sheet's checks
// find, and a button that opens the call sheet on that day. Nothing shows while the day is clear.

export function DayChecksButton({ records, projectId, dayId, dayName }: { records: Readonly<Record<string, SbdRecord>>; projectId: string; dayId: string; dayName: string }) {
  const workspaceId = useWorkspaceId();
  const points = projectLocations(records, projectId).flatMap(({ record }) => {
    const place = mapPlace(record.props);
    return place ? [{ id: record.id, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const zones = useZonesAt(points);
  const held = useHeldForecasts(points);
  const count = callSheetChecks(records, projectId, dayId, held, zones).findings.length;
  if (count === 0) return null;
  return (
    // Its own line in the day, with its own label, apart from the gear check.
    <div className="flex flex-wrap items-center gap-2">
      <span className="sb-label">{t('days.callSheetChecks')}</span>
      <Button
        data-day-checks=""
        aria-label={tn('days.checksOpen', count, { day: dayName })}
        onClick={() => {
          // The call sheet tile, in front in this workspace, on this day.
          showSheetDay(dayId);
          const { layouts, change } = layoutStore.getState();
          change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'sheet'));
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-call-sheet] [data-day-select]')?.focus();
          });
        }}
      >
        <span aria-hidden="true">▲ </span>
        {tn('days.checks', count)}
      </Button>
    </div>
  );
}

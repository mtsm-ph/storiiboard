import { projectStore } from '../../app/projectStore';
import { callSheetChecks } from '../../core/checks';
import { mapPlace, projectLocations } from '../../core/model/location';
import type { ExportCallSheetOptions } from './exportCallSheet';
import { readHeldForecasts } from './useHeldForecasts';

// How many problems the call sheet's checks find right now (4.8), for Issue's one question. Worked out when Issue is
// pressed, after a time typed a moment ago has been saved (as Export and Issue wait for it), from the project as it is
// then and the forecasts held then, not from the last draw.
export async function problemsNow(options: ExportCallSheetOptions): Promise<number> {
  await projectStore.getState().applyWith(() => ({ changes: [] }));
  const { records } = projectStore.getState();
  const points = projectLocations(records, options.projectId).flatMap(({ record }) => {
    const place = mapPlace(record.props);
    return place ? [{ id: record.id, latitude: place.latitude, longitude: place.longitude }] : [];
  });
  const held = await readHeldForecasts(points);
  return callSheetChecks(records, options.projectId, options.dayId, held, options.zones).findings.length;
}

import { isTauriApp } from '../../app/fileAccess';
import { projectStore } from '../../app/projectStore';
import { showInfo, showNotice } from '../../app/notice';
import { localizeError, t } from '../../core/i18n';
import { callSheet, type CallSheet } from '../../core/model/callsheet';
import type { Paper } from '../../core/model/paper';
import { isDayDate } from '../../core/model/shootDay';
import { dayWeather, type WeatherUnits } from '../../core/net/weather';
import type { DirectionsApp } from '../../core/storage/settings';
import { chooseExportFile } from '../../core/storage/exportFiles';
import { fontBytes, replacedWarning } from '../export/pdfStoryboardFormat';
import type { PdfForecast } from './callSheetPdf';
import { callSheetFileName } from './callSheetName';
import { findForecast } from './forecast';

// Export PDF… on the Call sheet tile (4.6): the day's sheet as a file to send. The PDF itself is callSheetPdf.ts (pure);
// this is the part that touches the world: the forecast the sheet already holds, the bundled fonts, the Save dialog.

/**
 * Each location's forecast as the sheet holds it: the one in this session's memory or the project's cache, whether or
 * not it is still fresh. Never asks the network (`mayAsk` false): a PDF is made offline, and the tile has already
 * asked once when the day was shown.
 */
async function heldForecasts(sheet: CallSheet): Promise<Map<string, PdfForecast>> {
  const held = new Map<string, PdfForecast>();
  const { date, callTime } = sheet.day.fields;
  if (!isDayDate(date)) return held;
  for (const { record, place, zone } of sheet.locations) {
    if (!place || !zone) continue;
    const loaded = await findForecast(place.latitude, place.longitude, false).catch(() => null);
    if (loaded) held.set(record.id, { day: dayWeather(loaded.forecast.entries, date, zone.zone, callTime), fetchedAt: loaded.fetchedAt });
  }
  return held;
}

export interface ExportCallSheetOptions {
  projectId: string;
  dayId: string;
  /** Each location's time zone as the tile has it so far (by location id); a place with none yet is still being asked. */
  zones: ReadonlyMap<string, string | null>;
  projectName: string;
  paper: Paper;
  app: DirectionsApp;
  units: WeatherUnits;
}

/** The sheet as the project is now: read again after the edits queued ahead have landed. */
const sheetNow = (o: ExportCallSheetOptions): CallSheet | null => callSheet(projectStore.getState().records, o.projectId, o.dayId, undefined, o.zones);

/** A place whose time zone hasn't come back yet has no sun or forecast to print; the sheet would go out without them. */
const stillFindingZone = (sheet: CallSheet): boolean => sheet.locations.some((l) => l.place !== null && l.zone === null);

export async function exportCallSheetPdf(options: ExportCallSheetOptions): Promise<void> {
  const before = sheetNow(options);
  if (!before) return;
  if (stillFindingZone(before)) {
    showNotice(new Error(t('callSheet.pdf.zonePending')));
    return;
  }
  let label = '';
  try {
    const target = await chooseExportFile(callSheetFileName(before.title || options.projectName, before.day.number, before.day.fields.date), isTauriApp);
    if (!target) return;
    label = target.label;
    // A call typed just before pressing Export is saved on the blur, in the queue: wait for it (and anything else queued
    // ahead) to land, then read the project, so the sheet is the one on the screen and not the one drawn a moment ago.
    await projectStore.getState().applyWith(() => ({ changes: [] }));
    const sheet = sheetNow(options);
    if (!sheet) throw new Error(t('callSheet.noDays'));
    if (stillFindingZone(sheet)) {
      showNotice(new Error(t('callSheet.pdf.zonePending')));
      return;
    }
    const [{ callSheetPdf }, forecasts, sans, sansSemiBold, sansBold, mono, monoBold] = await Promise.all([
      import('./callSheetPdf'),
      heldForecasts(sheet),
      fontBytes(() => import('../export/fonts/InterTight-Regular.ttf?url')),
      fontBytes(() => import('../export/fonts/InterTight-SemiBold.ttf?url')),
      fontBytes(() => import('../export/fonts/InterTight-Bold.ttf?url')),
      fontBytes(() => import('../export/fonts/JetBrainsMono-Regular.ttf?url')),
      fontBytes(() => import('../export/fonts/JetBrainsMono-Bold.ttf?url')),
    ]);
    const { projectName, paper, app, units } = options;
    const pdf = await callSheetPdf({ sheet, projectName, paper, app, units, forecasts, fonts: { sans, sansSemiBold, sansBold, mono, monoBold } });
    await target.write(callSheetFileName(sheet.title || projectName, sheet.day.number, sheet.day.fields.date), pdf.bytes);
    const said = t('export.done', { what: t('callSheet.pdf.what'), label });
    if (pdf.replaced) showNotice(new Error(t('export.doneWarning', { said, warning: replacedWarning() })));
    else showInfo(said);
  } catch (error) {
    const reason = localizeError(error instanceof Error ? error.message : String(error));
    showNotice(new Error(label === '' ? t('export.failed', { reason }) : t('export.failedTo', { label, reason })));
  }
}

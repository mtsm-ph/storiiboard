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
import type { CallSheetPdf, PdfForecast } from './callSheetPdf';
import { callSheetFileName } from './callSheetName';
import { findForecast } from './forecast';
import { companyLogoBytes, sheetCompany } from './sheetCompany';
import { gatherSheetMaps } from './gatherSheetMaps';
import type { GatheredMap } from './sheetMap';

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
export const sheetNow = (o: ExportCallSheetOptions): CallSheet | null => callSheet(projectStore.getState().records, o.projectId, o.dayId, undefined, o.zones);

/** A place whose time zone hasn't come back yet has no sun or forecast to print; the sheet would go out without them. */
export const stillFindingZone = (sheet: CallSheet): boolean => sheet.locations.some((l) => l.place !== null && l.zone === null);

/** The maps gathered earlier that still fit (centred on the place the location has now), and again only the rest. */
async function mapsFor(sheet: CallSheet, gathered: ReadonlyMap<string, GatheredMap> | undefined): Promise<Map<string, GatheredMap>> {
  const maps = new Map<string, GatheredMap>();
  const changed = new Set<string>();
  for (const { record, place } of sheet.locations) {
    if (!place) continue;
    const map = gathered?.get(record.id);
    if (map && map.at.latitude === place.latitude && map.at.longitude === place.longitude) maps.set(record.id, map);
    else changed.add(record.id);
  }
  if (changed.size > 0) for (const [id, map] of await gatherSheetMaps(sheet, undefined, changed)) maps.set(id, map);
  return maps;
}

/**
 * The sheet as a PDF with the forecast it already holds and the bundled fonts. `issue` is the version and time an issued
 * sheet prints in its header (4.7); a sheet being exported has none.
 */
export async function makeCallSheetPdf(sheet: CallSheet, options: ExportCallSheetOptions, issue?: { version: number; issuedAt: Date }, gathered?: ReadonlyMap<string, GatheredMap>): Promise<CallSheetPdf> {
  // The company on the header (4.12): the project's own copy, taken now with the sheet (the fonts and maps below can take
  // seconds), its logo read from the file after.
  const state = projectStore.getState();
  const found = sheetCompany(state.records, options.projectId);
  const [{ callSheetPdf }, forecasts, maps, sans, sansSemiBold, sansBold, mono, monoBold] = await Promise.all([
    import('./callSheetPdf'),
    heldForecasts(sheet),
    // The map pictures: the tiles through the tile queue and Rust's cache, waiting up to 10 s, then what came (4.10). Ones
    // gathered earlier (Issue does it before reading the records) are used while the places are still the same.
    mapsFor(sheet, gathered),
    fontBytes(() => import('../export/fonts/InterTight-Regular.ttf?url')),
    fontBytes(() => import('../export/fonts/InterTight-SemiBold.ttf?url')),
    fontBytes(() => import('../export/fonts/InterTight-Bold.ttf?url')),
    fontBytes(() => import('../export/fonts/JetBrainsMono-Regular.ttf?url')),
    fontBytes(() => import('../export/fonts/JetBrainsMono-Bold.ttf?url')),
  ]);
  const { projectName, paper, app, units } = options;
  const company = found ? { name: found.name, logo: await companyLogoBytes(state.project?.file ?? null, found) } : null;
  return callSheetPdf({ sheet, company, projectName, paper, app, units, forecasts, maps, fonts: { sans, sansSemiBold, sansBold, mono, monoBold }, ...(issue ? { issue } : {}) });
}

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
    const pdf = await makeCallSheetPdf(sheet, options);
    await target.write(callSheetFileName(sheet.title || options.projectName, sheet.day.number, sheet.day.fields.date), pdf.bytes);
    const said = t('export.done', { what: t('callSheet.pdf.what'), label });
    if (pdf.replaced) showNotice(new Error(t('export.doneWarning', { said, warning: replacedWarning() })));
    else showInfo(said);
  } catch (error) {
    const reason = localizeError(error instanceof Error ? error.message : String(error));
    showNotice(new Error(label === '' ? t('export.failed', { reason }) : t('export.failedTo', { label, reason })));
  }
}
